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
 */
import { useCallback, useMemo, useState } from 'react';
import type { AnnotationDoc, Author, Body, Ref, Thread } from './types';

export const emptyDoc = (): AnnotationDoc => ({ version: 1, threads: [] });

/** Client-side ids double as idempotency keys once posted to a server. */
export const newId = () =>
  // crypto.randomUUID needs a secure context; fall back for plain http.
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function addThread(
  doc: AnnotationDoc,
  opts: { refs: Ref[]; pin?: { xPct: number; yPct: number }; author: Author; body: Body[] },
): { doc: AnnotationDoc; thread: Thread } {
  const thread: Thread = {
    id: newId(),
    refs: opts.refs,
    pin: opts.pin,
    status: 'open',
    comments: [
      { id: newId(), author: opts.author, createdAt: new Date().toISOString(), body: opts.body },
    ],
  };
  return { doc: { ...doc, threads: [...doc.threads, thread] }, thread };
}

export function addReply(
  doc: AnnotationDoc,
  threadId: string,
  opts: { author: Author; body: Body[] },
): AnnotationDoc {
  return {
    ...doc,
    threads: doc.threads.map((t) =>
      t.id === threadId
        ? {
            ...t,
            comments: [
              ...t.comments,
              { id: newId(), author: opts.author, createdAt: new Date().toISOString(), body: opts.body },
            ],
          }
        : t,
    ),
  };
}

/**
 * Resolve or reopen. The `resolution` marker is filled in by whoever owns the
 * document: a server-backed host receives it from the server's event, a local
 * host may pass `by` to stamp it directly.
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
      if (status === 'open') {
        const { resolution: _drop, ...rest } = t;
        return { ...rest, status };
      }
      return {
        ...t,
        status,
        ...(by
          ? { resolution: { actor: by.author, actorKind: 'user' as const, at: new Date().toISOString(), note: by.note } }
          : {}),
      };
    }),
  };
}

/** Flatten a body array to text, for previews and prompt serialisation. */
export const bodyText = (body: Body[]): string =>
  body
    .map((b) => (b.kind === 'text' ? b.value : (b.label ?? b.value)))
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