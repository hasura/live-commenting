/**
 * Deriving pins from threads.
 *
 * Pins are never stored. Threads carry a ref and an optional fractional offset;
 * where a pin lands on screen is computed here, every frame. That is what makes
 * three separate asks fall out as rendering rules rather than schema changes:
 *
 *   - several threads on the same target  -> grouped by target, one pin, count
 *   - pins from different targets too close -> merged by proximity
 *   - inline pins swapped for a margin rail -> a different placement function
 *     over the same threads
 */
import type { Pin, Thread, TargetLayout } from './types';
import { pointVisible } from './layout';

/**
 * Merge pins whose centres fall within this many pixels.
 *
 * 60px is Hypothesis's bucket threshold (`BUCKET_GAP_SIZE` in
 * `src/annotator/util/buckets.ts`), which they use to cluster annotations in the
 * margin rail. Reused here rather than invented.
 */
export const CLUSTER_RADIUS = 60;

/** Pin radius, in px. A target smaller than twice this can't host one inside. */
export const PIN_RADIUS = 12;

/**
 * Place a single thread's pin inside its target.
 *
 * Stored `{xPct,yPct}` is where the reviewer actually clicked, so it survives
 * responsive reflow proportionally. When the target is too small to hold a pin
 * without covering itself (planted case 4 — a 16px icon button), the pin is
 * nudged just outside the top-right corner instead.
 */
function placeInTarget(layout: TargetLayout, thread: Thread) {
  const { box } = layout;
  const frac = thread.pin ?? { xPct: 1, yPct: 0 };
  const tooSmall = box.width < PIN_RADIUS * 2 || box.height < PIN_RADIUS * 2;

  if (tooSmall) {
    return { x: box.left + box.width, y: box.top };
  }
  return {
    x: box.left + frac.xPct * box.width,
    y: box.top + frac.yPct * box.height,
  };
}

/**
 * Group threads into pins.
 *
 * Two passes: first by target (so several threads on one element always share a
 * pin regardless of their offsets), then by proximity across targets (so a
 * dense grid doesn't turn into confetti).
 *
 * Threads whose refs don't resolve are not returned — the caller renders those
 * in a page-level tray instead.
 */
export function clusterPins(
  threads: Thread[],
  layouts: Map<string, TargetLayout>,
): { pins: Pin[]; unresolved: Thread[] } {
  const unresolved: Thread[] = [];
  const byTarget = new Map<string, { layout: TargetLayout; threads: Thread[] }>();

  for (const thread of threads) {
    // `anno_id` is the only implemented ref kind; take the first that resolves.
    const ref = thread.refs.find((r) => r.kind === 'anno_id' && layouts.has(r.id));
    if (!ref) {
      unresolved.push(thread);
      continue;
    }
    const layout = layouts.get(ref.id)!;
    const entry = byTarget.get(ref.id);
    if (entry) entry.threads.push(thread);
    else byTarget.set(ref.id, { layout, threads: [thread] });
  }

  // Pass 1 — one candidate per target.
  const candidates: Pin[] = [];
  for (const [id, { layout, threads: group }] of byTarget) {
    const { x, y } = placeInTarget(layout, group[0]);
    candidates.push({
      key: id,
      layer: layout.layer,
      x,
      y,
      hidden: layout.hidden || !pointVisible(layout, x, y),
      threads: group,
    });
  }

  // Pass 2 — merge across targets by proximity, within a layer.
  // Sorted so clustering is deterministic regardless of thread order.
  candidates.sort((a, b) => a.layer.localeCompare(b.layer) || a.y - b.y || a.x - b.x);

  const pins: Pin[] = [];
  for (const c of candidates) {
    const near = pins.find(
      (p) =>
        p.layer === c.layer &&
        !p.hidden === !c.hidden &&
        Math.hypot(p.x - c.x, p.y - c.y) < CLUSTER_RADIUS,
    );
    if (near) {
      // Keep the first position so the pin doesn't drift as threads merge in.
      near.threads = near.threads.concat(c.threads);
      near.key = `${near.key}+${c.key}`;
    } else {
      pins.push({ ...c, threads: [...c.threads] });
    }
  }

  return { pins, unresolved };
}

/** Total comments across a pin's threads, for the count badge. */
export const pinCount = (pin: Pin) => pin.threads.reduce((n, t) => n + t.comments.length, 0);
