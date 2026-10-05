import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowUpLeft, CircleCheck, CircleDot, Eye, EyeOff, MessageCircle, MessageSquarePlus } from 'lucide-react';
import { Hint, TooltipProvider } from './ui/tooltip';
import { useFloating, shift, flip, offset, autoUpdate, size } from '@floating-ui/react';
import type { AnnotationDoc, Author, Body, Pin, Target, Ref } from './types';
import { allTargets, findTargetById, pinFraction, targetAtPoint, widenChain } from './target';
import { measure, useLayouts } from './layout';
import { clusterPins, PIN_RADIUS } from './cluster';
import { anchoredRefs, commentsInPageOrder, matchesStatus, type CommentStatusFilter } from './comments';
import { addReply, addThread, setThreadStatus } from './store';
import { DraftPin, OverlayRoot, PinButton, TargetOutline } from './Overlay';
import { DraftComposer, TextComposer, type ComposerComponent } from './Composer';
import { CloseComments, ThreadHeading, ThreadList } from './Thread';
import './annotations.css';
import { useOutsideDismiss } from './useOutsideDismiss';
import { DeviceBehaviorProvider, useDeviceBehavior, type DeviceBehaviorOverrides } from './device';
import { MentionContext, type MentionSource } from './mentions';
import type { SubmitOptions } from './types';
import { snapshotRef, refsFromRange, regionFromPoints, refBoxes, validRef } from './selection';
import { CHART_CHANGE, getChart, type ChartMark } from '../chart';
import { chartMarks, chartSelection, resolveChart, chartPin, sameValues } from './chart';
import { captureSelection } from './capture';
import { ChartHighlight, SelectionDetails } from './ChartSelection';
import type { ChartRef, SelectionSnapshot } from './types';
import { DraftsProvider, useActiveDraftKey, useDraftPending, useDraftStore } from './drafts';

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
  /** Retained for host compatibility; all reader controls are always visible. */
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
    <MentionContext.Provider value={props.mentions ?? {directory:null}}>
      <DraftsProvider key={props.author.id}><AnnotationLayer {...props} /></DraftsProvider>
    </MentionContext.Provider>
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
  const { protectOpenPopup, deviceProfile } = useDeviceBehavior();
  // Device, not iframe width: a narrow desktop pane keeps the desktop markers.
  const pinSize = PIN_RADIUS * 2 * (deviceProfile === 'mobile' ? 1.5 : 1);
  const [pinsVisible, setPinsVisible] = useState(true);
  const [statusFilter, setStatusFilter] = useState<CommentStatusFilter>('all');
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [returnToComments, setReturnToComments] = useState(false);
  const [focusedComment, setFocusedComment] = useState<{ id: string; nonce: number } | null>(null);
  const [hover, setHover] = useState<Target | null>(null);
  const [showLabel, setShowLabel] = useState(false);
  const [draftState, setDraft] = useState<{ target: Target; xPct: number; yPct: number; refs?: Ref[]; capture?: Promise<SelectionSnapshot> } | null>(null);
  const drafts = useDraftStore(), activeDraftKey = useActiveDraftKey();
  const saving = useDraftPending(), newDraftPending = useDraftPending('new');
  const draft = activeDraftKey === 'new' ? draftState : null;
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
  const discardEditor = useCallback(() => {
    if (!drafts.discard()) return false;
    setDraft(null);captureOwner.current=null;
    return true;
  }, [drafts]);
  const discardDraft = () => {
    setDraft(null);captureOwner.current=null;
  };
  useEffect(() => {
    if (drafts.activeKey() !== 'new') { setDraft(null);captureOwner.current=null; }
  }, [activeDraftKey, drafts]);

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
    () => annotations.threads.filter((t) => matchesStatus(t, statusFilter)),
    [annotations.threads, statusFilter],
  );

  // Prune selection only when the host confirms a change or the reviewer changes
  // the filter. Failed/pending saves retain the popup; a late save cannot dismiss
  // a different discussion or apply a filter that the reviewer has since changed.
  useEffect(() => {
    const visible = new Set(visibleThreads.map(thread => thread.id));
    setOpenThreadIds(ids => {
      if (!ids) return ids;
      const next = ids.filter(id => visible.has(id));
      return next.length === ids.length ? ids : next.length ? next : null;
    });
  }, [visibleThreads]);

  // Only measure targets that something actually needs: threads that reference
  // them, plus whatever is hovered or being composed against.
  const neededIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of annotations.threads) for (const r of t.refs) ids.add(r.id);
    if (hover) ids.add(hover.id);
    if (draft) { ids.add(draft.target.id); draft.refs?.forEach(r => ids.add(r.id)); }
    if (regionPreview) ids.add(regionPreview.id);
    return ids;
  }, [annotations.threads, hover, draft, regionPreview]);

  const needed = useMemo(() => targets.filter((t) => neededIds.has(t.id)), [targets, neededIds]);
  const layouts = useLayouts(root, needed);

  const { pins } = useMemo(
    () => clusterPins(visibleThreads, layouts, pinSize),
    [visibleThreads, layouts, pinSize],
  );

  const { ordered, anchors, unanchoredIds } = useMemo(
    () => commentsInPageOrder(annotations.threads, layouts), [annotations.threads, layouts],
  );

  const openPin = useMemo(() => {
    if (!openThreadIds) return null;
    return pins.find((p) => p.threads.some((t) => openThreadIds.includes(t.id))) ?? null;
  }, [pins, openThreadIds]);
  // Keep the same cards/editors mounted when anchors vanish, return or regroup.
  const discussionThreads=visibleThreads.filter(t=>openThreadIds?.includes(t.id));
  useEffect(() => {
    const key = drafts.activeKey();
    if (!key?.startsWith('reply:') || drafts.pending()) return;
    const id = key.slice('reply:'.length);
    const shown = commentsOpen ? visibleThreads.some(t => t.id === id)
      : discussionThreads.some(t => t.id === id);
    if (!shown) drafts.discard(key);
  }, [activeDraftKey, saving, commentsOpen, visibleThreads, discussionThreads, drafts]);
  const discussionInTray=discussionThreads.length>0&&!openPin;
  const lastOpenAnchor=useRef<{key:string;rect:DOMRect}|null>(null);
  const openAnchorRect=useCallback(()=>{
    const key=openThreadIds?.join('|')??'';
    if(openPin&&!openPin.hidden){const rect=pinRectOf(openPin, pinSize)();lastOpenAnchor.current={key,rect};return rect;}
    return lastOpenAnchor.current?.key===key?lastOpenAnchor.current.rect:openPin?pinRectOf(openPin, pinSize)():new DOMRect();
  },[openPin,openThreadIds,pinSize]);

  const protectedPopupOpen = saving || protectOpenPopup && (!!draft || discussionThreads.length > 0 || commentsOpen);

  // A protected popup owns the interaction even with Comment mode off. Keep
  // background controls/charts from reacting to accidental taps; scrolling is
  // still available. Annotation UI lives outside this artifact event boundary.
  useEffect(() => {
    if (!root || !protectedPopupOpen) return;
    const block = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('[data-anno-ignore]')) return;
      event.preventDefault();event.stopPropagation();
    };
    const kinds = ['pointerdown', 'mousedown', 'click', 'dblclick'];
    for (const kind of kinds) root.addEventListener(kind, block, true);
    return () => { for (const kind of kinds) root.removeEventListener(kind, block, true); };
  }, [root, protectedPopupOpen]);

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
  const draftAnchored=draft?.refs?.length?draft.refs.some(ref=>{
    const layout=layouts.get(ref.id);return !!layout&&validRef(ref,layout);
  }):!!draftTarget;
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
            const anchor=new DOMRect(point.x-sx-2,point.y-sy-pinSize,pinSize,pinSize);
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
  }, [root,pinSize]);

  useEffect(() => { if (readOnly) { setCommentMode(false);discardEditor();setHover(null); } },[readOnly,discardEditor]);

  const appliedFocus = useRef<number | null>(null);

  // ---- focus (Jump) -------------------------------------------------------

  useEffect(() => {
    if (!focus || appliedFocus.current === focus.nonce) return;
    const t = annotations.threads.find((x) => x.id === focus.threadId);
    if (!t) return;
    appliedFocus.current = focus.nonce;
    if (!discardEditor()) return;
    if (!matchesStatus(t, statusFilter)) setStatusFilter('all');
    setReturnToComments(false);
    const liveLayouts = new Map(t.refs.flatMap(ref => {
      const target = root && findTargetById(root, ref.id);
      for (let parent=target?.el.parentElement;parent;parent=parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open=true;
      return target && root ? [[ref.id, measure(target, root)] as const] : [];
    }));
    const anchor = anchoredRefs(t, liveLayouts)[0];
    setCommentsOpen(!anchor);
    setOpenThreadIds(anchor ? [t.id] : null);
    if (anchor) anchor.layout.target.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else setFocusedComment({ id: t.id, nonce: focus.nonce });
    // Runs only when a new focus request arrives, not on every doc change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const timer = window.setTimeout(() => {
      if(focus.eventId) document.querySelector(`${anchor ? '.ca-popover' : '.ca-comments-panel'} [data-event-id="${CSS.escape(focus.eventId)}"]`)?.scrollIntoView({block:'nearest'});
    },350);
    return () => window.clearTimeout(timer);
  }, [focus?.nonce, annotations.threads.length, root]);

  // ---- mode transitions ---------------------------------------------------

  const enterCommentMode = useCallback(() => {
    if (readOnly || drafts.pending()) return;
    setCommentMode(true);
  }, [readOnly, drafts]);

  const exitCommentMode = useCallback(() => {
    if (drafts.pending()) return;
    setCommentMode(false);
    setHover(null);
  }, [drafts]);

  const toggleCommentMode = useCallback(() => {
    if (commentMode) exitCommentMode();
    else enterCommentMode();
  }, [commentMode, enterCommentMode, exitCommentMode]);

  // Popup selection is exclusive, independent of pointer-outside dismissal.
  // Both document and viewport pins use this same transition (including keys).
  const selectPin = useCallback((pin: Pin) => {
    if (!discardEditor()) return;
    setCommentsOpen(false);
    setReturnToComments(false);
    setOpenThreadIds((cur) =>
      cur && pin.threads.some((t) => cur.includes(t.id))
        ? null
        : pin.threads.map((t) => t.id),
    );
  }, [discardEditor]);

  const openDraft = useCallback((next: NonNullable<typeof draft>, continuing = false) => {
    if (drafts.pending()) return;
    if (!continuing && !drafts.begin('new')) return;
    setCommentsOpen(false);
    setReturnToComments(false);
    setCaptureError('');
    captureOwner.current=next.capture??null;
    setOpenThreadIds(null);
    setDraft(next);
  }, [drafts]);

  const openSelectionDraft=useCallback((next:NonNullable<typeof draft>, continuing = false)=>{
    if(drafts.pending())return;
    const ref=next.refs?.[0];
    if(!ref||(ref.kind!=='chart'&&ref.kind!=='region')){openDraft(next,continuing);return;}
    // A point already has its immutable key/label/value snapshot. Keep posting
    // immediate; only rectangles need a raster image of the selected area.
    if(ref.kind==='chart'&&ref.selection==='point'){openDraft(next,continuing);return;}
    const region=ref.kind==='chart'?ref.region:ref;
    const before=next.target.mode==='chart'?JSON.stringify(chartMarks(next.target).marks?.map(m=>({key:m.key,values:m.values,bounds:m.geometry.bounds}))):null;
    let timeout:ReturnType<typeof setTimeout>;
    const job=Promise.race([captureSelection(next.target,region),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(Error('Image capture timed out. Your draft is kept.')),12000);})]).finally(()=>clearTimeout(timeout)).then(snapshot=>{
      const after=next.target.mode==='chart'?JSON.stringify(chartMarks(next.target).marks?.map(m=>({key:m.key,values:m.values,bounds:m.geometry.bounds}))):null;
      if(before!==after)throw Error('The chart changed during capture. Your draft is kept; select the region again before posting.');
      return snapshot;
    });
    const withJob={...next,capture:job};openDraft(withJob,continuing);
    void job.then(snapshot=>setDraft(cur=>cur?.capture===job?{...cur,refs:cur.refs?.map((r,i)=>i===0?{...r,snapshot}:r)}:cur))
      .catch(error=>{if(captureOwner.current===job)setCaptureError(error instanceof Error?error.message:'Image capture failed. Your draft is kept.');});
  },[openDraft,drafts]);

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
      openSelectionDraft({...d,target,refs:[{...ref,region,snapshot:undefined}]},true);
    }else openSelectionDraft({...d,target,refs:[{...ref,snapshot:undefined}]},true);
  };

  const dismissPopup = () => { if (discardEditor()) { setOpenThreadIds(null);setReturnToComments(false); } };
  const closeComments = () => { if (discardEditor()) setCommentsOpen(false); };
  const changeFilter = (filter: CommentStatusFilter) => {
    if (drafts.pending()) return;
    const key = drafts.activeKey();
    const editing = key?.startsWith('reply:') ? annotations.threads.find(t => `reply:${t.id}` === key) : undefined;
    if (editing && !matchesStatus(editing, filter)) discardEditor();
    setStatusFilter(filter);
  };
  const changeStatus = (id: string, status: 'open' | 'resolved') => {
    if (readOnly) return;
    void Promise.resolve(onChange(setThreadStatus(annotations, id, status, { author }))).catch(() => {});
  };
  const resolveThread = (id: string) => changeStatus(id, 'resolved');
  const reopenThread = (id: string) => changeStatus(id, 'open');
  const replyToThread = async (id: string, body: Body[], options?: SubmitOptions) => {
    if (readOnly) return;
    await onChange(addReply(annotations, id, { author, body, notifyBot: options?.notifyBot }));
  };
  const showOnPage = (id: string) => {
    const anchor = anchors.get(id);
    if (!anchor) return;
    if (!discardEditor()) return;
    setCommentsOpen(false);
    setReturnToComments(true);
    setOpenThreadIds([id]);
    for(let parent=anchor.layout.target.el.parentElement;parent;parent=parent.parentElement) if(parent instanceof HTMLDetailsElement) parent.open=true;
    anchor.layout.target.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const openComments = () => {
    if (!discardEditor()) return;
    setFocusedComment(null);
    setOpenThreadIds(null);
    setReturnToComments(false);
    setCommentsOpen(true);
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
      if (!(e.target instanceof Node)) return;
      // Our own UI must stay clickable in comment mode.
      if (e.target instanceof HTMLElement && e.target.closest('[data-anno-ignore]')) return;

      const target = targetAtPoint(root, e.clientX, e.clientY);
      if (!target) return;

      // In comment mode a click means "comment on this", never "activate this".
      // The artifact has real controls — a Send button, a menu, a sort toggle —
      // so the click cannot mean both things at once.
      e.preventDefault();
      e.stopPropagation();
      if (protectedPopupOpen) return;
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
    if (!commentMode || !root || readOnly || protectedPopupOpen) return;
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
      if(target.mode==='block'&&target.el.closest('[data-anno-mode="chart"]')){
        chartDragging.current=true;
        window.getSelection()?.removeAllRanges();
      }
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
        } else if(d.target.mode==='block'&&d.target.el.closest('[data-anno-mode="chart"]')){
          suppressClick.current=Date.now()+500;
          openDraft({target:d.target,...pinFraction(d.target.el,d.x,d.y)});
        }
        return;
      }
      let refs: Ref[] = [];
      if(d.target.mode==='block'&&d.target.el.closest('[data-anno-mode="chart"]')){
        suppressClick.current=Date.now()+400;
        return; // In-chart labels are whole-element click targets, never plot drags.
      }
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
        // Dismiss the current popup first; only exit mode when none is open.
        if (draft) discardEditor();
        else if (openThreadIds) dismissPopup();
        else if (commentsOpen) closeComments();
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
            openDraft({target,refs,xPct:0,yPct:0});
          }
        }
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draft, openThreadIds, commentsOpen, commentMode, exitCommentMode, root, readOnly, openDraft, discardEditor]);

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
    discardDraft();
    if (statusFilter === 'resolved') setStatusFilter('all');
    setOpenThreadIds([thread.id]);
  };

  const widenDraft = () => {
    // Walk up from the live element, not the one captured when the draft opened.
    if (!draft || !root || !draftTarget || newDraftPending) return;
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
    <TooltipProvider><div className={`ca-root${commentMode ? ' ca-mode-comment' : ''}`}
      style={{ '--ca-pin-size': `${pinSize}px` } as React.CSSProperties} data-anno-ignore="">
      <Toolbar
        actions={toolbarActions}
        debug={debugToolbar}
        readOnly={readOnly}
        busy={saving}
        commentMode={commentMode}
        onToggleCommentMode={toggleCommentMode}
        pinsVisible={pinsVisible}
        onTogglePins={() => {
          if (drafts.pending()) return;
          setPinsVisible(v => !v);
        }}
        commentCount={visibleThreads.length}
        statusFilter={statusFilter}
        commentsOpen={commentsOpen}
        onToggleComments={() => commentsOpen ? closeComments() : openComments()}
      />

      {([...(pinsVisible ? visibleThreads : []).flatMap(t => t.refs.filter(r => r.kind !== 'anno_id')),
           ...(pinsVisible ? draft?.refs ?? [] : []), ...(regionPreview ? [regionPreview] : [])]).map((ref,i) => {
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
      {pinsVisible && draftLayout && draft && draftAnchored && (
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
          onDismiss={discardEditor}
          label={draft.refs?.[0]?.label??draft.target.label}
        >
          <article className="ca-thread ca-thread-draft" data-ca-draft-anchored={draftAnchored ? 'true' : 'false'}>
            <ThreadHeading target={draft.refs?.[0]??draft.target} unanchored={!draftAnchored} onDismiss={discardEditor} />
            <div className="ca-thread-body" tabIndex={0} role="region" aria-label="New comment">
              {!draftAnchored && <p className="ca-draft-unanchored" role="status">
                This selection is not visible in the current view. Your comment is kept and will be filed as unanchored.
              </p>}
              {draft.refs?.map((ref,i)=><SelectionDetails key={i} reference={ref} layout={layouts.get(ref.id)}/>)}
              {draft.capture&&!draft.refs?.[0]?.snapshot&&!captureError&&<p className="ca-capture-status" role="status">Capturing the selected image…</p>}
              {captureError&&<><p className="ca-capture-error" role="alert">{captureError}</p><button type="button" className="ca-btn-ghost" onClick={retryCapture}>Retry image in current view</button></>}
              <DraftComposer draftKey="new" Composer={Composer} onSubmit={commitDraft} onCancel={discardDraft} onEscape={discardEditor} submitDisabled={!!captureError} />
              {draft.refs?.[0]?.kind==='chart'&&<button type="button" className="ca-widen" disabled={newDraftPending} onClick={()=>openDraft({target:draft.target,xPct:draft.xPct,yPct:draft.yPct},true)}><ArrowUpLeft className="ca-icon" aria-hidden="true"/>Comment on the whole chart</button>}
              {draftWidenTo && (
                <button className="ca-widen" onClick={widenDraft} disabled={newDraftPending}>
                  <ArrowUpLeft className="ca-icon" aria-hidden="true" /> Widen to <b>{draftWidenTo}</b>
                </button>
              )}
            </div>
          </article>
        </Popover>
      )}

      {/* Keep the active editor mounted if a chart anchor disappears or returns. */}
      {discussionThreads.length > 0 && !draft && !commentsOpen && (
        <Popover
          anchorRect={openAnchorRect}
          onDismiss={dismissPopup}
          tray={discussionInTray}
          threadCount={discussionThreads.length}
          label={discussionThreads.length===1?discussionThreads[0].refs[0]?.label:undefined}
          onBack={returnToComments ? openComments : undefined}
        >
          <ThreadList
            layouts={layouts}
            threads={discussionThreads}
            Composer={Composer}
            readOnly={readOnly}
            unanchoredIds={unanchoredIds}
            onDismiss={dismissPopup}
            onReply={replyToThread}
            onResolve={resolveThread}
            onReopen={reopenThread}
          />
        </Popover>
      )}

      {/* Reader position is retained; closing or switching views ends editing. */}
      <CommentsPanel open={commentsOpen} filter={statusFilter}
        total={annotations.threads.length} openCount={openThreads} resolvedCount={resolvedThreads}
        visibleCount={visibleThreads.length} focusedComment={focusedComment}
        onFilter={changeFilter} onDismiss={closeComments} busy={saving}>
        <ThreadList
          threads={ordered}
          active={commentsOpen}
          onEscape={closeComments}
          layouts={layouts}
          hiddenIds={new Set(ordered.filter(t => !matchesStatus(t, statusFilter)).map(t => t.id))}
          Composer={Composer} readOnly={readOnly}
          unanchoredIds={unanchoredIds}
          navigableIds={new Set([...anchors].filter(([, anchor]) => !!anchor).map(([id]) => id))}
          onShowOnPage={showOnPage}
          onReply={replyToThread} onResolve={resolveThread} onReopen={reopenThread}
        />
      </CommentsPanel>
    </div></TooltipProvider>,
    host,
  );
}

// ---------------------------------------------------------------------------

function Toolbar({
  commentMode, onToggleCommentMode, pinsVisible, onTogglePins,
  commentCount, statusFilter, commentsOpen, onToggleComments, actions, debug, readOnly, busy,
}: {
  actions?: React.ReactNode;
  commentMode: boolean;
  onToggleCommentMode: () => void;
  pinsVisible: boolean;
  onTogglePins: () => void;
  commentCount: number;
  statusFilter: CommentStatusFilter;
  commentsOpen: boolean;
  onToggleComments: () => void;
  busy: boolean;
  debug: boolean;
  readOnly: boolean;
}) {
  const filterLabel = statusFilter === 'open' ? 'Open' : statusFilter === 'resolved' ? 'Resolved' : '';
  return (
    <div className="ca-toolbar" role="toolbar" aria-label="Comments" data-debug={debug || undefined} data-anno-preserve-draft="">
      <div className="ca-toolbar-group ca-toolbar-primary">
        <Hint content={readOnly ? 'Sign in to add comments' : 'Click a target or chart mark, select text, or draw a rectangle on an image or chart. Escape exits comment mode.'} disabled={readOnly}>
          <button className={`ca-tool ca-tool-comment${commentMode ? ' ca-tool-active' : ''}`}
            onClick={onToggleCommentMode} aria-pressed={commentMode} aria-label="Comment mode" disabled={readOnly || busy}>
            <MessageSquarePlus className="ca-icon" aria-hidden="true" />
            {commentMode ? 'Commenting' : 'Comment'}
          </button>
        </Hint>
        <div className="ca-tool-segments" role="group" aria-label="Comments and markers">
          <Hint content={`${commentsOpen ? 'Close' : 'Read'} comments in page order${filterLabel ? ` · ${filterLabel} only` : ''}`}>
            <button className={`ca-tool${commentsOpen ? ' ca-tool-on' : ''}`}
              onClick={onToggleComments} aria-expanded={commentsOpen} disabled={busy}
              aria-label={filterLabel ? `Comments: ${filterLabel}` : 'Comments'} data-testid="toggle-comments">
              <span className="ca-comments-icon" aria-hidden="true">
                <MessageCircle className="ca-icon" />
                {filterLabel && <span className="ca-filter-badge" data-status={statusFilter}>
                  {statusFilter === 'open' ? <CircleDot /> : <CircleCheck />}
                </span>}
              </span>
              Comments <span className="ca-count">{commentCount}</span>
            </button>
          </Hint>
          <Hint content={pinsVisible ? 'Hide markers' : 'Show markers'}>
            <button className={`ca-tool${pinsVisible ? ' ca-tool-on' : ''}`}
              onClick={onTogglePins} aria-pressed={pinsVisible} disabled={busy} aria-label={pinsVisible ? 'Hide markers' : 'Show markers'} data-testid="toggle-markers">
              {pinsVisible ? <Eye className="ca-icon" aria-hidden="true" /> : <EyeOff className="ca-icon" aria-hidden="true" />}
            </button>
          </Hint>
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
  onBack,
  tray = false,
  children,
}: {
  anchorRect: () => DOMRect;
  onDismiss: () => void;
  label?: string;
  threadCount?: number;
  onBack?: () => void;
  tray?: boolean;
  children: React.ReactNode;
}) {
  const saving = useDraftPending();
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
        // An async measurement can finish after the surface moved to the tray.
        if(elements.floating.classList.contains('ca-tray'))return;
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
    <div ref={refs.setFloating} style={{...(tray?{position:'fixed',left:16,top:'auto',bottom:toolbarHeight+10,transform:'none',maxWidth:'calc(100vw - 32px)',maxHeight:`min(60vh, calc(100dvh - ${toolbarHeight+26}px))`}:floatingStyles), '--ca-toolbar-height': `${toolbarHeight}px`, visibility: tray||isPositioned ? 'visible' : 'hidden'} as React.CSSProperties} role="dialog" tabIndex={-1} aria-label={tray?'Unanchored threads':threadCount > 1 ? `${threadCount} threads` : label ?? "Comments"} onKeyDown={(e) => {
      if (e.key === 'Escape') {e.preventDefault();e.stopPropagation();onDismiss();}

    }} className={tray?`ca-tray ca-tray-open${threadCount>1?' ca-tray-multiple':''}`:`ca-popover${threadCount>1?' ca-popover-multiple':''}`} data-anno-ignore="">
      {onBack && <div className="ca-reader-back"><button className="ca-btn-ghost" onClick={onBack} disabled={saving}>
        <ArrowLeft className="ca-icon" aria-hidden="true" /> Back to comments
      </button></div>}
      {threadCount > 1 && <header className={tray?"ca-tray-head":"ca-popover-head"}>
        <span className="ca-popover-title">{threadCount} threads</span>
        <CloseComments onDismiss={onDismiss} label={tray?'Close unanchored comments':'Close comments'} />
      </header>}
      <div className={tray?"ca-tray-body":"ca-popover-body"} tabIndex={threadCount > 1 ? 0 : undefined}
        role={threadCount > 1 ? 'region' : undefined} aria-label={tray?'Unanchored threads':threadCount > 1 ? 'Discussions' : undefined}>{(tray||isPositioned) && children}</div>
    </div>
  );
}

function CommentsPanel({ open, filter, total, openCount, resolvedCount, visibleCount, focusedComment, onFilter, onDismiss, busy, children }: {
  open: boolean;
  filter: CommentStatusFilter;
  total: number;
  openCount: number;
  resolvedCount: number;
  visibleCount: number;
  focusedComment: { id: string; nonce: number } | null;
  onFilter: (filter: CommentStatusFilter) => void;
  onDismiss: () => void;
  busy: boolean;
  children: React.ReactNode;
}) {
  const [visited, setVisited] = useState(open);
  useEffect(() => { if (open) setVisited(true); }, [open]);
  const panel = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [toolbarHeight, setToolbarHeight] = useState(48);
  // Both popup types share device dismissal. A closed reader remains mounted
  // for reading position, but must not handle outside presses in another view.
  useOutsideDismiss(panel, onDismiss, undefined, open);
  const positions = useRef(new Map<CommentStatusFilter, { id?: string; offset: number; top: number }>());
  const remember = () => {
    if (!open || !body.current) return;
    const node = body.current, top = node.getBoundingClientRect().top;
    const card = [...node.querySelectorAll<HTMLElement>('.ca-thread:not([hidden])')]
      .find(el => el.getBoundingClientRect().bottom > top);
    positions.current.set(filter, { id: card?.dataset.threadId, offset: card ? card.getBoundingClientRect().top - top : 0, top: node.scrollTop });
  };
  // Preserve the first visible card and its offset even if an earlier card is
  // inserted or receives a reply. No sorting by recency and no scroll-to-latest.
  useLayoutEffect(() => {
    if (!open || !body.current) return;
    const saved = positions.current.get(filter), node = body.current;
    const card = saved?.id && node.querySelector<HTMLElement>(`[data-thread-id="${CSS.escape(saved.id)}"]:not([hidden])`);
    if (saved) node.scrollTop = card
      ? node.scrollTop + card.getBoundingClientRect().top - node.getBoundingClientRect().top - saved.offset
      : saved.top;
    else node.scrollTop = 0;
    remember();
  });
  useEffect(() => {
    const toolbar = document.querySelector('.ca-toolbar');
    if (!toolbar) return;
    const observer = new ResizeObserver(() => setToolbarHeight(toolbar.getBoundingClientRect().height));
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (open) panel.current?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open || !focusedComment || !body.current) return;
    const card = body.current.querySelector<HTMLElement>(`[data-thread-id="${CSS.escape(focusedComment.id)}"]`);
    card?.scrollIntoView({ block: 'nearest' });
    remember();
  // Explicit external focus only, never incoming data.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, focusedComment]);
  const close = () => {
    if (busy) return;
    onDismiss();
    panel.current?.closest('.ca-root')?.querySelector<HTMLElement>('[data-testid="toggle-comments"]')?.focus({ preventScroll: true });
  };
  if (!visited && !open) return null;
  return (
    <aside ref={panel} hidden={!open} className="ca-tray ca-tray-multiple ca-comments-panel"
      role="dialog" tabIndex={-1} aria-label="Comments"
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }}
      style={{ bottom: toolbarHeight + 10, '--ca-toolbar-height': `${toolbarHeight}px` } as React.CSSProperties} data-anno-ignore="">
      <header className="ca-tray-head"><span>Comments</span><CloseComments onDismiss={close} /></header>
      <div className="ca-comments-filters" role="group" aria-label="Discussion status">
        {([['all', 'All', total], ['open', 'Open', openCount], ['resolved', 'Resolved', resolvedCount]] as const).map(([value, label, count]) =>
          <button key={value} type="button" className="ca-status-filter" aria-pressed={filter === value} disabled={busy}
            aria-label={`${label} discussions`} onClick={() => { remember(); onFilter(value); }}>
            {label} <span className="ca-filter-count">{count}</span>
          </button>)}
      </div>
      <div ref={body} className="ca-tray-body" tabIndex={0} role="region" aria-label="Discussions" onScroll={remember}>
        {visibleCount === 0 && <p className="ca-comments-empty" role="status">
          {total === 0 ? 'No comments yet.' : filter === 'open' ? 'No open discussions.' : 'No resolved discussions.'}
        </p>}
        {children}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------

function pinRectOf(pin: Pin, pinSize: number): () => DOMRect {
  return () => {
    // Pin coords are in its layer's space; floating-ui wants viewport space.
    const x = pin.layer === 'document' ? pin.x - window.scrollX : pin.x;
    const y = pin.layer === 'document' ? pin.y - window.scrollY : pin.y;
    return new DOMRect(x - 2, y - pinSize, pinSize, pinSize);
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
