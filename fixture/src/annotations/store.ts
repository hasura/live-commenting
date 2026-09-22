/**
 * Document helpers and the uncontrolled convenience hook.
 *
 * Every helper takes a doc and returns a *new* doc. Nothing mutates in place:
 * React needs a fresh reference to re-render, and immutable updates make undo a
 * stack of docs rather than a diff algorithm.
 *
 * The library itself never owns the document. The host holds it and passes it
 * down, which is what satisfies the round-trip requirement by construction
 * rather than by discipline — the canonical copy is always the caller's. A
 * server-backed host derives the document from an event log instead of holding
 * it directly; `events.ts` turns the doc these helpers produce back into events.
 *
 * Each helper appends to the thread's `log` — the ordered record of comments,
 * resolves and reopens — and keeps `status` / `comments` as folds of it.
 */
import { useCallback, useMemo, useState } from 'react';
import type { AnnotationDoc, Author, Body, LogEntry, Ref, StatusEntry, Thread } from './types';

export const emptyDoc = (): AnnotationDoc => ({ version: 1, threads: [] });

/** Client-side ids double as idempotency keys once posted to a server. */
export const newId = () =>
  // crypto.randomUUID needs a secure context; fall back for plain http.
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** A thread's log; tolerates documents written before `log` existed. */
export const logOf = (t: Thread): LogEntry[] => t.log ?? t.comments.map((c) => ({ kind: 'comment' as const, ...c }));

const statusEntry = (kind: StatusEntry['kind'], by?: { author: Author; note?: string }): StatusEntry => ({
  kind,
  id: newId(),
  actor: by?.author ?? { id: 'unknown', name: 'Someone' },
  actorKind: 'user',
  at: new Date().toISOString(),
  ...(by?.note ? { note: by.note } : {}),
});

function append(t: Thread, entry: LogEntry): Thread {
  const log = [...logOf(t), entry];
  if (entry.kind === 'comment') {
    const { kind: _k, ...comment } = entry;
    return { ...t, log, comments: [...t.comments, comment] };
  }
  if (entry.kind === 'error') return { ...t, log };
  if (entry.kind === 'reopen') {
    const { resolution: _drop, ...rest } = t;
    return { ...rest, log, status: 'open' };
  }
  return { ...t, log, status: 'resolved', resolution: { actor: entry.actor, actorKind: entry.actorKind, at: entry.at, ...(entry.note ? { note: entry.note } : {}) } };
}

export function addThread(
  doc: AnnotationDoc,
  opts: { refs: Ref[]; pin?: { xPct: number; yPct: number }; author: Author; body: Body[]; notifyBot?: boolean },
): { doc: AnnotationDoc; thread: Thread } {
  const thread = append(
    { id: newId(), refs: opts.refs, pin: opts.pin, status: 'open', comments: [], log: [] },
    { kind: 'comment', id: newId(), author: opts.author, createdAt: new Date().toISOString(), body: opts.body, notifyBot: opts.notifyBot },
  );
  return { doc: { ...doc, threads: [...doc.threads, thread] }, thread };
}

/**
 * Reply. Replying to a resolved thread reopens it first: the reply is a signal
 * that the matter is not settled, and the log records that as a reopen entry
 * by the same author immediately before the comment.
 */
export function addReply(
  doc: AnnotationDoc,
  threadId: string,
  opts: { author: Author; body: Body[]; notifyBot?: boolean },
): AnnotationDoc {
  return {
    ...doc,
    threads: doc.threads.map((t) => {
      if (t.id !== threadId) return t;
      const reopened = t.status === 'resolved' ? append(t, statusEntry('reopen', { author: opts.author })) : t;
      return append(reopened, { kind: 'comment', id: newId(), author: opts.author, createdAt: new Date().toISOString(), body: opts.body, notifyBot: opts.notifyBot });
    }),
  };
}

/**
 * Resolve or reopen. A no-op when the thread is already in that state. `by`
 * names the actor for the log entry; a server-backed host will overwrite it
 * with the server's stamped actor when the event comes back.
 */
export function setThreadStatus(
  doc: AnnotationDoc,
  threadId: string,
  status: Thread['status'],
  by?: { author: Author; note?: string },
): AnnotationDoc {
  return {
    ...doc,
    threads: doc.threads.map((t) => {
      if (t.id !== threadId || t.status === status) return t;
      return append(t, statusEntry(status === 'resolved' ? 'resolve' : 'reopen', by));
    }),
  };
}

/** Flatten a body array to text, for previews and prompt serialisation. */
export const bodyText = (body: Body[]): string =>
  body
    .map((b) => (b.kind === 'rich' ? b.content.map(s => s.kind === 'newline' ? '\n' : s.kind === 'mention' ? '@' + s.label : s.text).join('') : b.kind === 'text' ? b.value : (b.label ?? b.value)))
    .filter(Boolean)
    .join(' · ');

/**
 * Uncontrolled convenience wrapper, for when the host doesn't want to hold
 * state itself. Mirrors `value` / `defaultValue` on a form input: the
 * controlled path is the real API, this is sugar over it.
 */
export function useAnnotations(initial?: AnnotationDoc) {
  const [doc, setDoc] = useState<AnnotationDoc>(() => initial ?? emptyDoc());
  const reset = useCallback((next?: AnnotationDoc) => setDoc(next ?? emptyDoc()), []);
  return useMemo(() => ({ doc, setDoc, reset }), [doc, reset]);
}