/**
 * End-to-end check of the review server against a fake Platform API. No
 * browser, no real bot, no real messages: the fake answers the consent probe
 * and `send_system_message`, and records what it was sent.
 *
 *   node scripts/check-server.mjs          # after `npm run build`
 */
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm, writeFile, mkdir, cp, appendFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const outputDir=process.env.TEST_OUTPUT_DIR??'test-output';
await mkdir(outputDir,{recursive:true});
const report=[];
const ok=(name,condition)=>{report.push({name,pass:!!condition});console.log(condition?'PASS':'FAIL',name);assert.ok(condition,name);};
const token=(id,name)=>['x',Buffer.from(JSON.stringify({sub:id,display_name:name})).toString('base64url'),'y'].join('.');
const alice=token('user-alice','Alice'), bob=token('user-bob','Bob');

// ---- fake platform ---------------------------------------------------------
const sent=[]; let failNext=false;
const fake=http.createServer(async(req,res)=>{
  let body='';for await(const c of req)body+=c;
  const json=body?JSON.parse(body):{};
  if(req.url==='/v1/graphql'&&json.query?.includes('send_system_message')){
    if(failNext){failNext=false;res.writeHead(500);return res.end('{"errors":[{"message":"boom"}]}');}
    sent.push({auth:req.headers.authorization,desc:req.headers['x-promptql-description'],variables:json.variables});
    res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({data:{send_system_message:{message_id:`msg-${sent.length}`}}}));
  }
  if(req.url==='/v1/graphql'){res.setHeader('Content-Type','application/json');return res.end('{"data":{"__typename":"query_root"}}');}
  res.writeHead(404);res.end('{}');
});
await new Promise(r=>fake.listen(0,'127.0.0.1',r));
const platform=`http://127.0.0.1:${fake.address().port}`;

// ---- server under test -----------------------------------------------------
const work=await mkdtemp(join(tmpdir(),'anno-'));
const PORT=5291, SOCK=join(work,'anno.sock'), DIST=join(work,'dist');
await cp(resolve('dist'),DIST,{recursive:true}); // private copy: the build-change test edits it
const server=spawn(process.execPath,[resolve('server.mjs')],{cwd:resolve('.'),env:{...process.env,PORT:String(PORT),ANNO_SOCK:SOCK,ANNO_DATA:work,ANNO_DIST:DIST,
  PROMPTQL_PLATFORM_API_URL:platform,PROMPTQL_THREAD_ID:'bot-thread',PROMPTQL_TIMEZONE:'Asia/Calcutta',BOT_NAME:'Test Bot',SYNC_MAX_AGE_MS:'1500',SYNC_MAX_COUNT:'4',PRESENCE_TTL_MS:'1200'},stdio:['ignore','pipe','pipe']});
let logs='';server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d);
const base=`http://127.0.0.1:${PORT}`;
const wait=async()=>{for(let i=0;i<60;i++){try{if((await fetch(`${base}/readyz`)).status===204)return;}catch{}await new Promise(r=>setTimeout(r,250));}throw Error(`server did not start\n${logs}`);};
const api=(path,tok,init={})=>fetch(base+path,{...init,headers:{'X-PromptQL-Visitor-Token':tok,'Content-Type':'application/json',...init.headers}});
const anno=(...args)=>new Promise(r=>{const p=spawn(process.execPath,[resolve('scripts/anno.mjs'),...args],{env:{...process.env,ANNO_SOCK:SOCK}});let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('close',code=>r({code,out,err}));});

try {
  await wait();
  ok('unauthenticated api rejected',(await fetch(`${base}/api/state`)).status===401);
  ok('malformed token rejected',(await fetch(`${base}/api/state`,{headers:{'X-PromptQL-Visitor-Token':'nope'}})).status===401);
  const state=await (await api('/api/state',alice)).json();
  ok('state carries identity, empty log, sync status',state.user.id==='user-alice'&&state.seq===0&&state.events.length===0&&state.sync.pending===0&&state.bot==='Test Bot');
  ok('state carries a build id and counts the caller as viewing',/^[0-9a-f]{12}$/.test(state.build)&&state.presence.count===1&&state.presence.viewers[0]==='Alice');
  const two=await (await api('/api/events?since=0',bob)).json();
  ok('a second poller raises presence to 2, per person not per tab',two.presence.count===2&&two.presence.viewers.includes('Bob')&&(await (await api('/api/events?since=0',bob)).json()).presence.count===2);
  await new Promise(r=>setTimeout(r,1300));
  ok('a viewer who stops polling drops off after PRESENCE_TTL_MS',(await (await api('/api/events?since=0',bob)).json()).presence.count===1);

  const t1=crypto.randomUUID(), c1=crypto.randomUUID();
  const opening={id:c1,thread_id:t1,kind:'comment',body:[{kind:'text',value:'First <b>comment</b>'}],refs:[{kind:'text',id:'spec.lede',label:'Lede',start:0,end:5,quote:'Hello'}],pin:{xPct:.2,yPct:.3}};
  const r1=await api('/api/event',alice,{method:'POST',body:JSON.stringify(opening)});
  const e1=await r1.json();
  ok('opening comment appended with server-stamped author',r1.status===201&&e1.seq===1&&e1.event.actor.id==='user-alice'&&e1.event.actor.kind==='user'&&e1.event.refs[0].quote==='Hello');
  const replay=await api('/api/event',alice,{method:'POST',body:JSON.stringify(opening)});
  ok('same event id replays without a second row',replay.status===200&&(await replay.json()).seq===1);
  ok('another user cannot reuse the id',(await api('/api/event',bob,{method:'POST',body:JSON.stringify(opening)})).status===409);
  ok('reply to unknown thread needs refs',(await api('/api/event',bob,{method:'POST',body:JSON.stringify({id:crypto.randomUUID(),thread_id:crypto.randomUUID(),kind:'comment',body:[{kind:'text',value:'x'}]})})).status===400);
  ok('oversize body rejected',(await api('/api/event',bob,{method:'POST',body:JSON.stringify({id:crypto.randomUUID(),thread_id:t1,kind:'comment',body:[{kind:'text',value:'x'.repeat(5000)}]})})).status===413);
  const r2=await api('/api/event',bob,{method:'POST',body:JSON.stringify({id:crypto.randomUUID(),thread_id:t1,kind:'comment',body:[{kind:'text',value:'A reply from Bob'}]})});
  ok('reply appended',r2.status===201&&(await r2.json()).seq===2);
  const feed=await (await api('/api/events?since=1',bob)).json();
  ok('poll since=1 returns only the reply',feed.events.length===1&&feed.events[0].seq===2&&feed.seq===2);
  ok('sync not yet due (age below threshold, count below cap)',feed.sync.pending===2&&feed.sync.due===false);
  ok('reopen on an open thread is a 409 no-op',(await api('/api/event',bob,{method:'POST',body:JSON.stringify({id:crypto.randomUUID(),thread_id:t1,kind:'reopen'})})).status===409);

  // ---- bot side over the socket ----
  const threads=await anno('threads');
  ok('anno.mjs threads lists the open thread with its quote',threads.code===0&&threads.out.includes(t1)&&threads.out.includes('"Hello"'));
  const peek=await anno('unread','--peek');
  ok('anno.mjs unread --peek shows both user messages and leaves the cursor',peek.code===0&&peek.out.includes('2 unread messages from Alice, Bob')&&peek.out.includes('- Alice ')&&peek.out.includes('＜b>comment')&&peek.out.includes('(peek'));
  const resolveBot=await anno('resolve',t1,'Fixed in the next revision');
  ok('anno.mjs resolve appends a bot event and prints seq',resolveBot.code===0&&JSON.parse(resolveBot.out).seq===3);
  const again=await anno('resolve',t1);
  ok('resolving a resolved thread fails loudly with exit 3',again.code===3&&again.err.includes('already resolved'));
  ok('unknown thread fails with exit 4',(await anno('reopen','no-such-thread-id')).code===4);
  const idem=await anno('reopen',t1,'--id','11111111-2222-3333-4444-555555555555');
  const idem2=await anno('reopen',t1,'--id','11111111-2222-3333-4444-555555555555');
  ok('--id makes a retry idempotent',idem.code===0&&idem2.code===0&&JSON.parse(idem2.out).replay===true&&JSON.parse(idem.out).seq===JSON.parse(idem2.out).seq);
  const after=await (await api('/api/events?since=2',alice)).json();
  ok('bot events arrive in the browser feed with actor kind bot',after.events.length===2&&after.events.every(e=>e.actor.kind==='bot')&&after.events[0].kind==='resolve'&&after.events[0].body[0].value==='Fixed in the next revision'&&after.events[1].kind==='reopen');

  // ---- sync ----
  await new Promise(r=>setTimeout(r,1600));
  const due=await (await api('/api/events?since=4',alice)).json();
  ok('sync becomes due once the oldest unsynced user event ages past SYNC_MAX_AGE',due.sync.due===true&&due.sync.pending===2);
  failNext=true;
  const failed=await api('/api/sync-now',alice,{method:'POST',body:'{}'});
  ok('failed send leaves the cursor and reports failure',failed.status===502&&(await failed.json()).sync.pending===2&&sent.length===0);
  const [s1,s2]=await Promise.all([api('/api/sync-now',alice,{method:'POST',body:'{}'}),api('/api/sync-now',bob,{method:'POST',body:'{}'})]);
  const statuses=[s1.status,s2.status].sort();
  ok('concurrent sync-now: one sends, the other gets 204',statuses[0]===200&&statuses[1]===204&&sent.length===1);
  const msg=sent[0];
  ok('one send_system_message with the visitor token of the caller',msg.auth?.startsWith('Bearer ')&&msg.variables.id==='bot-thread'&&msg.variables.tz==='Asia/Calcutta');
  ok('message header names the batch, range and authors',/^Review batch [0-9a-f-]{36} · seq 1–4 · 2 messages from Alice, Bob/.test(msg.variables.message));
  ok('digest groups by thread with context and excludes bot events',msg.variables.message.includes(`[${t1.slice(0,8)}] Lede / "Hello" · open`)&&msg.variables.message.includes('- Alice ')&&msg.variables.message.includes('A reply from Bob')&&!msg.variables.message.includes('Test Bot'));
  ok('digest escapes angle brackets and carries the ack-only instruction',msg.variables.message.includes('＜b>comment')&&msg.variables.message.includes('Reply only with: `Read 2 messages.`'));
  ok('description header is single-line ASCII',/^[\x20-\x7e]+$/.test(msg.desc));
  const post=await (await api('/api/events?since=4',alice)).json();
  ok('cursor advanced on message_id; nothing pending',post.sync.pending===0&&post.sync.due===false&&post.sync.lastMessageId==='msg-1');
  const unreadAfter=await anno('unread');
  ok('bot has nothing unread after a delivered batch',unreadAfter.code===0&&unreadAfter.out.includes('No unread'));

  // ---- pull path + count trigger ----
  for(let i=0;i<4;i++) await api('/api/event',bob,{method:'POST',body:JSON.stringify({id:crypto.randomUUID(),thread_id:t1,kind:'comment',body:[{kind:'text',value:`bulk ${i}`}]})});
  const countDue=await (await api('/api/events?since=99',alice)).json();
  ok('count cap makes sync due immediately',countDue.sync.due===true&&countDue.sync.pending===4);
  const pulled=await anno('unread');
  ok('anno.mjs unread prints the digest and advances the cursor',pulled.code===0&&pulled.out.includes('4 unread messages from Bob')&&pulled.out.includes('bulk 3')&&pulled.out.includes('cursor advanced'));
  const nothing=await (await api('/api/sync-now',alice,{method:'POST',body:'{}'})).json();
  ok('a pull clears the batch: sync-now has nothing to send',nothing.status==='nothing'&&sent.length===1);
  const beforeFeed=await (await api(`/api/events?since=0`,alice)).json(), before=beforeFeed.build, before_seq=beforeFeed.seq;
  await appendFile(join(DIST,'index.html'),'\n<!-- rebuilt -->\n');
  const rebuilt=await (await api('/api/events?since=0',alice)).json();
  ok('build id changes when the served app is rebuilt; the log is untouched',rebuilt.build!==before&&/^[0-9a-f]{12}$/.test(rebuilt.build)&&rebuilt.seq===before_seq);
  ok('static app still served',(await fetch(`${base}/`)).status===200);
} finally {
  server.kill();
  fake.close();
  await rm(work,{recursive:true,force:true}).catch(()=>{});
  await writeFile(`${outputDir}/server-results.json`,JSON.stringify({report,coverage:'Real server + anno.mjs; fake Platform API. No real messages created.'},null,2));
  if(report.some(r=>!r.pass)) console.log(logs);
}