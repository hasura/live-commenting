import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SpecPage } from './fixture/SpecPage';
import { DevOverlay } from './dev/DevOverlay';
import {
  Annotations, emptyDoc, foldEvents, diffDoc, bodyText,
  type AnnotationDoc, type AnnotationEvent, type Author, type LocalEvent,
} from './annotations';

const STORAGE_KEY = 'annotation-fixture-doc';
const DEV = import.meta.env.DEV;
const DEFAULT_POLL_MS = 4000; // until the server says otherwise (presence.pollMs)

type Sync = {
  nudged: number; pulled: number; pending: number; unread: number; due: boolean; inflight: boolean;
  oldestAt: string | null; dueAt: string | null;
  lastNudgedAt: string | null; lastMessageId: string | null; lastPulledAt: string | null;
  maxAgeMs: number; maxCount: number;
};
type Presence = { count: number; viewers: string[]; ttlMs?: number; pollMs?: number; graceMs?: number };
type Feed = { seq: number; events: AnnotationEvent[]; sync: Sync; presence?: Presence; build?: string };
type Toast = { id: number; text: string; jump?: string; retry?: LocalEvent };

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
  const [status,setStatus]=useState('Loading shared review…');
  const [toasts,setToasts]=useState<Toast[]>([]);
  const [syncing,setSyncing]=useState(false);
  const [presence,setPresence]=useState<Presence|null>(null);
  const [stale,setStale]=useState(false);
  const [offline,setOffline]=useState(false);
  const [pollMs,setPollMs]=useState(DEFAULT_POLL_MS);
  const seqRef=useRef(0);
  const buildRef=useRef('');
  const toastId=useRef(0);
  const userRef=useRef<Author|null>(null);
  const autoSyncedFor=useRef<string>('');
  const missedRef=useRef(0);

  const doc=useMemo(()=>foldEvents([...events,...optimistic]),[events,optimistic]);

  const toast=useCallback((t:Omit<Toast,'id'>)=>{
    const id=++toastId.current;
    setToasts(cur=>[...cur.slice(-4),{id,...t}]);
    if(!t.retry) window.setTimeout(()=>setToasts(cur=>cur.filter(x=>x.id!==id)),8000);
  },[]);

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
      else if(data.status==='nudged') toast({text:`Nudged ${botName} about ${data.count} message${data.count===1?'':'s'}`});
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

  return <>
    <aside className="review-banner" data-anno-ignore="">
      <strong>Collaborative annotation review</strong>
      {status && <span role="status">{status}</span>}
      <StatusLine user={user} sync={sync} botName={botName} syncing={syncing} offline={offline} onSyncNow={()=>void syncNow()}/>
      <details className="review-debug-wrap">
        <summary>Live commenting debug</summary>
        <DebugState sync={sync} presence={presence} seq={seqRef.current} events={events.length} optimistic={optimistic.length} build={buildRef.current} stale={stale} pollMs={pollMs} offline={offline}/>
      </details>
    </aside>
    <div className="review-toasts" data-anno-ignore="" aria-live="polite">
      {toasts.map(t=><div key={t.id} className={`review-toast${t.retry?' review-toast-error':''}`}>
        <span>{t.text}</span>
        {t.jump && <button onClick={()=>{jump(t.jump!);setToasts(c=>c.filter(x=>x.id!==t.id));}}>Jump</button>}
        {t.retry && <button onClick={()=>{setToasts(c=>c.filter(x=>x.id!==t.id));void post(t.retry!);}}>Retry</button>}
        <button aria-label="Dismiss" onClick={()=>setToasts(c=>c.filter(x=>x.id!==t.id))}>×</button>
      </div>)}
    </div>
    <div id="artifact-root" ref={rootRef}><SpecPage/></div>
    <Annotations root={root} annotations={doc} onChange={handleChange}
      author={user??{id:'anonymous',name:'Reviewer'}} readOnly={!user} focus={focus}
      toolbarActions={<ToolbarStatus presence={presence} stale={stale}/>}/>
  </>;
}

/** Left end of the commenting bar: who is looking now, and a refresh when the app was rebuilt. */
function ToolbarStatus({presence,stale}:{presence:Presence|null;stale:boolean}) {
  return <>
    {presence && <span className="ca-tool ca-tool-sm ca-presence" data-testid="presence"
      title={`Viewing now: ${presence.viewers.join(', ')}`} aria-label={`${presence.count} viewing now`}>
      <span className="ca-tool-icon" aria-hidden="true">👥</span>{presence.count}
    </span>}
    {stale && <button className="ca-tool ca-tool-sm ca-tool-refresh" data-testid="refresh"
      title="The app was updated — refresh to see the changes. Your comments are saved."
      aria-label="The app was updated — refresh to see the changes. Your comments are saved."
      onClick={()=>location.reload()}>
      <span className="ca-tool-icon" aria-hidden="true">⟳</span>
    </button>}
  </>;
}

/**
 * The one line a reviewer needs: who they are, when the bot last read, and —
 * only when it matters — that a nudge is due (with the count) or that the tab
 * has lost the server. Everything else is in the debug block.
 */
function StatusLine({user,sync,botName,syncing,offline,onSyncNow}:{user:Author|null;sync:Sync|null;botName:string;syncing:boolean;offline:boolean;onSyncNow:()=>void}) {
  const [,tick]=useState(0);
  useEffect(()=>{ const t=window.setInterval(()=>tick(n=>n+1),30000); return ()=>window.clearInterval(t); },[]);
  const read=sync?.lastPulledAt?relativeAgo(sync.lastPulledAt):'never';
  return <span className="review-line review-sync" data-testid="sync-footer">
    <span>Signed in: {user?.name??'Open the app to authenticate'}</span>
    {sync && <><span className="review-sep">·</span><span>{botName} last read {read}</span></>}
    {sync && sync.pending>0 && <><span className="review-sep">·</span>
      <span className={sync.due?'review-due':undefined}>{sync.pending} pending{sync.due?' · nudge due':''}</span>
      <button disabled={syncing||sync.inflight} onClick={onSyncNow}>{syncing||sync.inflight?'Nudging…':'Sync now'}</button></>}
    {offline && <><span className="review-sep">·</span><span className="review-offline" data-testid="offline">Reconnecting…</span></>}
  </span>;
}
/** Internal state, for debugging: the log position, both bot cursors, the nudge window, presence and build. */
function DebugState({sync,presence,seq,events,optimistic,build,stale,pollMs,offline}:{sync:Sync|null;presence:Presence|null;seq:number;events:number;optimistic:number;build:string;stale:boolean;pollMs:number;offline:boolean}) {
  if(!sync) return null;
  const t=(iso:string|null)=>iso?new Date(iso).toLocaleTimeString(undefined,{hour12:false}):'—';
  const waiting=sync.unread>sync.pending?` · ${sync.unread-sync.pending} nudged, not yet read`:'';
  return <span className="review-debug" data-testid="debug-state">
    <span>log: seq {seq} · {events} events loaded{optimistic?` · ${optimistic} posting`:''} · poll {pollMs/1000}s{offline?' · OFFLINE':''}</span>
    <span>bot cursors: nudged {sync.nudged} · pulled {sync.pulled} · pending {sync.pending} · unread {sync.unread}{waiting}</span>
    <span>nudge: due {String(sync.due)} · inflight {String(sync.inflight)} · oldest pending {t(sync.oldestAt)} · due at {t(sync.dueAt)} · next {sync.pending?(sync.due?'due now':sync.dueAt?`in ${untilText(sync.dueAt)}`:'—'):'nothing pending'} · window {Math.round(sync.maxAgeMs/1000)}s / {sync.maxCount} msgs</span>
    <span>last nudge {t(sync.lastNudgedAt)}{sync.lastMessageId?` (msg ${sync.lastMessageId})`:''} · last pull {t(sync.lastPulledAt)}</span>
    <span>presence: {presence?`${presence.count} · ${presence.viewers.join(', ')} · ttl ${(presence.ttlMs??0)/1000}s (poll ${(presence.pollMs??pollMs)/1000}s + grace ${(presence.graceMs??0)/1000}s)`:'—'} · build {build||'—'}{stale?' (stale)':''}</span>
  </span>;
}
const relativeAgo=(iso:string)=>{ const s=Math.max(0,(Date.now()-Date.parse(iso))/1000); return s<60?'just now':s<3600?`${Math.floor(s/60)}m ago`:s<86400?`${Math.floor(s/3600)}h ago`:`${Math.floor(s/86400)}d ago`; };
const untilText=(iso:string)=>{ const s=Math.max(0,(Date.parse(iso)-Date.now())/1000); return s<60?'<1m':`${Math.ceil(s/60)}m`; };

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
    <Annotations root={root} annotations={doc} onChange={handleChange} author={author}/>
    <DevOverlay doc={doc} onResetDoc={()=>handleChange(emptyDoc())}/>
  </>;
}
function loadDoc():AnnotationDoc{
  try{const parsed=JSON.parse(localStorage.getItem(STORAGE_KEY)??'null');
    if(parsed?.version===1 && Array.isArray(parsed.threads))return parsed;
  }catch{}
  return emptyDoc();
}