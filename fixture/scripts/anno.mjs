#!/usr/bin/env node
/**
 * The bot's handle on a running live-commenting server. Zero dependencies.
 *
 *   anno.mjs unread [--peek]                     digest of everything the bot has not read; advances its cursors unless --peek
 *   anno.mjs threads [--all|--resolved]          list threads
 *   anno.mjs resolve <thread-id> [note] [--id <uuid>] [--actor <name>]
 *   anno.mjs reopen  <thread-id> [note] [--id <uuid>] [--actor <name>]
 *   anno.mjs events  [--since <seq>]             raw events (JSON)
 *
 * One call = one event, synchronous: prints `{seq}` on success, the server's
 * error body on failure with a non-zero exit. `--id` makes a retry idempotent.
 * Talks to the Unix socket `runtime-state/anno.sock` (override: ANNO_SOCK).
 */
import http from 'node:http';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const SOCK=process.env.ANNO_SOCK ?? join(dirname(fileURLToPath(import.meta.url)),'..','runtime-state','anno.sock');
const args=process.argv.slice(2), flags={}, positional=[];
for(let i=0;i<args.length;i++) {
  const a=args[i];
  if(a.startsWith('--')) { const k=a.slice(2); const next=args[i+1]; if(next!==undefined && !next.startsWith('--') && ['id','actor','since'].includes(k)) { flags[k]=next; i++; } else flags[k]=true; }
  else positional.push(a);
}
const [cmd,threadId,...noteParts]=positional;

function call(method,path,body,attempt=0) {
  return new Promise((resolvePromise,reject)=>{
    const data=body?JSON.stringify(body):null;
    const req=http.request({socketPath:SOCK,path,method,headers:data?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}:{}},res=>{
      let text='';
      res.on('data',c=>text+=c);
      res.on('end',()=>{ let json; try{json=JSON.parse(text);}catch{json={error:text};} resolvePromise({status:res.statusCode,json}); });
    });
    req.on('error',e=>{
      // The systemd unit may still be starting; give it 10 s before failing loudly.
      if((e.code==='ECONNREFUSED'||e.code==='ENOENT') && attempt<20) setTimeout(()=>call(method,path,body,attempt+1).then(resolvePromise,reject),500);
      else reject(Object.assign(e,{hint:`No live-commenting server on ${SOCK}`}));
    });
    if(data) req.write(data);
    req.end();
  });
}
const out=(o)=>console.log(JSON.stringify(o,null,2));
const die=(msg,code=1)=>{ console.error(msg); process.exit(code); };

try {
  if(cmd==='unread') {
    const {status,json}=await call('GET','/unread');
    if(status!==200) die(JSON.stringify(json));
    if(!json.count) { console.log(`No unread comments (cursor ${json.to_seq}).`); process.exit(0); }
    console.log(`${json.count} unread message${json.count===1?'':'s'} from ${json.authors.join(', ')} · seq ${json.from_seq}–${json.to_seq}\n`);
    console.log(json.digest);
    if(!flags.peek) {
      const ack=await call('POST','/unread/ack',{to_seq:json.to_seq});
      if(ack.status!==200) die(`\nFailed to advance cursor: ${JSON.stringify(ack.json)}`);
      console.log(`\n(cursor advanced to ${json.to_seq})`);
    } else console.log(`\n(peek: cursor left at ${json.from_seq-1})`);
  } else if(cmd==='threads') {
    const want=flags.all?'all':flags.resolved?'resolved':'open';
    const {status,json}=await call('GET',`/threads?status=${want}`);
    if(status!==200) die(JSON.stringify(json));
    if(!json.threads.length) { console.log(`No ${want==='all'?'':want+' '}threads.`); process.exit(0); }
    for(const t of json.threads) console.log(`${t.thread_id}  ${t.status.padEnd(8)}  ${t.n_comments}c  ${t.context}\n    ${t.opener_name} ${t.opened_at}: ${t.opening}`);
  } else if(cmd==='resolve' || cmd==='reopen') {
    if(!threadId) die(`usage: anno.mjs ${cmd} <thread-id> [note] [--id <uuid>] [--actor <name>]`,2);
    const note=noteParts.join(' ').trim();
    const body={kind:cmd,thread_id:threadId,...(note?{note}:{}),...(typeof flags.id==='string'?{id:flags.id}:{}),...(typeof flags.actor==='string'?{actor_name:flags.actor}:{})};
    const {status,json}=await call('POST','/event',body);
    if(status!==201 && status!==200) die(JSON.stringify(json), status===409?3:status===404?4:1);
    out({seq:json.seq,...(status===200?{replay:true}:{})});
  } else if(cmd==='events') {
    const {status,json}=await call('GET',`/events?since=${Number(flags.since??0)}`);
    if(status!==200) die(JSON.stringify(json));
    out(json);
  } else die('usage: anno.mjs unread [--peek] | threads [--all] | resolve <id> [note] | reopen <id> [note] | events [--since n]',2);
} catch(e) { die(`${e.message}${e.hint?`\n${e.hint}`:''}`); }