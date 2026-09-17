import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Send, Users } from 'lucide-react';
import { toast as notify } from 'sonner';
import { Toaster } from './ui/sonner';
import { Hint } from './annotations/ui/tooltip';
import { SpecPage } from './fixture/SpecPage';
import { DevOverlay } from './dev/DevOverlay';
import {
  Annotations, emptyDoc, foldEvents, diffDoc, bodyText,
  type AnnotationDoc, type AnnotationEvent, type Author, type LocalEvent,
} from './annotations';

const STORAGE_KEY = 'annotation-fixture-doc';
const DEV = import.meta.env.DEV;
// TEMPORARY visual review: turn off before pushing. Current-build Refresh must
// be hidden outside debug mode; do not remove the (debug || stale) render gate.
const TEMPORARY_DEBUG_TOOLBAR = true;
const DEFAULT_POLL_MS = 4000; // until the server says otherwise (presence.pollMs)

type Sync = {
  nudged: number; pulled: number; pending: number; unread: number; due: boolean; inflight: boolean;
  oldestAt: string | null; dueAt: string | null;
  lastNudgedAt: string | null; lastMessageId: string | null; lastPulledAt: string | null;
  maxAgeMs: number; maxCount: number;
};
type Presence = { count: number; viewers: string[]; ttlMs?: number; pollMs?: number; graceMs?: number };
type Feed = { seq: number; events: AnnotationEvent[]; sync: Sync; presence?: Presence; build?: string };
type Toast = { text: string; jump?: string; retry?: LocalEvent };

/**
 * Production host: the document is the fold of the server's event log. Every
 * edit the layer hands back is diffed into events and posted; every poll merges
 * what other readers (and the bot) appended. Nothing is held back — there is
 * no draft, no Save all, no publish step.
 *
 * Development host (`vite dev`): a local document in localStorage, as before,
 * so the layer can be exercised without a server.
 */
export default function App() {
  const [root,setRoot]=useState<HTMLElement|null>(null);
  const rootRef=useRef<HTMLDivElement>(null);
  useEffect(()=>setRoot(rootRef.current),[]);
  return <>
    {DEV ? <DevHost root={root} rootRef={rootRef}/> : <SharedHost root={root} rootRef={rootRef}/>}
  </>;
}

// ---------------------------------------------------------------------------

function SharedHost({root,rootRef}:{root:HTMLElement|null;rootRef:React.RefObject<HTMLDivElement|null>}) {
  const [events,setEvents]=useState<AnnotationEvent[]>([]);
  const [optimistic,setOptimistic]=useState<AnnotationEvent[]>([]);
  const [user,setUser]=useState<Author|null>(null);
  const [botName,setBotName]=useState('the bot');
  const [sync,setSync]=useState<Sync|null>(null);
  const [status,setStatus]=useState('');
  const [syncing,setSyncing]=useState(false);
  const [presence,setPresence]=useState<Presence|null>(null);
  const [stale,setStale]=useState(false);
  const [offline,setOffline]=useState(false);
  const [pollMs,setPollMs]=useState(DEFAULT_POLL_MS);
  const seqRef=useRef(0);
  const buildRef=useRef('');
  const jumpRef = useRef<(id: string) => void>(() => {});
  const postRef = useRef<(event: LocalEvent) => void>(() => {});
  const userRef=useRef<Author|null>(null);
  const autoSyncedFor=useRef<string>('');
  const missedRef=useRef(0);

  const doc=useMemo(()=>foldEvents([...events,...optimistic]),[events,optimistic]);

  const toast=useCallback((t:Toast)=>{
    const options = {
      duration: t.retry ? Infinity : 8000,
      action: t.jump ? { label: 'Jump', onClick: () => jumpRef.current(t.jump!) }
        : t.retry ? { label: 'Retry', onClick: () => postRef.current(t.retry!) } : undefined,
    };
    if (t.retry) notify.error(t.text, options);
    else notify(t.text, options);
  },[]);

  useEffect(() => {
    if (status) notify.error(status, { id: 'review-status', duration: Infinity });
    else notify.dismiss('review-status');
  }, [status]);
  useEffect(() => {
    if (offline) notify.loading('Reconnecting…', { id: 'review-offline', duration: Infinity });
    else notify.dismiss('review-offline');
  }, [offline]);

  /** Merge a feed page; announce what other people posted. */
  const merge=useCallback((feed:Feed,announce:boolean)=>{
    setEvents(cur=>{
      const seen=new Set(cur.map(e=>e.seq));
      const fresh=feed.events.filter(e=>!seen.has(e.seq));
      if(!fresh.length) return cur;
      const ids=new Set(fresh.map(e=>e.id));
      setOptimistic(o=>o.filter(e=>!ids.has(e.id)));
      const me=userRef.current?.id;
      const others=fresh.filter(e=>e.actor.id!==me);
      if(announce && others.length){
        const names=[...new Set(others.map(e=>e.actor.name))];
        const first=others[0];
        const verb=others.length===1?(first.kind==='comment'?'new comment':`thread ${first.kind==='resolve'?'resolved':'reopened'}`):`${others.length} new`;
        toast({text:`${verb} from ${names.join(', ')}`,jump:first.thread_id});
      }
      return [...cur,...fresh].sort((a,b)=>a.seq-b.seq);
    });
    seqRef.current=Math.max(seqRef.current,feed.seq);
    setSync(feed.sync);
    if(feed.presence){ setPresence(feed.presence); if(feed.presence.pollMs) setPollMs(feed.presence.pollMs); }
    // First response pins the build this tab is running; any later change means
    // the app was rebuilt underneath us. Comments are in the log, not the bundle.
    if(feed.build){ if(!buildRef.current) buildRef.current=feed.build; else if(feed.build!==buildRef.current) setStale(true); }
  },[toast]);

  useEffect(()=>{
    let cancelled=false, timer:number|undefined;
    const poll=async()=>{
      if(cancelled || document.visibilityState!=='visible' || !userRef.current) return;
      try{
        const r=await fetch(`/api/events?since=${seqRef.current}`);
        if(r.ok){ merge(await r.json() as Feed,true); missedRef.current=0; setOffline(false); }
        else if(r.status===401) setStatus('Session expired — reload the app to continue.');
      }catch{ if(++missedRef.current>=2) setOffline(true); /* transient; next tick */ }
    };
    const schedule=()=>{ window.clearInterval(timer); timer=window.setInterval(()=>void poll(),pollMs); };
    (async()=>{
      try{
        const r=await fetch('/api/state');
        const data=await r.json();
        if(!r.ok) throw Error(data.error??'Unable to load');
        if(cancelled) return;
        userRef.current=data.user; setUser(data.user); setBotName(data.bot??'the bot');
        merge(data as Feed,false);
        setStatus('');
        schedule();
      }catch(e){ if(!cancelled) setStatus((e as Error).message); }
    })();
    const vis=()=>{ if(document.visibilityState==='visible'){ void poll(); schedule(); } };
    document.addEventListener('visibilitychange',vis);
    return ()=>{ cancelled=true; window.clearInterval(timer); document.removeEventListener('visibilitychange',vis); };
  },[merge,pollMs]);

  const post=useCallback(async(ev:LocalEvent)=>{
    const me=userRef.current!;
    const provisional:AnnotationEvent={seq:Number.MAX_SAFE_INTEGER-Math.floor(Math.random()*1e9),id:ev.id,thread_id:ev.thread_id,kind:ev.kind,
      actor:{...me,kind:'user'},body:ev.body,refs:ev.refs,pin:ev.pin,created_at:new Date().toISOString()};
    setOptimistic(o=>[...o.filter(x=>x.id!==ev.id),provisional]);
    try{
      const r=await fetch('/api/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(ev)});
      const data=await r.json();
      // A status flip that someone else already made (409) is not an error worth
      // a toast: the next poll brings their event, and the comment that follows a
      // reopen still posts. Only comments are worth retrying.
      if(r.status===409 && ev.kind!=='comment'){ setOptimistic(o=>o.filter(x=>x.id!==ev.id)); return; }
      if(!r.ok) throw Error(data.error??`Failed (${r.status})`);
      setEvents(cur=>cur.some(e=>e.seq===data.event.seq)?cur:[...cur,data.event as AnnotationEvent].sort((a,b)=>a.seq-b.seq));
      setOptimistic(o=>o.filter(x=>x.id!==ev.id));
      // Do not move the poll cursor to our own seq: anything appended between the
      // last poll and this post would be skipped forever. merge() dedupes by seq.
    }catch(e){
      setOptimistic(o=>o.filter(x=>x.id!==ev.id));
      const what=ev.kind==='comment'?`“${bodyText(ev.body??[]).slice(0,80)}”`:ev.kind;
      toast({text:`Not posted — ${(e as Error).message}: ${what}`,retry:ev});
    }
  },[toast]);

  // Events for one change are posted in order (a reply on a resolved thread is
  // reopen, then comment) and awaited one at a time so the server sees the
  // reopen before the comment.
  const handleChange=useCallback((next:AnnotationDoc)=>{
    if(!userRef.current) return;
    const evs=diffDoc(doc,next);
    void (async()=>{ for(const ev of evs) await post(ev); })();
  },[doc,post]);

  const syncNow=useCallback(async()=>{
    if(syncing) return;
    setSyncing(true);
    try{
      const r=await fetch('/api/sync-now',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      if(r.status===204) return; // another tab is already sending
      const data=await r.json();
      if(data.sync) setSync(data.sync);
      if(!r.ok) toast({text:`Sync to ${botName} failed — ${data.error??data.status}`});
      else if(data.status==='nudged') toast({text:`Nudged ${botName} about ${data.count} comment${data.count===1?'':'s'}`});
    }catch(e){ toast({text:`Sync failed — ${(e as Error).message}`}); }
    finally{ setSyncing(false); }
  },[syncing,toast,botName]);

  // Whichever tab notices a nudge is due sends it; the server keeps it to one.
  useEffect(()=>{
    if(!sync?.due || sync.inflight || document.visibilityState!=='visible') return;
    const key=`${sync.nudged}:${sync.pending}`;
    if(autoSyncedFor.current===key) return;
    autoSyncedFor.current=key;
    void syncNow();
  },[sync,syncNow]);

  // Jump hands the thread to the annotation layer, which shows resolved threads
  // if it has to, turns pins on, opens the popover and scrolls the anchor into view.
  const [focus,setFocus]=useState<{threadId:string;nonce:number}|null>(null);
  const jump=(threadId:string)=>setFocus({threadId,nonce:Date.now()});
  useEffect(() => { jumpRef.current = jump; postRef.current = ev => { void post(ev); }; });

  return <>
    {/* Fixed shape: a title and one status line. Nothing is ever added to or
        removed from the banner at runtime — transient signals go to the toasts
        (errors, reconnecting) or the commenting bar (refresh, pending/Sync now). */}
    <aside className="review-banner" data-anno-ignore="">
      <strong>Live commenting debug</strong>
      <StatusLine user={user} sync={sync} botName={botName}/>
    </aside>
    <div data-anno-ignore=""><Toaster /></div>
    <div id="artifact-root" ref={rootRef}><SpecPage/></div>
    <Annotations root={root} annotations={doc} onChange={handleChange}
      debugToolbar={TEMPORARY_DEBUG_TOOLBAR} author={user??{id:'anonymous',name:'Reviewer'}} readOnly={!user} focus={focus}
      toolbarActions={<ToolbarStatus debug={TEMPORARY_DEBUG_TOOLBAR} presence={presence} stale={stale} sync={sync} syncing={syncing} onSyncNow={()=>void syncNow()}/>}/>
  </>;
}

/** Debug fixture: all controls stay mounted; counts and enabled state remain real. */
function ToolbarStatus({presence,stale,sync,syncing,onSyncNow,debug=false}:{debug?:boolean;presence:Presence|null;stale:boolean;sync:Sync|null;syncing:boolean;onSyncNow:()=>void}) {
  const pending = sync?.pending ?? 0;
  const busy = syncing || !!sync?.inflight;
  const syncDisabled = !sync || pending === 0 || busy;
  const syncText = !sync ? 'Sync unavailable in local preview' : pending === 0 ? 'No pending comments to sync'
    : `Syncing ${pending} pending comment${pending === 1 ? '' : 's'} to the bot.${busy ? '' : ' Click to sync immediately.'}`;
  const refreshText = stale
    ? 'The app was updated — refresh to see the changes. Your comments are saved.'
    : 'You are on the latest build. Your comments are saved.';
  return <>
    <Hint content={presence ? `Viewing now: ${presence.viewers.join(', ') || 'no viewers'}` : 'Viewer presence unavailable in local preview'}>
      <span className="ca-tool ca-tool-status ca-presence" data-testid="presence" tabIndex={0}
        aria-label={`${presence?.count ?? 0} viewing now`}>
        <Users className="ca-icon" aria-hidden="true" /><span>{presence?.count ?? 0}</span>
      </span>
    </Hint>
    <Hint disabled={syncDisabled} content={syncText}>
      <button className={`ca-tool ca-tool-sync${sync?.due ? ' ca-tool-due' : ''}`} data-testid="sync-now"
        disabled={syncDisabled} aria-label={syncText} onClick={onSyncNow}>
        <Send className={`ca-icon${busy ? ' ca-spin' : ''}`} aria-hidden="true" />
        <span>{pending}</span>
      </button>
    </Hint>
    {(debug || stale) && <Hint content={refreshText} disabled={!stale}>
      <button className={`ca-tool ca-tool-refresh${stale ? ' ca-tool-stale' : ''}`} data-testid="refresh"
        disabled={!stale} aria-label={refreshText} onClick={()=>location.reload()}>
        <RefreshCw className="ca-icon" aria-hidden="true" /><span>Refresh</span>
      </button>
    </Hint>}
  </>;
}

/**
 * The one line in the banner: who the reviewer is and when the bot last read.
 * Always the same three spans — text changes, elements never do.
 */
function StatusLine({user,sync,botName}:{user:Author|null;sync:Sync|null;botName:string}) {
  const [,tick]=useState(0);
  useEffect(()=>{ const t=window.setInterval(()=>tick(n=>n+1),30000); return ()=>window.clearInterval(t); },[]);
  const read=sync?(sync.lastPulledAt?relativeAgo(sync.lastPulledAt):'never'):'—';
  return <span className="review-line review-sync" data-testid="sync-footer">
    <span>Signed in: {user?.name??'Open the app to authenticate'}</span>
    <span className="review-sep">·</span>
    <span>{botName} last read {read}</span>
  </span>;
}
const relativeAgo=(iso:string)=>{ const s=Math.max(0,(Date.now()-Date.parse(iso))/1000); return s<60?'just now':s<3600?`${Math.floor(s/60)}m ago`:s<86400?`${Math.floor(s/3600)}h ago`:`${Math.floor(s/86400)}d ago`; };

// ---------------------------------------------------------------------------

function DevHost({root,rootRef}:{root:HTMLElement|null;rootRef:React.RefObject<HTMLDivElement|null>}) {
  const [doc,setDoc]=useState<AnnotationDoc>(loadDoc);
  const author={id:'demo-user',name:'Sam Rivera'};
  const handleChange=useCallback((next:AnnotationDoc)=>{
    setDoc(next);
    try{ localStorage.setItem(STORAGE_KEY,JSON.stringify(next)); }catch{}
  },[]);
  return <>
    <div id="artifact-root" ref={rootRef}><SpecPage/></div>
    <Annotations root={root} annotations={doc} onChange={handleChange} author={author} debugToolbar={TEMPORARY_DEBUG_TOOLBAR}
      toolbarActions={<ToolbarStatus debug={TEMPORARY_DEBUG_TOOLBAR} presence={null} stale={false} sync={null} syncing={false} onSyncNow={()=>{}}/>}/>
    <DevOverlay doc={doc} onResetDoc={()=>handleChange(emptyDoc())}/>
  </>;
}
function loadDoc():AnnotationDoc{
  try{const parsed=JSON.parse(localStorage.getItem(STORAGE_KEY)??'null');
    if(parsed?.version===1 && Array.isArray(parsed.threads))return parsed;
  }catch{}
  return emptyDoc();
}