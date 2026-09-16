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
 * Nothing is folded away: every comment, resolve and reopen lands in the
 * thread's `log` in `seq` order, and `status` is derived from the status
 * entries in it. A reply on a resolved thread is two events, reopen then
 * comment — the store emits them in that order and the host posts them in
 * that order.
 *
 * DOM-free. The server's digest and the bot's tooling share these shapes.
 */
import type { ActorKind, AnnotationDoc, Author, Body, LogEntry, Ref, Thread } from './types';
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

function entryOf(ev: AnnotationEvent, actor: Author): LogEntry | null {
  if (ev.kind === 'comment') {
    if (!ev.body) return null;
    return { kind: 'comment', id: ev.id, author: actor, createdAt: ev.created_at, body: ev.body };
  }
  const note = ev.body ? bodyText(ev.body) : undefined;
  return { kind: ev.kind, id: ev.id, actor, actorKind: ev.actor.kind, at: ev.created_at, ...(note ? { note } : {}) };
}

/** Append one entry to a thread and refold its status from the log. */
function withEntry(t: Thread, entry: LogEntry): Thread {
  const log = [...t.log, entry];
  if (entry.kind === 'comment') return { ...t, log, comments: [...t.comments, stripKind(entry)] };
  if (entry.kind === 'reopen') {
    const { resolution: _drop, ...rest } = t;
    return { ...rest, log, status: 'open' };
  }
  return {
    ...t,
    log,
    status: 'resolved',
    resolution: { actor: entry.actor, actorKind: entry.actorKind, at: entry.at, ...(entry.note ? { note: entry.note } : {}) },
  };
}
const stripKind = (e: LogEntry & { kind: 'comment' }) => ({ id: e.id, author: e.author, createdAt: e.createdAt, body: e.body });

export function applyEvent(doc: AnnotationDoc, ev: AnnotationEvent): AnnotationDoc {
  const actor: Author = { id: ev.actor.id, name: ev.actor.name };
  const entry = entryOf(ev, actor);
  if (!entry) return doc;
  const existing = doc.threads.find((t) => t.id === ev.thread_id);
  if (!existing) {
    if (ev.kind !== 'comment' || !ev.refs?.length) return doc; // a reply/status for a thread we never saw open
    const thread: Thread = { id: ev.thread_id, refs: ev.refs, pin: ev.pin, status: 'open', comments: [], log: [] };
    return { ...doc, threads: [...doc.threads, withEntry(thread, entry)] };
  }
  if (existing.log.some((e) => e.id === ev.id)) return doc;
  return { ...doc, threads: doc.threads.map((t) => (t === existing ? withEntry(t, entry) : t)) };
}

/** Events must be in `seq` order; this sorts defensively. */
export function foldEvents(events: readonly AnnotationEvent[], base: AnnotationDoc = emptyDoc()): AnnotationDoc {
  return [...events].sort((a, b) => a.seq - b.seq).reduce(applyEvent, base);
}

/**
 * The events that take `prev` to `next`, in the order they should be posted:
 * the new log entries of each thread, as the store appended them (so a reply
 * on a resolved thread yields reopen, then comment). Anything else (a removed
 * thread, an edited comment) is not expressible and is ignored — the log is
 * append-only and comments are immutable by design.
 */
export function diffDoc(prev: AnnotationDoc, next: AnnotationDoc): LocalEvent[] {
  const out: LocalEvent[] = [];
  const before = new Map(prev.threads.map((t) => [t.id, t]));
  for (const t of next.threads) {
    const old = before.get(t.id);
    const seen = new Set(old?.log.map((e) => e.id) ?? []);
    let statusEmitted = false;
    let first = !old;
    for (const e of t.log) {
      if (seen.has(e.id)) continue;
      if (e.kind === 'comment') {
        out.push({ id: e.id, thread_id: t.id, kind: 'comment', body: e.body, ...(first ? { refs: t.refs, pin: t.pin } : {}) });
        first = false;
      } else {
        out.push({ id: e.id, thread_id: t.id, kind: e.kind, ...(e.note ? { body: [{ kind: 'text', value: e.note }] } : {}) });
        statusEmitted = true;
      }
    }
    // A host that flips `status` without logging it still gets its event.
    if (old && !statusEmitted && old.status !== t.status) {
      out.push({ id: newId(), thread_id: t.id, kind: t.status === 'resolved' ? 'resolve' : 'reopen' });
    }
  }
  return out;
}