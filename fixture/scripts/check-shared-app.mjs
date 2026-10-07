/** Two isolated real-browser reviewers + local bot + fake platform, no live sends. */
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,mkdir,writeFile,readFile} from 'node:fs/promises';
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
 server=spawn(process.execPath,[resolve('server.mjs')],{env:{...process.env,PORT:'5292',ANNO_DATA:work,ANNO_SOCK:sock,ANNO_DIST:resolve(process.env.ANNO_DIST??'dist'),PROMPTQL_PLATFORM_API_URL:`http://127.0.0.1:${fake.address().port}`,PROMPTQL_THREAD_ID:'11111111-1111-4111-8111-111111111111',BOT_NAME:'Lilo',BUILD_ID:build,POLL_MS:'300'},stdio:['ignore','pipe','pipe']});
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
 // The built app has no identity banner (that is development-only chrome); the
 // served identity is what /api/state returns for each context's visitor token.
 const whoami=page=>page.evaluate(()=>fetch('/api/state').then(r=>r.json()).then(d=>d.user?.name));
 ok('reviewer identity preserved',await whoami(alice)==='Alice'&&await whoami(bob)==='Bob');
 await alice.locator('[data-testid=presence]',{hasText:'2'}).waitFor();
 await alice.locator('[data-testid=presence]').click();
 await alice.locator('.ca-presence-list li').filter({hasText:'Bob'}).waitFor();
 ok('presence bubble displays actual shared viewers',JSON.stringify((await alice.locator('.ca-presence-list li').allTextContents()).sort())===JSON.stringify(['Alice','Bob']));
 await alice.mouse.move(10,10);await alice.waitForTimeout(700);
 ok('presence remains pinned across polls without sending',await alice.locator('.ca-presence-bubble').getAttribute('data-pinned')==='true'&&sends.length===0);
 await alice.locator('[data-anno-id="spec.title"]').click();await alice.locator('.ca-presence-bubble').waitFor({state:'detached'});
 ok('shared-app outside click dismisses presence',true);
 ok('no periodic sync/read controls',await alice.locator('[data-testid=sync-now],[data-testid=sync-footer]').count()===0);
 await openDraft(alice);await alice.locator('.ca-composer-input').fill('Plain shared comment');
 await alice.locator('.ca-btn').click();await alice.locator('.ca-composer-input').waitFor({state:'detached'});
 await bob.locator('.ca-pin').first().waitFor();await bob.locator('.ca-pin').first().click();
 await bob.getByText('Plain shared comment',{exact:true}).waitFor();
 ok('plain comment shared without send',sends.length===0);
 ok('first durable save leaves discussion open',await alice.locator('.ca-popover [data-entry-kind=comment]').count()===1&&await alice.locator('.ca-thread-draft').count()===0);
 ok('plain comment has no direct-post prefix',await alice.locator('.ca-direct-badge').count()===0);
 ok('comment is stamped with the served identity',(await alice.locator('.ca-popover .ca-comment-author').first().innerText()).trim()==='Alice');
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
 ok('inline mention is the only bot signal (no duplicate prefix)',await directedComment.locator('.ca-direct-badge').count()===0&&await directedComment.locator('.ca-mention').count()===1&&await directedComment.innerText().then(t=>t.replace(/\s+/g,' ').startsWith('@Lilo please clarify')));
 await bob.locator(`[data-event-id="${directed.id}"] .ca-mention`).waitFor();
 ok('peer sees a single bot mention and no prefix',await bob.locator(`[data-event-id="${directed.id}"] .ca-direct-badge`).count()===0);
 await alice.reload();await alice.locator('.ca-pin').first().waitFor();await alice.locator('.ca-pin').first().click();
 await directedComment.waitFor();
 ok('no prefix appears after reload for inline-mention comment',await directedComment.locator('.ca-direct-badge').count()===0);
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
 // A failed Resolve under Open must retain the popup and committed SQLite history.
 const eventsBeforeResolve=(await cli('read')).events.length;
 await alice.getByTestId('toggle-comments').click();
 const reader=alice.locator('.ca-comments-panel');
 await reader.getByRole('button',{name:'Open discussions',exact:true}).click();
 await reader.locator(`[data-thread-id="${opening.thread_id}"]`).getByRole('button',{name:'Show on page',exact:true}).click();
 let statusAttempts=0;
 await alice.route('**/api/event',r=>{statusAttempts++;return r.fulfill({status:503,contentType:'application/json',body:'{"error":"Status save unavailable"}'});});
 await alice.locator('.ca-popover').getByRole('button',{name:'Resolve',exact:true}).click();
 await alice.waitForTimeout(100);
 ok('failed Resolve retains popup and leaves SQLite and bot delivery unchanged',statusAttempts===1
   &&await alice.locator('.ca-popover').getByRole('button',{name:'Resolve',exact:true}).isVisible()
   &&(await cli('read')).events.length===eventsBeforeResolve&&sends.length===sentBefore);
 await alice.unroute('**/api/event');
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
 // Real chart gesture through durable save, platform invocation, peer and bot.
 await alice.goto(base);
 await alice.getByRole('button',{name:'Comment mode',exact:true}).click();
 const plot=alice.locator('[data-anno-id="charts.basic.bar.plot"]');
 await plot.scrollIntoViewIfNeeded();
 const getRegion=()=>plot.evaluate(el=>{
  const rect=el.getBoundingClientRect(),marks=el.__annoChartV1.getMarks().filter(m=>['requests/billing','requests/reports'].includes(m.key));
  return {x:rect.x+Math.min(...marks.map(m=>m.geometry.bounds.x))-2,y:rect.y+Math.min(...marks.map(m=>m.geometry.bounds.y))-2,
   right:rect.x+Math.max(...marks.map(m=>m.geometry.bounds.x+m.geometry.bounds.width))+2,bottom:rect.y+Math.max(...marks.map(m=>m.geometry.bounds.y+m.geometry.bounds.height))+2};
 });
 const region=await getRegion();
 await alice.mouse.move(region.x,region.y);await alice.mouse.down();await alice.mouse.move(region.right,region.bottom,{steps:10});await alice.mouse.up();
 await alice.locator('.ca-composer-input').fill('Please review these two services.');
 await alice.locator('.ca-direct input').check();
 await alice.locator('.ca-thread-draft img').waitFor();
 const eventsBeforePause=(await cli('read')).events.length;
 await alice.getByTestId('toggle-comments').click();
 ok('switching popups discards the chart editor without a save or Resume state',
   await alice.locator('.ca-thread-draft').count()===0&&await alice.getByTestId('resume-draft').count()===0
   &&(await cli('read')).events.length===eventsBeforePause);
 await alice.locator('.ca-comments-panel .ca-close').click();await plot.scrollIntoViewIfNeeded();
 const freshRegion=await getRegion();
 await alice.mouse.move(freshRegion.x,freshRegion.y);await alice.mouse.down();await alice.mouse.move(freshRegion.right,freshRegion.bottom,{steps:10});await alice.mouse.up();
 ok('a replacement chart comment starts with empty text and fresh delivery intent',(await alice.locator('.ca-thread-draft .ca-composer-input').innerText()).trim()===''&&!await alice.locator('.ca-thread-draft .ca-direct input').isChecked());
 await alice.locator('.ca-thread-draft .ca-composer-input').fill('Please review these two services.');await alice.locator('.ca-thread-draft .ca-direct input').check();
 const sendsBeforeChart=sends.length;
 await alice.getByRole('button',{name:'Comment',exact:true}).click();await alice.locator('.ca-composer-input').waitFor({state:'detached'});
 const chartEvent=(await cli('read')).events.find(e=>e.refs?.[0]?.kind==='chart');
 ok('chart invocation sends once after saving its fixed members',sends.length===sendsBeforeChart+1&&sends.at(-1).mode==='force_respond'&&chartEvent.invokes_bot&&chartEvent.refs[0].members.length===2);
 ok('chart receipt links to its saved discussion',sends.at(-1).message.includes(`anno_discussion=${chartEvent.thread_id}`)&&sends.at(-1).message.includes(`anno_event=${chartEvent.id}`));
 const imagePath=join(work,'chart-selection.png');
 await cli('snapshot',chartEvent.refs[0].snapshot.id,imagePath);
 const imageBytes=await readFile(imagePath);
 ok('bot reads chart members and the original selection PNG',imageBytes.readUInt32BE(16)===chartEvent.refs[0].snapshot.width);
 await bob.goto(`${base}/?anno_discussion=${chartEvent.thread_id}&anno_event=${chartEvent.id}`);
 await bob.locator('.ca-original-image img').waitFor();
 await bob.waitForFunction(()=>document.querySelector('.ca-original-image img')?.naturalWidth>0);
 ok('peer opens chart receipt with image first and one data disclosure',await bob.locator('.ca-selection-details > :first-child img').isVisible()&&await bob.locator('.ca-selection-details summary').innerText()==='2 data points');
 await bob.screenshot({path:out+'/shared-chart-details.png'});
 await bob.locator('.ca-selection-details summary').click();
 await bob.getByText('2 of 2 selected items visible in this view',{exact:true}).waitFor();
 await cli('reply',chartEvent.thread_id,'Reviewed the selected services and their saved image.');
 await bob.getByText('Reviewed the selected services and their saved image.',{exact:true}).waitFor();
 ok('bot chart reply reaches reviewers without another send',sends.length===sendsBeforeChart+1&&await bob.locator('.ca-waiting').count()===0);
 // Edit the actual saved chart comment while the other reviewer watches.
 const ownChart=alice.locator(`.ca-popover [data-event-id="${chartEvent.id}"]`);
 const peerChart=bob.locator(`.ca-popover [data-event-id="${chartEvent.id}"]`);
 const currentBody=entry=>entry.locator(':scope > .ca-comment-body');
 ok('only the author sees Edit for their comment',await ownChart.getByRole('button',{name:'Edit comment',exact:true}).count()===1
  &&await peerChart.getByRole('button',{name:'Edit comment',exact:true}).count()===0
  &&await bob.locator('.ca-popover [data-entry-kind="comment"]').last().getByRole('button',{name:'Edit comment',exact:true}).count()===0);
 const originalTime=await ownChart.locator('.ca-comment-time').getAttribute('datetime');
 const sendsBeforeEdits=sends.length;
 await ownChart.getByRole('button',{name:'Edit comment',exact:true}).click();
 ok('edit loads current text and checked delivery intent',await ownChart.locator('.ca-composer-input').innerText()==='Please review these two services.'&&await ownChart.locator('.ca-direct input').isChecked());
 ok('unchanged edit cannot send another request',await ownChart.getByRole('button',{name:'Save changes',exact:true}).isDisabled());
 await ownChart.locator('.ca-composer-input').fill('Quiet correction to these services');await ownChart.locator('.ca-direct input').uncheck();
 await ownChart.getByRole('button',{name:'Save changes',exact:true}).click();await ownChart.locator('.ca-composer').waitFor({state:'detached'});
 await currentBody(peerChart).filter({hasText:'Quiet correction to these services'}).waitFor();
 ok('unchecked correction reaches peer without waking bot',sends.length===sendsBeforeEdits&&await ownChart.locator('.ca-comment-time').getAttribute('datetime')===originalTime);
 await peerChart.locator('.ca-edit-history > summary').click();
 ok('history preserves original wording and corrected wording',(await peerChart.locator('.ca-revision .ca-comment-body').allTextContents()).join('|').includes('Please review these two services.')
  &&await peerChart.locator('.ca-revision').count()===2);
 await peerChart.locator('.ca-edit-history > summary').click();
 await cli('resolve',chartEvent.thread_id,'Completed before correction');
 await alice.locator('.ca-popover .ca-thread-resolved').waitFor();
 await ownChart.getByRole('button',{name:'Edit comment',exact:true}).click();
 ok('next edit defaults to the latest unchecked choice',!await ownChart.locator('.ca-direct input').isChecked());
 await ownChart.locator('.ca-composer-input').fill('Please use the corrected service description');await ownChart.locator('.ca-direct input').check();
 await ownChart.getByRole('button',{name:'Save changes',exact:true}).click();await ownChart.locator('.ca-composer').waitFor({state:'detached'});
 ok('checked correction sends current wording with corrected marker',sends.length===sendsBeforeEdits+1&&sends.at(-1).mode==='force_respond'
  &&sends.at(-1).message.startsWith('Comment posted [corrected] in ')
  &&sends.at(-1).message.includes('Please use the corrected service description')&&sends.at(-1).message.includes(`anno_event=${chartEvent.id}`));
 ok('correction does not reopen completed discussion',await alice.locator('.ca-popover .ca-thread-resolved').count()===1);
 await ownChart.getByRole('button',{name:'Edit comment',exact:true}).click();
 await ownChart.locator('.ca-composer-input').fill('Keep this unsaved edit');
 const beforeFailedEdit=(await cli('read')).events.length;
 await alice.route('**/api/event',r=>r.fulfill({status:409,contentType:'application/json',body:'{"error":"Refresh required before saving"}'}));
 await ownChart.getByRole('button',{name:'Save changes',exact:true}).click();await ownChart.locator('.ca-composer-error').waitFor();
 ok('edit failure is not mistaken for a status no-op',await ownChart.locator('.ca-composer-input').innerText()==='Keep this unsaved edit'&&(await cli('read')).events.length===beforeFailedEdit);
 await alice.unroute('**/api/event');await ownChart.getByRole('button',{name:'Cancel',exact:true}).click();
 sendError=true;await ownChart.getByRole('button',{name:'Edit comment',exact:true}).click();
 await ownChart.locator('.ca-composer-input').fill('Saved correction with a delivery error');
 await ownChart.getByRole('button',{name:'Save changes',exact:true}).click();await ownChart.locator('.ca-composer').waitFor({state:'detached'});sendError=false;
 await currentBody(peerChart).filter({hasText:'Saved correction with a delivery error'}).waitFor();
 const correctedHistory=await cli('read'),corrections=correctedHistory.events.filter(e=>e.kind==='edit'&&e.comment_id===chartEvent.id);
 ok('bot reads complete correction events while original chart event stays immutable',corrections.length===3&&JSON.stringify(correctedHistory.events.find(e=>e.id===chartEvent.id))===JSON.stringify(chartEvent));
 ok('delivery error belongs to saved correction',correctedHistory.events.some(e=>e.kind==='error'&&e.related_id===corrections.at(-1).id));
 await cli('snapshot',chartEvent.refs[0].snapshot.id,imagePath);
 ok('editing preserves the original selection PNG',(await readFile(imagePath)).equals(imageBytes));
 await alice.reload();await alice.getByTestId('toggle-comments').click();
 await alice.locator(`.ca-comments-panel [data-thread-id="${chartEvent.thread_id}"]`).getByRole('button',{name:'Show on page',exact:true}).click();
 await currentBody(ownChart).filter({hasText:'Saved correction with a delivery error'}).waitFor();
 await ownChart.getByRole('button',{name:'Edit comment',exact:true}).click();
 ok('reload retains latest wording and send choice after delivery failure',await ownChart.locator('.ca-composer-input').innerText()==='Saved correction with a delivery error'&&await ownChart.locator('.ca-direct input').isChecked());
 await ownChart.getByRole('button',{name:'Cancel',exact:true}).click();
 await bob.setViewportSize({width:390,height:650});
 await bob.waitForFunction(()=>{
  const panel=document.querySelector('.ca-popover')?.getBoundingClientRect(),toolbar=document.querySelector('.ca-toolbar')?.getBoundingClientRect();
  return panel&&toolbar&&panel.x>=0&&panel.right<=innerWidth&&panel.y>=0&&panel.bottom<=toolbar.y-7;
 });
 ok('image and expanded point details fit a mobile discussion sheet',true);
 await bob.screenshot({path:out+'/shared-chart-details-mobile.png'});
 await bob.goto(base+`/?anno_discussion=${opening.thread_id}`);await bob.locator('.ca-thread').waitFor();
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
