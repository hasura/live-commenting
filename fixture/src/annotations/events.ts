/**
 * The event log behind a server-backed document.
 *
 * A live-commenting server keeps one append-only log; every reader — every
 * open tab, and the owning bot — is a cursor into it. The document the layer
 * renders is `foldEvents(log)`, never stored on its own. Going the other way,
 * `diffDoc(prev, next)` turns the new document an `onChange` hands back into
 * the events that explain it, so the controlled `<Annotations>` API stays
 * exactly as it is and the host posts events instead of documents.
 *
 * DOM-free. The server's digest and the bot's tooling share these shapes.
 */
import type { ActorKind, AnnotationDoc, Author, Body, Ref, Thread } from './types';
import { bodyText, emptyDoc, newId } from './store';

export type EventKind = 'comment' | 'resolve' | 'reopen';

/** One row of the server's log, as returned by `/api/events`. */
export interface AnnotationEvent {
  /** Server-assigned, monotonic. The only ordering. */
  seq: number;
  /** Client-assigned idempotency key (`LocalEvent.id`); becomes the comment id. */
  id: string;
  thread_id: string;
  kind: EventKind;
  actor: Author & { kind: ActorKind };
  /** Comment body, or a resolve/reopen note. */
  body?: Body[];
  /** Opening comment only. */
  refs?: Ref[];
  pin?: { xPct: number; yPct: number };
  /** ISO 8601, stamped by the server. */
  created_at: string;
}

/** What a client posts. The server stamps actor, seq and time. */
export interface LocalEvent {
  id: string;
  thread_id: string;
  kind: EventKind;
  body?: Body[];
  refs?: Ref[];
  pin?: { xPct: number; yPct: number };
}

export function applyEvent(doc: AnnotationDoc, ev: AnnotationEvent): AnnotationDoc {
  const actor: Author = { id: ev.actor.id, name: ev.actor.name };
  const existing = doc.threads.find((t) => t.id === ev.thread_id);
  if (ev.kind === 'comment') {
    if (!ev.body) return doc;
    const comment = { id: ev.id, author: actor, createdAt: ev.created_at, body: ev.body };
    if (!existing) {
      if (!ev.refs?.length) return doc; // a reply to a thread we never saw open
      const thread: Thread = { id: ev.thread_id, refs: ev.refs, pin: ev.pin, status: 'open', comments: [comment] };
      return { ...doc, threads: [...doc.threads, thread] };
    }
    if (existing.comments.some((c) => c.id === ev.id)) return doc;
    return {
      ...doc,
      threads: doc.threads.map((t) => (t === existing ? { ...t, comments: [...t.comments, comment] } : t)),
    };
  }
  if (!existing) return doc;
  const status = ev.kind === 'resolve' ? 'resolved' : 'open';
  return {
    ...doc,
    threads: doc.threads.map((t) => {
      if (t !== existing) return t;
      if (status === 'open') {
        const { resolution: _drop, ...rest } = t;
        return { ...rest, status };
      }
      const note = ev.body ? bodyText(ev.body) : undefined;
      return { ...t, status, resolution: { actor, actorKind: ev.actor.kind, at: ev.created_at, ...(note ? { note } : {}) } };
    }),
  };
}

/** Events must be in `seq` order; this sorts defensively. */
export function foldEvents(events: readonly AnnotationEvent[], base: AnnotationDoc = emptyDoc()): AnnotationDoc {
  return [...events].sort((a, b) => a.seq - b.seq).reduce(applyEvent, base);
}

/**
 * The events that take `prev` to `next`: new threads, new replies, status
 * flips. Anything else (a removed thread, an edited comment) is not
 * expressible and is ignored — the log is append-only and comments are
 * immutable by design.
 */
export function diffDoc(prev: AnnotationDoc, next: AnnotationDoc): LocalEvent[] {
  const out: LocalEvent[] = [];
  const before = new Map(prev.threads.map((t) => [t.id, t]));
  for (const t of next.threads) {
    const old = before.get(t.id);
    const seen = new Set(old?.comments.map((c) => c.id) ?? []);
    t.comments.forEach((c, i) => {
      if (seen.has(c.id)) return;
      out.push({
        id: c.id,
        thread_id: t.id,
        kind: 'comment',
        body: c.body,
        ...(!old && i === 0 ? { refs: t.refs, pin: t.pin } : {}),
      });
    });
    if (old && old.status !== t.status) {
      out.push({ id: newId(), thread_id: t.id, kind: t.status === 'resolved' ? 'resolve' : 'reopen' });
    }
  }
  return out;
}