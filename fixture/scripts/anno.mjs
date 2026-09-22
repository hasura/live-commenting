#!/usr/bin/env node
/** Non-mutating complete read; explicit bot reply/status writes. No retries. */
import http from 'node:http';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const SOCK=process.env.ANNO_SOCK??join(dirname(fileURLToPath(import.meta.url)),'..','runtime-state','anno.sock');
const args=process.argv.slice(2),flags={},pos=[];
for(let i=0;i<args.length;i++){
 if(args[i].startsWith('--')){const k=args[i].slice(2);if(!['id','expected-seq'].includes(k)||!args[i+1])throw Error('Unknown or incomplete option');flags[k]=args[++i];}
 else pos.push(args[i]);
}
const [command,discussion,...words]=pos;
function call(method,path,body){
 return new Promise((resolve,reject)=>{
  const data=body?JSON.stringify(body):null;
  const req=http.request({socketPath:SOCK,path,method,headers:data?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}:{}},res=>{
   let text='';res.on('data',c=>text+=c);res.on('end',()=>{try{resolve({status:res.statusCode,data:JSON.parse(text)});}catch(e){reject(e);}});
  });req.on('error',reject);req.setTimeout(10000,()=>req.destroy(Error('Request timed out')));req.end(data);
 });
}
try{
 let r;
 if(command==='read')r=await call('GET','/read');
 else if(['reply','resolve','reopen'].includes(command)&&discussion){
  if(flags['expected-seq']!==undefined&&(!/^\d+$/.test(flags['expected-seq'])||!Number.isSafeInteger(Number(flags['expected-seq']))))throw Error('expected-seq must be a nonnegative integer');
  const note=words.join(' ');
  if(command==='reply'&&!note.trim())throw Error('Reply text required');
  r=await call('POST','/event',{id:flags.id??randomUUID(),thread_id:discussion,kind:command==='reply'?'comment':command,
    ...(note?{body:[{kind:'text',value:note}]}:{}),...(flags['expected-seq']?{expected_seq:Number(flags['expected-seq'])}:{})});
 }else throw Error('usage: anno.mjs read | reply <discussion-id> <text> | resolve <discussion-id> [note] | reopen <discussion-id> [note] [--id UUID] [--expected-seq N]');
 if(r.status>=400){console.error(JSON.stringify(r.data));process.exitCode=r.status===409?3:r.status===404?4:1;}
 else console.log(JSON.stringify(r.data,null,2));
}catch(e){console.error(e.message);process.exitCode=1;}
