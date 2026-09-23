/** Two isolated real-browser reviewers + local bot + fake platform, no live sends. */
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {launchBrowser} from './browser.mjs';
const out=process.env.TEST_OUTPUT_DIR??'test-output';await mkdir(out,{recursive:true});
const report=[],errors=[],ok=(n,v)=>{assert.ok(v,n);report.push({name:n,pass:true});console.log('PASS',n);};
const aliceId='33abc8c7-50af-41b8-aa9f-db572a6fa713',bobId='5ab475aa-bf9a-45ae-ac0a-30d6b78d8f10';
const jwt=id=>['x',Buffer.from(JSON.stringify({sub:id,display_name:id===aliceId?'Alice':'Bob'})).toString('base64url'),'y'].join('.');
let sends=[],sendError=false,dirName='Lilo';
const fake=http.createServer(async(req,res)=>{
 let s='';for await(const c of req)s+=c;const body=JSON.parse(s||'{}');let data={__typename:'query_root'};
 if(body.query?.includes('thread_participants'))data={threads_v2_by_pk:{project_id:'11111111-1111-4111-8111-111111111111',thread_participants:[aliceId,bobId].map(id=>({promptql_user_id:id,promptql_user:{display_name:id===aliceId?'Alice':'Bob',is_active:true,is_bot:false}})),project_config:{agent_name:dirName}}};
 if(body.query?.includes('send_thread_message')){sends.push(body.variables);if(sendError){res.writeHead(500);return res.end('{}');}data={send_thread_message:{message_id:'msg'+sends.length}};}
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data}));
});
await new Promise(r=>fake.listen(0,'127.0.0.1',r));
const work=await mkdtemp(join(tmpdir(),'anno-ui-v5-')),sock=join(work,'anno.sock'),base='http://127.0.0.1:5292';
let server,logs='';
async function start(build){
 server=spawn(process.execPath,[resolve('server.mjs')],{env:{...process.env,PORT:'5292',ANNO_DATA:work,ANNO_SOCK:sock,ANNO_DIST:resolve('dist'),PROMPTQL_PLATFORM_API_URL:`http://127.0.0.1:${fake.address().port}`,PROMPTQL_THREAD_ID:'11111111-1111-4111-8111-111111111111',BOT_NAME:'Lilo',BUILD_ID:build,POLL_MS:'300'},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
 for(let i=0;i<80;i++){try{if((await fetch(base+'/readyz')).status===204)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error(logs);
}
const stop=()=>new Promise(r=>{server.once('exit',r);server.kill();});
const cli=(...args)=>new Promise((r,j)=>{const p=spawn(process.execPath,[resolve('scripts/anno.mjs'),...args],{env:{...process.env,ANNO_SOCK:sock}});let s='',e='';p.stdout.on('data',b=>s+=b);p.stderr.on('data',b=>e+=b);p.once('exit',code=>code===0?r(JSON.parse(s)):j(Error(e)));});
await start('ui-v5-1');
const browser=await launchBrowser();
const as=async(id)=>{
 const context=await browser.newContext({viewport:{width:1200,height:900}});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>route.continue({headers:{...route.request().headers(),'x-promptql-visitor-token':jwt(id),'x-forwarded-host':'published.example','x-forwarded-proto':'https'}}));
 await page.goto(base);await page.locator('[aria-label="Comment mode"]:not(:disabled)').waitFor();
 return page;
};
const openDraft=async(page)=>{
 if(await page.locator('.ca-popover').count())await page.keyboard.press('Escape');
 const mode=page.getByRole('button',{name:'Comment mode',exact:true});
 if(await mode.getAttribute('aria-pressed')==='true')await mode.click();
 await mode.click();
 const target=page.locator('[data-anno-id="spec.summary"]');
 const fallback=await target.count()?target:page.locator('[data-anno-id]').first();
 await fallback.scrollIntoViewIfNeeded();await fallback.click({position:{x:12,y:10}});
 await page.locator('.ca-composer-input').waitFor();
};
try{
 const alice=await as(aliceId),bob=await as(bobId);
 ok('reviewer identity preserved',(await alice.locator('.review-banner').innerText()).includes('Alice')&&(await bob.locator('.review-banner').innerText()).includes('Bob'));
 await alice.locator('[data-testid=presence]',{hasText:'2'}).waitFor();
 ok('no periodic sync/read controls',await alice.locator('[data-testid=sync-now],[data-testid=sync-footer]').count()===0);
 await openDraft(alice);await alice.locator('.ca-composer-input').fill('Plain shared comment');
 await alice.locator('.ca-btn').click();await alice.locator('.ca-composer-input').waitFor({state:'detached'});
 await bob.locator('.ca-pin').first().waitFor();await bob.locator('.ca-pin').first().click();
 await bob.getByText('Plain shared comment',{exact:true}).waitFor();
 ok('plain comment shared without send',sends.length===0);
 ok('first durable save leaves discussion open',await alice.locator('.ca-popover [data-entry-kind=comment]').count()===1&&await alice.locator('.ca-thread-draft').count()===0);
 ok('plain comment has no direct-post prefix',await alice.locator('.ca-direct-badge').count()===0);
 const opening=(await cli('read')).events.find(e=>e.kind==='comment');
 await alice.keyboard.press('Escape');await alice.locator('.ca-pin').first().click();
 await alice.locator('.ca-thread').getByRole('button',{name:'Reply',exact:true}).click();
 const input=alice.locator('.ca-composer-input');
 await input.fill('@promptql');await alice.getByRole('option',{name:'Lilo Bot'}).click();
 await input.press('End');await input.type(' please clarify');
 ok('inline bot locks checked checkbox',await alice.locator('.ca-direct input').isChecked()&&await alice.locator('.ca-direct input').isDisabled());
 await alice.locator('.ca-btn').click();await input.waitFor({state:'detached'});
 await alice.getByText('Waiting for Lilo…',{exact:true}).waitFor();
 ok('one invocation for badge plus checkbox',sends.length===1&&sends[0].mode==='force_respond');
 ok('single canonical bot mention in receipt For row',(sends[0].message.match(/<agent_mention \/>/g)||[]).length===1);
 const directed=(await cli('read')).events.find(e=>e.invokes_bot);
 const directedComment=alice.locator(`[data-event-id="${directed.id}"] .ca-comment-body`);
 ok('prefix precedes original inline mention',await directedComment.locator('.ca-direct-badge').innerText()==='@Lilo'&&await directedComment.locator('.ca-mention').count()===2&&await directedComment.innerText().then(t=>t.startsWith('@Lilo @Lilo')));
 await bob.locator(`[data-event-id="${directed.id}"] .ca-direct-badge`).waitFor();
 ok('peer sees direct-post prefix',true);
 await alice.reload();await alice.locator('.ca-pin').first().waitFor();await alice.locator('.ca-pin').first().click();
 await directedComment.waitFor();
 ok('direct-post prefix survives reload',await directedComment.locator('.ca-direct-badge').count()===1);
 ok('receipt uses gateway canonical origin',sends[0].message.includes('https://published.example/?anno_discussion='));
 await cli('reply',opening.thread_id,'Could you clarify the wording?');
 await alice.getByText('Could you clarify the wording?',{exact:true}).waitFor();
 await alice.getByText('Waiting for Lilo…',{exact:true}).waitFor({state:'detached'});
 ok('bot clarification clears waiting without resolving',(await cli('read')).discussions[0].status==='open');
 const count=sends.length;
 await alice.locator('.ca-thread').getByRole('button',{name:'Reply',exact:true}).click();await input.fill('Human follow-up');await alice.locator('.ca-btn').click();await input.waitFor({state:'detached'});
 ok('ordinary clarification response does not invoke',sends.length===count);
 sendError=true;
 await alice.locator('.ca-thread').getByRole('button',{name:'Reply',exact:true}).click();await input.fill('A new request');await alice.locator('.ca-direct input').check();await alice.locator('.ca-btn').click();await input.waitFor({state:'detached'});
 await alice.locator('[data-entry-kind=error]').waitFor();
 ok('exact durable error and no retry button',(await alice.locator('[data-entry-kind=error]').innerText()).includes('Sending failed, ping Lilo in chat to retry.')&&await alice.getByRole('button',{name:'Retry',exact:true}).count()===0);
 const directOnly=(await cli('read')).events.filter(e=>e.invokes_bot).at(-1);
 ok('checkbox-only prefix survives send failure',await alice.locator(`[data-event-id="${directOnly.id}"] .ca-direct-badge`).innerText()==='@Lilo');
 ok('send error clears matching waiting',await alice.locator('.ca-waiting').count()===0);
 sendError=false;
 // Save failures keep the composer open and draft editable; no platform send.
 const sentBefore=sends.length;
 await alice.locator('.ca-thread').getByRole('button',{name:'Reply',exact:true}).click();await input.fill('Retain this draft');
 await alice.route('**/api/event',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"Saving failed. Your draft is still here."}'}));
 await alice.locator('.ca-btn').click();await alice.locator('.ca-composer-error').waitFor();
 ok('save failure retains draft and sends nothing',await input.innerText()==='Retain this draft'&&sends.length===sentBefore);
 await alice.unroute('**/api/event');await alice.getByRole('button',{name:'Cancel',exact:true}).click();
 // Resolved and unanchored history deep-links, including reload.
 await cli('resolve',opening.thread_id,'Done');
 const url=`${base}/?anno_discussion=${opening.thread_id}&anno_event=${opening.id}`;
 await alice.goto(url);await alice.locator(`[data-event-id="${opening.id}"]`).waitFor();
 ok('deep link opens resolved discussion',await alice.locator('.ca-thread-resolved').count()===1);
 await alice.reload();await alice.locator(`[data-event-id="${opening.id}"]`).waitFor();
 ok('reload retains exact discussion/event',new URL(alice.url()).searchParams.get('anno_event')===opening.id);
 await alice.route('**/api/state',async route=>{
  const r=await route.fetch({headers:{...route.request().headers(),'x-promptql-visitor-token':jwt(aliceId)}});const d=await r.json();
  d.events=d.events.map(e=>e.refs?{...e,refs:e.refs.map(ref=>({...ref,id:'gone-target'}))}:e);
  await route.fulfill({json:d});
 });
 await alice.reload();await alice.locator(`.ca-tray [data-event-id="${opening.id}"]`).waitFor();
 ok('deep link opens unanchored resolved history',await alice.locator('.ca-tray .ca-tag-unanchored').count()===1);
 await alice.unroute('**/api/state');
 await cli('reopen',opening.thread_id,'Follow-up');await bob.goto(base+`/?anno_discussion=${opening.thread_id}`);await bob.locator('.ca-thread').waitFor();
 await bob.locator('.ca-thread').getByRole('button',{name:'Reply',exact:true}).click();
 await bob.locator('.ca-direct').filter({hasText:'Post directly to Lilo'}).waitFor();
 // Wait for initial directory before requesting a reconnect refresh.
 dirName='Nova';await bob.evaluate(()=>window.dispatchEvent(new Event('online')));
 await bob.locator('.ca-direct').filter({hasText:'Post directly to Nova'}).waitFor();
 ok('reconnect refreshes configured bot name',true);
 await bob.getByRole('button',{name:'Cancel',exact:true}).click();
 await bob.setViewportSize({width:320,height:430});
 await stop();await start('ui-v5-2');
 await bob.locator('[data-testid=refresh]').waitFor();
 ok('new build exposes refresh',await bob.locator('[data-testid=refresh]').isEnabled());
 await bob.waitForTimeout(200);
 await bob.waitForFunction(()=>{
  const p=document.querySelector('.ca-popover')?.getBoundingClientRect(),t=document.querySelector('.ca-toolbar')?.getBoundingClientRect();
  return p&&t&&p.y>=0&&p.bottom<=t.y-7;
 });
 ok('mobile sheet stays above toolbar after Refresh appears',true);
 await bob.screenshot({path:out+'/mobile-refresh.png'});
 await bob.locator('[data-testid=refresh]').click();
 await bob.locator('.ca-popover .ca-thread').waitFor();
 ok('Refresh remains tappable with mobile discussion open',await bob.locator('[data-testid=refresh]').count()===0);
 ok('restart preserves full history',(await cli('read')).events.length>=7);
 await alice.setViewportSize({width:375,height:812});await alice.reload();await alice.locator('.ca-toolbar').waitFor();
 console.log('Overflow diagnostic',await alice.evaluate(()=>({width:innerWidth,doc:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+2).slice(0,12).map(e=>({tag:e.tagName,cls:e.className,w:e.getBoundingClientRect().width}))})));
 ok('mobile annotation UI fits viewport',await alice.locator('.ca-toolbar,.ca-popover,.ca-tray').evaluateAll(nodes=>nodes.every(e=>e.getBoundingClientRect().right<=innerWidth+1&&e.getBoundingClientRect().left>=-1)));
 await alice.screenshot({path:out+'/shared-mobile.png'});
 ok('no browser exceptions',errors.length===0);
 console.log(`${report.length} shared-app checks passed`);
}finally{await browser.close();await stop();fake.close();await rm(work,{recursive:true,force:true});await writeFile(out+'/shared-app-results.json',JSON.stringify({report,errors,logs},null,2));}
