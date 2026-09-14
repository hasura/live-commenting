import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SpecPage } from './fixture/SpecPage';
import { DevOverlay } from './dev/DevOverlay';
import {
  Annotations, emptyDoc, foldEvents, diffDoc, bodyText,
  type AnnotationDoc, type AnnotationEvent, type Author, type LocalEvent,
} from './annotations';

const STORAGE_KEY = 'annotation-fixture-doc';
const DEV = import.meta.env.DEV;
const POLL_MS = 4000;

type Sync = {
  cursor: number; pending: number; due: boolean; inflight: boolean;
  oldestAt: string | null; dueAt: string | null;
  lastSentAt: string | null; lastMessageId: string | null; lastStatus: string | null;
  maxAgeMs: number; maxCount: number;
};
type Feed = { seq: number; events: AnnotationEvent[]; sync: Sync };
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
  const seqRef=useRef(0);
  const toastId=useRef(0);
  const userRef=useRef<Author|null>(null);
  const autoSyncedFor=useRef<string>('');

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
        const names=[...new Set(others.map(e=>e.actor.kind==='bot'?`${e.actor.name} (bot)`:e.actor.name))];
        const first=others[0];
        const verb=others.length===1?(first.kind==='comment'?'new comment':`thread ${first.kind==='resolve'?'resolved':'reopened'}`):`${others.length} new`;
        toast({text:`${verb} from ${names.join(', ')}`,jump:first.thread_id});
      }
      return [...cur,...fresh].sort((a,b)=>a.seq-b.seq);
    });
    seqRef.current=Math.max(seqRef.current,feed.seq);
    setSync(feed.sync);
  },[toast]);

  useEffect(()=>{
    let cancelled=false, timer:number|undefined;
    const poll=async()=>{
      if(cancelled || document.visibilityState!=='visible' || !userRef.current) return;
      try{
        const r=await fetch(`/api/events?since=${seqRef.current}`);
        if(r.ok) merge(await r.json() as Feed,true);
        else if(r.status===401) setStatus('Session expired — reload the app to continue.');
      }catch{/* transient; next tick */}
    };
    const schedule=()=>{ window.clearInterval(timer); timer=window.setInterval(()=>void poll(),POLL_MS); };
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
  },[merge]);

  const post=useCallback(async(ev:LocalEvent)=>{
    const me=userRef.current!;
    const provisional:AnnotationEvent={seq:Number.MAX_SAFE_INTEGER-Math.floor(Math.random()*1e9),id:ev.id,thread_id:ev.thread_id,kind:ev.kind,
      actor:{...me,kind:'user'},body:ev.body,refs:ev.refs,pin:ev.pin,created_at:new Date().toISOString()};
    setOptimistic(o=>[...o.filter(x=>x.id!==ev.id),provisional]);
    try{
      const r=await fetch('/api/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(ev)});
      const data=await r.json();
      if(!r.ok) throw Error(data.error??`Failed (${r.status})`);
      setEvents(cur=>cur.some(e=>e.seq===data.event.seq)?cur:[...cur,data.event as AnnotationEvent].sort((a,b)=>a.seq-b.seq));
      setOptimistic(o=>o.filter(x=>x.id!==ev.id));
      seqRef.current=Math.max(seqRef.current,data.seq);
    }catch(e){
      setOptimistic(o=>o.filter(x=>x.id!==ev.id));
      const what=ev.kind==='comment'?`“${bodyText(ev.body??[]).slice(0,80)}”`:ev.kind;
      toast({text:`Not posted — ${(e as Error).message}: ${what}`,retry:ev});
    }
  },[toast]);

  const handleChange=useCallback((next:AnnotationDoc)=>{
    if(!userRef.current) return;
    for(const ev of diffDoc(doc,next)) void post(ev);
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
      else if(data.status==='sent') toast({text:`Sent ${data.count} message${data.count===1?'':'s'} to ${botName}`});
    }catch(e){ toast({text:`Sync failed — ${(e as Error).message}`}); }
    finally{ setSyncing(false); }
  },[syncing,toast,botName]);

  // Whichever tab notices a batch is due sends it; the server keeps it to one.
  useEffect(()=>{
    if(!sync?.due || sync.inflight || document.visibilityState!=='visible') return;
    const key=`${sync.cursor}:${sync.pending}`;
    if(autoSyncedFor.current===key) return;
    autoSyncedFor.current=key;
    void syncNow();
  },[sync,syncNow]);

  const jump=(threadId:string)=>{
    const t=doc.threads.find(x=>x.id===threadId);
    const el=t && root?.querySelector<HTMLElement>(`[data-anno-id="${CSS.escape(t.refs[0].id)}"]`);
    el?.scrollIntoView({behavior:'smooth',block:'center'});
  };

  return <>
    <aside className="review-banner" data-anno-ignore="">
      <strong>Collaborative annotation review</strong>
      <span>Comment mode from the toolbar · click/tap: block · drag: text or image region · Alt+Enter: selected text. Every comment is shared the moment you post it; {botName} reads them in batches.</span>
      {status && <span role="status">{status}</span>}
      <span>Signed in: {user?.name??'Open the app to authenticate'}</span>
      <SyncFooter sync={sync} botName={botName} syncing={syncing} onSyncNow={()=>void syncNow()}/>
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
      author={user??{id:'anonymous',name:'Reviewer'}} readOnly={!user}/>
  </>;
}

function SyncFooter({sync,botName,syncing,onSyncNow}:{sync:Sync|null;botName:string;syncing:boolean;onSyncNow:()=>void}) {
  const [,tick]=useState(0);
  useEffect(()=>{ const t=window.setInterval(()=>tick(n=>n+1),30000); return ()=>window.clearInterval(t); },[]);
  if(!sync) return null;
  const ago=sync.lastSentAt?relativeAgo(sync.lastSentAt):'never';
  const next=sync.pending?(sync.due?'due now':sync.dueAt?`in ${untilText(sync.dueAt)}`:''):'';
  return <span className="review-sync" data-testid="sync-footer">
    {botName}: last read {ago}
    {sync.pending?` · ${sync.pending} pending${next?` · next ${next}`:''}`:' · nothing pending'}
    {sync.pending>0 && <> · <button disabled={syncing||sync.inflight} onClick={onSyncNow}>{syncing||sync.inflight?'Sending…':'Sync now'}</button></>}
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