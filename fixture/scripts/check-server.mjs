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
  ok('presence advertises the poll interval and grace behind its TTL',state.presence.pollMs===4000&&state.presence.graceMs===2000&&state.presence.ttlMs===1200);
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

  // ---- nudge (doorbell) ----
  await new Promise(r=>setTimeout(r,1600));
  const due=await (await api('/api/events?since=4',alice)).json();
  ok('nudge becomes due once the oldest un-nudged user event ages past SYNC_MAX_AGE',due.sync.due===true&&due.sync.pending===2&&due.sync.unread===2);
  failNext=true;
  const failed=await api('/api/sync-now',alice,{method:'POST',body:'{}'});
  ok('failed send leaves the cursors and reports failure',failed.status===502&&(await failed.json()).sync.pending===2&&sent.length===0);
  const [s1,s2]=await Promise.all([api('/api/sync-now',alice,{method:'POST',body:'{}'}),api('/api/sync-now',bob,{method:'POST',body:'{}'})]);
  const statuses=[s1.status,s2.status].sort();
  ok('concurrent sync-now: one nudges, the other gets 204',statuses[0]===200&&statuses[1]===204&&sent.length===1);
  const msg=sent[0];
  ok('one send_system_message with the visitor token of the caller',msg.auth?.startsWith('Bearer ')&&msg.variables.id==='bot-thread'&&msg.variables.tz==='Asia/Calcutta');
  ok('doorbell names the batch, count, authors and range',/^Review nudge [0-9a-f-]{36} · 2 new messages from Alice, Bob on this bot's live-commenting app \(seq 1–4\)\./.test(msg.variables.message));
  ok('doorbell tells the bot to run anno.mjs unread by absolute path and how to reply',msg.variables.message.includes(`Run \`node ${resolve('scripts/anno.mjs')} unread\``)&&msg.variables.message.includes('`Read N messages.`'));
  ok('doorbell carries no comment text',!msg.variables.message.includes('A reply from Bob')&&!msg.variables.message.includes('comment</b>')&&!msg.variables.message.includes('Hello')&&msg.variables.message.length<600);
  ok('description header is single-line ASCII',/^[\x20-\x7e]+$/.test(msg.desc));
  const post=await (await api('/api/events?since=4',alice)).json();
  ok('nudged cursor advanced on message_id; nothing pending, still unread',post.sync.pending===0&&post.sync.due===false&&post.sync.lastMessageId==='msg-1'&&post.sync.nudged===4&&post.sync.pulled===0&&post.sync.unread===2);
  const unreadAfter=await anno('unread','--peek');
  ok('bot still has the 2 messages unread after a nudge (nudge is not a read)',unreadAfter.code===0&&unreadAfter.out.includes('2 unread messages from Alice, Bob')&&unreadAfter.out.includes('A reply from Bob'));
  // A new comment after the nudge, while the bot has not pulled: exactly one more nudge, 2 min later, no stale repeats.
  await api('/api/event',bob,{method:'POST',body:JSON.stringify({id:crypto.randomUUID(),thread_id:t1,kind:'comment',body:[{kind:'text',value:'late one'}]})});
  const soon=await (await api('/api/events?since=5',alice)).json();
  ok('a comment after the nudge is 1 pending / 3 unread and not yet due',soon.sync.pending===1&&soon.sync.unread===3&&soon.sync.due===false);
  await new Promise(r=>setTimeout(r,1600));
  const dueAgain=await (await api('/api/events?since=5',alice)).json();
  ok('it becomes due on its own age, not the older unread',dueAgain.sync.due===true&&dueAgain.sync.pending===1);
  const second=await (await api('/api/sync-now',bob,{method:'POST',body:'{}'})).json();
  ok('second doorbell counts only the new message and says N may exceed it',second.status==='nudged'&&second.count===1&&sent.length===2&&/1 new message from Bob/.test(sent[1].variables.message)&&sent[1].variables.message.includes('may exceed 1'));
  const pulledAll=await anno('unread');
  ok('anno.mjs unread prints all 3 (both nudges) and advances the cursor',pulledAll.code===0&&pulledAll.out.includes('3 unread messages from Alice, Bob')&&pulledAll.out.includes('late one')&&pulledAll.out.includes('cursor advanced'));
  const clean=await (await api('/api/events?since=5',alice)).json();
  ok('a pull moves both cursors to head and records a pull time',clean.sync.pulled===5&&clean.sync.nudged===5&&clean.sync.unread===0&&clean.sync.pending===0&&!!clean.sync.lastPulledAt);

  // ---- pull before nudge + count trigger ----
  for(let i=0;i<4;i++) await api('/api/event',bob,{method:'POST',body:JSON.stringify({id:crypto.randomUUID(),thread_id:t1,kind:'comment',body:[{kind:'text',value:`bulk ${i}`}]})});
  const countDue=await (await api('/api/events?since=99',alice)).json();
  ok('count cap makes a nudge due immediately',countDue.sync.due===true&&countDue.sync.pending===4);
  const pulled=await anno('unread');
  ok('anno.mjs unread prints the digest and advances the cursor',pulled.code===0&&pulled.out.includes('4 unread messages from Bob')&&pulled.out.includes('bulk 3')&&pulled.out.includes('cursor advanced'));
  const nothing=await (await api('/api/sync-now',alice,{method:'POST',body:'{}'})).json();
  ok('a pull before the nudge cancels it: sync-now has nothing to send',nothing.status==='nothing'&&sent.length===2);
  const beforeFeed=await (await api(`/api/events?since=0`,alice)).json(), before=beforeFeed.build, before_seq=beforeFeed.seq;
  await appendFile(join(DIST,'index.html'),'\n<!-- rebuilt -->\n');
  const rebuilt=await (await api('/api/events?since=0',alice)).json();
  ok('build id changes when the served app is rebuilt; the log is untouched',rebuilt.build!==before&&/^[0-9a-f]{12}$/.test(rebuilt.build)&&rebuilt.seq===before_seq);
  ok('static app still served',(await fetch(`${base}/`)).status===200);

  // ---- migration from a v0.3.0 database (single 'bot' cursor, 'sent' receipts) ----
  const legacy=await mkdtemp(join(tmpdir(),'anno-legacy-'));
  {
    const {DatabaseSync}=await import('node:sqlite');
    const ldb=new DatabaseSync(join(legacy,'state.db'));
    ldb.exec(`CREATE TABLE event(seq INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL, kind TEXT NOT NULL, actor_kind TEXT NOT NULL, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, body TEXT, refs TEXT, pin TEXT, source_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
      INSERT INTO event(thread_id,kind,actor_kind,actor_id,actor_name,body,refs,source_id,created_at) VALUES('t-legacy-0001','comment','user','u1','Old Alice','[{"kind":"text","value":"old"}]','[{"kind":"anno_id","id":"x"}]','s1','2026-09-01T00:00:00.000Z');
      INSERT INTO event(thread_id,kind,actor_kind,actor_id,actor_name,body,source_id,created_at) VALUES('t-legacy-0001','comment','user','u1','Old Alice','[{"kind":"text","value":"newer"}]','s2','2026-09-01T00:01:00.000Z');
      CREATE TABLE reader(name TEXT PRIMARY KEY, seq INTEGER NOT NULL); INSERT INTO reader VALUES('bot',1);
      CREATE TABLE receipt(batch_id TEXT PRIMARY KEY, from_seq INTEGER NOT NULL, to_seq INTEGER NOT NULL, count INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('sending','sent','failed','pulled')), message_id TEXT, actor_id TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO receipt VALUES('b1',1,1,1,'sent','m1','u1',NULL,'2026-09-01T00:02:00.000Z','2026-09-01T00:02:00.000Z');`);
    ldb.close();
  }
  const lserver=spawn(process.execPath,[resolve('server.mjs')],{cwd:resolve('.'),env:{...process.env,PORT:'5292',ANNO_SOCK:join(legacy,'anno.sock'),ANNO_DATA:legacy,ANNO_DIST:DIST,
    PROMPTQL_PLATFORM_API_URL:platform,PROMPTQL_THREAD_ID:'bot-thread'},stdio:['ignore','pipe','pipe']});
  let llogs='';lserver.stdout.on('data',d=>llogs+=d);lserver.stderr.on('data',d=>llogs+=d);
  try {
    for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:5292/readyz')).status===204)break;}catch{}await new Promise(r=>setTimeout(r,250));}
    const ls=await (await fetch('http://127.0.0.1:5292/api/state',{headers:{'X-PromptQL-Visitor-Token':alice}})).json();
    ok('a v0.3.0 db migrates: old cursor seeds both nudged and pulled, sent receipt becomes nudged',ls.sync?.nudged===1&&ls.sync?.pulled===1&&ls.sync?.pending===1&&ls.sync?.unread===1&&ls.sync?.lastMessageId==='m1'&&ls.events.length===2);
  } catch(e) { console.log(llogs); throw e; } finally { lserver.kill(); await rm(legacy,{recursive:true,force:true}).catch(()=>{}); }
} finally {
  server.kill();
  fake.close();
  await rm(work,{recursive:true,force:true}).catch(()=>{});
  await writeFile(`${outputDir}/server-results.json`,JSON.stringify({report,coverage:'Real server + anno.mjs; fake Platform API. No real messages created.'},null,2));
  if(report.some(r=>!r.pass)) console.log(logs);
}