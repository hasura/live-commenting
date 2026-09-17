/**
 * Public surface of the annotation layer.
 *
 * Implements element, block-scoped text, and fractional region references.
 * Supports controlled documents and, through `events`, a server-backed store
 * where the document is the fold of an append-only event log.
 * All reference variants anchor through the generated data-anno-id contract.
 */
export { Annotations, type AnnotationsProps } from './Annotations';
export { TextComposer, type ComposerProps, type ComposerComponent } from './Composer';
export {
  useAnnotations,
  emptyDoc,
  newId,
  addThread,
  addReply,
  setThreadStatus,
  bodyText,
  logOf,
} from './store';
export type {
  AnnotationDoc,
  Thread,
  ThreadStatus,
  LogEntry,
  CommentEntry,
  StatusEntry,
  Resolution,
  ActorKind,
  Comment,
  Author,
  Body,
  TextBody,
  ChoiceBody,
  Ref,
  AnnoIdRef,
  Target,
} from './types';
export type { TextRef, RegionRef } from './types';

export { flattenAnnotations } from './review';
export { applyEvent, foldEvents, diffDoc } from './events';
export type { AnnotationEvent, LocalEvent, EventKind } from './events';
export { refsFromRange, rangeForRef, regionFromPoints } from './selection';
export {
  DeviceBehaviorProvider, useDeviceBehavior,
  readDeviceCharacteristics, detectDeviceProfile, deriveDeviceBehavior,
} from './device';
export type {
  DeviceCharacteristics, DeviceProfile, EnterBehavior,
  DeviceBehavior, DeviceBehaviorOverrides,
} from './device';
