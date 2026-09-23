import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Toaster } from './ui/sonner';
import { Hint } from './annotations/ui/tooltip';
import { SpecPage } from './fixture/SpecPage';
import { DevOverlay } from './dev/DevOverlay';
import { Annotations, PresenceIndicator, type ViewerPresence, foldEvents, diffDoc, type AnnotationDoc, type AnnotationEvent, type Author, type LocalEvent, type MentionDirectory } from './annotations';

/**
 * The one host. Development (`npm run dev`) and the published app run this same
 * code against the same review server (`server.mjs`); only the platform behind
 * the server differs (a fake one in development, see scripts/dev-server.mjs).
 * The dev inspector is the single development-only addition.
 */
type Presence=ViewerPresence & {pollMs?:number};
type Feed={seq:number;events:AnnotationEvent[];presence?:Presence;build?:string;protocol?:number};
export default function App(){
 const rootRef=useRef<HTMLDivElement>(null);
 const [root,setRoot]=useState<HTMLElement|null>(null);
 useEffect(()=>setRoot(rootRef.current),[]);
 const [events,setEvents]=useState<AnnotationEvent[]>([]),[user,setUser]=useState<Author|null>(null);
 const [directory,setDirectory]=useState<MentionDirectory|null>(null),[directoryError,setDirectoryError]=useState('');
 const [presence,setPresence]=useState<Presence|null>(null),[stale,setStale]=useState(false);
 const [focus,setFocus]=useState<{threadId:string;eventId?:string;nonce:number}|null>(null);
 const seq=useRef(0),build=useRef(''),pollMs=useRef(4000),refreshAt=useRef(0),refreshing=useRef(false);
 const userRef=useRef<Author|null>(null),alive=useRef(true);
 const doc=useMemo(()=>foldEvents(events),[events]);
 const merge=useCallback((feed:Feed,announce=false)=>{
  setEvents(cur=>{
   const known=new Set(cur.map(e=>e.id));const fresh=feed.events.filter(e=>!known.has(e.id));
   return [...cur,...fresh].sort((a,b)=>a.seq-b.seq);
  });
  if(announce) {
   const other=feed.events.find(e=>e.actor.id!==userRef.current?.id);
   if(other)toast(`New activity from ${other.actor.name}`,{action:{label:'Jump',onClick:()=>setFocus({threadId:other.thread_id,nonce:Date.now()})}});
  }
  if(feed.presence){setPresence(feed.presence);pollMs.current=feed.presence.pollMs??4000;}
  if(feed.build){if(build.current&&build.current!==feed.build)setStale(true);else build.current=feed.build;}
 },[]);
 const refreshDirectory=useCallback(async(force=false)=>{
  if(refreshing.current||(!force&&Date.now()-refreshAt.current<60000))return;
  refreshing.current=true;
  try{
   const r=await fetch('/api/directory',{cache:'no-store'});const d=await r.json();
   if(!r.ok)throw Error('Participants unavailable');
   if(alive.current){setDirectory(d);setDirectoryError('');refreshAt.current=Date.now();}
  }catch{if(alive.current){setDirectory(null);setDirectoryError('Participants unavailable');}}
  finally{refreshing.current=false;}
 },[]);
 useEffect(()=>{
  alive.current=true;let cancelled=false,timer:ReturnType<typeof setTimeout>;
  const poll=async()=>{
   if(cancelled)return;
   if(document.visibilityState==='visible'&&userRef.current){
    try{const r=await fetch(`/api/events?since=${seq.current}`);
     if(!r.ok)throw Error('Connection unavailable');
     const data:Feed=await r.json();if(cancelled)return;merge(data,true);seq.current=Math.max(seq.current,data.seq);
     toast.dismiss('offline');void refreshDirectory();
    }catch{toast.error('Connection unavailable',{id:'offline'});}
   }
   timer=setTimeout(poll,pollMs.current);
  };
  void(async()=>{
   try{const r=await fetch('/api/state');const d=await r.json();if(!r.ok)throw Error(d.error??'Unable to load');
    if(cancelled)return;
    if(d.protocol!==5)throw Error('The app was updated. Refresh to continue.');
    userRef.current=d.user;setUser(d.user);merge(d);seq.current=d.seq;
    const params=new URLSearchParams(location.search),threadId=params.get('anno_discussion'),eventId=params.get('anno_event');
    if(threadId)setFocus({threadId,eventId:eventId??undefined,nonce:Date.now()});
    void refreshDirectory(true);timer=setTimeout(poll,pollMs.current);
   }catch(e){toast.error((e as Error).message,{duration:Infinity});}
  })();
  const foreground=()=>{if(document.visibilityState==='visible'){clearTimeout(timer);void poll();void refreshDirectory(true);}};
  document.addEventListener('visibilitychange',foreground);window.addEventListener('online',foreground);
  return()=>{cancelled=true;alive.current=false;clearTimeout(timer);document.removeEventListener('visibilitychange',foreground);window.removeEventListener('online',foreground);};
 },[merge,refreshDirectory]);
 const post=useCallback(async(ev:LocalEvent)=>{
  const r=await fetch('/api/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...ev,protocol:5})});
  const d=await r.json();
  if(r.status===409&&ev.kind!=='comment')return;
  if(!r.ok)throw Error(d.error??'Saving failed. Your draft is still here.');
  // Own writes never move the poll cursor: intervening events must still arrive.
  merge({seq:d.seq,events:[d.event,...(d.error_event?[d.error_event]:[])]});
  if(d.send_error)toast.error(d.send_error);
 },[merge]);
 const change=useCallback(async(next:AnnotationDoc)=>{
  try{if(stale)throw Error('The app was updated. Copy your draft before refreshing.');for(const ev of diffDoc(doc,next))await post(ev);}
  catch(e){toast.error('Saving failed. Your draft is still here.');throw e;}
 },[doc,post,stale]);
 return <>
  <aside className="review-banner" data-anno-ignore=""><strong>Live commenting debug</strong><span className="review-line">Signed in: {user?.name??'Open the app to authenticate'}</span></aside>
  <div data-anno-ignore=""><Toaster/></div>
  <div id="artifact-root" ref={rootRef}><SpecPage/></div>
  <Annotations root={root} annotations={doc} author={user??{id:'anonymous',name:'Reviewer'}} readOnly={!user} onChange={change} focus={focus}
   mentions={{directory,error:directoryError,refresh:()=>void refreshDirectory()}}
   toolbarActions={<ToolbarStatus presence={presence} stale={stale}/>}/>
  {import.meta.env.DEV&&<DevOverlay doc={doc}/>}
 </>;
}
function ToolbarStatus({presence,stale}:{presence:Presence|null;stale:boolean}){
 return <>
  <PresenceIndicator presence={presence}/>
  {stale&&<Hint content="The app was updated. Refresh to continue."><button className="ca-tool ca-tool-refresh ca-tool-stale" data-testid="refresh" onClick={()=>location.reload()}><RefreshCw className="ca-icon"/>Refresh</button></Hint>}
 </>;
}