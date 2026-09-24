/**
 * Development harness — the real code path, locally.
 *
 *   Vite (:5180, the UI with HMR)
 *     └─ /api  ──proxy──▶  server.mjs (:5190, SQLite event log, anno.mjs socket)
 *                             └─ Platform API ──▶ a fake one, in this process
 *
 * The browser talks to the same review server that runs in production; only the
 * PromptQL platform behind it is replaced by a fake that answers the directory
 * query and logs every `send_thread_message` (the chat receipt) to this console.
 * The proxy injects a visitor token for a fixed development identity when the
 * request carries none, so nothing signs in — override the header per request
 * (as check-shared-app.mjs does) to act as somebody else.
 *
 * State lives in a fresh temporary directory each start. `POST /__dev/reset`
 * restarts the server on a new empty directory; the check suites use it.
 *
 *   PORT            Vite port (default 5180)       ANNO_API_PORT  server port (default PORT+10)
 *   ANNO_SOCK       bot socket (default ./dev.sock) → ANNO_SOCK=dev.sock node scripts/anno.mjs read
 *   BOT_NAME        default "Hasura Bot"           POLL_MS        default 1000
 */
import http from 'node:http';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';

const cwd=fileURLToPath(new URL('../',import.meta.url));
const HOST=process.env.HOST??'0.0.0.0', PORT=Number(process.env.PORT??5180), API_PORT=Number(process.env.ANNO_API_PORT??PORT+10);
const SOCK=resolve(cwd,process.env.ANNO_SOCK??'dev.sock');
const BOT_NAME=process.env.BOT_NAME??'Hasura Bot', BOT_ID='11111111-1111-4111-8111-111111111111';
const DEV_USER={id:'33abc8c7-50af-41b8-aa9f-db572a6fa713',name:'Demo Reviewer'};
const PEER={id:'7e0b9d2a-4c1f-4b7e-9a3d-2f6c8e1b5a90',name:'Sam Rivera'};
const token=u=>['x',Buffer.from(JSON.stringify({sub:u.id,display_name:u.name})).toString('base64url'),'y'].join('.');

// ---- fake platform: directory + receipts, nothing leaves this process ---------
const sends=[];
const fake=http.createServer(async(req,res)=>{
 let s='';for await(const c of req)s+=c;const body=JSON.parse(s||'{}');
 let data={__typename:'query_root'};
 if(body.query?.includes('thread_participants'))data={threads_v2_by_pk:{project_id:BOT_ID,project_config:{agent_name:BOT_NAME},
  thread_participants:[DEV_USER,PEER].map(u=>({promptql_user_id:u.id,promptql_user:{display_name:u.name,email:null,is_active:true,is_bot:false}}))}};
 if(body.query?.includes('send_thread_message')){
  sends.push(body.variables);
  console.log(`\n[fake platform] chat receipt #${sends.length} (agentResponseConfig=${body.variables.mode}):\n${body.variables.message}\n`);
  data={send_thread_message:{message_id:`dev-${sends.length}`}};
 }
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data}));
});
await new Promise(r=>fake.listen(0,'127.0.0.1',r));

// ---- the review server, on a fresh state directory ---------------------------
let child=null,state=null;
async function startServer(){
 state=await mkdtemp(join(tmpdir(),'live-commenting-dev-'));
 // The server serves `dist/` when one is built (the production bundle, on the
 // API port); otherwise a placeholder, since the UI comes from Vite in development.
 let dist=resolve(cwd,'dist');
 if(!existsSync(join(dist,'index.html'))){
  dist=join(state,'dist');await mkdir(dist);
  await writeFile(join(dist,'index.html'),'<!doctype html><title>Live commenting dev</title><p>The UI is served by Vite in development.');
 }
 child=spawn(process.execPath,[resolve(cwd,'server.mjs')],{cwd,stdio:['ignore','inherit','inherit'],env:{...process.env,
  PORT:String(API_PORT),ANNO_DATA:state,ANNO_SOCK:SOCK,ANNO_DIST:dist,
  PROMPTQL_PLATFORM_API_URL:`http://127.0.0.1:${fake.address().port}`,PROMPTQL_THREAD_ID:BOT_ID,
  BOT_NAME,ANNO_APP_URL:`http://${HOST}:${PORT}/`,ANNO_APP_TITLE:process.env.ANNO_APP_TITLE??'Live commenting (dev)',
  BUILD_ID:process.env.BUILD_ID??'dev',POLL_MS:process.env.POLL_MS??'1000'}});
 const exited=new Promise(r=>child.once('exit',r));
 for(let i=0;i<100;i++){
  try{if((await fetch(`http://127.0.0.1:${API_PORT}/readyz`)).status===204)return;}catch{}
  if(child.exitCode!==null)throw Error('server.mjs exited during startup');
  await new Promise(r=>setTimeout(r,100));
 }
 child.kill();await exited;throw Error('server.mjs did not become ready');
}
async function stopServer(){
 if(!child)return;const c=child;child=null;
 await new Promise(r=>{c.once('exit',r);c.kill();});
 if(state)await rm(state,{recursive:true,force:true});state=null;
}
let restarting=Promise.resolve();
const restart=()=>restarting=restarting.then(async()=>{await stopServer();await startServer();});
await startServer();

// ---- Vite: the UI, /api proxied to the server with a development identity -----
const vite=await createServer({
 configFile:resolve(cwd,'vite.config.ts'),
 server:{host:HOST,port:PORT,strictPort:true,proxy:{'/api':{target:`http://127.0.0.1:${API_PORT}`,configure(proxy){
  proxy.on('proxyReq',(proxyReq,req)=>{
   if(!req.headers['x-promptql-visitor-token'])proxyReq.setHeader('x-promptql-visitor-token',token(DEV_USER));
   if(!req.headers['x-forwarded-host']){proxyReq.setHeader('x-forwarded-host',req.headers.host??`${HOST}:${PORT}`);proxyReq.setHeader('x-forwarded-proto','http');}
  });
 }}}},
 plugins:[{name:'live-commenting-dev',configureServer(server){
  server.middlewares.use(async(req,res,next)=>{
   if(req.url!=='/__dev/reset'||req.method!=='POST')return next();
   try{await restart();res.statusCode=204;res.end();}catch(e){res.statusCode=500;res.end(String(e));}
  });
 }}],
});
await vite.listen();
console.log(`\nLive commenting dev → http://localhost:${PORT}/   (review server :${API_PORT}, bot socket ${SOCK})`);
console.log(`Signed in as ${DEV_USER.name}; @-mentionable: ${PEER.name}, ${BOT_NAME}. Chat receipts print here.\n`);

const shutdown=async()=>{await vite.close();await stopServer();fake.close();process.exit(0);};
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
process.on('exit',()=>{child?.kill();});