import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFloating, shift, flip, offset, autoUpdate } from '@floating-ui/react';
import type { AnnotationDoc, Author, Body, Pin, Target } from './types';
import { allTargets, findTargetById, pinFraction, targetAtPoint, widenChain } from './target';
import { measure, useLayouts } from './layout';
import { clusterPins } from './cluster';
import { addReply, addThread, bodyText, removeThread, setThreadStatus } from './store';
import { DraftPin, OverlayRoot, PinButton, TargetOutline } from './Overlay';
import { TextComposer, type ComposerComponent } from './Composer';
import { ThreadList } from './Thread';
import './annotations.css';

/**
 * Controlled annotation layer for `kind: 'anno_id'` refs.
 *
 * The host owns the document. This component reads it, renders it, and hands
 * back a new one via `onChange` — it never keeps its own copy, which is what
 * makes the artefact/annotation round trip safe by construction.
 */
export interface AnnotationsProps {
  /** The artefact root. Targets outside it are ignored. */
  root: HTMLElement | null;
  annotations: AnnotationDoc;
  onChange: (next: AnnotationDoc) => void;
  author: Author;
  /** Swap for a radio set, emoji picker, rating… anything producing `Body[]`. */
  composer?: ComposerComponent;
  /** Where the toolbar and popovers mount. Defaults to `document.body`. */
  portalTo?: HTMLElement;
}

/** How long the pointer must rest before the label chip appears. */
const LABEL_DWELL_MS = 120;

export function Annotations({
  root,
  annotations,
  onChange,
  author,
  composer: Composer = TextComposer,
  portalTo,
}: AnnotationsProps) {
  const [commentMode, setCommentMode] = useState(false);
  const [pinsVisible, setPinsVisible] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [hover, setHover] = useState<Target | null>(null);
  const [showLabel, setShowLabel] = useState(false);
  const [draft, setDraft] = useState<{ target: Target; xPct: number; yPct: number } | null>(null);
  // Only the thread ids are stored; the Pin itself is derived from `pins` every
  // render. Holding the Pin object in state made the popover show a stale
  // snapshot — a reply would bump the pin's count but not appear in the open
  // thread, because the stored Pin still referenced the pre-reply Thread.
  const [openThreadIds, setOpenThreadIds] = useState<string[] | null>(null);

  // Remember the pin-visibility preference so entering comment mode can force
  // pins on (you must see existing threads to reply rather than duplicate)
  // and exiting can put it back.
  const restorePins = useRef(pinsVisible);

  const targets = useTargets(root);

  const visibleThreads = useMemo(
    () => annotations.threads.filter((t) => showResolved || t.status === 'open'),
    [annotations.threads, showResolved],
  );

  // Only measure targets that something actually needs: threads that reference
  // them, plus whatever is hovered or being composed against.
  const neededIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of visibleThreads) for (const r of t.refs) if (r.kind === 'anno_id') ids.add(r.id);
    if (hover) ids.add(hover.id);
    if (draft) ids.add(draft.target.id);
    return ids;
  }, [visibleThreads, hover, draft]);

  const needed = useMemo(() => targets.filter((t) => neededIds.has(t.id)), [targets, neededIds]);
  const layouts = useLayouts(root, needed);

  const { pins, unresolved } = useMemo(
    () => clusterPins(visibleThreads, layouts),
    [visibleThreads, layouts],
  );

  const openPin = useMemo(() => {
    if (!openThreadIds) return null;
    return pins.find((p) => p.threads.some((t) => openThreadIds.includes(t.id))) ?? null;
  }, [pins, openThreadIds]);

  const hoverLayout = hover ? layouts.get(hover.id) : undefined;
  const draftLayout = draft ? layouts.get(draft.target.id) : undefined;

  // ---- mode transitions ---------------------------------------------------

  const enterCommentMode = useCallback(() => {
    restorePins.current = pinsVisible;
    setPinsVisible(true);
    setCommentMode(true);
    setOpenThreadIds(null);
  }, [pinsVisible]);

  const exitCommentMode = useCallback(() => {
    setCommentMode(false);
    setPinsVisible(restorePins.current);
    setHover(null);
    setDraft(null);
  }, []);

  const toggleCommentMode = useCallback(() => {
    if (commentMode) exitCommentMode();
    else enterCommentMode();
  }, [commentMode, enterCommentMode, exitCommentMode]);

  // ---- hover tracking in comment mode ------------------------------------

  useEffect(() => {
    if (!commentMode || !root || draft) {
      setHover(null);
      return;
    }

    let dwell: number | undefined;
    // Tracked in a closure rather than read from state inside the updater:
    // setState updaters must be pure, so scheduling the dwell timer from inside
    // one is unreliable (StrictMode invokes updaters twice).
    let current: HTMLElement | null = null;

    const onMove = (e: PointerEvent) => {
      const next = targetAtPoint(root, e.clientX, e.clientY);
      if (next?.el === current) return;
      current = next?.el ?? null;

      // Outline appears immediately; the label waits for the pointer to settle.
      // Outline flicker reads as responsive, label flicker reads as broken —
      // and dragging across the decisions table crosses many cells.
      setHover(next);
      setShowLabel(false);
      window.clearTimeout(dwell);
      if (next) dwell = window.setTimeout(() => setShowLabel(true), LABEL_DWELL_MS);
    };

    const onLeave = () => {
      window.clearTimeout(dwell);
      current = null;
      setHover(null);
      setShowLabel(false);
    };

    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerdown', onMove, true);
    document.addEventListener('pointerleave', onLeave);
    return () => {
      window.clearTimeout(dwell);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerdown', onMove, true);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, [commentMode, root, draft]);

  // ---- click to target ----------------------------------------------------

  useEffect(() => {
    if (!commentMode || !root || draft) return;

    const onClick = (e: MouseEvent) => {
      if (!(e.target instanceof Node)) return;
      // Our own UI must stay clickable in comment mode.
      if (e.target instanceof HTMLElement && e.target.closest('[data-anno-ignore]')) return;

      const target = targetAtPoint(root, e.clientX, e.clientY);
      if (!target) return;

      // In comment mode a click means "comment on this", never "activate this".
      // The artefact has real controls — a Send button, a menu, a sort toggle —
      // so the click cannot mean both things at once.
      e.preventDefault();
      e.stopPropagation();

      setDraft({ target, ...pinFraction(target.el, e.clientX, e.clientY) });
      setHover(null);
    };

    // Capture phase, so the artefact's own handlers never see the click.
    window.addEventListener('click', onClick, true);
    return () => window.removeEventListener('click', onClick, true);
  }, [commentMode, root, draft]);

  // ---- keyboard -----------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Layered: a draft eats the first Escape, the popover the next, and
        // only then does comment mode exit.
        if (draft) setDraft(null);
        else if (openThreadIds) setOpenThreadIds(null);
        else if (commentMode) exitCommentMode();
        return;
      }
      // Don't steal `c` from a text field.
      const el = e.target as HTMLElement | null;
      const typing =
        el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (!typing && (e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        toggleCommentMode();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draft, openThreadIds, commentMode, exitCommentMode, toggleCommentMode]);

  // ---- document edits -----------------------------------------------------

  const commitDraft = (body: Body[]) => {
    if (!draft) return;
    const { target } = draft;
    const { doc } = addThread(annotations, {
      refs: [
        {
          kind: 'anno_id',
          id: target.id,
          // Snapshot label and semantics so the comment stays readable — to a
          // person and to a model — after the element stops existing.
          label: target.label,
          semantic: target.semantic,
        },
      ],
      pin: { xPct: draft.xPct, yPct: draft.yPct },
      author,
      body,
    });
    onChange(doc);
    setDraft(null);
  };

  const widenDraft = () => {
    if (!draft || !root) return;
    const chain = widenChain(root, draft.target);
    const next = chain[1];
    if (!next) return;
    // Keep the pin under the pointer by re-projecting the fraction into the
    // wider box, so the pin doesn't jump when the target changes.
    const from = draft.target.el.getBoundingClientRect();
    const px = from.left + draft.xPct * from.width;
    const py = from.top + draft.yPct * from.height;
    setDraft({ target: next, ...pinFraction(next.el, px, py) });
  };

  const draftWidenTo = useMemo(() => {
    if (!draft || !root) return undefined;
    return widenChain(root, draft.target)[1]?.label;
  }, [draft, root]);

  // ---- render -------------------------------------------------------------

  const host = portalTo ?? document.body;
  const openThreads = annotations.threads.filter((t) => t.status === 'open').length;
  const resolvedThreads = annotations.threads.length - openThreads;

  const documentPins = pins.filter((p) => p.layer === 'document');
  const viewportPins = pins.filter((p) => p.layer === 'viewport');

  return createPortal(
    <div className={`ca-root${commentMode ? ' ca-mode-comment' : ''}`} data-anno-ignore="">
      <Toolbar
        commentMode={commentMode}
        onToggleCommentMode={toggleCommentMode}
        pinsVisible={pinsVisible}
        onTogglePins={() => setPinsVisible((v) => !v)}
        openThreads={openThreads}
        resolvedThreads={resolvedThreads}
        showResolved={showResolved}
        onToggleResolved={() => setShowResolved((v) => !v)}
        unresolvedCount={unresolved.length}
      />

      {/* Hover affordance, comment mode only */}
      {commentMode && hoverLayout && !draft && (
        <OverlayRoot layer={hoverLayout.layer}>
          <TargetOutline layout={hoverLayout} showLabel={showLabel} />
        </OverlayRoot>
      )}

      {/* Draft: outline the chosen target and mark where the pin will land */}
      {draftLayout && draft && (
        <OverlayRoot layer={draftLayout.layer}>
          <TargetOutline layout={draftLayout} showLabel={false} />
          <DraftPin
            x={draftLayout.box.left + draft.xPct * draftLayout.box.width}
            y={draftLayout.box.top + draft.yPct * draftLayout.box.height}
          />
        </OverlayRoot>
      )}

      {/* Pins, split by positioning context */}
      {pinsVisible && (
        <>
          <OverlayRoot layer="document">
            {documentPins.map((p) => (
              <PinButton
                key={p.key}
                pin={p}
                active={openPin?.key === p.key}
                onSelect={(pin) => {
                  setDraft(null);
                  setOpenThreadIds((cur) =>
                    cur && pin.threads.some((t) => cur.includes(t.id))
                      ? null
                      : pin.threads.map((t) => t.id),
                  );
                }}
              />
            ))}
          </OverlayRoot>
          <OverlayRoot layer="viewport">
            {viewportPins.map((p) => (
              <PinButton
                key={p.key}
                pin={p}
                active={openPin?.key === p.key}
                onSelect={(pin) => {
                  setDraft(null);
                  setOpenThreadIds((cur) =>
                    cur && pin.threads.some((t) => cur.includes(t.id))
                      ? null
                      : pin.threads.map((t) => t.id),
                  );
                }}
              />
            ))}
          </OverlayRoot>
        </>
      )}

      {/* Composer for a new thread */}
      {draft && draftLayout && (
        <Popover
          anchorRect={anchorRectOf(draft.target)}
          onDismiss={() => setDraft(null)}
          title={draft.target.label}
        >
          <Composer onSubmit={commitDraft} onCancel={() => setDraft(null)} />
          {draftWidenTo && (
            <button className="ca-widen" onClick={widenDraft}>
              ↑ Widen to <b>{draftWidenTo}</b>
            </button>
          )}
        </Popover>
      )}

      {/* Existing threads */}
      {openPin && !draft && (
        <Popover
          anchorRect={pinRectOf(openPin)}
          onDismiss={() => setOpenThreadIds(null)}
          title={
            openPin.threads.length > 1 ? `${openPin.threads.length} threads` : undefined
          }
        >
          <ThreadList
            threads={openPin.threads}
            Composer={Composer}
            onReply={(id, body) => onChange(addReply(annotations, id, { author, body }))}
            onResolve={(id) => onChange(setThreadStatus(annotations, id, 'resolved'))}
            onReopen={(id) => onChange(setThreadStatus(annotations, id, 'open'))}
            onDeleteThread={(id) => {
              onChange(removeThread(annotations, id));
              setOpenThreadIds(null);
            }}
          />
        </Popover>
      )}

      {/* Threads whose refs don't resolve against this artefact */}
      {pinsVisible && unresolved.length > 0 && (
        <UnresolvedTray threads={unresolved} />
      )}
    </div>,
    host,
  );
}

// ---------------------------------------------------------------------------

function Toolbar({
  commentMode,
  onToggleCommentMode,
  pinsVisible,
  onTogglePins,
  openThreads,
  resolvedThreads,
  showResolved,
  onToggleResolved,
  unresolvedCount,
}: {
  commentMode: boolean;
  onToggleCommentMode: () => void;
  pinsVisible: boolean;
  onTogglePins: () => void;
  openThreads: number;
  resolvedThreads: number;
  showResolved: boolean;
  onToggleResolved: () => void;
  unresolvedCount: number;
}) {
  return (
    <div className="ca-toolbar" role="toolbar" aria-label="Comments">
      <button
        className={`ca-tool${pinsVisible ? ' ca-tool-on' : ''}`}
        onClick={onTogglePins}
        aria-pressed={pinsVisible}
        title="Show or hide all comments"
      >
        <span className="ca-tool-icon">💬</span>
        Comments
        <span className="ca-count">{openThreads}</span>
      </button>

      {/* A mode, not a verb — a review pass is many comments, so you stay in it
          until Escape rather than re-entering per comment. */}
      <button
        className={`ca-tool${commentMode ? ' ca-tool-active' : ''}`}
        onClick={onToggleCommentMode}
        aria-pressed={commentMode}
        title="Comment mode (C)"
      >
        <span className="ca-tool-icon">✚</span>
        {commentMode ? 'Commenting — Esc to exit' : 'Comment'}
        <kbd>C</kbd>
      </button>

      {resolvedThreads > 0 && (
        <button
          className={`ca-tool ca-tool-sm${showResolved ? ' ca-tool-on' : ''}`}
          onClick={onToggleResolved}
          aria-pressed={showResolved}
          title="Show resolved threads"
        >
          {showResolved ? 'Hiding none' : 'Show resolved'}
          <span className="ca-count">{resolvedThreads}</span>
        </button>
      )}

      {unresolvedCount > 0 && (
        <span className="ca-tool ca-tool-sm ca-tool-warn" title="Targets missing from this artefact">
          ⚠ {unresolvedCount} unanchored
        </span>
      )}
    </div>
  );
}

/**
 * Popover positioned by floating-ui, which handles flipping, shifting and
 * keeping the anchor tracked through scroll and resize.
 */
function Popover({
  anchorRect,
  onDismiss,
  title,
  children,
}: {
  anchorRect: () => DOMRect;
  onDismiss: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  const { refs, floatingStyles } = useFloating({
    placement: 'right-start',
    middleware: [offset(12), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
    elements: {
      reference: {
        getBoundingClientRect: anchorRect,
        // A virtual element needs no DOM node; floating-ui just needs the rect.
      } as unknown as Element,
    },
  });

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const node = refs.floating.current;
      if (!node) return;
      if (e.target instanceof Node && node.contains(e.target)) return;
      // Clicking a pin is handled by the pin itself; anything else dismisses.
      if (e.target instanceof HTMLElement && e.target.closest('.ca-pin')) return;
      onDismiss();
    };
    // Deferred so the click that opened the popover doesn't immediately close it.
    const id = window.setTimeout(() => window.addEventListener('pointerdown', onDown, true), 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [refs.floating, onDismiss]);

  return (
    <div ref={refs.setFloating} style={floatingStyles} className="ca-popover" data-anno-ignore="">
      {title && (
        <header className="ca-popover-head">
          <span className="ca-popover-title">commenting on: {title}</span>
        </header>
      )}
      {children}
    </div>
  );
}

function UnresolvedTray({ threads }: { threads: import('./types').Thread[] }) {
  const [open, setOpen] = useState(false);
  return (
    <aside className={`ca-tray${open ? ' ca-tray-open' : ''}`} data-anno-ignore="">
      <button className="ca-tray-toggle" onClick={() => setOpen((v) => !v)}>
        ⚠ {threads.length} comment{threads.length === 1 ? '' : 's'} without a target
      </button>
      {open && (
        <div className="ca-tray-body">
          {threads.map((t) => {
            const ref = t.refs.find((r) => r.kind === 'anno_id');
            return (
              <div key={t.id} className="ca-tray-item">
                {/* The snapshot is what keeps this readable with no element to
                    point at. Without it this row would just be a dead id. */}
                <span className="ca-tray-target">{ref?.label ?? ref?.id}</span>
                <span className="ca-tray-text">{bodyText(t.comments[0]?.body ?? [])}</span>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------

/** Live rect getter for floating-ui, so the popover tracks its target. */
function anchorRectOf(target: Target): () => DOMRect {
  return () => target.el.getBoundingClientRect();
}

function pinRectOf(pin: Pin): () => DOMRect {
  return () => {
    // Pin coords are in its layer's space; floating-ui wants viewport space.
    const x = pin.layer === 'document' ? pin.x - window.scrollX : pin.x;
    const y = pin.layer === 'document' ? pin.y - window.scrollY : pin.y;
    return new DOMRect(x - 12, y - 12, 24, 24);
  };
}

/** Live list of annotatable targets inside the artefact. */
function useTargets(root: HTMLElement | null): Target[] {
  const [targets, setTargets] = useState<Target[]>([]);

  useEffect(() => {
    if (!root) {
      setTargets([]);
      return;
    }
    const sync = () => setTargets(allTargets(root));
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(root, { subtree: true, childList: true, attributes: true });
    return () => mo.disconnect();
  }, [root]);

  return targets;
}

export { findTargetById, measure };
