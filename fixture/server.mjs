/**
 * Live commenting v5. Durable save, then one visitor-authorized send.
 * No background dispatcher, bot read cursor, credential storage or retries.
 */
import http from 'node:http';
import {readFile, mkdir, unlink, chmod} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {validateBody,recipients,receipt,discussionUrl,sendingFailed,fail} from './server/protocol.mjs';

const PORT=Number(process.env.PORT??5190), ROOT=resolve(process.env.ANNO_DIST??'dist'), DATA=resolve(process.env.ANNO_DATA??'runtime-state');
const SOCK=process.env.ANNO_SOCK??resolve(DATA,'anno.sock');
const API=process.env.PROMPTQL_PLATFORM_API_URL, BOT=process.env.PROMPTQL_THREAD_ID;
const TZ=process.env.PROMPTQL_TIMEZONE??'UTC';
const BOT_NAME=process.env.BOT_NAME?.trim()||'PromptQL';
const APP_URL=process.env.ANNO_APP_URL, APP_TITLE=process.env.ANNO_APP_TITLE??'Live commenting';
const POLL_MS=Number(process.env.POLL_MS??4000), PRESENCE_GRACE_MS=Number(process.env.PRESENCE_GRACE_MS??2000);
const PRESENCE_TTL_MS=Number(process.env.PRESENCE_TTL_MS??POLL_MS+PRESENCE_GRACE_MS);
const MAX_BODY_BYTES=Number(process.env.MAX_BODY_BYTES??16384);
const BUILD_ID=process.env.BUILD_ID?.trim()||`v5 ${new Date().toISOString()}`;
if(!API||!BOT) throw Error('Platform URL and bot ID required');
await mkdir(DATA,{recursive:true});
const db=new DatabaseSync(resolve(DATA,'state.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
const schema=`CREATE TABLE event(
 seq INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('comment','resolve','reopen','error')),
 actor_kind TEXT NOT NULL CHECK(actor_kind IN ('user','bot')),
 actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, body TEXT, refs TEXT, pin TEXT,
 source_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
 invokes_bot INTEGER NOT NULL DEFAULT 0, related_id TEXT, code TEXT, fingerprint TEXT, message_id TEXT);`;
const existing=db.prepare("SELECT sql FROM sqlite_master WHERE name='event'").get()?.sql;
if(!existing) db.exec(schema);
else if(!existing.includes("'error'")) {
 db.exec('BEGIN IMMEDIATE');
 try {
  db.exec('DROP VIEW IF EXISTS v_thread; DROP INDEX IF EXISTS event_thread; ALTER TABLE event RENAME TO event_v4;');
  db.exec(schema);
  db.exec(`INSERT INTO event(seq,thread_id,kind,actor_kind,actor_id,actor_name,body,refs,pin,source_id,created_at)
    SELECT seq,thread_id,kind,actor_kind,actor_id,actor_name,body,refs,pin,source_id,created_at FROM event_v4;
    DROP TABLE event_v4; COMMIT;`);
 } catch(e) {db.exec('ROLLBACK');throw e;}
}
// Remove obsolete read/ack/nudge state, not the comment history.
db.exec(`DROP TABLE IF EXISTS reader; DROP TABLE IF EXISTS receipt;
 CREATE INDEX IF NOT EXISTS event_thread ON event(thread_id,seq);
 CREATE VIEW IF NOT EXISTS v_thread AS
 SELECT o.thread_id, o.actor_id AS opener_id,o.actor_name AS opener_name,o.created_at AS opened_at,o.seq AS open_seq,
 COALESCE((SELECT CASE s.kind WHEN 'resolve' THEN 'resolved' ELSE 'open' END FROM event s
 WHERE s.thread_id=o.thread_id AND s.kind IN ('resolve','reopen') ORDER BY s.seq DESC LIMIT 1),'open') AS status,
 (SELECT MAX(e.seq) FROM event e WHERE e.thread_id=o.thread_id) AS last_seq,
 (SELECT COUNT(*) FROM event c WHERE c.thread_id=o.thread_id AND c.kind='comment') AS n_comments
 FROM event o WHERE o.kind='comment' AND o.refs IS NOT NULL;`);
const q={
 insert:db.prepare('INSERT INTO event(thread_id,kind,actor_kind,actor_id,actor_name,body,refs,pin,source_id,created_at,invokes_bot,related_id,code,fingerprint) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)'),
 bySource:db.prepare('SELECT * FROM event WHERE source_id=?'),
 bySeq:db.prepare('SELECT * FROM event WHERE seq=?'),
 since:db.prepare('SELECT * FROM event WHERE seq>? ORDER BY seq'),
 maxSeq:db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM event'),
 thread:db.prepare('SELECT * FROM v_thread WHERE thread_id=?'),
 threads:db.prepare('SELECT * FROM v_thread ORDER BY open_seq'),
 opener:db.prepare("SELECT * FROM event WHERE thread_id=? AND refs IS NOT NULL ORDER BY seq LIMIT 1"),
 ack:db.prepare('UPDATE event SET message_id=? WHERE source_id=?'),
};
const parse=s=>s==null?undefined:JSON.parse(s);
const shape=r=>({seq:r.seq,id:r.source_id,thread_id:r.thread_id,kind:r.kind,
 actor:{id:r.actor_id,name:r.actor_name,kind:r.actor_kind},created_at:r.created_at,
 ...(r.body?{body:parse(r.body)}:{}),...(r.refs?{refs:parse(r.refs)}:{}),...(r.pin?{pin:parse(r.pin)}:{}),
 ...(r.invokes_bot?{invokes_bot:true}:{}),...(r.related_id?{related_id:r.related_id}:{}),...(r.code?{code:r.code}:{}),
 ...(r.message_id?{message_id:r.message_id}:{})});
const ID=/^[a-zA-Z0-9_-]{8,80}$/;
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const fingerprint=(input,actor)=>createHash('sha256').update(JSON.stringify(stable({input,actor:{id:actor.id,kind:actor.kind}}))).digest('hex');
function assertRefs(refs) {
  if(!Array.isArray(refs) || !refs.length || refs.length>50) throw fail(400,'Opening comment needs a reference');
  for(const r of refs) {
    if(typeof r?.id!=='string' || !['anno_id','text','region'].includes(r.kind)) throw fail(400,'Invalid reference');
    if(r.kind==='text' && (!Number.isInteger(r.start)||!Number.isInteger(r.end)||r.start<0||r.end<=r.start||typeof r.quote!=='string')) throw fail(400,'Invalid text offsets');
    if(r.kind==='region' && (![r.xPct,r.yPct,r.wPct,r.hPct].every(Number.isFinite)||r.xPct<0||r.yPct<0||r.wPct<=0||r.hPct<=0||r.xPct+r.wPct>1.000001||r.yPct+r.hPct>1.000001)) throw fail(400,'Invalid region');
    if(r.label!=null && typeof r.label!=='string') throw fail(400,'Invalid reference label');
  }
  return refs;
}
function assertPin(pin) {
  if(pin==null) return undefined;
  if(![pin.xPct,pin.yPct].every(v=>Number.isFinite(v)&&v>=0&&v<=1)) throw fail(400,'Invalid pin');
  return {xPct:pin.xPct,yPct:pin.yPct};
}


function appendEvent(input,actor,{invokesBot=false,error=false,fp}={}) {
 const {id=randomUUID(),thread_id,kind,body,refs,pin,related_id,code}=input;
 if(typeof id!=='string'||!ID.test(id)||typeof thread_id!=='string'||!ID.test(thread_id)) throw fail(400,'Invalid event or discussion id');
 if(!['comment','resolve','reopen',...(error?['error']:[])].includes(kind)) throw fail(400,'Invalid event kind');
 const prior=q.bySource.get(id);
 if(prior) {
  if(!fp||prior.fingerprint!==fp) throw fail(409,'Event id already used with different payload');
  return {event:shape(prior),replay:true};
 }
 const thread=q.thread.get(thread_id);
 let refsJson=null,pinJson=null,bodyJson=null;
 if(kind==='comment') {
  bodyJson=JSON.stringify(validateBody(body,MAX_BODY_BYTES));
  if(!thread) {refsJson=JSON.stringify(assertRefs(refs));const p=assertPin(pin);if(p)pinJson=JSON.stringify(p);}
  else if(refs||pin) throw fail(409,'Discussion already exists');
 } else {
  if(!thread)throw fail(404,'Unknown discussion');
  if(kind==='resolve'&&thread.status==='resolved')throw fail(409,'Discussion is already resolved');
  if(kind==='reopen'&&thread.status==='open')throw fail(409,'Discussion is already open');
  if(body)bodyJson=JSON.stringify(validateBody(body,MAX_BODY_BYTES));
 }
 const {lastInsertRowid}=q.insert.run(thread_id,kind,actor.kind,actor.id,actor.name,bodyJson,refsJson,pinJson,id,new Date().toISOString(),invokesBot?1:0,related_id??null,code??null,fp??null);
 return {event:shape(q.bySeq.get(lastInsertRowid)),replay:false};
}
const viewers=new Map();
const seen=user=>viewers.set(user.id,{name:user.name,at:Date.now()});
function presence() {
 for(const [id,v]of viewers)if(Date.now()-v.at>PRESENCE_TTL_MS)viewers.delete(id);
 return {count:viewers.size,viewers:[...viewers.values()].map(v=>v.name),ttlMs:PRESENCE_TTL_MS,pollMs:POLL_MS,graceMs:PRESENCE_GRACE_MS};
}
const meta=()=>({protocol:5,presence:presence(),build:BUILD_ID});
async function graphql(token,query,variables,description) {
 const r=await platform('graphql',token,{method:'POST',headers:{'Content-Type':'application/json',...(description?{'X-PromptQL-Description':description}:{})},body:JSON.stringify({query,variables})});
 if(r?.errors?.length)throw fail(502,'Platform request rejected');
 return r?.data??r;
}
/** Deliberately no server-wide directory cache: never share one viewer's grants. */
async function directory(visitor) {
 const info=await graphql(visitor.token,'query { get_project_info { projectId } }');
 const project=info.get_project_info.projectId;
 const d=await graphql(visitor.token,`query($id:uuid!,$project:uuid!){
 thread_participants(where:{thread_id:{_eq:$id},is_removed:{_eq:false}},order_by:{created_at:asc}){
 promptql_user_id promptql_user{display_name email is_active is_bot}}
 project_configuration_by_pk(project_id:$project){agent_name}
 }`,{id:BOT,project});
 const botName=d.project_configuration_by_pk?.agent_name?.trim()||'PromptQL';
 const users=d.thread_participants.filter(p=>p.promptql_user?.is_active&&!p.promptql_user.is_bot).map(p=>({
 entity:'user',id:p.promptql_user_id,label:p.promptql_user.display_name||p.promptql_user.email||'Reviewer'
 }));
 return {key:`${project}:${BOT}:${visitor.user.id}`,botName,entries:[...users,{entity:'bot',id:'current',label:botName,aliases:['promptql']}],updatedAt:new Date().toISOString()};
}
async function saveAndSend(input,visitor) {
 if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.id!=='string'||!ID.test(input.id))throw fail(400,'Invalid event id');
 if(input.protocol!==5)throw fail(409,'The app was updated. Refresh before posting.');
 if(input.notify_bot!=null&&typeof input.notify_bot!=='boolean')throw fail(400,'Invalid invocation intent');
 const fp=fingerprint(input,visitor.user);
 const prior=q.bySource.get(input.id);
 if(prior) {
  if(prior.fingerprint!==fp)throw fail(409,'Event id already used with different payload');
  return {event:shape(prior),replay:true};
 }
 const body=input.body?validateBody(input.body,MAX_BODY_BYTES):undefined;
 const people=input.kind==='comment'?recipients(body):[];
 const invokesBot=input.kind==='comment'&&(input.notify_bot===true||people.some(p=>p.entity==='bot'));
 if(input.kind!=='comment'&&(input.notify_bot||people.length))throw fail(400,'Only comments can request delivery');
 let botName=BOT_NAME;
 // Revalidate selected recipients, under the submitting viewer's permissions.
 if(people.length||invokesBot) {
  const d=await directory(visitor);botName=d.botName;
  for(const p of people)if(!d.entries.some(e=>e.entity===p.entity&&e.id===p.id))throw fail(403,'A selected recipient is no longer available. Remove the badge and try again.');
 }
 const saved=appendEvent({...input,body},visitor.user,{invokesBot,fp});
 if(saved.replay||(!people.length&&!invokesBot))return saved;
 const event=saved.event;
 try {
  const opener=q.opener.get(event.thread_id), ref=parse(opener.refs)[0];
  if(!visitor.appUrl&&!APP_URL)throw Error('App URL not configured');
  const url=discussionUrl(visitor.appUrl??APP_URL,event.thread_id,event.id);
  const message=receipt({body,recipients:people,invokesBot,url,title:ref.label??ref.id,appTitle:APP_TITLE});
  const result=await graphql(visitor.token,`mutation($id:String!,$message:String!,$tz:String!,$mode:String!){
    send_thread_message(threadId:$id,message:$message,timezone:$tz,agentResponseConfig:$mode){message_id}
  }`,{id:BOT,message,tz:TZ,mode:invokesBot?'force_respond':'force_skip'},'Post this saved live comment to its owning bot chat with the selected mentions');
  const messageId=result?.send_thread_message?.message_id;
  if(!messageId)throw Error('No acknowledgment');
  q.ack.run(String(messageId),event.id);
  return {...saved,message_id:String(messageId)};
 } catch(e) {
  const errorText=sendingFailed(botName);
  // No raw platform error or token enters durable history.
  try {
   const logged=appendEvent({id:randomUUID(),thread_id:event.thread_id,kind:'error',body:[{kind:'text',value:errorText}],related_id:event.id,code:'sending_failed'},visitor.user,{error:true});
   return {...saved,error_event:logged.event,send_error:errorText};
  } catch {
   console.error('Could not persist sending_failed event',event.id);
   return {...saved,send_error:errorText,error_not_persisted:true};
  }
 }
}
const respond=(res,status,data)=>{
  res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(status===204?undefined:JSON.stringify(data));
};
function identity(req) {
  const token=req.headers['x-promptql-visitor-token'];
  if(typeof token!=='string') throw fail(401,'Open the published app and approve access to comment.');
  // Decode only; the gateway strips browser-sent X-PromptQL-* headers, so the value is
  // trusted for where it arrived. Key durable records on `sub`; names are mutable metadata.
  let p;
  try { p=JSON.parse(Buffer.from(token.split('.')[1],'base64url')); } catch {}
  const ns=p?.['https://promptql.hasura.io'];
  const id=p?.sub ?? ns?.['x-hasura-promptql-user-id'];
  if(typeof id!=='string' || !id) throw fail(401,'Invalid visitor identity');
  // Gateway strips caller-supplied x-forwarded-* before injecting the isolated
  // application's canonical host/protocol. Never use a client body URL or Host.
  const host=req.headers['x-forwarded-host'], proto=req.headers['x-forwarded-proto'];
  let appUrl;
  if(typeof host==='string'&&/^[a-z0-9.-]+(?::[0-9]+)?$/i.test(host)&&['https','http'].includes(proto))
    appUrl=`${proto}://${host}/`;
  return {token,appUrl,user:{id,name:p.display_name ?? ns?.['x-hasura-email'] ?? 'Reviewer',kind:'user'}};
}
async function platform(path,token,options={}) {
  const r=await fetch(`${API}/v1/${path}`,{...options,headers:{Authorization:`Bearer ${token}`,...options.headers},signal:AbortSignal.timeout(60000)});
  const body=await r.text();
  if(!r.ok) throw fail(r.status===401||r.status===403?r.status:502,`Platform request failed (${r.status})`);
  return body ? JSON.parse(body) : null;
}
async function jsonBody(req,limit=256_000) {
  let data='',size=0;
  for await (const chunk of req) { size+=chunk.length; if(size>limit) throw fail(413,'Request too large'); data+=chunk; }
  try { return JSON.parse(data||'{}'); } catch { throw fail(400,'Invalid JSON'); }
}

const sinceParam=url=>{const n=Number(url.searchParams.get('since')??0);if(!Number.isInteger(n)||n<0)throw fail(400,'Invalid since');return n;};
const feed=since=>{const rows=q.since.all(since);return {seq:q.maxSeq.get().seq,events:rows.map(shape)};};
// Finish local startup before accepting traffic. No credentials or network calls
// belong in readiness: visitor authorization remains per request below.
const startupHTML=await readFile(resolve(ROOT,'index.html'),'utf8');
await Promise.all([...startupHTML.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map(([,path])=>readFile(resolve(ROOT,'.'+path))));


http.createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/readyz')return respond(res,req.method==='GET'?204:405);
  if(url.pathname.startsWith('/api/')){
   const visitor=identity(req);
   if(req.method==='GET'&&url.pathname==='/api/state'){
    await graphql(visitor.token,'query { __typename }');
    seen(visitor.user);
    return respond(res,200,{user:visitor.user,bot:BOT_NAME,...feed(0),...meta()});
   }
   if(req.method==='GET'&&url.pathname==='/api/directory')return respond(res,200,await directory(visitor));
   if(req.method==='GET'&&url.pathname==='/api/events'){seen(visitor.user);return respond(res,200,{...feed(sinceParam(url)),...meta()});}
   if(req.method==='POST'&&url.pathname==='/api/event'){
    if(!req.headers['content-type']?.startsWith('application/json')||req.headers['sec-fetch-site']==='cross-site')throw fail(403,'Same-origin JSON requests only');
    const result=await saveAndSend(await jsonBody(req),visitor);
    return respond(res,result.replay?200:201,{...result,seq:result.event.seq});
   }
   return respond(res,404,{error:'Not found'});
  }
    if(req.method!=='GET' && req.method!=='HEAD') return respond(res,405,{error:'Method not allowed'});
    const path=resolve(ROOT,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if(!path.startsWith(ROOT+'/')) return respond(res,403,{error:'Forbidden'});
    let data;
    try { data=await readFile(path); } catch { return respond(res,404,{error:'Not found'}); }
    const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'}[extname(path)]??'application/octet-stream';
    res.writeHead(200,{'Content-Type':mime,'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});
    res.end(req.method==='HEAD'?undefined:data);
  } catch(e) { respond(res,e.status??500,{error:e.status?e.message:'Internal server error',...(e.extra??{})}); if(!e.status) console.error(e); }
}).listen(PORT,'0.0.0.0',()=>console.log(`Annotation review on ${PORT}`));


// Bot-only transport; the public API cannot impersonate this actor.
const bot={id:'bot',name:BOT_NAME,kind:'bot'};
await unlink(SOCK).catch(()=>{});
http.createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/read') {
   const data=feed(0);
   return respond(res,200,{schema_version:5,complete:true,snapshot_seq:data.seq,app:{title:APP_TITLE,owning_bot_id:BOT},...data,discussions:q.threads.all().map(t=>({...t,refs:parse(q.opener.get(t.thread_id).refs)}))});
  }
  if(req.method==='POST'&&url.pathname==='/event'){
   const input=await jsonBody(req);
   if(!['comment','resolve','reopen'].includes(input.kind))throw fail(400,'Invalid bot event');
   if(!q.thread.get(input.thread_id))throw fail(404,'Unknown discussion');
   if(input.expected_seq!=null&&q.thread.get(input.thread_id).last_seq!==input.expected_seq&&!q.bySource.get(input.id))throw fail(409,'Discussion changed; read it again');
   const body=input.body??(input.note?[{kind:'text',value:input.note}]:undefined);
   const result=appendEvent({...input,body},bot,{fp:fingerprint(input,bot)});
   return respond(res,result.replay?200:201,{...result,seq:result.event.seq});
  }
  return respond(res,404,{error:'Not found'});
 }catch(e){respond(res,e.status??500,{error:e.status?e.message:'Internal server error'});if(!e.status)console.error(e);}
}).listen(SOCK,async()=>{await chmod(SOCK,0o600);console.log(`Bot listener on ${SOCK}`);});
