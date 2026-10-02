import { chartMarks } from './chart';
import { CHART_CHANGE } from '../chart';
/**
 * Mapping live targets to overlay geometry.
 *
 * The architecture, arrived at by getting it wrong twice:
 *
 * A single overlay container positioned in *document* coordinates is O(1) on
 * page scroll — the browser scrolls the container and every child moves for
 * free. That works for normal-flow content and is the right default.
 *
 * It is wrong for two kinds of target:
 *
 *   1. `position: sticky` / `fixed` — these do not move with the document, so a
 *      document-positioned outline drifts away from them as you scroll. This is
 *      planted case 7, and the fixture's dev inspector shipped with exactly
 *      this bug.
 *   2. Targets inside an inner scroll container — their screen position changes
 *      when that container scrolls, independently of the page, and they must
 *      additionally be *clipped* to it. This is planted case 6: without
 *      clipping, an outline for a message scrolled out of a comment panel gets
 *      painted 80px above the panel, over unrelated text.
 *
 * So: two containers. `document` keeps the O(1) win for the common case;
 * `viewport` handles the special cases at O(k) on scroll, where k is small.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LayerKind, Target, TargetLayout } from './types';

/**
 * Nearest ancestor that actually scrolls, bounded by `root`. Returns null when
 * the target is only clipped by the viewport.
 */
export function nearestScrollRoot(el: HTMLElement, root: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    const clips = /auto|scroll|hidden/.test(style.overflowY + style.overflowX);
    const overflows =
      node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1;
    if (clips && overflows) return node;
    if (node === root) break;
    node = node.parentElement;
  }
  return null;
}

/** Every scrolling ancestor, for clipping (a target may sit inside several). */
function scrollRoots(el: HTMLElement, root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  let node: HTMLElement | null = el;
  while (node) {
    const next = nearestScrollRoot(node, root);
    if (!next) break;
    out.push(next);
    node = next;
  }
  return out;
}

/** True when the element or an ancestor is taken out of document flow. */
function isViewportPositioned(el: HTMLElement, root: HTMLElement): boolean {
  let node: HTMLElement | null = el;
  while (node) {
    const pos = getComputedStyle(node).position;
    if (pos === 'fixed' || pos === 'sticky') return true;
    if (node === root) break;
    node = node.parentElement;
  }
  return false;
}

export function layerFor(el: HTMLElement, root: HTMLElement): LayerKind {
  if (isViewportPositioned(el, root)) return 'viewport';
  if (nearestScrollRoot(el, root)) return 'viewport';
  return 'document';
}

export function measure(target: Target, root: HTMLElement): TargetLayout {
  const layer = layerFor(target.el, root);
  const r = target.el.getBoundingClientRect();

  // Intersect every enclosing scroll container to get the visible window.
  let clip: TargetLayout['clip'] = null;
  for (const sr of scrollRoots(target.el, root)) {
    const c = sr.getBoundingClientRect();
    clip = clip
      ? {
          top: Math.max(clip.top, c.top),
          left: Math.max(clip.left, c.left),
          right: Math.min(clip.right, c.right),
          bottom: Math.min(clip.bottom, c.bottom),
        }
      : { top: c.top, left: c.left, right: c.right, bottom: c.bottom };
  }

  const hidden =
    (typeof target.el.checkVisibility === 'function' && !target.el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})) ||
    r.width === 0 ||
    r.height === 0 ||
    (clip !== null &&
      (r.bottom <= clip.top || r.top >= clip.bottom || r.right <= clip.left || r.left >= clip.right));

  return {
    ...(target.mode === 'chart'&&!hidden ? {chartMarks:chartMarks(target).marks} : {}),
    target,
    layer,
    box:
      layer === 'document'
        ? { top: r.top + window.scrollY, left: r.left + window.scrollX, width: r.width, height: r.height }
        : { top: r.top, left: r.left, width: r.width, height: r.height },
    clip,
    hidden,
  };
}

/**
 * `clip-path` for a box, from a viewport-coordinate clip rect. Insets are
 * relative to the box's own edges, so this works in either coordinate space.
 */
export function clipPathFor(layout: TargetLayout): string | undefined {
  if (!layout.clip) return undefined;
  const r = layout.target.el.getBoundingClientRect();
  const top = Math.max(0, layout.clip.top - r.top);
  const left = Math.max(0, layout.clip.left - r.left);
  const right = Math.max(0, r.right - layout.clip.right);
  const bottom = Math.max(0, r.bottom - layout.clip.bottom);
  if (!top && !left && !right && !bottom) return undefined;
  // Negative outsets would expand the box, so floor at 0 above.
  return `inset(${top}px ${right}px ${bottom}px ${left}px)`;
}

/** Is a point inside the clip window? Used to hide pins rather than slice them. */
export function pointVisible(layout: TargetLayout, x: number, y: number): boolean {
  if (!layout.clip) return true;
  // x/y arrive in the layer's space; convert document -> viewport to compare.
  const vx = layout.layer === 'document' ? x - window.scrollX : x;
  const vy = layout.layer === 'document' ? y - window.scrollY : y;
  return vx >= layout.clip.left && vx <= layout.clip.right && vy >= layout.clip.top && vy <= layout.clip.bottom;
}

/**
 * Track layout for a set of target ids.
 *
 * Recompute policy:
 * - scroll: only `viewport`-layer entries need it; `document` entries ride the
 *   container. A capturing listener is required to hear inner-scroll events.
 * - resize / DOM mutation: everything, since either can move anything.
 */
export function useLayouts(
  root: HTMLElement | null,
  targets: Target[],
  enabled = true,
): Map<string, TargetLayout> {
  const [layouts, setLayouts] = useState<Map<string, TargetLayout>>(new Map());
  const raf = useRef<number | null>(null);
  // Avoid re-running effects when only the array identity changed.
  const pendingAll = useRef(false);

  const remeasure = useCallback(
    (only: 'viewport' | 'all') => {
      if (!root || !enabled) {
        setLayouts((prev) => (prev.size ? new Map() : prev));
        return;
      }
      setLayouts((prev) => {
        const next = new Map(prev);
        for (const t of targets) {
          if (only === 'viewport') {
            const existing = prev.get(t.id);
            if (existing && existing.layer === 'document') continue;
          }
          // The element may have been replaced by a re-render; re-read it.
          const measured=measure(t,root),previous=prev.get(t.id);
          // Hiding a container cannot tell us whether its data disappeared.
          // Retain the last rendered view's membership until it can be measured.
          if(t.mode==='chart'&&measured.hidden&&previous&&'chartMarks' in previous)measured.chartMarks=previous.chartMarks;
          next.set(t.id,measured);
        }
        for (const id of next.keys()) {
          if (!targets.some((t) => t.id === id)) next.delete(id);
        }
        return next;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [root, enabled, targets],
  );

  const schedule = useCallback(
    (only: 'viewport' | 'all') => {
      if (only === 'all') pendingAll.current = true;
      if (raf.current !== null) return;
      raf.current = requestAnimationFrame(() => {
        raf.current = null;
        const full = pendingAll.current;
        pendingAll.current = false;
        remeasure(full ? 'all' : 'viewport');
      });
    },
    [remeasure],
  );

  useLayoutEffect(() => {
    remeasure('all');
  }, [remeasure]);

  useEffect(() => {
    if (!root || !enabled) return;

    const onScroll = () => schedule('viewport');
    const onResize = () => schedule('all');

    // capture:true so inner scroll containers are heard — scroll does not bubble.
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    root.addEventListener(CHART_CHANGE, onResize);

    const ro = new ResizeObserver(() => schedule('all'));
    ro.observe(root);
    const mo = new MutationObserver(() => schedule('all'));
    mo.observe(root, { subtree: true, childList: true, attributes: true });

    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      root.removeEventListener(CHART_CHANGE, onResize);
      ro.disconnect();
      mo.disconnect();
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [root, enabled, schedule]);

  return layouts;
}
