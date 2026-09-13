import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFloating, shift, flip, offset, autoUpdate } from '@floating-ui/react';
import type { AnnotationDoc, Author, Body, Pin, Target, Ref } from './types';
import { allTargets, findTargetById, pinFraction, targetAtPoint, widenChain } from './target';
import { measure, useLayouts } from './layout';
import { clusterPins } from './cluster';
import { addReply, addThread, bodyText, removeThread, setThreadStatus } from './store';
import { DraftPin, OverlayRoot, PinButton, TargetOutline } from './Overlay';
import { TextComposer, type ComposerComponent } from './Composer';
import { ThreadList } from './Thread';
import './annotations.css';
import { useReviewViewport, useElementHeight, type ReviewInsets, type ReviewStatus } from './ReviewLayout';
import { snapshotRef, refsFromRange, regionFromPoints, refBoxes } from './selection';

/**
 * Controlled annotation layer for `kind: 'anno_id'` refs.
 *
 * The host owns the document. This component reads it, renders it, and hands
 * back a new one via `onChange` — it never keeps its own copy, which is what
 * makes the artifact/annotation round trip safe by construction.
 */
export interface AnnotationsProps {
  /** The artifact root. Targets outside it are ignored. */
  root: HTMLElement | null;
  annotations: AnnotationDoc;
  onChange: (next: AnnotationDoc) => void;
  author: Author;
  /** Swap for a radio set, emoji picker, rating… anything producing `Body[]`. */
  composer?: ComposerComponent;
  /** Where the toolbar and popovers mount. Defaults to `document.body`. */
  portalTo?: HTMLElement;
  toolbarActions?: React.ReactNode;
  readOnly?: boolean;
  /** Host-owned delivery state; preferred over a custom toolbar action. */
  review?: ReviewStatus;
  /** Reserve these insets in the host shell and offset sticky headers. */
  onLayoutChange?: (insets: ReviewInsets) => void;
  /** True while a new comment/reply editor is open, including minimized drafts. */
  onDraftStateChange?: (hasUnpostedContent: boolean) => void;
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
  toolbarActions,
  readOnly = false,
  review,
  onLayoutChange,
  onDraftStateChange,
}: AnnotationsProps) {
  const [commentMode, setCommentMode] = useState(false);
  const [pinsVisible, setPinsVisible] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [hover, setHover] = useState<Target | null>(null);
  const [showLabel, setShowLabel] = useState(false);
  const [draft, setDraft] = useState<{ target: Target; xPct: number; yPct: number; refs?: Ref[] } | null>(null);
  // Only the thread ids are stored; the Pin itself is derived from `pins` every
  // render. Holding the Pin object in state made the popover show a stale
  // snapshot — a reply would bump the pin's count but not appear in the open
  // thread, because the stored Pin still referenced the pre-reply Thread.
  const [openThreadIds, setOpenThreadIds] = useState<string[] | null>(null);

  // Minimize rather than unmount: custom composers and reply state survive
  // outside taps, Escape, mode changes and viewport transitions.
  const [surfaceHidden, setSurfaceHidden] = useState(false);
  const [replyEditing, setReplyEditing] = useState(false);
  // Conservatively protect every mounted composer, including custom editors
  // that do not report their contents. Only Add/Cancel end an editing session.
  const dirty = draft !== null || replyEditing;
  const view = useReviewViewport();
  const [toolbarElement, setToolbarElement] = useState<HTMLDivElement | null>(null);
  const [panelElement, setPanelElement] = useState<HTMLDivElement | null>(null);
  const headerHeight = useElementHeight(toolbarElement);
  const panelHeight = useElementHeight(panelElement);
  const footerHeight = view.compact && !surfaceHidden ? panelHeight : 0;
  useEffect(() => { onLayoutChange?.({top: headerHeight, bottom: footerHeight}); },
    [headerHeight, footerHeight, onLayoutChange]);
  useEffect(() => { onDraftStateChange?.(dirty); }, [dirty, onDraftStateChange]);
  const dismiss = useCallback(() => setSurfaceHidden(true), []);
  const discardDraft = () => { setDraft(null); setSurfaceHidden(false); };

  const suppressClick = useRef(0);
  const [regionPreview, setRegionPreview] = useState<Ref | null>(null);

  const targets = useTargets(root);

  const visibleThreads = useMemo(
    () => annotations.threads.filter((t) => showResolved || t.status === 'open'),
    [annotations.threads, showResolved],
  );

  // Only measure targets that something actually needs: threads that reference
  // them, plus whatever is hovered or being composed against.
  const neededIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of visibleThreads) for (const r of t.refs) ids.add(r.id);
    if (hover) ids.add(hover.id);
    if (draft) { ids.add(draft.target.id); draft.refs?.forEach(r => ids.add(r.id)); }
    if (regionPreview) ids.add(regionPreview.id);
    return ids;
  }, [visibleThreads, hover, draft, regionPreview]);

  const needed = useMemo(() => targets.filter((t) => neededIds.has(t.id)), [targets, neededIds]);
  const layouts = useLayouts(root, needed);

  const { pins, unresolved } = useMemo(
    () => clusterPins(visibleThreads, layouts),
    [visibleThreads, layouts],
  );

  const lastOpenPin = useRef<Pin | null>(null);
  const resolvedOpenPin = useMemo(() => {
    if (!openThreadIds) return null;
    return pins.find((p) => p.threads.some((t) => openThreadIds.includes(t.id))) ?? null;
  }, [pins, openThreadIds]);
  useEffect(() => { if (resolvedOpenPin) lastOpenPin.current = resolvedOpenPin; }, [resolvedOpenPin]);
  const retainedPin = replyEditing ? lastOpenPin.current : null;
  const openPin = resolvedOpenPin ?? (retainedPin ? {...retainedPin,
    threads: retainedPin.threads.map(t => annotations.threads.find(next => next.id === t.id) ?? t),
  } : null);

  const hoverLayout = hover ? layouts.get(hover.id) : undefined;
  const draftLayout = draft ? layouts.get(draft.target.id) : undefined;

  useEffect(() => { if (readOnly) { setCommentMode(false);setSurfaceHidden(true);setHover(null); } },[readOnly]);

  // ---- mode transitions ---------------------------------------------------

  const enterCommentMode = useCallback(() => {
    if (readOnly) return;
    setPinsVisible(true);
    setCommentMode(true);
    if (!dirty) setOpenThreadIds(null);
  }, [dirty, readOnly]);

  const exitCommentMode = useCallback(() => {
    setCommentMode(false);
    setPinsVisible(true);
    setHover(null);
    setSurfaceHidden(true);
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
    if (!commentMode || !root || readOnly) return;

    const onClick = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest('[data-anno-ignore]')) return;
      if (Date.now() < suppressClick.current) { e.preventDefault(); e.stopPropagation(); return; }
      if (!(e.target instanceof Node)) return;
      if (draft || dirty) {
        if (targetAtPoint(root, e.clientX, e.clientY)) {
          e.preventDefault(); e.stopPropagation(); setSurfaceHidden(false);
        }
        return;
      }
      // Our own UI must stay clickable in comment mode.
      if (e.target instanceof HTMLElement && e.target.closest('[data-anno-ignore]')) return;

      const target = targetAtPoint(root, e.clientX, e.clientY);
      if (!target) return;

      // In comment mode a click means "comment on this", never "activate this".
      // The artifact has real controls — a Send button, a menu, a sort toggle —
      // so the click cannot mean both things at once.
      e.preventDefault();
      e.stopPropagation();

      setSurfaceHidden(false);
      setOpenThreadIds(null);
      setDraft({ target, ...pinFraction(target.el, e.clientX, e.clientY) });
      setHover(null);
    };

    // Capture phase, so the artifact's own handlers never see the click.
    window.addEventListener('click', onClick, true);
    return () => window.removeEventListener('click', onClick, true);
  }, [commentMode, root, draft, dirty, readOnly]);

  // Drag gestures: native text selection; pointer-drag for a region.
  useEffect(() => {
    if (!commentMode || !root || draft || dirty || readOnly) return;
    const regions = [...root.querySelectorAll<HTMLElement>('[data-anno-mode="region"]')].map(el=>({el,touch:el.style.touchAction}));
    regions.forEach(({el})=>el.style.touchAction='none');
    let drag: { target: Target; x: number; y: number; pointerId: number } | null = null;
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const target = targetAtPoint(root,e.clientX,e.clientY);
      if (!target) return;
      drag = {target,x:e.clientX,y:e.clientY,pointerId:e.pointerId};
      if (target.mode === 'region') {
        e.preventDefault();
        target.el.setPointerCapture(e.pointerId);
      }
    };
    const move = (e: PointerEvent) => {
      if (!drag || drag.target.mode !== 'region') return;
      e.preventDefault();
      setRegionPreview(regionFromPoints(drag.target,drag.x,drag.y,e.clientX,e.clientY));
    };
    const up = (e: PointerEvent) => {
      if (!drag) return;
      const d = drag; drag = null;
      setRegionPreview(null);
      if (Math.hypot(e.clientX-d.x,e.clientY-d.y) < 5) return;
      let refs: Ref[] = [];
      if (d.target.mode === 'region') {
        const region = regionFromPoints(d.target,d.x,d.y,e.clientX,e.clientY);
        if (region.wPct > 0 && region.hPct > 0) refs = [region];
      } else {
        const selection = window.getSelection();
        if (selection?.rangeCount) refs = refsFromRange(root,selection.getRangeAt(0));
      }
      suppressClick.current = Date.now()+400;
      if (!refs.length) return;
      const target = findTargetById(root,refs[0].id);
      if (!target) return;
      window.getSelection()?.removeAllRanges();
      setSurfaceHidden(false);
      setOpenThreadIds(null);
      setDraft({target,refs,...pinFraction(target.el,d.x,d.y)});
      setHover(null);
    };
    const cancel = () => { drag = null; setRegionPreview(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && drag) { suppressClick.current = Date.now()+400; cancel(); } };
    const noImageDrag = (e: DragEvent) => { if (drag?.target.mode === 'region') e.preventDefault(); };
    root.addEventListener('pointerdown',down,true);
    window.addEventListener('pointermove',move,{capture:true,passive:false});
    window.addEventListener('pointerup',up,true);
    window.addEventListener('pointercancel',cancel,true);
    window.addEventListener('keydown',key,true);
    root.addEventListener('dragstart',noImageDrag);
    return () => {
      regions.forEach(({el,touch})=>el.style.touchAction=touch);
      root.removeEventListener('pointerdown',down,true);
      window.removeEventListener('pointermove',move,true);
      window.removeEventListener('pointerup',up,true);
      window.removeEventListener('pointercancel',cancel,true);
      window.removeEventListener('keydown',key,true);
      root.removeEventListener('dragstart',noImageDrag);
    };
  },[commentMode,root,draft,dirty,readOnly]);

  // ---- keyboard -----------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if ((draft || openThreadIds) && !surfaceHidden) dismiss();
        else if (commentMode) exitCommentMode();
        return;
      }
      // Keyboard users can select native text, then explicitly annotate it.
      if (e.key === 'Enter' && e.altKey && root && !readOnly && !draft && !dirty) {
        const selection = window.getSelection();
        if (selection?.rangeCount) {
          const refs = refsFromRange(root,selection.getRangeAt(0));
          const target = refs[0] ? findTargetById(root,refs[0].id) : null;
          if (target) {
            e.preventDefault(); selection?.removeAllRanges();
            setSurfaceHidden(false); setOpenThreadIds(null);
            setDraft({target,refs,xPct:0,yPct:0}); setPinsVisible(true);
          }
        }
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draft, openThreadIds, commentMode, exitCommentMode, root, readOnly, surfaceHidden, dirty, dismiss]);

  // ---- document edits -----------------------------------------------------

  const commitDraft = (body: Body[]) => {
    if (!draft || readOnly) return;
    const { target } = draft;
    const { doc } = addThread(annotations, {
      refs: draft.refs ?? [snapshotRef(target)],
      pin: { xPct: draft.xPct, yPct: draft.yPct },
      author,
      body,
    });
    onChange(doc);
    discardDraft();
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
    if (!draft || !root || draft.refs) return undefined;
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
        actions={toolbarActions}
        review={review}
        readOnly={readOnly}
        hasDraft={dirty}
        resume={surfaceHidden && (draft !== null || dirty) ? () => { setSurfaceHidden(false); setPinsVisible(true); } : undefined}
        toolbarRef={setToolbarElement}
        top={view.top} left={view.left} width={view.width}
        commentMode={commentMode}
        onToggleCommentMode={toggleCommentMode}
        pinsVisible={pinsVisible}
        onTogglePins={() => { setPinsVisible(v => !v); setSurfaceHidden(true); }}
        openThreads={openThreads}
        resolvedThreads={resolvedThreads}
        showResolved={showResolved}
        onToggleResolved={() => setShowResolved((v) => !v)}
        unresolvedCount={unresolved.length}
      />

      {([...(pinsVisible ? visibleThreads : []).flatMap(t => t.refs.filter(r => r.kind !== 'anno_id')),
           ...(draft?.refs ?? []), ...(regionPreview ? [regionPreview] : [])]).map((ref,i) => {
        const layout = layouts.get(ref.id);
        if (!layout) return null;
        return <OverlayRoot key={`${ref.id}-${i}`} layer={layout.layer}>
          {refBoxes(ref,layout).map((box,j) => <div key={j}
            className={`ca-selection ca-selection-${ref.kind}`} style={{position:'absolute',...box}} />)}
        </OverlayRoot>;
      })}

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
                  if (dirty || draft) { setSurfaceHidden(false); return; }
                  setSurfaceHidden(false);
                  setOpenThreadIds((cur) =>
                    !surfaceHidden && cur && pin.threads.some((t) => cur.includes(t.id))
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
                  if (dirty || draft) { setSurfaceHidden(false); return; }
                  setSurfaceHidden(false);
                  setOpenThreadIds((cur) =>
                    !surfaceHidden && cur && pin.threads.some((t) => cur.includes(t.id))
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
      {draft && (
        <Popover
          anchorRect={anchorRectOf(draft.target)}
          onDismiss={dismiss}
          hidden={surfaceHidden}
          view={view} headerHeight={headerHeight} panelRef={setPanelElement}
          title={draft.target.label}
        >
          <Composer onSubmit={commitDraft} onCancel={discardDraft} onDismiss={dismiss} disabled={readOnly} />
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
          onDismiss={dismiss}
          hidden={surfaceHidden}
          view={view} headerHeight={headerHeight} panelRef={setPanelElement}
          title={
            openPin.threads.length > 1 ? `${openPin.threads.length} threads` : undefined
          }
        >
          <ThreadList
            threads={openPin.threads}
            Composer={Composer}
            readOnly={readOnly}
            onDismiss={dismiss}
            onEditingChange={setReplyEditing}
            onReply={(id, body) => !readOnly && onChange(addReply(annotations, id, { author, body }))}
            onResolve={(id) => !readOnly && onChange(setThreadStatus(annotations, id, 'resolved'))}
            onReopen={(id) => !readOnly && onChange(setThreadStatus(annotations, id, 'open'))}
            onDeleteThread={(id) => {
              if (readOnly) return;
              onChange(removeThread(annotations, id));
              setOpenThreadIds(null);
            }}
          />
        </Popover>
      )}

      {/* Threads whose refs don't resolve against this artifact */}
      {pinsVisible && unresolved.length > 0 && (!(draft || openPin) || surfaceHidden) && (
        <UnresolvedTray threads={unresolved} />
      )}
    </div>,
    host,
  );
}

// ---------------------------------------------------------------------------

function CommentIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-5 3V6a2 2 0 0 1 2-2Z"/></svg>;
}

function Toolbar({
  commentMode, onToggleCommentMode, pinsVisible, onTogglePins, openThreads,
  resolvedThreads, showResolved, onToggleResolved, unresolvedCount, actions,
  review, readOnly, hasDraft, resume, toolbarRef, top, left, width,
}: {
  actions?: React.ReactNode;
  review?: ReviewStatus;
  readOnly: boolean; hasDraft: boolean; resume?: () => void;
  toolbarRef: (el: HTMLDivElement | null) => void;
  top: number; left: number; width: number;
  commentMode: boolean; onToggleCommentMode: () => void;
  pinsVisible: boolean; onTogglePins: () => void; openThreads: number;
  resolvedThreads: number; showResolved: boolean; onToggleResolved: () => void;
  unresolvedCount: number;
}) {
  const label = review ? {
    idle: 'Send', unsent: 'Send', sending: 'Sending…', sent: 'Sent',
    error: 'Retry send', uncertain: 'Check save',
  }[review.state] : '';
  return (
    <div ref={toolbarRef} className="ca-toolbar" role="toolbar" aria-label="Comments"
      style={{top, left, width}} data-anno-preserve-draft="">
      <button className={`ca-tool${pinsVisible ? ' ca-tool-on' : ''}`}
        onClick={onTogglePins} aria-pressed={pinsVisible} title="Show or hide all comments">
        <CommentIcon/><span>Comments</span><span className="ca-count">{openThreads}</span>
      </button>
      <button className={`ca-tool${commentMode ? ' ca-tool-active' : ''}`}
        onClick={onToggleCommentMode} disabled={readOnly}
        aria-pressed={commentMode} title="Comment mode">
        <span className="ca-mode-dot" aria-hidden="true"/>{commentMode ? 'Commenting' : 'Comment'}
      </button>
      <div className="ca-toolbar-send">
        {review ? <button className="ca-tool ca-send" onClick={review.onSend}
          disabled={review.disabled || hasDraft || review.state === 'sending' || review.state === 'sent' || review.state === 'idle'}
          title={hasDraft ? 'Add or cancel the unposted comment before sending' : review.message ?? 'Send review to bot'}>
          <span role="status">{label}</span>
          {!!review.pendingCount && <span className="ca-count">{review.pendingCount}</span>}
        </button> : actions}
      </div>
      {(resolvedThreads > 0 || unresolvedCount > 0) && <details className="ca-more">
        <summary aria-label="More comment options">•••</summary>
        <div className="ca-more-menu">
          {resolvedThreads > 0 && <button className="ca-btn-ghost" onClick={onToggleResolved}
            aria-pressed={showResolved} title="Show resolved threads">{showResolved ? 'Hide resolved' : 'Show resolved'} ({resolvedThreads})</button>}
          {unresolvedCount > 0 && <span>{unresolvedCount} unanchored</span>}
        </div>
      </details>}
      {resume && <button className="ca-resume" onClick={resume} disabled={readOnly}>Resume draft — not yet added</button>}
    </div>
  );
}

/**
 * Popover positioned by floating-ui, which handles flipping, shifting and
 * keeping the anchor tracked through scroll and resize.
 */
function Popover({
  anchorRect, onDismiss, title, children, hidden, view, headerHeight, panelRef,
}: {
  anchorRect: () => DOMRect; onDismiss: () => void; title?: string;
  children: React.ReactNode; hidden: boolean;
  view: ReturnType<typeof useReviewViewport>; headerHeight: number;
  panelRef: (el: HTMLDivElement | null) => void;
}) {
  const previousFocus = useRef<Element | null>(null);
  const [expanded, setExpanded] = useState(false);
  const { refs, floatingStyles, isPositioned } = useFloating({
    open: !hidden, placement: 'right-start',
    middleware: view.compact ? [] : [offset(12), flip({padding: {top: headerHeight + 8, bottom: 8, left: 8, right: 8}}),
      shift({padding: {top: headerHeight + 8, bottom: 8, left: 8, right: 8}, crossAxis: true})],
    whileElementsMounted: autoUpdate,
    elements: { reference: {getBoundingClientRect: anchorRect} as unknown as Element },
  });
  const setPanel = useCallback((el: HTMLDivElement | null) => {
    refs.setFloating(el); panelRef(el);
  }, [refs.setFloating, panelRef]);

  useEffect(() => {
    previousFocus.current = document.activeElement;
    return () => {
      const el = previousFocus.current;
      if (el instanceof HTMLElement && el.isConnected) el.focus({preventScroll:true});
    };
  }, []);
  // Restore focus on resume, but never steal it on a viewport transition.
  const wasHidden = useRef(true);
  useEffect(() => {
    if (hidden) {
      if (refs.floating.current?.contains(document.activeElement)) {
        const previous = previousFocus.current;
        if (previous instanceof HTMLElement && previous !== document.body && previous.isConnected) previous.focus({preventScroll:true});
        else document.querySelector<HTMLElement>('.ca-toolbar button')?.focus({preventScroll:true});
      }
      wasHidden.current = true; return;
    }
    if (!view.compact && !isPositioned) return;
    if (wasHidden.current) {
      const panel = refs.floating.current;
      if (panel && !panel.contains(document.activeElement)) {
        (panel.querySelector<HTMLElement>('textarea,input') ?? panel.querySelector<HTMLElement>('button'))?.focus({preventScroll:true});
      }
      wasHidden.current = false;
    }
  }, [hidden, isPositioned, view.compact, refs.floating]);

  // Reveal the anchor once on open/resume/viewport change, never follow a
  // user's scroll or run per keystroke. The host reserves the measured footer.
  const anchor = useRef(anchorRect);
  anchor.current = anchorRect;
  useEffect(() => {
    if (!view.compact || hidden) return;
    const id = window.setTimeout(() => {
      const panel = refs.floating.current;
      if (!panel) return;
      const r = anchor.current(), bottom = panel.getBoundingClientRect().top - 12;
      const top = view.top + headerHeight + 12;
      if (r.top >= top && r.top < bottom - 20) return;
      window.scrollBy({top: r.top - top - Math.max(0, (bottom - top) / 3), behavior:'instant'});
    }, 100);
    return () => window.clearTimeout(id);
  }, [hidden, view.compact, view.width, view.height, view.top, headerHeight, refs.floating]);

  useEffect(() => {
    if (hidden) return;
    const onDown = (e: PointerEvent) => {
      const node = refs.floating.current;
      if (!node || (e.target instanceof Node && node.contains(e.target))) return;
      if (e.target instanceof Element && e.target.closest('.ca-pin,[data-anno-preserve-draft]')) return;
      onDismiss();
    };
    const id = window.setTimeout(() => window.addEventListener('pointerdown', onDown, true), 0);
    return () => { window.clearTimeout(id); window.removeEventListener('pointerdown', onDown, true); };
  }, [refs.floating, onDismiss, hidden]);
  const maxHeight = Math.max(48, Math.min(view.height - headerHeight - 40, view.height * (expanded ? .85 : .55)));
  const style: React.CSSProperties = view.compact
    ? {position:'fixed', left:view.left, bottom:view.bottom, width:view.width, maxHeight}
    : {...floatingStyles, maxHeight: Math.max(48, view.height - headerHeight - 16), maxWidth: Math.max(0, view.width - 16)};
  return (
    <div ref={setPanel} hidden={hidden} style={{...style, visibility: (view.compact || isPositioned) ? 'visible' : 'hidden'}}
      role="dialog" aria-label={title ?? 'Comments'}
      onKeyDown={e => { if(e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onDismiss(); } }}
      className={`ca-popover${view.compact ? ' ca-footer' : ''}`} data-anno-ignore="">
      <header className="ca-popover-head">
        <span className="ca-popover-title">{title ? `Comment on: ${title}` : 'Comments'}</span>
        {view.compact && <button className="ca-btn-ghost" aria-label={expanded ? 'Collapse comments' : 'Expand comments'} onClick={() => setExpanded(v => !v)}>{expanded ? 'Less' : 'More'}</button>}
        <button className="ca-btn-ghost" aria-label="Minimize comments" onClick={onDismiss}>−</button>
      </header>
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
            const ref = t.refs[0];
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
    return new DOMRect(x - 2, y - 24, 24, 24);
  };
}

/** Live list of annotatable targets inside the artifact. */
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
