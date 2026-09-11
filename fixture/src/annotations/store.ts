/**
 * Document helpers and the uncontrolled convenience hook.
 *
 * Every helper takes a doc and returns a *new* doc. Nothing mutates in place:
 * React needs a fresh reference to re-render, and immutable updates make undo a
 * stack of docs rather than a diff algorithm.
 *
 * The library itself never owns the document. The host holds it and passes it
 * down, which is what satisfies the round-trip requirement by construction
 * rather than by discipline — the canonical copy is always the caller's.
 */
import { useCallback, useMemo, useState } from 'react';
import type { AnnotationDoc, Author, Body, Ref, Thread } from './types';

export const emptyDoc = (artifactVersion?: string): AnnotationDoc => ({
  version: 1,
  artifactVersion,
  threads: [],
});

const newId = () =>
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
      t.id === threadId && !t.closedRoundId
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

export function setThreadStatus(
  doc: AnnotationDoc,
  threadId: string,
  status: Thread['status'],
): AnnotationDoc {
  return {
    ...doc,
    threads: doc.threads.map((t) => (t.id === threadId && !t.closedRoundId ? { ...t, status } : t)),
  };
}

export function removeThread(doc: AnnotationDoc, threadId: string): AnnotationDoc {
  return { ...doc, threads: doc.threads.filter((t) => t.id !== threadId || t.closedRoundId) };
}

export function removeComment(doc: AnnotationDoc, threadId: string, commentId: string): AnnotationDoc {
  const thread = doc.threads.find((t) => t.id === threadId);
  if (!thread || thread.closedRoundId) return doc;
  // Deleting the root comment deletes the thread; a thread with no root has no
  // meaning and would render as an empty pin.
  if (thread.comments[0]?.id === commentId) return removeThread(doc, threadId);
  return {
    ...doc,
    threads: doc.threads.map((t) =>
      t.id === threadId ? { ...t, comments: t.comments.filter((c) => c.id !== commentId) } : t,
    ),
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
