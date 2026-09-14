/**
 * The artifact-side annotation contract.
 *
 * This file has ZERO imports, by design. The generated artifact must not depend
 * on the annotation runtime — otherwise every artifact we ever ship is version-
 * locked to our library. All the artifact does is emit `data-anno-*` attributes.
 * The annotation layer mounts separately and reads them off the DOM.
 *
 * `anno()` spreads props rather than wrapping in a component: a wrapper element
 * would add DOM the artifact doesn't need, and would make *every* target a
 * zero-gap nest (the wrapper always exactly contains its child), manufacturing
 * the hardest hit-test case everywhere instead of only where it's real.
 */

export type AnnoMode =
  /** Click targets the whole node. The default; never needs emitting. */
  | 'block'
  /** Click targets the node; drag selects a sub-range. Implies `block`. */
  | 'text'
  /** Click targets the node; drag selects a sub-rect. Implies `block`. */
  | 'region';

/**
 * Structured extras, for machine consumption. Optional.
 *
 * This is where domain coordinates live — row, column, value, author. They are
 * snapshotted onto the comment at creation, so a comment stays meaningful to an
 * LLM after its element has stopped existing. Anything you'd want in a prompt
 * but couldn't recompute from the DOM belongs here.
 */
export interface AnnoSemantic {
  [key: string]: unknown;
}

export interface AnnoAttrs {
  'data-anno-id': string;
  'data-anno-label': string;
  'data-anno-mode'?: AnnoMode;
  'data-anno-semantic'?: string;
}

/**
 * Mark a node as annotatable.
 *
 * @param id     Unique within the artifact. That is the *only* hard constraint —
 *               `id125` is perfectly valid. The annotation layer never parses
 *               ids. Semantic ids (`wireframe.composer.send`) are worth
 *               preferring where they come naturally, because a generator
 *               regenerating from scratch may re-derive them and get anchor
 *               continuity for free — but it is a bonus, not a requirement.
 *               A block rewritten in response to a comment keeps its id, so
 *               the discussion stays attached to the new wording.
 *
 *               Ids must derive from *data identity*, never from list position.
 *               An index-derived id silently relocates every comment on reorder
 *               (planted case 9).
 *
 * @param label  Human- and LLM-readable name. No uniqueness or length
 *               constraint — descriptive beats terse, since this is what a
 *               reviewer and a model both read. Shown in the hover chip and in
 *               "commenting on: …".
 *
 * @param opts   `mode` defaults to `'block'` and is omitted from the DOM when
 *               it is the default. `semantic` is optional structured extras.
 */
export function anno(
  id: string,
  label: string,
  opts: { mode?: AnnoMode; semantic?: AnnoSemantic } = {},
): AnnoAttrs {
  const attrs: AnnoAttrs = {
    'data-anno-id': id,
    'data-anno-label': label,
  };
  // 'block' is implicit — don't emit the attribute for the common case.
  if (opts.mode && opts.mode !== 'block') attrs['data-anno-mode'] = opts.mode;
  if (opts.semantic) attrs['data-anno-semantic'] = JSON.stringify(opts.semantic);
  return attrs;
}

/** `anno()` with mode 'text' — prose that also supports sub-range selection. */
export const annoText = (
  id: string,
  label: string,
  semantic?: AnnoSemantic,
): AnnoAttrs => anno(id, label, { mode: 'text', semantic });

/** `anno()` with mode 'region' — figures that also support rectangle selection. */
export const annoRegion = (
  id: string,
  label: string,
  semantic?: AnnoSemantic,
): AnnoAttrs => anno(id, label, { mode: 'region', semantic });
