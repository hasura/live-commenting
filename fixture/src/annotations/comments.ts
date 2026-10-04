import type { Ref, TargetLayout, Thread, ThreadStatus } from './types';
import { validRef } from './selection';

export type CommentStatusFilter = 'all' | ThreadStatus;

export const matchesStatus = (thread: Thread, filter: CommentStatusFilter) =>
  filter === 'all' || thread.status === filter;

/** Missing/invalid references are different from offscreen or clipped targets. */
export function anchoredRefs(thread: Thread, layouts: Map<string, TargetLayout>) {
  return thread.refs.flatMap(ref => {
    const layout = layouts.get(ref.id);
    return layout?.target.el.isConnected && validRef(ref, layout) ? [{ ref, layout }] : [];
  });
}

type Anchor = { ref: Ref; layout: TargetLayout };

function compareAnchors(a: Anchor, b: Anchor) {
  const ae = a.layout.target.el, be = b.layout.target.el;
  // Logical page order, not viewport coordinates: scrolling sticky headers or
  // nested panes must never shuffle the reader.
  if (ae !== be) {
    const position = ae.compareDocumentPosition(be);
    if (!(position & Node.DOCUMENT_POSITION_DISCONNECTED)) {
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    }
  }
  const position = (ref: Ref) => ref.kind === 'text' ? [ref.start, 0]
    : ref.kind === 'region' ? [ref.yPct, ref.xPct] : [0, 0];
  const [ay, ax] = position(a.ref), [by, bx] = position(b.ref);
  return ay - by || ax - bx;
}

/** Start from the document, not pins + unresolved (those collections overlap). */
export function commentsInPageOrder(threads: Thread[], layouts: Map<string, TargetLayout>) {
  const unique = [...new Map(threads.map(thread => [thread.id, thread])).values()];
  const refs = new Map(unique.map(thread => [thread.id, anchoredRefs(thread, layouts)]));
  // Navigation uses the same first valid ref as marker placement; ordering uses
  // the earliest valid reference on the page, even for reverse-order refs.
  const anchors = new Map(unique.map(thread => [thread.id, refs.get(thread.id)![0]]));
  const firstOnPage = new Map(unique.map(thread => [thread.id, [...refs.get(thread.id)!].sort(compareAnchors)[0]]));
  const ordered = unique.sort((a, b) => {
    const aa = firstOnPage.get(a.id), ba = firstOnPage.get(b.id);
    if (aa && ba) {
      const order = compareAnchors(aa, ba);
      if (order) return order;
    } else if (!!aa !== !!ba) return aa ? -1 : 1;
    return (a.comments[0]?.createdAt ?? '').localeCompare(b.comments[0]?.createdAt ?? '') ||
      a.id.localeCompare(b.id);
  });
  const unanchoredIds = new Set(unique.filter(thread =>
    !thread.refs.length || thread.refs.some(ref => {
      const layout = layouts.get(ref.id);
      return !layout?.target.el.isConnected || !validRef(ref, layout);
    })).map(thread => thread.id));
  return { ordered, anchors, unanchoredIds };
}