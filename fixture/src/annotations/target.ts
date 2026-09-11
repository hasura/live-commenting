/**
 * Reading annotatable targets off the DOM, and resolving a pointer to one.
 */
import type { Target } from './types';

export const ANNO_SELECTOR = '[data-anno-id]';

/** Marks our own UI so it can never become an annotation target. */
export const IGNORE_ATTR = 'data-anno-ignore';

export function readTarget(el: HTMLElement): Target | null {
  const id = el.dataset.annoId;
  if (!id) return null;

  let semantic: Record<string, unknown> | undefined;
  const raw = el.dataset.annoSemantic;
  if (raw) {
    try {
      semantic = JSON.parse(raw);
    } catch {
      // A malformed payload shouldn't make the element unannotatable.
      semantic = undefined;
    }
  }

  const mode = el.dataset.annoMode;
  return {
    id,
    el,
    // Fall back to the id so a target missing its label is still usable.
    label: el.dataset.annoLabel ?? id,
    mode: mode === 'text' || mode === 'region' ? mode : 'block',
    semantic,
  };
}

export function allTargets(root: HTMLElement): Target[] {
  const out: Target[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(ANNO_SELECTOR)) {
    if (el.closest(`[${IGNORE_ATTR}]`)) continue;
    const t = readTarget(el);
    if (t) out.push(t);
  }
  return out;
}

export function findTargetById(root: HTMLElement, id: string): Target | null {
  // Attribute values come from generated artefacts, so escape before querying.
  const sel = `[data-anno-id="${CSS.escape(id)}"]`;
  const el = root.querySelector<HTMLElement>(sel);
  return el ? readTarget(el) : null;
}

/**
 * Resolve a screen point to the target that should receive a comment.
 *
 * Uses `elementFromPoint` rather than rect containment, deliberately. Planted
 * case 3 is a count badge positioned *outside* its parent button's box: it is a
 * DOM child but its rectangle escapes the parent, so any rect-containment test
 * gets the wrong answer. DOM ancestry is the truth; rectangles are only for
 * drawing.
 *
 * `hitRoot` must have `pointer-events: none` (or be temporarily disabled) or it
 * will shadow the artefact.
 */
export function targetAtPoint(root: HTMLElement, x: number, y: number): Target | null {
  const el = document.elementFromPoint(x, y);
  if (!(el instanceof HTMLElement)) return null;
  if (!root.contains(el)) return null;
  if (el.closest(`[${IGNORE_ATTR}]`)) return null;

  const hit = el.closest<HTMLElement>(ANNO_SELECTOR);
  if (!hit || !root.contains(hit)) return null;
  return readTarget(hit);
}

/**
 * The chain of annotatable ancestors, innermost first, for the widen control.
 *
 * Widening is not a nicety. A table row is fully tiled by its cells, so every
 * pixel of the row belongs to some cell and nearest-ancestor hit-testing can
 * never resolve to the row — even though the row is a legitimate thing to
 * comment on ("this whole decision is wrong"). Planted case 1 is the same
 * problem with identical rectangles.
 */
export function widenChain(root: HTMLElement, from: Target): Target[] {
  const chain: Target[] = [];
  let el: HTMLElement | null = from.el;
  while (el) {
    const t = readTarget(el);
    if (t) chain.push(t);
    if (el === root) break;
    el = el.parentElement?.closest<HTMLElement>(ANNO_SELECTOR) ?? null;
  }
  return chain;
}

/** Where the click landed inside the target, as fractions of its box. */
export function pinFraction(el: HTMLElement, x: number, y: number) {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return { xPct: 0.5, yPct: 0.5 };
  return {
    xPct: clamp01((x - r.left) / r.width),
    yPct: clamp01((y - r.top) / r.height),
  };
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
