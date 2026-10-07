const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;};
/** Isolated fake-platform integration: never contacts a real bot or visitor. */
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {foldEvents} from '../lib/events.js';
const out=process.env.TEST_OUTPUT_DIR??'test-output';await mkdir(out,{recursive:true});
const report=[],ok=(name,test)=>{assert.ok(test,name);report.push({name,pass:true});console.log('PASS',name);};
const aliceId='33abc8c7-50af-41b8-aa9f-db572a6fa713',bobId='5ab475aa-bf9a-45ae-ac0a-30d6b78d8f10';
const token=(id,name)=>['x',Buffer.from(JSON.stringify({sub:id,display_name:name})).toString('base64url'),'y'].join('.');
const alice=token(aliceId,'Alice'),bob=token(bobId,'Bob');
let behavior='ok',sends=[],removed=false,unavailable=false,release;
const fake=http.createServer(async(req,res)=>{
 let b='';for await(const c of req)b+=c;const p=JSON.parse(b||'{}');
 let data={__typename:'query_root'};
 if(p.query?.includes('thread_participants')) data={threads_v2_by_pk:unavailable?null:{project_id:'11111111-1111-4111-8111-111111111111',thread_participants:(removed?[]:[aliceId,bobId]).map(id=>({promptql_user_id:id,promptql_user:{display_name:id===aliceId?'Alice':'Bob',email:'hidden@example.com',is_active:true,is_bot:false}})).concat([
  {promptql_user_id:'blocked',promptql_user:{is_active:false,is_bot:false}},
  {promptql_user_id:'machine',promptql_user:{is_active:true,is_bot:true}}
 ]),project_config:{agent_name:'Lilo'}}};
 if(p.query?.includes('send_thread_message')){
  sends.push({auth:req.headers.authorization,...p.variables});
  if(behavior==='fail'){res.writeHead(500);return res.end('{"error":"DO NOT PERSIST THIS SECRET"}');}
  if(behavior==='lost'){req.socket.destroy();return;}
  if(behavior==='delay')await new Promise(r=>release=r);
  data={send_thread_message:{message_id:'m'+sends.length}};
 }
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data}));
});
await new Promise(r=>fake.listen(0,'127.0.0.1',r));
const work=await mkdtemp(join(tmpdir(),'anno-v5-')),sock=join(work,'anno.sock');
const db=new DatabaseSync(join(work,'state.db'));
const legacy6=process.env.TEST_LEGACY_SCHEMA==='6';
db.exec(`CREATE TABLE event(seq INTEGER PRIMARY KEY AUTOINCREMENT,thread_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('comment','resolve','reopen'${legacy6?",'error'":''})),actor_kind TEXT NOT NULL,actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,body TEXT,refs TEXT,pin TEXT,source_id TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL${legacy6?',invokes_bot INTEGER NOT NULL DEFAULT 0,related_id TEXT,code TEXT,fingerprint TEXT,message_id TEXT':''});CREATE TABLE reader(name TEXT PRIMARY KEY,seq INTEGER);CREATE TABLE receipt(batch_id TEXT);`);
db.prepare('INSERT INTO event(seq,thread_id,kind,actor_kind,actor_id,actor_name,body,refs,pin,source_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(1,'old-discussion','comment','user',aliceId,'Alice','[{"kind":"text","value":"Preserve me"}]','[{"kind":"anno_id","id":"old","label":"Old"}]',null,'old-comment','2026-09-01T00:00:00Z');
if(legacy6)db.exec("UPDATE event SET invokes_bot=1,fingerprint='original-fingerprint',message_id='original-message'");
const originalRow=db.prepare('SELECT * FROM event').get();db.close();
const port=5291,base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,[resolve('server.mjs')],{env:{...process.env,PORT:String(port),ANNO_DATA:work,ANNO_SOCK:sock,ANNO_DIST:resolve('dist'),PROMPTQL_PLATFORM_API_URL:`http://127.0.0.1:${fake.address().port}`,PROMPTQL_THREAD_ID:'11111111-1111-4111-8111-111111111111',BOT_NAME:'Lilo',ANNO_APP_URL:'https://app.example/',ANNO_APP_TITLE:'Spec',BUILD_ID:'v5-test',PRESENCE_TTL_MS:'150'},stdio:['ignore','pipe','pipe']});
let logs='';server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
const api=(path,t=alice,init={})=>fetch(base+path,{...init,headers:{'X-PromptQL-Visitor-Token':t,'Content-Type':'application/json',...init.headers}});
const post=(e,t=alice)=>api('/api/event',t,{method:'POST',body:JSON.stringify({protocol:7,...e})});
const event=(extra={})=>({id:crypto.randomUUID(),thread_id:crypto.randomUUID(),kind:'comment',body:[{kind:'text',value:'hello'}],refs:[{kind:'anno_id',id:'target',label:'Target'}],...extra});
const rich=(entity,id,label)=>[{kind:'rich',version:1,content:[{kind:'text',text:'Please '},{kind:'mention',entity,id,label},{kind:'newline'},{kind:'text',text:'<agent_mention /> ` * [ ] & &#60;\n\nliteral'}]}];
const cli=(...args)=>new Promise(r=>{const p=spawn(process.execPath,[resolve('scripts/anno.mjs'),...args],{env:{...process.env,ANNO_SOCK:sock}});let text='',err='';p.stdout.on('data',b=>text+=b);p.stderr.on('data',b=>err+=b);p.on('close',code=>r({code,text,err}));});
try{
 for(let i=0;i<80;i++){try{if((await fetch(base+'/readyz')).status===204)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 ok('server ready',(await fetch(base+'/readyz')).status===204);
 ok('unauthenticated API rejected',(await fetch(base+'/api/state')).status===401);
 const s=await(await api('/api/state')).json();
 ok('v4 migration preserves comments, IDs and sequence',s.events.length===1&&s.events[0].id==='old-comment'&&s.events[0].body[0].value==='Preserve me'&&s.seq===1);
 ok('no sync/cursor protocol',!('sync'in s)&&s.protocol===7);
 const checkDb=new DatabaseSync(join(work,'state.db'));
 const migrated=checkDb.prepare('SELECT * FROM event WHERE seq=1').get();
 ok('migration preserves every pre-existing column',Object.entries(originalRow).every(([k,v])=>migrated[k]===v));
 ok('cursor and receipt tables removed',checkDb.prepare("SELECT name FROM sqlite_master WHERE name IN ('reader','receipt')").all().length===0);checkDb.close();
 const d=await(await api('/api/directory')).json();
 ok('eligible participants + configured bot only',d.entries.length===3&&d.botName==='Lilo'&&d.entries.at(-1).aliases.join()==='promptql');
 unavailable=true;
 ok('unavailable owning bot fails closed',(await api('/api/directory')).status===403);
 unavailable=false;
 ok('directory cache key viewer-scoped',d.key!==(await(await api('/api/directory',bob)).json()).key);
 ok('presence includes two viewers',(await(await api('/api/events?protocol=7',bob)).json()).presence.count===2);
 await new Promise(r=>setTimeout(r,180));
 ok('presence expires',(await(await api('/api/events?protocol=7')).json()).presence.count===1);
 const plain=event();const saved=await(await post(plain)).json();
 ok('ordinary comment saves only',saved.event.actor.id===aliceId&&sends.length===0);
 ok('protocol 5 writers are rejected',(await api('/api/event',alice,{method:'POST',body:JSON.stringify({...event(),protocol:5})})).status===409);
 ok('stale clients blocked',(await api('/api/event',alice,{method:'POST',body:JSON.stringify(plain)})).status===409);
 ok('body oversize rejected',(await post(event({body:[{kind:'text',value:'x'.repeat(20000)}]}))).status===413);
 ok('same ID replay no new event',(await(await post(plain)).json()).replay===true);
 ok('same ID/different payload conflicts',(await post({...plain,body:[{kind:'text',value:'changed'}]})).status===409);
 ok('same ID/other actor conflicts',(await post(plain,bob)).status===409);
 ok('public bot actor spoof ignored',saved.event.actor.kind==='user');
 const human=event({body:rich('user',bobId,'Historic Bob')});
 const h=await(await post(human)).json();
 ok('human only uses force_skip once',sends.length===1&&sends[0].mode==='force_skip'&&!h.event.invokes_bot&&sends[0].auth===`Bearer ${alice}`);
 ok('canonical human tag emitted once',(sends[0].message.match(/<user_mention /g)||[]).length===1);
 ok('raw text tags inert',!sends[0].message.includes('<agent_mention')&&sends[0].message.includes('&#60;agent'));
 ok('verbatim labels, blank lines, no procedure',sends[0].message.includes('@Historic Bob')&&sends[0].message.includes('\n> \n> literal')&&!sends[0].message.includes('anno.mjs'));
 ok('direct event/discussion link',sends[0].message.includes(`anno_discussion=${human.thread_id}`)&&sends[0].message.includes(`anno_event=${human.id}`));
 const directed=event({body:rich('bot','current','Lilo'),notify_bot:true});
 const b=await(await post(directed)).json();
 ok('bot badge + checkbox yields one send',sends.length===2&&sends[1].mode==='force_respond'&&(sends[1].message.match(/<agent_mention \/>/g)||[]).length===1&&b.event.invokes_bot);
 ok('replay never resends',(await(await post(directed)).json()).replay&&sends.length===2);
 const checked=await(await post(event({notify_bot:true}))).json();
 ok('checkbox only produces same bot mention',checked.event.invokes_bot&&sends.at(-1).message.includes('<agent_mention />'));
 removed=true;ok('removed recipient rejected before saving',(await post(event({body:rich('user',bobId,'Bob')}))).status===403);removed=false;
 behavior='fail';const failEvent=event({notify_bot:true});const failed=await(await post(failEvent)).json();
 ok('send failure saved + durable error, exact copy',failed.event.id===failEvent.id&&failed.error_event.related_id===failEvent.id&&failed.send_error==='Sending failed, ping Lilo in chat to retry.');
 ok('raw errors not persisted',!JSON.stringify(failed).includes('SECRET'));
 behavior='lost';const lost=await(await post(event({notify_bot:true}))).json();
 ok('uncertain send same error copy',lost.send_error===failed.send_error);
 const before=sends.length;await new Promise(r=>setTimeout(r,200));await api('/api/events?protocol=7');await post(failEvent);
 ok('no poll/replay/automatic retry',sends.length===before);
 behavior='delay';const delayed=event({notify_bot:true});const request=post(delayed);
 for(let i=0;i<80&&!release;i++)await new Promise(r=>setTimeout(r,20));
 const history=await(await api('/api/events?protocol=7')).json();
 ok('save visible and waiting while send pending',foldEvents(history.events).threads.find(t=>t.id===delayed.thread_id).waitingFor===delayed.id);
 const reply=await cli('reply',delayed.thread_id,'Working on this');
 ok('bot replies enabled via socket',reply.code===0&&JSON.parse(reply.text).event.actor.kind==='bot');
 release();await request;
 const after=await(await api('/api/events?protocol=7')).json();
 ok('late acknowledgment does not relight waiting',!foldEvents(after.events).threads.find(t=>t.id===delayed.thread_id).waitingFor);
 behavior='ok';
 const read=await cli('read'),read2=await cli('read');
 ok('read complete and non-mutating',read.code===0&&read.text===read2.text&&JSON.parse(read.text).events.length===after.events.length);
 ok('bot reply causes no platform send',sends.length===before+1);
 const res=await cli('resolve',delayed.thread_id,'Fixed','--expected-seq',String(JSON.parse(reply.text).seq));
 ok('revision-guarded resolve works',res.code===0);
 ok('no-op resolve exit3',(await cli('resolve',delayed.thread_id)).code===3);
 ok('unknown discussion exit4',(await cli('reply','unknown-discussion','hello')).code===4);
 ok('stale revision rejected',(await cli('reopen',delayed.thread_id,'--expected-seq','1')).code===3);
 ok('legacy sync removed',(await api('/api/sync-now',alice,{method:'POST',body:'{}'})).status===404);
 ok('legacy unread removed',(await cli('unread')).code!==0);
 // Multiple requests and unrelated errors; trusted bot contribution clears, human status doesn't.
 const seqs=[b.event,{...b.event,seq:100,id:'new-request'}, {...failed.error_event,seq:101,thread_id:directed.thread_id,related_id:directed.id}];
 ok('old error cannot clear newer waiting',foldEvents(seqs).threads[0].waitingFor==='new-request');
 ok('human status does not clear waiting',foldEvents([...seqs,{...b.event,seq:102,id:'human-resolve',kind:'resolve',body:undefined,invokes_bot:false}]).threads[0].waitingFor==='new-request');
 ok('trusted bot status clears waiting',!foldEvents([...seqs,{...b.event,seq:103,id:'bot-resolve',kind:'resolve',body:undefined,invokes_bot:false,actor:{id:'bot',name:'Lilo',kind:'bot'}}]).threads[0].waitingFor);
 const png=await readFile('public/image-annotation-example.png');
 const snapshot={dataUrl:`data:image/png;base64,${png.toString('base64')}`,width:png.readUInt32BE(16),height:png.readUInt32BE(20),capturedAt:'2026-10-02T00:00:00.000Z'};
 const chartRef={kind:'chart',version:1,id:'chart.revenue',label:'Revenue · two selected',selection:'rectangle',members:[{key:'billing',label:'Billing',values:{revenue:31}},{key:'reports',label:'Reports',values:{revenue:56}}],region:{xPct:.2,yPct:.2,wPct:.3,hPct:.4},snapshot};
 const chartEvent=event({refs:[chartRef]});
 const chartResponse=await post(chartEvent);const chartSaved=await chartResponse.json();
 ok('chart members and PNG save together',chartResponse.status===201&&chartSaved.event.refs[0].members[1].key==='reports'&&/^[a-f0-9]{64}$/.test(chartSaved.event.refs[0].snapshot.id));
 const hash=chartSaved.event.refs[0].snapshot.id;
 ok('polling carries image ids, never base64',!JSON.stringify((await(await api('/api/events?protocol=7')).json()).events).includes('data:image'));
 const imageResponse=await api(`/api/snapshots/${hash}`);
 ok('authorized image bytes round-trip',imageResponse.status===200&&Buffer.from(await imageResponse.arrayBuffer()).equals(png));
 ok('snapshot endpoint requires visitor identity',(await fetch(base+`/api/snapshots/${hash}`)).status===401);
 ok('chart replay remains idempotent',(await(await post(chartEvent)).json()).replay===true);
 const checkImages=new DatabaseSync(join(work,'state.db'));
 ok('snapshot bytes deduplicate',checkImages.prepare('SELECT count(*) AS n FROM snapshot').get().n===1);
 const pointOnly=await post(event({refs:[{...chartRef,selection:'point',members:[chartRef.members[0]],snapshot:undefined}]}));
 ok('point comments need no image rendering',pointOnly.status===201&&!((await pointOnly.json()).event.refs[0].snapshot));
 const unicodeEvent=event({refs:[{...chartRef,label:'图表',selection:'point',members:[{key:'日期/九月一日',label:'图表 📈',values:{说明:'原始值'}}],snapshot:undefined}]});
 const unicodeBytes=Buffer.from(JSON.stringify({protocol:7,...unicodeEvent}));
 const split=unicodeBytes.indexOf(Buffer.from('图'))+1;
 const chunked=await new Promise((resolve,reject)=>{
  const req=http.request(base+'/api/event',{method:'POST',headers:{'X-PromptQL-Visitor-Token':alice,'Content-Type':'application/json'}},res=>{
   const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))}));
  });req.on('error',reject);req.write(unicodeBytes.subarray(0,split));setTimeout(()=>req.end(unicodeBytes.subarray(split)),15);
 });
 ok('UTF-8 keys and labels survive split request chunks',chunked.status===201&&chunked.body.event.refs[0].members[0].key==='日期/九月一日'&&chunked.body.event.refs[0].label==='图表');
 const invalidMembers=event({refs:[{...chartRef,members:[chartRef.members[0],chartRef.members[0]]}]});
 ok('duplicate member identities rejected',(await post(invalidMembers)).status===400);
 ok('missing chart image rejected',(await post(event({refs:[{...chartRef,snapshot:undefined}]}))).status===400);
 ok('mismatched PNG dimensions rejected',(await post(event({refs:[{...chartRef,snapshot:{...snapshot,width:1}}]}))).status===400);
 ok('non-PNG image rejected',(await post(event({refs:[{...chartRef,snapshot:{...snapshot,dataUrl:'data:image/svg+xml;base64,PHN2Zy8+'}}]}))).status===400);
 ok('live geometry cannot enter history',(await post(event({refs:[{...chartRef,members:[{...chartRef.members[0],geometry:{x:2}}]}]}))).status===400);
 const empty=await(await post(event({refs:[{...chartRef,members:[],snapshot:{id:hash,width:snapshot.width,height:snapshot.height,capturedAt:snapshot.capturedAt}}]}))).json();
 const membershipUnavailable=await(await post(event({refs:[{...chartRef,members:null}]}))).json();
 ok('empty and unavailable membership stay distinct',empty.event.refs[0].members.length===0&&membershipUnavailable.event.refs[0].members===null);
 const imageFile=join(work,'download.png');const downloaded=await cli('snapshot',hash,imageFile);
 ok('bot can retrieve original image bytes',downloaded.code===0&&(await readFile(imageFile)).equals(png));
 const beforeRows=checkImages.prepare('SELECT count(*) AS n FROM event').get().n;
 const textChunk=Buffer.from('tEXtComment\0rollback transaction');
 const chunkLength=Buffer.alloc(4);chunkLength.writeUInt32BE(textChunk.length-4);
 const checksum=Buffer.alloc(4);checksum.writeUInt32BE(crc32(textChunk));
 const otherPng=Buffer.concat([png.subarray(0,33),chunkLength,textChunk,checksum,png.subarray(33)]);
 // Force a failure after image insertion to verify the transaction, on this
 // isolated database only. An ancillary PNG chunk gives a distinct content hash.
 const otherSnapshot={dataUrl:`data:image/png;base64,${otherPng.toString('base64')}`,width:otherPng.readUInt32BE(16),height:otherPng.readUInt32BE(20),capturedAt:snapshot.capturedAt};
 if(otherSnapshot.width<=1200&&otherSnapshot.height<=1200){
  checkImages.exec("CREATE TRIGGER reject_chart_test BEFORE INSERT ON event WHEN NEW.thread_id='rollback-chart-test' BEGIN SELECT RAISE(ABORT,'test rollback'); END;");
  const rejected=await post(event({thread_id:'rollback-chart-test',refs:[{...chartRef,snapshot:otherSnapshot}]}));
  ok('failed event rolls back its image',rejected.status===500&&checkImages.prepare('SELECT count(*) AS n FROM event').get().n===beforeRows&&checkImages.prepare('SELECT count(*) AS n FROM snapshot').get().n===1);
  checkImages.exec('DROP TRIGGER reject_chart_test');
 }
 checkImages.close();

 // Corrections retain originals, use current send intent, and never reopen.
 const beforeEditSends=sends.length;
 const edit=(extra={})=>({id:crypto.randomUUID(),thread_id:plain.thread_id,kind:'edit',comment_id:plain.id,
  body:[{kind:'text',value:'Corrected wording'}],...extra});
 const firstEdit=edit();const firstEditResult=await(await post(firstEdit)).json();
 ok('ordinary correction saves without notification',firstEditResult.event.kind==='edit'&&firstEditResult.event.comment_id===plain.id&&sends.length===beforeEditSends);
 let editHistory=JSON.parse((await cli('read')).text);
 let edited=foldEvents(editHistory.events).threads.find(t=>t.id===plain.thread_id);
 ok('current comment changes in place with history retained',edited.comments.length===1&&edited.comments[0].id===plain.id&&edited.comments[0].body[0].value==='Corrected wording'
  &&edited.comments[0].createdAt===saved.event.created_at&&edited.comments[0].editedAt===firstEditResult.event.created_at
  &&edited.log[0].body[0].value==='hello'&&edited.log[1].commentId===plain.id);
 ok('selection is unchanged',JSON.stringify(edited.refs)===JSON.stringify(saved.event.refs));
 ok('editing another author is rejected',(await post(edit(),bob)).status===403);
 ok('editing a bot comment is rejected',(await post(edit({thread_id:delayed.thread_id,comment_id:JSON.parse(reply.text).event.id}))).status===403);
 ok('cross-discussion correction is rejected',(await post(edit({thread_id:human.thread_id}))).status===404);
 ok('unknown comment correction is rejected',(await post(edit({comment_id:'unknown-comment'}))).status===404);
 ok('correction cannot change refs',(await post(edit({refs:plain.refs}))).status===400);
 ok('correction cannot change pin',(await post(edit({pin:{xPct:.2,yPct:.2}}))).status===400);
 ok('empty correction is rejected',(await post(edit({body:[{kind:'text',value:' '}]}))).status===400);
 const directedEdit=edit({notify_bot:true});const directedEditResult=await(await post(directedEdit)).json();
 ok('checked correction requests one response',directedEditResult.event.invokes_bot&&sends.length===beforeEditSends+1&&sends.at(-1).mode==='force_respond');
 ok('correction receipt adds marker and keeps original comment link',sends.at(-1).message.startsWith('Comment posted [corrected] in ')
  &&sends.at(-1).message.includes(`anno_event=${plain.id}`)&&!sends.at(-1).message.includes('anno.mjs'));
 ok('replaying correction does not append or resend',(await(await post(directedEdit)).json()).replay&&sends.length===beforeEditSends+1);
 const quiet=await(await post(edit({notify_bot:false,body:[{kind:'text',value:'Quiet correction'}]}))).json();
 edited=foldEvents((await(await api('/api/state')).json()).events).threads.find(t=>t.id===plain.thread_id);
 ok('unchecked correction overrides previous send choice without cancelling its request',!edited.comments[0].notifyBot&&edited.waitingFor===directedEdit.id&&sends.length===beforeEditSends+1);
 await cli('resolve',plain.thread_id,'Done');
 const resolvedEdit=await(await post(edit({notify_bot:true}))).json();
 edited=foldEvents((await(await api('/api/state')).json()).events).threads.find(t=>t.id===plain.thread_id);
 ok('editing resolved comment leaves status and count unchanged',edited.status==='resolved'&&edited.comments.length===1&&edited.waitingFor===resolvedEdit.event.id);
 await post(edit({body:rich('bot','current','Lilo'),notify_bot:false}));
 ok('inline bot mention still requests delivery',sends.at(-1).mode==='force_respond');
 await post(edit({body:rich('user',bobId,'Bob'),notify_bot:false}));
 ok('human mention correction keeps human-only delivery',sends.at(-1).mode==='force_skip'&&sends.at(-1).message.includes('[corrected]'));
 behavior='fail';const failedEdit=edit({notify_bot:true,body:[{kind:'text',value:'Saved even if sending fails'}]});
 const failure=await(await post(failedEdit)).json();behavior='ok';
 ok('correction survives delivery failure with related durable error',failure.event.id===failedEdit.id&&failure.error_event.related_id===failedEdit.id);
 const editRead=await cli('read');editHistory=JSON.parse(editRead.text);
 ok('bot reads linked correction history without acknowledgement',editRead.text===(await cli('read')).text&&editHistory.events.filter(e=>e.kind==='edit'&&e.comment_id===plain.id).length===7);
 ok('original event payload remains unchanged',JSON.stringify(editHistory.events.find(e=>e.id===plain.id))===JSON.stringify(saved.event));
 ok('corrections are ordered and last saved wording is current',foldEvents(editHistory.events).threads.find(t=>t.id===plain.thread_id).comments[0].body[0].value==='Saved even if sending fails');
 ok('old protocol writers cannot introduce ambiguous changes',(await post(edit({protocol:6}))).status===409);
 const legacyFeed=await(await api('/api/events?since=1')).json();
 ok('old polling clients receive refresh signal without edit events',legacyFeed.events.length===0&&legacyFeed.seq===1&&legacyFeed.build.startsWith('protocol-7:'));
 console.log(`${report.length} server checks passed`);
}finally{
 server.kill();await new Promise(r=>server.once('exit',r));fake.close();await rm(work,{recursive:true,force:true});
 await writeFile(join(out,'server-results.json'),JSON.stringify({report,logs},null,2));
}
