import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpLeft, CheckCheck, MessageCircle, MessageSquarePlus, TriangleAlert } from 'lucide-react';
import { Hint, TooltipProvider } from './ui/tooltip';
import { useFloating, shift, flip, offset, autoUpdate, size } from '@floating-ui/react';
import type { AnnotationDoc, Author, Body, Pin, Target, Ref } from './types';
import { allTargets, findTargetById, pinFraction, targetAtPoint, widenChain } from './target';
import { measure, useLayouts } from './layout';
import { clusterPins } from './cluster';
import { addReply, addThread, setThreadStatus } from './store';
import { DraftPin, OverlayRoot, PinButton, TargetOutline } from './Overlay';
import { TextComposer, type ComposerComponent } from './Composer';
import { CloseComments, ThreadHeading, ThreadList } from './Thread';
import './annotations.css';
import { useOutsideDismiss } from './useOutsideDismiss';
import { DeviceBehaviorProvider, useDeviceBehavior, type DeviceBehaviorOverrides } from './device';
import { MentionContext, type MentionSource } from './mentions';
import type { SubmitOptions } from './types';
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
  onChange: (next: AnnotationDoc) => void | Promise<void>;
  mentions?: MentionSource;
  author: Author;
  /** Swap for a radio set, emoji picker, rating… anything producing `Body[]`. */
  composer?: ComposerComponent;
  /** Where the toolbar and popovers mount. Defaults to `document.body`. */
  portalTo?: HTMLElement;
  toolbarActions?: React.ReactNode;
  readOnly?: boolean;
  /** Device defaults and optional Enter override; independent of layout width. */
  interaction?: DeviceBehaviorOverrides;
  /** Keep every toolbar control visible for visual review, including zero counts. */
  debugToolbar?: boolean;
  /**
   * Bring a thread into view: shows resolved threads if it is one, turns pins
   * on, opens its popover and scrolls its anchor into view. Change `nonce` to
   * focus the same thread again.
   */
  focus?: { threadId: string; eventId?: string; nonce: number } | null;
}

/** How long the pointer must rest before the label chip appears. */
const LABEL_DWELL_MS = 120;

export function Annotations(props: AnnotationsProps) {
  return <DeviceBehaviorProvider overrides={props.interaction}>
    <MentionContext.Provider value={props.mentions ?? {directory:null}}><AnnotationLayer {...props} /></MentionContext.Provider>
  </DeviceBehaviorProvider>;
}

function AnnotationLayer({
  root,
  annotations,
  onChange,
  author,
  composer: Composer = TextComposer,
  portalTo,
  toolbarActions,
  readOnly = false,
  debugToolbar = false,
  focus = null,
}: AnnotationsProps) {
  const [commentMode, setCommentMode] = useState(false);
  const { protectOpenPopup } = useDeviceBehavior();
  const [pinsVisible, setPinsVisible] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [showUnanchored, setShowUnanchored] = useState(false);
  const [hover, setHover] = useState<Target | null>(null);
  const [showLabel, setShowLabel] = useState(false);
  const [draft, setDraft] = useState<{ target: Target; xPct: number; yPct: number; refs?: Ref[] } | null>(null);
  // Only the thread ids are stored; the Pin itself is derived from `pins` every
  // render. Holding the Pin object in state made the popover show a stale
  // snapshot — a reply would bump the pin's count but not appear in the open
  // thread, because the stored Pin still referenced the pre-reply Thread.
  const [openThreadIds, setOpenThreadIds] = useState<string[] | null>(null);
  const currentDraft = useRef(draft);
  currentDraft.current = draft;

  // Remember the pin-visibility preference so entering comment mode can force
  // pins on (you must see existing threads to reply rather than duplicate)
  // and exiting can put it back.
  const restorePins = useRef(pinsVisible);
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

  const openPin = useMemo(() => {
    if (!openThreadIds) return null;
    return pins.find((p) => p.threads.some((t) => openThreadIds.includes(t.id))) ?? null;
  }, [pins, openThreadIds]);

  const protectedPopupOpen = protectOpenPopup && (!!openPin || (pinsVisible && showUnanchored && unresolved.length > 0));

  const hoverLayout = hover ? layouts.get(hover.id) : undefined;
  const draftLayout = draft ? layouts.get(draft.target.id) : undefined;

  useEffect(() => { if (readOnly) { setCommentMode(false);setDraft(null);setHover(null); } },[readOnly]);

  const appliedFocus = useRef<number | null>(null);

  // ---- focus (Jump) -------------------------------------------------------

  useEffect(() => {
    if (!focus || appliedFocus.current === focus.nonce) return;
    const t = annotations.threads.find((x) => x.id === focus.threadId);
    if (!t) return;
    appliedFocus.current = focus.nonce;
    if (t.status === 'resolved') setShowResolved(true);
    setPinsVisible(true);
    setDraft(null);
    setShowUnanchored(!t.refs.some(r => root?.querySelector(`[data-anno-id="${CSS.escape(r.id)}"]`)));
    setOpenThreadIds([t.id]);
    const first = t.refs[0];
    const el = first && root?.querySelector<HTMLElement>(`[data-anno-id="${CSS.escape(first.id)}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Runs only when a new focus request arrives, not on every doc change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const timer = window.setTimeout(() => {
      if(focus.eventId) document.querySelector(`[data-event-id="${CSS.escape(focus.eventId)}"]`)?.scrollIntoView({block:'nearest'});
    },350);
    return () => window.clearTimeout(timer);
  }, [focus?.nonce, annotations.threads.length, root]);

  // ---- mode transitions ---------------------------------------------------

  const enterCommentMode = useCallback(() => {
    if (readOnly) return;
    restorePins.current = pinsVisible;
    setPinsVisible(true);
    setCommentMode(true);
    setShowUnanchored(false);
    setOpenThreadIds(null);
  }, [pinsVisible, readOnly]);

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

  // Popup selection is exclusive, independent of pointer-outside dismissal.
  // Both document and viewport pins use this same transition (including keys).
  const selectPin = useCallback((pin: Pin) => {
    setDraft(null);
    setShowUnanchored(false);
    setOpenThreadIds((cur) =>
      cur && pin.threads.some((t) => cur.includes(t.id))
        ? null
        : pin.threads.map((t) => t.id),
    );
  }, []);

  const openDraft = useCallback((next: NonNullable<typeof draft>) => {
    setShowUnanchored(false);
    setOpenThreadIds(null);
    setDraft(next);
  }, []);

  const resolveThread = (id: string) => {
    if (readOnly) return;
    // Resolving the last visible card is a close action, not just filtering.
    // Clear the selection now so Show resolved cannot resurrect the popup.
    // Do not clear selection whenever an anchor is temporarily unmeasurable.
    if (!showResolved) {
      if (openPin?.threads.length === 1 && openPin.threads[0].id === id) {
        setOpenThreadIds(null);
      }
      if (showUnanchored && unresolved.length === 1 && unresolved[0].id === id) {
        setShowUnanchored(false);
      }
    }
    void Promise.resolve(onChange(setThreadStatus(annotations, id, 'resolved', { author }))).catch(() => {});
  };

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
      if (draft || protectedPopupOpen || !(e.target instanceof Node)) return;
      // Our own UI must stay clickable in comment mode.
      if (e.target instanceof HTMLElement && e.target.closest('[data-anno-ignore]')) return;

      const target = targetAtPoint(root, e.clientX, e.clientY);
      if (!target) return;

      // In comment mode a click means "comment on this", never "activate this".
      // The artifact has real controls — a Send button, a menu, a sort toggle —
      // so the click cannot mean both things at once.
      e.preventDefault();
      e.stopPropagation();

      openDraft({ target, ...pinFraction(target.el, e.clientX, e.clientY) });
      setHover(null);
    };

    // Capture phase, so the artifact's own handlers never see the click.
    window.addEventListener('click', onClick, true);
    return () => window.removeEventListener('click', onClick, true);
  }, [commentMode, root, draft, readOnly, openDraft, protectedPopupOpen]);

  // Drag gestures: native text selection; pointer-drag for a region.
  useEffect(() => {
    if (!commentMode || !root || draft || readOnly || protectedPopupOpen) return;
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
      openDraft({target,refs,...pinFraction(target.el,d.x,d.y)});
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
  },[commentMode,root,draft,readOnly,openDraft,protectedPopupOpen]);

  // ---- keyboard -----------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Layered: a draft eats the first Escape, the popover the next, and
        // only then does comment mode exit.
        if (draft) setDraft(null);
        else if (openThreadIds) setOpenThreadIds(null);
        else if (showUnanchored) setShowUnanchored(false);
        else if (commentMode) exitCommentMode();
        return;
      }
      // Keyboard users can select native text, then explicitly annotate it.
      if (e.key === 'Enter' && e.altKey && root && !readOnly && !draft) {
        const selection = window.getSelection();
        if (selection?.rangeCount) {
          const refs = refsFromRange(root,selection.getRangeAt(0));
          const target = refs[0] ? findTargetById(root,refs[0].id) : null;
          if (target) {
            e.preventDefault(); selection?.removeAllRanges();
            openDraft({target,refs,xPct:0,yPct:0}); setPinsVisible(true);
          }
        }
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draft, openThreadIds, showUnanchored, commentMode, exitCommentMode, root, readOnly, openDraft]);

  // ---- document edits -----------------------------------------------------

  const commitDraft = async (body: Body[], options?: SubmitOptions) => {
    if (!draft || readOnly) return;
    const { target } = draft;
    const { doc, thread } = addThread(annotations, {
      refs: draft.refs ?? [snapshotRef(target)],
      pin: { xPct: draft.xPct, yPct: draft.yPct },
      author,
      body,
      notifyBot: options?.notifyBot,
    });
    await onChange(doc);
    // A late save must not reopen a dismissed draft or replace a newer selection.
    if (currentDraft.current !== draft) return;
    setDraft(null);
    setPinsVisible(true);
    setOpenThreadIds([thread.id]);
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
    <TooltipProvider><div className={`ca-root${commentMode ? ' ca-mode-comment' : ''}`} data-anno-ignore="">
      <Toolbar
        actions={toolbarActions}
        debug={debugToolbar}
        readOnly={readOnly}
        commentMode={commentMode}
        onToggleCommentMode={toggleCommentMode}
        pinsVisible={pinsVisible}
        onTogglePins={() => setPinsVisible((v) => !v)}
        openThreads={openThreads}
        resolvedThreads={resolvedThreads}
        showResolved={pinsVisible && showResolved}
        onToggleResolved={() => {
          setShowResolved(!pinsVisible || !showResolved);
          setPinsVisible(true);
        }}
        unresolvedCount={unresolved.length}
        showUnanchored={pinsVisible && showUnanchored}
        onToggleUnanchored={() => {
          const opening = !pinsVisible || !showUnanchored;
          if (opening) {
            setOpenThreadIds(null);
            setDraft(null);
          }
          setShowUnanchored(opening);
          setPinsVisible(true);
        }}
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
                onSelect={selectPin}
              />
            ))}
          </OverlayRoot>
          <OverlayRoot layer="viewport">
            {viewportPins.map((p) => (
              <PinButton
                key={p.key}
                pin={p}
                active={openPin?.key === p.key}
                onSelect={selectPin}
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
          label={draft.target.label}
        >
          <article className="ca-thread ca-thread-draft">
            <ThreadHeading target={draft.target} onDismiss={() => setDraft(null)} />
            <div className="ca-thread-body" tabIndex={0} role="region" aria-label="New comment">
              <Composer onSubmit={commitDraft} onCancel={() => setDraft(null)} />
              {draftWidenTo && (
                <button className="ca-widen" onClick={widenDraft}>
                  <ArrowUpLeft className="ca-icon" aria-hidden="true" /> Widen to <b>{draftWidenTo}</b>
                </button>
              )}
            </div>
          </article>
        </Popover>
      )}

      {/* Existing threads */}
      {openPin && !draft && (
        <Popover
          // Keyed by pin so selecting another pin remounts the popover against it
          // instead of swapping the contents in place at the old position.
          key={openPin.key}
          anchorRect={pinRectOf(openPin)}
          onDismiss={() => setOpenThreadIds(null)}
          threadCount={openPin.threads.length}
          label={openPin.threads.length === 1 ? openPin.threads[0].refs[0]?.label : undefined}
        >
          <ThreadList
            threads={openPin.threads}
            Composer={Composer}
            readOnly={readOnly}
            unanchoredIds={new Set(unresolved.map(t => t.id))}
            onDismiss={() => setOpenThreadIds(null)}
            onReply={async (id, body, options) => { if(!readOnly) await onChange(addReply(annotations, id, { author, body, notifyBot: options?.notifyBot })); }}
            onResolve={resolveThread}
            onReopen={(id) => { if(!readOnly) void Promise.resolve(onChange(setThreadStatus(annotations, id, 'open', { author }))).catch(() => {}); }}
          />
        </Popover>
      )}

      {/* Threads whose refs don't resolve against this artifact */}
      {pinsVisible && showUnanchored && unresolved.length > 0 && (
        <UnresolvedTray threads={unresolved} onDismiss={() => setShowUnanchored(false)}>
          <ThreadList
            threads={unresolved}
            Composer={Composer}
            readOnly={readOnly}
            unanchoredIds={new Set(unresolved.map(t => t.id))}
            onDismiss={() => setShowUnanchored(false)}
            onReply={async (id, body, options) => { if(!readOnly) await onChange(addReply(annotations, id, { author, body, notifyBot: options?.notifyBot })); }}
            onResolve={resolveThread}
            onReopen={(id) => { if(!readOnly) void Promise.resolve(onChange(setThreadStatus(annotations, id, 'open', { author }))).catch(() => {}); }}
          />
        </UnresolvedTray>
      )}
    </div></TooltipProvider>,
    host,
  );
}

// ---------------------------------------------------------------------------

function Toolbar({
  commentMode, onToggleCommentMode, pinsVisible, onTogglePins,
  openThreads, resolvedThreads, showResolved, onToggleResolved,
  unresolvedCount, showUnanchored, onToggleUnanchored, actions, debug, readOnly,
}: {
  actions?: React.ReactNode;
  commentMode: boolean;
  onToggleCommentMode: () => void;
  pinsVisible: boolean;
  onTogglePins: () => void;
  openThreads: number;
  resolvedThreads: number;
  showResolved: boolean;
  onToggleResolved: () => void;
  unresolvedCount: number;
  showUnanchored: boolean;
  onToggleUnanchored: () => void;
  debug: boolean;
  readOnly: boolean;
}) {
  return (
    <div className="ca-toolbar" role="toolbar" aria-label="Comments" data-debug={debug || undefined}>
      <div className="ca-toolbar-group ca-toolbar-primary">
        <Hint content={readOnly ? 'Sign in to add comments' : 'Click a target, select text, or draw on an image. Escape exits comment mode.'} disabled={readOnly}>
          <button className={`ca-tool ca-tool-comment${commentMode ? ' ca-tool-active' : ''}`}
            onClick={onToggleCommentMode} aria-pressed={commentMode} aria-label="Comment mode" disabled={readOnly}>
            <MessageSquarePlus className="ca-icon" aria-hidden="true" />
            {commentMode ? 'Commenting' : 'Comment'}
          </button>
        </Hint>
        <div className="ca-tool-segments" role="group" aria-label="Comment visibility">
          <Hint content={pinsVisible ? 'Hide comments' : 'Show comments'}>
            <button className={`ca-tool${pinsVisible ? ' ca-tool-on' : ''}`}
              onClick={onTogglePins} aria-pressed={pinsVisible} aria-label={pinsVisible ? 'Hide comments' : 'Show comments'} data-testid="toggle-comments">
              <MessageCircle className="ca-icon" aria-hidden="true" />
              <span className="ca-count">{openThreads}</span>
            </button>
          </Hint>
          {(debug || resolvedThreads > 0) && (
            <Hint content={showResolved ? 'Hide resolved threads' : 'Show resolved threads'}>
              <button className={`ca-tool${showResolved ? ' ca-tool-on' : ''}`}
                onClick={onToggleResolved} aria-pressed={showResolved} aria-label={showResolved ? 'Hide resolved threads' : 'Show resolved threads'} data-testid="toggle-resolved">
                <CheckCheck className="ca-icon" aria-hidden="true" />
                <span className="ca-count">{resolvedThreads}</span>
              </button>
            </Hint>
          )}
          {(debug || unresolvedCount > 0) && (
            <Hint content={`${showUnanchored ? 'Hide' : 'Show'} unanchored (comments whose targets can no longer be found in this artifact)`}>
              <button className={`ca-tool${showUnanchored ? ' ca-tool-on' : ''}`}
                onClick={onToggleUnanchored} aria-pressed={showUnanchored}
                aria-label={`${showUnanchored ? 'Hide' : 'Show'} unanchored comments`} data-testid="unanchored" data-ca-unanchored-toggle="">
                <TriangleAlert className="ca-icon" aria-hidden="true" />
                <span className="ca-count">{unresolvedCount}</span>
              </button>
            </Hint>
          )}
        </div>
      </div>
      {actions && <div className="ca-toolbar-group ca-toolbar-status">{actions}</div>}
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
  label,
  threadCount = 1,
  children,
}: {
  anchorRect: () => DOMRect;
  onDismiss: () => void;
  label?: string;
  threadCount?: number;
  children: React.ReactNode;
}) {
  const previousFocus = useRef<Element | null>(null);
  const [toolbarHeight, setToolbarHeight] = useState(48);
  useEffect(() => {
    const toolbar = document.querySelector('.ca-toolbar');
    if (!toolbar) return;
    const resize = new ResizeObserver(() => setToolbarHeight(toolbar.getBoundingClientRect().height));
    resize.observe(toolbar);
    return () => resize.disconnect();
  }, []);
  const padding = { top: 8, left: 8, right: 8, bottom: toolbarHeight + 10 };
  const { refs, floatingStyles, isPositioned } = useFloating({
    open: true,
    placement: 'right-start',
    // No cross-axis or alignment fallback: the popover's own height changes
    // (mention picker, error line, incoming replies) re-run placement, and a
    // fallback would relocate the panel to whichever corner fits best. Keep
    // the start edge on the target and let shift nudge / size cap instead.
    middleware: [offset(12), flip({ padding, crossAxis: false, flipAlignment: false }), shift({ padding, crossAxis: true }), size({
      padding,
      apply({availableHeight,availableWidth,elements}) {
        Object.assign(elements.floating.style,{maxHeight: `${Math.max(0,availableHeight)}px`,
          maxWidth: `${Math.max(0,Math.min(360,availableWidth))}px`});
      },
    })],
    whileElementsMounted: autoUpdate,
    elements: {
      reference: {
        getBoundingClientRect: anchorRect,
        // A virtual element needs no DOM node; floating-ui just needs the rect.
      } as unknown as Element,
    },
  });

  useEffect(() => {
    previousFocus.current = document.activeElement;
    return () => {
      const el = previousFocus.current;
      if (el instanceof HTMLElement && el.isConnected) el.focus({preventScroll:true});
    };
  }, []);

  useEffect(() => {
    if (!isPositioned || !refs.floating.current) return;
    const panel = refs.floating.current;
    // Existing discussions start at the neutral dialog, not a title/Close
    // tooltip trigger. A new-comment or reply editor keeps its own autofocus.
    if (!panel.contains(document.activeElement)) panel.focus({preventScroll:true});
  },[isPositioned,refs.floating]);

  useOutsideDismiss(refs.floating, onDismiss);

  return (
    <div ref={refs.setFloating} style={{...floatingStyles, '--ca-toolbar-height': `${toolbarHeight}px`, visibility: isPositioned ? 'visible' : 'hidden'} as React.CSSProperties} role="dialog" tabIndex={-1} aria-label={threadCount > 1 ? `${threadCount} threads` : label ?? "Comments"} onKeyDown={(e) => {
      if (e.key === 'Escape') {e.preventDefault();e.stopPropagation();onDismiss();}

    }} className={`ca-popover${threadCount > 1 ? ' ca-popover-multiple' : ''}`} data-anno-ignore="">
      {threadCount > 1 && <header className="ca-popover-head">
        <span className="ca-popover-title">{threadCount} threads</span>
        <CloseComments onDismiss={onDismiss} />
      </header>}
      <div className="ca-popover-body" tabIndex={threadCount > 1 ? 0 : undefined}
        role={threadCount > 1 ? 'region' : undefined} aria-label={threadCount > 1 ? 'Discussions' : undefined}>{isPositioned && children}</div>
    </div>
  );
}

function UnresolvedTray({ threads, onDismiss, children }: {
  threads: import('./types').Thread[];
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  useOutsideDismiss(panel, onDismiss, '[data-ca-unanchored-toggle]');
  const [toolbarHeight, setToolbarHeight] = useState(48);
  useEffect(() => {
    const toolbar = document.querySelector('.ca-toolbar');
    if (!toolbar) return;
    const observer = new ResizeObserver(() => setToolbarHeight(toolbar.getBoundingClientRect().height));
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);
  const multiple = threads.length > 1;
  return (
    <aside ref={panel} className={`ca-tray ca-tray-open${multiple ? ' ca-tray-multiple' : ''}`}
      aria-label="Unanchored threads" style={{ bottom: toolbarHeight + 10, '--ca-toolbar-height': `${toolbarHeight}px` } as React.CSSProperties} data-anno-ignore="">
      {multiple && <header className="ca-tray-head">
        <span>{threads.length} threads</span>
        <CloseComments onDismiss={onDismiss} label="Close unanchored comments" />
      </header>}
      <div className="ca-tray-body" tabIndex={multiple ? 0 : undefined}
        role={multiple ? 'region' : undefined} aria-label={multiple ? 'Unanchored discussions' : undefined}>{children}</div>
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
