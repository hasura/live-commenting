import { useCallback, useEffect, useRef, useState } from 'react';
import { SpecPage } from './fixture/SpecPage';
import { DevOverlay } from './dev/DevOverlay';
import { Annotations, emptyDoc, type AnnotationDoc } from './annotations';

/**
 * The separation that matters: the artefact lives inside #artefact-root and
 * knows nothing about annotation beyond emitting `data-anno-*`. Anything that
 * reads those attributes — the dev inspector, the annotation layer — mounts as
 * a sibling and is handed the root element.
 *
 * Keeping this boundary means generated artefacts never take a dependency on
 * the commenting runtime, so an artefact shipped today still works against a
 * library rewritten tomorrow.
 *
 * Note that the *host* owns the annotation document, not the library. That is
 * what makes the round trip safe: the same structure goes in at load and comes
 * back out on every change, so persistence stays entirely the host's concern.
 */

const STORAGE_KEY = 'annotation-fixture-doc';
const ARTEFACT_VERSION = 'spec-v0.3';

export default function App() {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<AnnotationDoc>(loadDoc);

  useEffect(() => setRoot(rootRef.current), []);

  // Persistence is the host's job. A sidecar in localStorage here; a JSON file
  // beside the artefact, or a row in a database, in production. The library
  // never knows which.
  const handleChange = useCallback((next: AnnotationDoc) => {
    setDoc(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private-mode or quota failures shouldn't lose the in-memory state.
    }
  }, []);

  return (
    <>
      <div id="artefact-root" ref={rootRef}>
        <SpecPage />
      </div>

      <Annotations
        root={root}
        annotations={doc}
        onChange={handleChange}
        // Placeholder identity. A real host passes its authenticated user.
        author={{ id: 'demo-user', name: 'Sam Rivera' }}
      />

      <DevOverlay doc={doc} onResetDoc={() => handleChange(emptyDoc(ARTEFACT_VERSION))} />
    </>
  );
}

function loadDoc(): AnnotationDoc {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AnnotationDoc;
      if (parsed?.version === 1 && Array.isArray(parsed.threads)) return parsed;
    }
  } catch {
    // Fall through to a fresh document rather than failing to boot.
  }
  return emptyDoc(ARTEFACT_VERSION);
}
