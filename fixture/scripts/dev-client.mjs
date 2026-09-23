/**
 * Suite helpers against the development harness (scripts/dev-server.mjs).
 *
 * The suites drive the real host: state is read by folding the server's event
 * log exactly as the app does, seeded by posting real events through `/api`,
 * and reset by asking the harness to restart the server on an empty directory.
 * Nothing here touches the production server code.
 */
export const origin=(process.env.FIXTURE_URL??'http://127.0.0.1:5180').replace(/\/$/,'');
const installed=new WeakSet();

/** `window.__annoDoc()` inside the page: the event log, folded like the app does. */
export async function install(page){
 if(installed.has(page))return;installed.add(page);
 await page.addInitScript(()=>{
  window.__annoDoc=async()=>{
   const {foldEvents}=await import('/src/annotations/events.ts');
   const r=await fetch('/api/state');if(!r.ok)throw Error(`state ${r.status}`);
   return foldEvents((await r.json()).events);
  };
 });
}

/** Restart the review server on empty state, then load `url` in `page`. */
export async function reset(page,url=origin+'/'){
 await install(page);
 await page.goto('about:blank');           // stop polling before the server goes away
 const base=new URL(url).origin;
 const r=await fetch(base+'/__dev/reset',{method:'POST'});
 if(r.status!==204)throw Error(`dev reset failed (${r.status}): is scripts/dev-server.mjs running on ${base}?`);
 await page.goto(url,{waitUntil:'networkidle'});
}

/** The annotation document as the app sees it. */
export const readDoc=page=>page.evaluate(async()=>{
 const {foldEvents}=await import('/src/annotations/events.ts');
 const r=await fetch('/api/state');if(!r.ok)throw Error(`state ${r.status}`);
 return foldEvents((await r.json()).events);
});

/**
 * Seed discussions as real events, authored by the page's identity. Thread and
 * comment ids must satisfy the server's id rule (8–80 chars of [A-Za-z0-9_-]).
 * A `status:'resolved'` thread gets a trailing resolve event.
 */
export async function seed(page,threads,{reload=true}={}){
 await page.evaluate(async threads=>{
  const post=async e=>{
   const r=await fetch('/api/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({protocol:5,...e})});
   if(!r.ok)throw Error(`seed rejected (${r.status}): ${await r.text()}`);
  };
  for(const t of threads){
   let first=true;
   for(const c of t.comments){await post({id:c.id,thread_id:t.id,kind:'comment',body:c.body,...(first?{refs:t.refs,...(t.pin?{pin:t.pin}:{})}:{})});first=false;}
   if(t.status==='resolved')await post({id:`${t.id}-resolve`,thread_id:t.id,kind:'resolve'});
  }
 },threads);
 if(reload)await page.reload({waitUntil:'networkidle'});
}

/** Empty state, then these discussions. */
export async function resetAndSeed(page,threads,url){await reset(page,url);if(threads.length)await seed(page,threads);}