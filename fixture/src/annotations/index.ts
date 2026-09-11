/**
 * Public surface of the annotation layer.
 *
 * Implements `Ref.kind === 'anno_id'` — comments anchored to elements the
 * artefact declared with `data-anno-id`. Text ranges and image regions are
 * modelled in the schema (`refs` is an array, `Ref` is a union) but not
 * implemented.
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
