import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { CHART_CHANGE, getChart, type ChartMark } from '../chart';
import { chartMarks, chartSelection, resolveChart, chartPin, sameValues } from './chart';
import { captureSelection } from './capture';
import { ChartHighlight, SelectionDetails } from './ChartSelection';
import type { ChartRef, SelectionSnapshot } from './types';

/**
 * Controlled annotation layer for element, text, image and chart references.
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
  const [draft, setDraft] = useState<{ target: Target; xPct: number; yPct: number; refs?: Ref[]; capture?: Promise<SelectionSnapshot> } | null>(null);
  const [hoverRef,setHoverRef]=useState<ChartRef|null>(null);
  const [captureError,setCaptureError]=useState('');
  const captureOwner=useRef<Promise<SelectionSnapshot>|null>(null);
  const chartDragging=useRef(false);
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

  useEffect(()=>{
    if(!root)return;
    const active=new Set<NonNullable<ReturnType<typeof getChart>>>();
    const sync=()=>{for(const el of root.querySelectorAll<HTMLElement>('[data-anno-mode="chart"]')){const adapter=getChart(el);if(adapter&&!active.has(adapter)){active.add(adapter);adapter.setCommentMode?.(commentMode);}}};
    sync();root.addEventListener(CHART_CHANGE,sync);
    const block=(e:Event)=>{if(!(e.target instanceof Element)||e.target.closest('[data-anno-ignore]'))return;const element=e.target.closest('[data-anno-mode="chart"]');if(commentMode&&element&&root.contains(element)){if(e.type==='pointerdown'||e.type==='click')e.preventDefault();e.stopPropagation();}};
    const kinds=['wheel','mousemove','mouseover','mousedown','mouseup','dblclick','pointermove','pointerdown','pointerup','click'];
    for(const kind of kinds)root.addEventListener(kind,block,true);
    return()=>{for(const adapter of active)adapter.setCommentMode?.(false);root.removeEventListener(CHART_CHANGE,sync);for(const kind of kinds)root.removeEventListener(kind,block,true);};
  },[root,commentMode]);

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
  const lastOpenAnchor=useRef<{key:string;rect:DOMRect}|null>(null);
  const openAnchorRect=useCallback(()=>{
    const key=openThreadIds?.join('|')??'';
    if(openPin&&!openPin.hidden){const rect=pinRectOf(openPin)();lastOpenAnchor.current={key,rect};return rect;}
    return lastOpenAnchor.current?.key===key?lastOpenAnchor.current.rect:openPin?pinRectOf(openPin)():new DOMRect();
  },[openPin,openThreadIds]);

  const protectedPopupOpen = protectOpenPopup && (!!openPin || (pinsVisible && showUnanchored && unresolved.length > 0));

  const hoverLayout = hover ? layouts.get(hover.id) : undefined;
  const draftLayout = draft ? layouts.get(draft.target.id) : undefined;

  // The draft keeps the target it opened on for the commit snapshot (id, label,
  // semantic), but every piece of live geometry — outline, pin, popover anchor,
  // widen — reads the element that is currently in the document under that id.
  // A host rerender may replace the node (same id, new element): the captured
  // one is then detached and measures 0×0 at the viewport origin, which used to
  // send the popover to the top-left corner on its next height change.
  const draftTarget = useMemo(
    () => (draft ? targets.find((t) => t.id === draft.target.id) ?? null : null),
    [draft, targets],
  );
  const draftAnchor = useRef<{ id: string; rect: DOMRect } | null>(null);
  const draftAnchorRect = useCallback((): DOMRect => {
    const d = currentDraft.current;
    if (!d) return new DOMRect(0, 0, 0, 0);
    // Query the DOM directly: floating-ui can measure between a host mutation
    // and the target registry catching up with it.
    const el = root ? findTargetById(root, d.target.id)?.el : null;
    if (el?.isConnected) {
      const rect = el.getBoundingClientRect();
      if ((rect.width || rect.height) && (typeof el.checkVisibility!=='function'||el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))) {
        if(d.refs?.[0]&&root){
          const target=findTargetById(root,d.target.id);
          if(target){const layout=measure(target,root),selected=refBoxes(d.refs[0],layout)[0];if(selected){
            const sx=layout.layer==='document'?window.scrollX:0,sy=layout.layer==='document'?window.scrollY:0;
            const point=d.refs[0].kind==='chart'?chartPin(d.refs[0],layout):{x:selected.left,y:selected.top+Math.min(24,selected.height)};
            const anchor=new DOMRect(point.x-sx-2,point.y-sy-24,24,24);
            draftAnchor.current={id:d.target.id,rect:anchor};return anchor;
          }}
        }
        draftAnchor.current = { id: d.target.id, rect };
        return rect;
      }
    }
    // Target gone or collapsed: hold the last good geometry rather than anchor
    // to a detached element's 0×0 rect at the origin.
    const held = draftAnchor.current;
    return held && held.id === d.target.id ? held.rect : new DOMRect(0, 0, 0, 0);
  }, [root]);

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
    for(let parent=el?.parentElement;parent;parent=parent.parentElement)if(parent instanceof HTMLDetailsElement)parent.open=true;
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
    setCaptureError('');
    captureOwner.current=next.capture??null;
    setShowUnanchored(false);
    setOpenThreadIds(null);
    setDraft(next);
  }, []);

  const openSelectionDraft=useCallback((next:NonNullable<typeof draft>)=>{
    const ref=next.refs?.[0];
    if(!ref||(ref.kind!=='chart'&&ref.kind!=='region')){openDraft(next);return;}
    // A point already has its immutable key/label/value snapshot. Keep posting
    // immediate; only rectangles need a raster image of the selected area.
    if(ref.kind==='chart'&&ref.selection==='point'){openDraft(next);return;}
    const region=ref.kind==='chart'?ref.region:ref;
    const before=next.target.mode==='chart'?JSON.stringify(chartMarks(next.target).marks?.map(m=>({key:m.key,values:m.values,bounds:m.geometry.bounds}))):null;
    let timeout:ReturnType<typeof setTimeout>;
    const job=Promise.race([captureSelection(next.target,region),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(Error('Image capture timed out. Your draft is kept.')),12000);})]).finally(()=>clearTimeout(timeout)).then(snapshot=>{
      const after=next.target.mode==='chart'?JSON.stringify(chartMarks(next.target).marks?.map(m=>({key:m.key,values:m.values,bounds:m.geometry.bounds}))):null;
      if(before!==after)throw Error('The chart changed during capture. Your draft is kept; select the region again before posting.');
      return snapshot;
    });
    const withJob={...next,capture:job};openDraft(withJob);
    void job.then(snapshot=>setDraft(cur=>cur?.capture===job?{...cur,refs:cur.refs?.map((r,i)=>i===0?{...r,snapshot}:r)}:cur))
      .catch(error=>{if(captureOwner.current===job)setCaptureError(error instanceof Error?error.message:'Image capture failed. Your draft is kept.');});
  },[openDraft]);

  const retryCapture=()=>{
    const d=currentDraft.current,ref=d?.refs?.[0];
    if(!d||!ref||!root)return;
    const target=findTargetById(root,d.target.id);
    if(!target){setCaptureError('The target is unavailable. Your draft is kept.');return;}
    if(ref.kind==='chart'&&ref.members?.length){
      const marks=chartMarks(target).marks;
      const changed=ref.members.some(m=>{const current=marks?.find(p=>p.key===m.key);return !current||current.label!==m.label||!sameValues(current.values,m.values);});
      if(changed){setCaptureError('The selected data changed. Your draft is kept; copy your text and select the data again.');return;}
      const layout=measure(target,root),box=resolveChart(ref,layout).box;
      if(!box){setCaptureError('The selection is outside this view. Your draft is kept.');return;}
      const region={xPct:(box.left-layout.box.left)/layout.box.width,yPct:(box.top-layout.box.top)/layout.box.height,wPct:box.width/layout.box.width,hPct:box.height/layout.box.height};
      openSelectionDraft({...d,target,refs:[{...ref,region,snapshot:undefined}]});
    }else openSelectionDraft({...d,target,refs:[{...ref,snapshot:undefined}]});
  };

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
      setHoverRef(null);
      return;
    }

    let dwell: number | undefined;
    // Tracked in a closure rather than read from state inside the updater:
    // setState updaters must be pure, so scheduling the dwell timer from inside
    // one is unreliable (StrictMode invokes updaters twice).
    let current: HTMLElement | null = null;

    const onMove = (e: PointerEvent) => {
      if(chartDragging.current)return;
      const next = targetAtPoint(root, e.clientX, e.clientY);
      if(next?.mode==='chart'){
        const box=next.el.getBoundingClientRect();
        const picked=chartSelection(next,{x:e.clientX-box.left,y:e.clientY-box.top,width:1,height:1},'point',chartMarks(next).marks);
        setHoverRef(picked.members?.length?picked:null);
      } else setHoverRef(null);
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
      setHoverRef(null);
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
      if(target.mode==='chart'){
        const box=target.el.getBoundingClientRect();
        const ref=chartSelection(target,{x:e.clientX-box.left,y:e.clientY-box.top,width:1,height:1},'point',chartMarks(target).marks);
        if(ref.members?.length)openSelectionDraft({target,refs:[ref],...pinFraction(target.el,e.clientX,e.clientY)});
        else openDraft({target,...pinFraction(target.el,e.clientX,e.clientY)});
      } else openDraft({ target, ...pinFraction(target.el, e.clientX, e.clientY) });
      setHover(null);
    };

    // Capture phase, so the artifact's own handlers never see the click.
    window.addEventListener('click', onClick, true);
    return () => window.removeEventListener('click', onClick, true);
  }, [commentMode, root, draft, readOnly, openDraft, openSelectionDraft, protectedPopupOpen]);

  // Drag gestures: native text selection; pointer-drag for a region.
  useEffect(() => {
    if (!commentMode || !root || draft || readOnly || protectedPopupOpen) return;
    const regions = [...root.querySelectorAll<HTMLElement>('[data-anno-mode="region"],[data-anno-mode="chart"]')].map(el=>({el,touch:el.style.touchAction}));
    regions.forEach(({el})=>el.style.touchAction='none');
    let drag: { target: Target; x: number; y: number; pointerId: number; marks:readonly ChartMark[]|null } | null = null;
    const selectionFor=(d:NonNullable<typeof drag>,x:number,y:number,preview=false):Ref=>{
      const region=regionFromPoints(d.target,d.x,d.y,x,y);
      if(d.target.mode!=='chart')return region;
      const b=d.target.el.getBoundingClientRect();
      return chartSelection(d.target,{x:region.xPct*b.width,y:region.yPct*b.height,width:region.wPct*b.width,height:region.hPct*b.height},'rectangle',chartMarks(d.target).marks,preview);
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0||e.isPrimary===false) return;
      const target = targetAtPoint(root,e.clientX,e.clientY);
      if (!target) return;
      drag = {target,x:e.clientX,y:e.clientY,pointerId:e.pointerId,marks:target.mode==='chart'?chartMarks(target).marks:null};
      if (target.mode === 'region'||target.mode==='chart') {
        e.preventDefault();
        target.el.setPointerCapture(e.pointerId);
        if(target.mode==='chart'){chartDragging.current=true;e.stopPropagation();}
      }
    };
    const move = (e: PointerEvent) => {
      if (!drag || !['region','chart'].includes(drag.target.mode)) return;
      e.preventDefault();
      if(drag.target.mode==='chart')e.stopPropagation();
      setRegionPreview(selectionFor(drag,e.clientX,e.clientY,true));
    };
    const up = (e: PointerEvent) => {
      if (!drag) return;
      const d = drag; drag = null;chartDragging.current=false;
      setRegionPreview(null);
      if(d.target.mode==='chart'){e.preventDefault();e.stopPropagation();}
      if(d.target.el.hasPointerCapture(e.pointerId))d.target.el.releasePointerCapture(e.pointerId);
      if (Math.hypot(e.clientX-d.x,e.clientY-d.y) < 5) {
        if(d.target.mode==='chart'){
          suppressClick.current=Date.now()+500;
          const b=d.target.el.getBoundingClientRect();const ref=chartSelection(d.target,{x:e.clientX-b.left,y:e.clientY-b.top,width:1,height:1},'point',d.marks);
          if(ref.members?.length)openSelectionDraft({target:d.target,refs:[ref],...pinFraction(d.target.el,e.clientX,e.clientY)});
          else openDraft({target:d.target,...pinFraction(d.target.el,e.clientX,e.clientY)});
        }
        return;
      }
      let refs: Ref[] = [];
      if (d.target.mode === 'region'||d.target.mode==='chart') {
        const ref=selectionFor(d,e.clientX,e.clientY),region=ref.kind==='chart'?ref.region:ref;
        if ('wPct' in region&&region.wPct > 0 && region.hPct > 0) refs = [ref];
      } else {
        const selection = window.getSelection();
        if (selection?.rangeCount) refs = refsFromRange(root,selection.getRangeAt(0));
      }
      suppressClick.current = Date.now()+400;
      if (!refs.length) return;
      const target = findTargetById(root,refs[0].id);
      if (!target) return;
      window.getSelection()?.removeAllRanges();
      openSelectionDraft({target,refs,...pinFraction(target.el,d.x,d.y)});
      setHover(null);
    };
    const cancel = () => { chartDragging.current=false;drag = null; setRegionPreview(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && drag) { suppressClick.current = Date.now()+400; cancel(); } };
    const noImageDrag = (e: DragEvent) => { if (drag&&['region','chart'].includes(drag.target.mode)) e.preventDefault(); };
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
  },[commentMode,root,draft,readOnly,openDraft,openSelectionDraft,protectedPopupOpen]);

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
    const captured=draft.capture?await draft.capture:undefined;
    const refs=(draft.refs??[snapshotRef(target)]).map((r,i)=>i===0&&captured?{...r,snapshot:captured}:r);
    const { doc, thread } = addThread(annotations, {
      refs,
      pin: { xPct: draft.xPct, yPct: draft.yPct },
      author,
      body,
      notifyBot: options?.notifyBot,
    });
    await onChange(doc);
    // A late save must not reopen a dismissed draft or replace a newer selection.
    if (currentDraft.current !== draft && (!draft.capture || currentDraft.current?.capture !== draft.capture)) return;
    setDraft(null);
    setPinsVisible(true);
    setOpenThreadIds([thread.id]);
  };

  const widenDraft = () => {
    // Walk up from the live element, not the one captured when the draft opened.
    if (!draft || !root || !draftTarget) return;
    const chain = widenChain(root, draftTarget);
    const next = chain[1];
    if (!next) return;
    // Keep the pin under the pointer by re-projecting the fraction into the
    // wider box, so the pin doesn't jump when the target changes.
    const from = draftTarget.el.getBoundingClientRect();
    const px = from.left + draft.xPct * from.width;
    const py = from.top + draft.yPct * from.height;
    setDraft({ target: next, ...pinFraction(next.el, px, py) });
  };

  const draftWidenTo = useMemo(() => {
    if (!draft || !root || draft.refs || !draftTarget) return undefined;
    return widenChain(root, draftTarget)[1]?.label;
  }, [draft, root, draftTarget]);

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
          {ref.kind==='chart'&&<ChartHighlight reference={ref} layout={layout}/>}
          {(ref.kind==='chart'&&ref.selection==='point'?[]:refBoxes(ref===regionPreview&&ref.kind==='chart'?{kind:'region',id:ref.id,...ref.region}:ref,layout)).map((box,j) => <div key={j}
            className={`ca-selection ca-selection-${ref.kind}`} data-ca-ref={ref.id} data-ca-selection={ref.kind==='chart'?ref.selection:ref.kind} style={{position:'absolute',...box}}>{ref===regionPreview&&ref.kind==='chart'&&<span className="ca-selection-count" role="status">{ref.members===null?'Image region':`${ref.members.length} selected`}</span>}</div>)}
        </OverlayRoot>;
      })}

      {/* Hover affordance, comment mode only */}
      {commentMode && hoverLayout && !draft && !regionPreview && (
        <OverlayRoot layer={hoverLayout.layer}>
          {hoverRef?<><ChartHighlight reference={hoverRef} layout={hoverLayout}/><TargetOutline layout={{...hoverLayout,box:resolveChart(hoverRef,hoverLayout).box??hoverLayout.box,target:{...hoverLayout.target,label:hoverRef.label!}}} outline={false} showLabel={showLabel}/></>:<TargetOutline layout={hoverLayout} showLabel={showLabel} />}
        </OverlayRoot>
      )}

      {/* Draft: outline the chosen target and mark where the pin will land */}
      {draftLayout && draft && (
        <OverlayRoot layer={draftLayout.layer}>
          {!draft.refs&&<TargetOutline layout={draftLayout} showLabel={false} />}
          <DraftPin
            x={draft.refs?.[0]?.kind==='chart'?chartPin(draft.refs[0],draftLayout).x:draft.refs?.[0]?refBoxes(draft.refs[0],draftLayout)[0]?.left??draftLayout.box.left:draftLayout.box.left + draft.xPct * draftLayout.box.width}
            y={draft.refs?.[0]?.kind==='chart'?chartPin(draft.refs[0],draftLayout).y:draft.refs?.[0]?(refBoxes(draft.refs[0],draftLayout)[0]?.top??draftLayout.box.top)+16:draftLayout.box.top + draft.yPct * draftLayout.box.height}
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

      {/* Composer for a new thread. Stays open while its target is missing:
          the text is the reviewer's, only they dismiss it; the comment files as
          unanchored and re-anchors if the id comes back. */}
      {draft && (
        <Popover
          anchorRect={draftAnchorRect}
          onDismiss={() => setDraft(null)}
          label={draft.refs?.[0]?.label??draft.target.label}
        >
          <article className="ca-thread ca-thread-draft" data-ca-draft-anchored={draftTarget ? 'true' : 'false'}>
            <ThreadHeading target={draft.refs?.[0]??draft.target} unanchored={!draftTarget} onDismiss={() => setDraft(null)} />
            <div className="ca-thread-body" tabIndex={0} role="region" aria-label="New comment">
              {!draftTarget && <p className="ca-draft-unanchored" role="status">
                This target is no longer on the page. Your comment is kept and will be filed as unanchored.
              </p>}
              {draft.refs?.map((ref,i)=><SelectionDetails key={i} reference={ref} layout={layouts.get(ref.id)}/>)}
              {draft.capture&&!draft.refs?.[0]?.snapshot&&!captureError&&<p className="ca-capture-status" role="status">Capturing the selected image…</p>}
              {captureError&&<><p className="ca-capture-error" role="alert">{captureError}</p><button type="button" className="ca-btn-ghost" onClick={retryCapture}>Retry image in current view</button></>}
              <Composer onSubmit={commitDraft} onCancel={() => setDraft(null)} submitDisabled={!!captureError} />
              {draft.refs?.[0]?.kind==='chart'&&<button type="button" className="ca-widen" onClick={()=>openDraft({target:draft.target,xPct:draft.xPct,yPct:draft.yPct})}><ArrowUpLeft className="ca-icon" aria-hidden="true"/>Comment on the whole chart</button>}
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
          key={openThreadIds?.join('|')}
          anchorRect={openAnchorRect}
          onDismiss={() => setOpenThreadIds(null)}
          threadCount={openPin.threads.length}
          label={openPin.threads.length === 1 ? openPin.threads[0].refs[0]?.label : undefined}
        >
          <ThreadList
            layouts={layouts}
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
            layouts={layouts}
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
        <Hint content={readOnly ? 'Sign in to add comments' : 'Click a target or chart mark, select text, or draw a rectangle on an image or chart. Escape exits comment mode.'} disabled={readOnly}>
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
  // One virtual reference for the popover's lifetime, reading the latest
  // getter: re-creating it every render would tear down and restart autoUpdate.
  const anchor = useRef(anchorRect);
  anchor.current = anchorRect;
  const reference = useMemo(() => ({
    getBoundingClientRect: () => anchor.current(),
    // A virtual element needs no DOM node; floating-ui just needs the rect.
  }), []);
  const { refs, floatingStyles, isPositioned, update } = useFloating({
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
  });

  useLayoutEffect(()=>{refs.setPositionReference(reference);},[refs.setPositionReference,reference]);
  useLayoutEffect(()=>{void update();});

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
