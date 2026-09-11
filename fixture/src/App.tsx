import { useCallback, useEffect, useRef, useState } from 'react';
import { SpecPage } from './fixture/SpecPage';
import { DevOverlay } from './dev/DevOverlay';
import { Annotations, emptyDoc, flattenAnnotations, readManifest, type AnnotationDoc, type Author } from './annotations';

const STORAGE_KEY = 'annotation-fixture-doc';
const VERSION = 'spec-v0.3';
const DEV = import.meta.env.DEV;
type Shared = {revision: number; doc: AnnotationDoc; user: Author};

export default function App() {
  const [root,setRoot]=useState<HTMLElement|null>(null);
  const rootRef=useRef<HTMLDivElement>(null);
  const [doc,setDoc]=useState<AnnotationDoc>(()=>DEV?loadDoc():emptyDoc(VERSION));
  const [shared,setShared]=useState<Shared|null>(null);
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState(DEV?'Local test fixture':'Loading shared review…');
  const [history,setHistory]=useState(false);
  const [uncertain,setUncertain]=useState(false);
  const pendingSave=useRef<{id:string;json:string}|null>(null);
  const draftKey=shared?`annotation-draft-${shared.user.id}`:null;
  const pending=doc.threads.filter(t=>!t.closedRoundId).length;
  useEffect(()=>setRoot(rootRef.current),[]);

  const load=useCallback(async()=>{
    setBusy(true);
    try {
      const r=await fetch('/api/state');
      const data=await r.json();
      if(!r.ok)throw Error(data.error??'Unable to load');
      const next=data as Shared;
      setShared(next);
      let restored=false;
      try {
        const cached=JSON.parse(localStorage.getItem(`annotation-draft-${next.user.id}`)??'null');
        if(cached?.revision===next.revision && cached.doc?.version===1){
          setDoc(cached.doc);restored=true;
          if(cached.pendingSave) {pendingSave.current=cached.pendingSave;setUncertain(true);}
        } else setDoc(next.doc);
      } catch {setDoc(next.doc);}
      setStatus(restored?'Local draft restored.':'Shared review loaded.');
    }catch(e){setStatus((e as Error).message);}finally{setBusy(false);}
  },[]);
  useEffect(()=>{if(!DEV)void load();},[load]);

  const handleChange=useCallback((next:AnnotationDoc)=>{
    if(busy || (!DEV && !shared) || uncertain)return;
    setDoc(next);
    try{
      localStorage.setItem(DEV?STORAGE_KEY:draftKey!,DEV?JSON.stringify(next):
        JSON.stringify({revision:shared!.revision,doc:next}));
    }catch{setStatus('Browser storage unavailable; download your draft before leaving.');}
  },[busy,shared,draftKey,uncertain]);

  const save=async()=>{
    if(!shared || busy)return;
    if(document.querySelector<HTMLTextAreaElement>('.ca-composer-input')?.value.trim()){
      setStatus('Post or cancel the comment currently in the composer before Save all.');return;
    }
    if(!pendingSave.current){
      const id=crypto.randomUUID();
      // Snapshot generated content only; no tokens, toolbar, or overlay DOM.
      const json=JSON.stringify({saveId:id,revision:shared.revision,doc,snapshot:root?.outerHTML??'',manifest:root?readManifest(root):[]});
      pendingSave.current={id,json};
    }
    setBusy(true);
    const request=pendingSave.current;
    try{
      try{localStorage.setItem(draftKey!,JSON.stringify({revision:shared.revision,doc,pendingSave:request}));}catch{}
      const r=await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:request.json});
      const result=await r.json();
      if(!r.ok){
        if(r.status===502 || result.saveId){setUncertain(true);}
        else {pendingSave.current=null;setUncertain(false);}
        throw Error(result.error??`Save failed (${r.status})`);
      }
      setDoc(result.doc);setShared({...shared,revision:result.revision,doc:result.doc});
      pendingSave.current=null;setUncertain(false);
      localStorage.removeItem(draftKey!);
      setStatus(`Saved review and posted to this bot. Message ${result.messageId}`);
    }catch(e){if(pendingSave.current)setUncertain(true);setStatus(`${(e as Error).message}${pendingSave.current?` · Save ID: ${request.id}`:''}`);}
    finally{setBusy(false);}
  };
  const download=()=>{
    const blob=new Blob([JSON.stringify({revision:shared?.revision,doc},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='annotation-review-draft.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <>
    {!DEV && <aside className="review-banner" data-anno-ignore="">
      <strong>Collaborative annotation review</strong>
      <span>Comment mode from the toolbar · click/tap: block · drag: text or image region · Alt+Enter: selected text. Sample spec below retains its original baseline wording.</span>
      <span role="status">{status}</span>
      <span>Signed in: {shared?.user.name??'Open the app to authenticate'} · Shared save/reload, not live editing</span>
      <div>
        <button onClick={()=>setHistory(!history)}>Sent rounds ({doc.rounds?.length??0})</button>
        <button onClick={download}>Download draft</button>
        <button disabled={busy || uncertain} onClick={()=>{
          if(pending && !window.confirm('Download your draft first. Discard local edits and reload shared review?'))return;
          if(draftKey)localStorage.removeItem(draftKey);
          pendingSave.current=null;void load();
        }}>Reload shared</button>
      </div>
      {history && <div className="review-history">{(doc.rounds??[]).map(r=><details key={r.id}>
        <summary>{r.createdAt} · {r.threads.length} discussions · {r.artifactVersion} · read-only</summary>
        <pre>{flattenAnnotations({version:1,artifactVersion:r.artifactVersion,threads:r.threads})}</pre>
      </details>)}</div>}
    </aside>}
    <div id="artifact-root" ref={rootRef}><SpecPage/></div>
    <Annotations root={root} annotations={doc} onChange={handleChange}
      author={shared?.user??{id:'demo-user',name:'Sam Rivera'}}
      readOnly={!DEV && (!shared || busy || uncertain)}
      toolbarActions={!DEV && <button data-anno-preserve-draft="" className="ca-tool ca-tool-active"
        disabled={!shared || busy || !pending} onClick={()=>void save()}>
        {busy?'Saving…':uncertain?'Check same save':'Save all'}{pending?` (${pending})`:''}
      </button>}
    />
    {DEV && <DevOverlay doc={doc} onResetDoc={()=>handleChange(emptyDoc(VERSION))}/>}
  </>;
}
function loadDoc():AnnotationDoc{
  try{const parsed=JSON.parse(localStorage.getItem(STORAGE_KEY)??'null');
    if(parsed?.version===1 && Array.isArray(parsed.threads))return parsed;
  }catch{}
  return emptyDoc(VERSION);
}