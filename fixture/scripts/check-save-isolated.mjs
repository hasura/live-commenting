// Real backend + built browser UI, isolated disk, fake upstream.
// Does NOT post artifacts/messages to PromptQL or touch the live review.
import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {mkdtemp,cp,readFile,writeFile,mkdir,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import assert from 'node:assert/strict';

const out=process.env.TEST_OUTPUT_DIR??'test-output/recreated';
await mkdir(out,{recursive:true});
const work=await mkdtemp(join(tmpdir(),'annotation-recreated-test-'));
const calls=[],report=[];
const ok=(name,pass)=>{report.push({name,pass:!!pass});console.log(pass?'PASS':'FAIL',name);assert.ok(pass,name);};
const id='local-isolated-reviewer',bot=process.env.PROMPTQL_THREAD_ID;
const token='test.'+Buffer.from(JSON.stringify({'https://promptql.hasura.io':{
  'x-hasura-promptql-user-id':id,'x-hasura-email':'isolated-test@example.invalid'
}})).toString('base64url')+'.test';
const upstream=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const body=JSON.parse(Buffer.concat(chunks).toString()||'{}');
  if(req.headers.authorization!=='Bearer '+token){res.writeHead(401);res.end('{}');return;}
  res.setHeader('Content-Type','application/json');
  if(req.url==='/v1/graphql'&&body.query?.includes('__typename')){
    res.end(JSON.stringify({data:{__typename:'query_root'}}));return;
  }
  calls.push({path:req.url,method:req.method,body});
  if(req.method==='PUT'&&req.url.startsWith(`/v1/artifacts/threads/${bot}/review-`)){
    res.end(JSON.stringify({artifact_id:'isolated-test-artifact',version:0}));return;
  }
  if(req.url==='/v1/graphql'&&body.query?.includes('send_thread_message')){
    res.end(JSON.stringify({data:{send_thread_message:{message_id:'isolated-test-message'}}}));return;
  }
  res.writeHead(400);res.end('{}');
});
await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
let backend,browser,context;
try{
  for(const name of ['dist','lib','server.mjs'])await cp(resolve(name),join(work,name),{recursive:true});
  // Synthetic empty review only. No production history/credentials enter test.
  await writeFile(join(work,'package.json'),'{"type":"module"}');
  await symlink(resolve('node_modules'),join(work,'node_modules'),'dir');
  backend=spawn(process.execPath,['server.mjs'],{cwd:work,env:{
    PATH:process.env.PATH,PORT:'5290',PROMPTQL_THREAD_ID:bot,
    PROMPTQL_PLATFORM_API_URL:`http://127.0.0.1:${upstream.address().port}`
  },stdio:['ignore','pipe','pipe']});
  backend.stderr.on('data',data=>process.stderr.write(data));
  let ready=false;
  for(let i=0;i<100;i++){
    try{if((await fetch('http://127.0.0.1:5290/readyz')).status===204){ready=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,50));
  }
  assert.ok(ready,'Isolated backend ready');
  browser=await chromium.connectOverCDP(process.env.CDP_URL??'http://127.0.0.1:9222');
  context=await browser.newContext({viewport:{width:1400,height:1050}});
  const page=await context.newPage();let input;
  await page.route('**/api/**',async route=>{
    const req=route.request(),options={headers:{...req.headers(),'x-promptql-visitor-token':token}};
    if(req.url().endsWith('/api/save')){input={...req.postDataJSON(),qa:true};options.postData=JSON.stringify(input);}
    await route.continue(options);
  });
  await page.goto('http://127.0.0.1:5290/',{waitUntil:'networkidle'});
  await page.getByRole('status').filter({hasText:'Shared review loaded.'}).waitFor();
  await page.locator('button[title="Comment mode"]').click();
  const target=page.locator('[data-anno-id="spec.lede"]');
  await target.scrollIntoViewIfNeeded();
  const box=await target.boundingBox();await page.mouse.click(box.x+15,box.y+15);
  await page.locator('.ca-composer-input').fill('Isolated recreation QA only; no external delivery.');
  await page.keyboard.press('Enter');
  await page.getByRole('button',{name:/Save all/}).click();
  await page.getByRole('status').filter({hasText:'Saved review and posted'}).waitFor();
  const saved=JSON.parse(await readFile(join(work,'runtime-state/state.json'),'utf8'));
  ok('real UI and backend close and persist review round',saved.revision===1&&saved.doc.rounds.length===1&&saved.doc.threads[0].closedRoundId===input.saveId);
  ok('server stamps requesting visitor identity',saved.doc.threads[0].comments[0].author.id===id);
  const archive=calls.find(c=>c.method==='PUT'),message=calls.find(c=>c.body.query?.includes('send_thread_message'));
  ok('archive request contains complete doc, snapshot, manifest',archive.body.doc.rounds.length===1&&archive.body.round.artifactSnapshot.includes('spec.image-example.image')&&archive.body.manifest.length===90);
  ok('bot callback addressed to owning bot with archived review link',message.body.variables.id===bot&&message.body.variables.message.includes(`review-${input.saveId}`)&&message.body.variables.config==='force_skip');
  const send=async body=>fetch('http://127.0.0.1:5290/api/save',{method:'POST',headers:{'Content-Type':'application/json','X-PromptQL-Visitor-Token':token},body:JSON.stringify(body)});
  const replay=await send(input);
  ok('identical retry has no duplicate outbound calls',replay.status===200&&(await replay.json()).duplicate===true&&calls.length===2);
  ok('stale revision rejected',(await send({...input,saveId:crypto.randomUUID()})).status===409);
  const doc=structuredClone(saved.doc);doc.threads[0].comments[0].body[0].value='Forbidden rewrite';
  ok('submitted history cannot be rewritten',(await send({...input,saveId:crypto.randomUUID(),revision:1,doc})).status===400);
  await page.reload({waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Sent rounds (1)'}).click();
  ok('saved round survives backend and UI reload',await page.locator('.review-history details').count()===1);
  await writeFile(out+'/isolated-save-results.json',JSON.stringify({report,coverage:'Real browser UI and backend; fake Platform API. No real artifacts or messages created.'},null,2));
}finally{
  if(context)await context.close();if(browser)await browser.close();
  if(backend&&backend.exitCode===null){backend.kill();await once(backend,'exit');}
  await new Promise(r=>upstream.close(r));
  await rm(work,{recursive:true,force:true});
}