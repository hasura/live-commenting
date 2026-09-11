import type { Ref, TextRef, RegionRef, Target, TargetLayout, Box } from './types';
import { readTarget } from './target';

export const snapshotRef = (target: Target): Ref => ({
  kind: 'anno_id', id: target.id, label: target.label, semantic: target.semantic,
});

/** UTF-16 offsets relative to this block's textContent, not document offsets. */
function offsetIn(el: HTMLElement, node: Node, offset: number) {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.setEnd(node, offset);
  return r.toString().length;
}

/** Split by nearest declared target; atomic blocks never become partial text refs. */
export function refsFromRange(root: HTMLElement, range: Range): Ref[] {
  if (range.collapsed || !root.contains(range.startContainer) || !root.contains(range.endContainer)) return [];
  const refs: Ref[] = [];
  const atomic = new Set<string>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (!range.intersectsNode(node)) continue;
    const parent = node.parentElement;
    if (!parent || parent.closest('[data-anno-ignore]')) continue;
    const owner = parent.closest<HTMLElement>('[data-anno-id]');
    if (!owner || !root.contains(owner)) continue;
    const target = readTarget(owner);
    if (!target) continue;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : (node.textContent?.length ?? 0);
    if (end <= start) continue;
    const part = document.createRange();
    part.setStart(node, start); part.setEnd(node, end);
    if (!part.getClientRects().length) continue;
    if (target.mode !== 'text') {
      if (!atomic.has(target.id)) { refs.push(snapshotRef(target)); atomic.add(target.id); }
      continue;
    }
    const a = offsetIn(owner, node, start), b = offsetIn(owner, node, end);
    const previous = refs.at(-1);
    if (previous?.kind === 'text' && previous.id === target.id && previous.end === a) {
      previous.end = b; previous.quote += part.toString();
    } else {
      refs.push({ ...snapshotRef(target), kind: 'text', start: a, end: b, quote: part.toString() });
    }
  }
  // Images/empty atomic blocks contribute no text nodes. Snap those when crossed.
  for (const el of root.querySelectorAll<HTMLElement>('[data-anno-id]')) {
    const target = readTarget(el);
    if (!target || target.mode === 'text' || el.textContent?.length || atomic.has(target.id) ||
        el.closest('[data-anno-ignore]') || !range.intersectsNode(el)) continue;
    refs.push(snapshotRef(target));
  }
  return refs;
}

export function rangeForRef(el: HTMLElement, ref: TextRef): Range | null {
  const text = el.textContent ?? '';
  if (!Number.isInteger(ref.start) || !Number.isInteger(ref.end) || ref.start < 0 ||
      ref.end <= ref.start || ref.end > text.length || text.slice(ref.start, ref.end) !== ref.quote) return null;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node: Node | null, pos = 0, started = false;
  const r = document.createRange();
  while ((node = walker.nextNode())) {
    const len = node.textContent?.length ?? 0;
    if (!started && ref.start < pos + len) { r.setStart(node, ref.start - pos); started = true; }
    if (started && ref.end <= pos + len) { r.setEnd(node, ref.end - pos); return r; }
    pos += len;
  }
  return null;
}

export function validRef(ref: Ref, layout: TargetLayout) {
  if (ref.kind === 'text') return rangeForRef(layout.target.el, ref) !== null;
  if (ref.kind === 'region') return [ref.xPct, ref.yPct, ref.wPct, ref.hPct].every(Number.isFinite) &&
    ref.xPct >= 0 && ref.yPct >= 0 && ref.wPct > 0 && ref.hPct > 0 &&
    ref.xPct + ref.wPct <= 1.000001 && ref.yPct + ref.hPct <= 1.000001;
  return true;
}

export function regionFromPoints(target: Target, x1: number, y1: number, x2: number, y2: number): RegionRef {
  const r = target.el.getBoundingClientRect();
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const x = clamp((x1-r.left)/r.width), y = clamp((y1-r.top)/r.height);
  const ex = clamp((x2-r.left)/r.width), ey = clamp((y2-r.top)/r.height);
  return { ...snapshotRef(target), kind: 'region', xPct: Math.min(x,ex), yPct: Math.min(y,ey), wPct: Math.abs(x-ex), hPct: Math.abs(y-ey) };
}

/** Return clipped boxes in the SAME coordinate space as existing overlay layers. */
export function refBoxes(ref: Ref, layout: TargetLayout): Box[] {
  if (layout.hidden || !validRef(ref, layout)) return [];
  const { box, layer, clip } = layout;
  let rects: Box[];
  if (ref.kind === 'text') {
    rects = [...rangeForRef(layout.target.el, ref)!.getClientRects()].map(r => ({
      left: r.left + (layer === 'document' ? window.scrollX : 0),
      top: r.top + (layer === 'document' ? window.scrollY : 0), width: r.width, height: r.height,
    }));
  } else if (ref.kind === 'region') {
    rects = [{left: box.left+ref.xPct*box.width, top: box.top+ref.yPct*box.height,
      width: ref.wPct*box.width, height: ref.hPct*box.height}];
  } else rects = [box];
  if (!clip) return rects;
  const sx = layer === 'document' ? window.scrollX : 0, sy = layer === 'document' ? window.scrollY : 0;
  return rects.map(r => {
    const left = Math.max(r.left,clip.left+sx), top = Math.max(r.top,clip.top+sy);
    return { left,top,width: Math.max(0,Math.min(r.left+r.width,clip.right+sx)-left),
      height: Math.max(0,Math.min(r.top+r.height,clip.bottom+sy)-top) };
  }).filter(r => r.width > 0 && r.height > 0);
}