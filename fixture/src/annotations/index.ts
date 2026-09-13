/**
 * Public surface of the annotation layer.
 *
 * Implements element, block-scoped text, and fractional region references.
 * Supports controlled documents, immutable rounds, and explicit revisions.
 * All reference variants anchor through the generated data-anno-id contract.
 */
export { Annotations, type AnnotationsProps } from './Annotations';
export { TextComposer, type ComposerProps, type ComposerComponent } from './Composer';
export {
  useAnnotations,
  emptyDoc,
  addThread,
  addReply,
  removeThread,
  removeComment,
  setThreadStatus,
  bodyText,
} from './store';
export type {
  AnnotationDoc,
  Thread,
  ThreadStatus,
  Comment,
  Author,
  Body,
  TextBody,
  ChoiceBody,
  Ref,
  AnnoIdRef,
  Target,
} from './types';

export { flattenAnnotations, closeRound, validateRevision, reconcileRevision } from './review';
export type { ManifestEntry, RevisionResult } from './review';
export type { TextRef, RegionRef, ReviewRound } from './types';
export { refsFromRange, rangeForRef, regionFromPoints } from './selection';

export { readManifest } from './manifest';
export { applyRevision } from './review';

export type { ReviewInsets, ReviewStatus } from './ReviewLayout';
