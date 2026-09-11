/**
 * The persisted annotation document, and the ephemeral types derived from it.
 *
 * The split is load-bearing. `AnnotationDoc` is pure serialisable data that
 * round-trips through artefact regeneration untouched. Everything with a live
 * DOM reference, a pixel measurement, or a piece of UI state lives in the
 * ephemeral types and is *never* written back into the doc.
 *
 * The test for whether that separation held: "are comments visible" is per-user
 * view state. If it ever appears in `AnnotationDoc`, the concerns have leaked.
 * Same for pixel coordinates, cluster membership, and open/closed popovers.
 */

// ---------------------------------------------------------------------------
// Persisted
// ---------------------------------------------------------------------------

export interface AnnotationDoc {
  version: 1;
  /** Which artefact version the comments were written against. Drives the
   *  revision diff: compare id sets between versions to classify orphans. */
  artefactVersion?: string;
  threads: Thread[];
}

/**
 * A thread is the unit that carries a reference. Pins are *derived* from
 * threads at paint time and never stored — that is what makes "collapse nearby
 * pins", "stack several threads at one pin" and "swap inline pins for a margin
 * rail" all rendering changes rather than data migrations.
 */
export interface Thread {
  id: string;
  /**
   * Plural from day one. `anno_id` is the only kind implemented; a text range
   * spanning several annotated blocks will produce several refs rather than
   * silently widening to their common ancestor, which would corrupt the
   * semantic payload.
   */
  refs: Ref[];
  /** Where the pin sits within the target, as fractions of its box. Survives
   *  responsive reflow. Purely cosmetic — losing it misplaces a pin, losing the
   *  ref loses the comment. */
  pin?: { xPct: number; yPct: number };
  status: ThreadStatus;
  /** `comments[0]` is the root; the rest are replies. */
  comments: Comment[];
}

export type ThreadStatus = 'open' | 'resolved';

export interface Comment {
  id: string;
  author: Author;
  /** ISO 8601. */
  createdAt: string;
  /**
   * Free-form so the composer can be swapped without touching the schema — a
   * radio set or emoji picker emits a different body kind, not a different
   * document. Only `text` is implemented.
   */
  body: Body[];
}

export interface Author {
  id: string;
  name: string;
}

export type Body = TextBody | ChoiceBody;

export interface TextBody {
  kind: 'text';
  value: string;
}

/** Reserved for a radio/emoji composer. Not yet produced by any UI. */
export interface ChoiceBody {
  kind: 'choice';
  /** Which question was answered, when a composer asks more than one. */
  name?: string;
  value: string;
  label?: string;
}

/**
 * How a thread points at part of the artefact.
 *
 * `label` and `semantic` are *snapshots taken at creation*. That is the detail
 * that keeps an unresolvable comment readable — to a human in the tray and to a
 * model in a prompt — after its element has stopped existing. Without them an
 * unresolvable ref is just a dead id.
 */
export type Ref = AnnoIdRef;

export interface AnnoIdRef {
  kind: 'anno_id';
  id: string;
  label?: string;
  semantic?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Ephemeral — derived per frame, never persisted
// ---------------------------------------------------------------------------

/** A live annotatable element, as read off the DOM. */
export interface Target {
  id: string;
  el: HTMLElement;
  label: string;
  mode: 'block' | 'text' | 'region';
  semantic?: Record<string, unknown>;
}

/**
 * Which positioning context a target belongs to.
 *
 * - `document` — normal flow. Positioned once in document coordinates; page
 *   scroll moves the whole container for free, so this is O(1) per scroll.
 * - `viewport` — the target is `sticky`/`fixed`, or lives inside an inner
 *   scroll container, so its screen position changes independently of document
 *   scroll. Must be recomputed on scroll, but only a handful of targets qualify.
 */
export type LayerKind = 'document' | 'viewport';

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface TargetLayout {
  target: Target;
  layer: LayerKind;
  /** Document coordinates when `layer === 'document'`, else viewport. */
  box: Box;
  /** Viewport-coordinate clip from enclosing scroll containers, if any. */
  clip: { top: number; left: number; right: number; bottom: number } | null;
  /** True when clipped away entirely by a scroll container. */
  hidden: boolean;
}

/** A rendered pin: one or more threads sharing a screen position. */
export interface Pin {
  key: string;
  layer: LayerKind;
  /** Pin centre, in the coordinate space of `layer`. */
  x: number;
  y: number;
  hidden: boolean;
  threads: Thread[];
}
