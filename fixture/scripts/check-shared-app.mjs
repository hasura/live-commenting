/**
 * The shared review app end to end: real browser UI + real server, fake
 * Platform API. Two reviewers in two browser contexts, the bot over the
 * socket. No real messages are created.
 *
 *   npm run build && node scripts/check-shared-app.mjs
 */
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm, writeFile, mkdir, cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {launchBrowser} from './browser.mjs';

const outputDir=process.env.TEST_OUTPUT_DIR??'test-output';
await mkdir(outputDir,{recursive:true});
const report=[];
const ok=(name,condition)=>{report.push({name,pass:!!condition});console.log(condition?'PASS':'FAIL',name);assert.ok(condition,name);};
const token=(id,name)=>['x',Buffer.from(JSON.stringify({sub:id,display_name:name})).toString('base64url'),'y'].join('.');

const sent=[];
const fake=http.createServer(async(req,res)=>{
  let body='';for await(const c of req)body+=c;
  const json=body?JSON.parse(body):{};
  res.setHeader('Content-Type','application/json');
  if(json.query?.includes('send_system_message')){sent.push(json.variables);return res.end(JSON.stringify({data:{send_system_message:{message_id:`msg-${sent.length}`}}}));}
  res.end('{"data":{"__typename":"query_root"}}');
});
await new Promise(r=>fake.listen(0,'127.0.0.1',r));
const work=await mkdtemp(join(tmpdir(),'anno-ui-'));
const PORT=5292, SOCK=join(work,'anno.sock'), base=`http://127.0.0.1:${PORT}`, DIST=join(work,'dist');
await cp(resolve('dist'),DIST,{recursive:true}); // private copy: the refresh test edits it
const serverEnv={...process.env,PORT:String(PORT),ANNO_SOCK:SOCK,ANNO_DATA:work,ANNO_DIST:DIST,
  PROMPTQL_PLATFORM_API_URL:`http://127.0.0.1:${fake.address().port}`,PROMPTQL_THREAD_ID:'bot-thread',BOT_NAME:'Test Bot',SYNC_MAX_AGE_MS:'600000'};
let logs='',server;
const startServer=async(buildId)=>{
  server=spawn(process.execPath,[resolve('server.mjs')],{cwd:resolve('.'),env:{...serverEnv,BUILD_ID:buildId},stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d);
  for(let i=0;i<60;i++){try{if((await fetch(`${base}/readyz`)).status===204)return;}catch{}await new Promise(r=>setTimeout(r,250));}
  throw Error(`server did not start\n${logs}`);
};
const stopServer=()=>new Promise(r=>{server.once('exit',r);server.kill();});
await startServer('v1');
const anno=(...args)=>new Promise(r=>{const p=spawn(process.execPath,[resolve('scripts/anno.mjs'),...args],{env:{...process.env,ANNO_SOCK:SOCK}});let out='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>out+=d);p.on('close',code=>r({code,out}));});

const browser=await launchBrowser();
const as=async(id,name)=>{
  const ctx=await browser.newContext({viewport:{width:1400,height:950}});
  const page=await ctx.newPage();
  await page.route('**/api/**',route=>route.continue({headers:{...route.request().headers(),'x-promptql-visitor-token':token(id,name)}}));
  await page.goto(base,{waitUntil:'networkidle'});
  return {ctx,page};
};
const comment=async(page,selector,text)=>{
  await page.locator('button[title="Comment mode"]').click();
  const target=page.locator(`[data-anno-id="${selector}"]`);
  await target.scrollIntoViewIfNeeded();
  const box=await target.boundingBox();
  await page.mouse.click(box.x+10,box.y+10);
  await page.locator('.ca-composer-input').fill(text);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
};
try {
  const alice=await as('user-alice','Alice'), bob=await as('user-bob','Bob');
  ok('both reviewers signed in',(await alice.page.locator('.review-banner').innerText()).includes('Signed in: Alice')&&(await bob.page.locator('.review-banner').innerText()).includes('Signed in: Bob'));
  ok('no Save all, no Sent rounds, no draft controls',await alice.page.getByRole('button',{name:/Save all|Sent rounds|Download draft|Reload shared/}).count()===0);
  ok('banner has no usage-instructions line',!(await alice.page.locator('.review-banner').innerText()).includes('Comment mode from the toolbar'));
  await alice.page.locator('[data-testid="presence"]',{hasText:'2'}).waitFor({timeout:10000});
  ok('commenting bar counts 2 people viewing, naming them in the tooltip',/Alice/.test(await alice.page.locator('[data-testid="presence"]').getAttribute('title')??'')&&/Bob/.test(await alice.page.locator('[data-testid="presence"]').getAttribute('title')??''));
  const bannerShape=p=>p.locator('.review-banner').evaluate(el=>[el.children.length,el.querySelector('strong')?.textContent,el.querySelectorAll('[data-testid="sync-footer"] > *').length].join('|'));
  ok('banner title is "Live commenting debug" and the debug block is gone',(await alice.page.locator('.review-banner strong').innerText())==='Live commenting debug'&&await alice.page.locator('.review-debug-wrap, [data-testid="debug-state"], details').count()===0);
  ok('banner is light grey with black text',(await alice.page.locator('.review-banner').evaluate(el=>getComputedStyle(el).backgroundColor+' '+getComputedStyle(el).color))==='rgb(229, 231, 235) rgb(17, 17, 17)');
  const shape0=await bannerShape(alice.page);
  ok('banner has a fixed shape: title + one status line of three spans',shape0==='2|Live commenting debug|3');
  const line=await alice.page.locator('[data-testid="sync-footer"]').innerText();
  ok('status line is just identity + bot last read while nothing is pending',line.includes('Signed in: Alice')&&line.includes('Test Bot last read never')&&!line.includes('pending')&&!line.includes('nudge'));
  ok('no Sync now control while nothing is pending',await alice.page.locator('[data-testid="sync-now"]').count()===0);
  ok('no refresh control while the build is current',await alice.page.locator('[data-testid="refresh"]').count()===0);

  await comment(alice.page,'spec.lede','Alice says: tighten this lede');
  await alice.page.locator('.ca-pin').first().waitFor();
  ok('Alice sees her comment as a pin immediately',await alice.page.locator('.ca-pin').count()===1);
  await bob.page.locator('.ca-pin').first().waitFor({timeout:10000});
  ok('Bob receives it by polling without doing anything',await bob.page.locator('.ca-pin').count()===1);
  await bob.page.locator('.review-toast').first().waitFor();
  ok('Bob gets a toast naming Alice',(await bob.page.locator('.review-toast').first().innerText()).includes('Alice'));
  ok('Alice gets no toast for her own comment',await alice.page.locator('.review-toast').count()===0);
  await bob.page.locator('[data-testid="sync-now"]',{hasText:'1 pending'}).waitFor({timeout:10000});
  ok('commenting bar shows pending count with a Sync now control; banner unchanged',(await bob.page.locator('[data-testid="sync-now"]').innerText()).includes('Sync now')&&!(await bob.page.locator('.review-banner').innerText()).includes('pending')&&await bannerShape(bob.page)==='2|Live commenting debug|3');

  await bob.page.locator('.ca-pin').first().click();
  await bob.page.locator('.ca-popover').getByRole('button',{name:'Reply'}).click();
  await bob.page.locator('.ca-composer-input').fill('Bob replies');
  await bob.page.keyboard.press('Enter');
  ok('no Delete affordance in the thread',await bob.page.locator('.ca-popover').getByRole('button',{name:'Delete'}).count()===0);
  await alice.page.locator('.ca-pin').first().click();
  await alice.page.locator('.ca-comment-body',{hasText:'Bob replies'}).waitFor({timeout:10000});
  ok('Alice sees Bob\'s reply arrive live in the open popover',true);

  const threads=await anno('threads');
  const threadId=threads.out.match(/^([0-9a-f-]{36})/m)?.[1];
  ok('bot can list the thread over the socket',!!threadId&&threads.out.includes('Alice says'));
  const resolved=await anno('resolve',threadId,'Done in the next build');
  ok('bot resolves via anno.mjs',resolved.code===0);
  // Bob is told about the resolve; Jump must work even though resolved threads are filtered out.
  const resolveToast=bob.page.locator('.review-toast',{hasText:'resolved'});
  await resolveToast.waitFor({timeout:10000});
  ok('resolve toast names the bot without a "(bot)" suffix',(await resolveToast.innerText()).includes('Test Bot')&&!(await resolveToast.innerText()).includes('(bot)'));
  await resolveToast.getByRole('button',{name:'Jump'}).click();
  await bob.page.locator('.ca-popover .ca-status-resolve').waitFor({timeout:10000});
  ok('Jump on a resolved thread turns Show resolved on and opens its popover',(await bob.page.locator('button[title="Show resolved threads"]').getAttribute('aria-pressed'))==='true'&&await bob.page.locator('.ca-pin').count()===1);
  // Resolved threads are hidden by default; the popover closes as the pin goes away.
  await alice.page.locator('button[title="Show resolved threads"]').waitFor({timeout:10000});
  ok('resolving hides the pin until Show resolved',await alice.page.locator('.ca-pin').count()===0);
  await alice.page.keyboard.press('Escape'); // clear the stale open-thread selection
  await alice.page.locator('button[title="Show resolved threads"]').click();
  await alice.page.locator('.ca-pin').first().click();
  await alice.page.locator('.ca-status-resolve').waitFor({timeout:10000});
  const resolveEntry=alice.page.locator('.ca-status-resolve');
  ok('bot resolve renders as a log entry: avatar, name, time, then the status word and note',(await resolveEntry.innerText()).includes('Test Bot')&&!(await resolveEntry.innerText()).includes('(bot)')&&(await resolveEntry.locator('.ca-avatar').count())===1&&(await resolveEntry.locator('.ca-comment-time').count())===1&&(await resolveEntry.locator('.ca-status-word').innerText()).toLowerCase()==='resolved'&&(await resolveEntry.innerText()).includes('Done in the next build'));
  ok('status word is set in small caps',(await resolveEntry.locator('.ca-status-word').evaluate(el=>getComputedStyle(el).fontVariantCaps))==='all-small-caps');
  ok('resolved thread offers Reopen',await alice.page.locator('.ca-popover').getByRole('button',{name:'Reopen'}).count()===1);
  // Replying to a resolved thread reopens it: a reopen entry by the replier, then the reply, both after the resolve.
  await alice.page.locator('.ca-popover').getByRole('button',{name:'Reply'}).click();
  ok('composer on a resolved thread says it will reopen',await alice.page.locator('.ca-popover').getByRole('button',{name:'Reply & reopen'}).count()===1);
  await alice.page.locator('.ca-composer-input').fill('Alice: not fixed yet');
  await alice.page.keyboard.press('Enter');
  await alice.page.locator('.ca-comment-body',{hasText:'not fixed yet'}).waitFor();
  await alice.page.locator('.ca-popover').getByRole('button',{name:'Resolve'}).waitFor({timeout:10000});
  ok('reply on a resolved thread reopened it (Resolve offered again, tag gone)',await alice.page.locator('.ca-popover .ca-tag').count()===0);
  const kinds=await alice.page.locator('.ca-popover [data-entry-kind]').evaluateAll(els=>els.map(e=>e.getAttribute('data-entry-kind')));
  ok('thread log keeps every event in order: comment, comment, resolve, reopen, comment',kinds.join(',')==='comment,comment,resolve,reopen,comment');
  ok('reopen entry names the replier and reads "reopened"',(await alice.page.locator('.ca-status-reopen').innerText()).includes('Alice')&&(await alice.page.locator('.ca-status-reopen .ca-status-word').innerText()).toLowerCase()==='reopened');
  await bob.page.locator('.ca-popover [data-entry-kind]').nth(4).waitFor({timeout:10000});
  ok('Bob sees the same ordered log',(await bob.page.locator('.ca-popover [data-entry-kind]').evaluateAll(els=>els.map(e=>e.getAttribute('data-entry-kind')))).join(',')==='comment,comment,resolve,reopen,comment');
  // Alice's reopen and reply are user events, so 4 pending: three comments + the reopen. The bot's resolve is not counted.
  await alice.page.locator('[data-testid="sync-now"]',{hasText:'4 pending'}).waitFor({timeout:10000});
  ok('bot events did not count as pending for the bot',true);

  await alice.page.keyboard.press('Escape');
  await alice.page.locator('[data-testid="sync-now"]').click();
  await alice.page.locator('.review-toast',{hasText:'Nudged Test Bot about 4 messages'}).waitFor({timeout:10000});
  ok('Sync now posts one doorbell counting the user events only, with no comment text',sent.length===1&&/4 new messages from Alice, Bob/.test(sent[0].message)&&sent[0].message.includes('anno.mjs unread')&&!sent[0].message.includes('Alice says')&&!sent[0].message.includes('Bob replies')&&!sent[0].message.includes('Done in the next build'));
  await bob.page.locator('[data-testid="sync-now"]').waitFor({state:'detached',timeout:10000});
  ok('Sync now control leaves the bar once nudged',await bob.page.locator('[data-testid="sync-now"]').count()===0);
  const pulledNow=await anno('unread');
  await bob.page.locator('[data-testid="sync-footer"]',{hasText:'last read just now'}).waitFor({timeout:10000});
  ok('bot pull shows up as last read',pulledNow.code===0&&pulledNow.out.includes('4 unread messages'));

  // A redeploy = restart with a new BUILD_ID (the bot bumps it after rebuilding dist).
  await stopServer(); await startServer('v2');
  await bob.page.locator('[data-testid="refresh"]').waitFor({timeout:15000});
  const refreshTitle=await bob.page.locator('[data-testid="refresh"]').getAttribute('title');
  ok('a rebuild shows the red refresh control with the saved-comments tooltip',/app was updated/.test(refreshTitle??'')&&/comments are saved/.test(refreshTitle??''));
  ok('banner carries no separate refresh line — the bar control is the whole signal',await bob.page.locator('[data-testid="stale-banner"]').count()===0&&!(await bob.page.locator('.review-banner').innerText()).includes('App updated'));
  ok('refresh control is red',(await bob.page.locator('[data-testid="refresh"]').evaluate(el=>getComputedStyle(el).backgroundColor))==='rgb(220, 38, 38)');
  ok('refresh icon is at least 2x the toolbar icon size (>= 24px)',(await bob.page.locator('[data-testid="refresh"] .ca-tool-icon').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)))>=24);
  ok('comments survive the redeploy — still 1 pin on the old tab',await bob.page.locator('.ca-pin').count()===1);
  ok('banner shape unchanged after comments, nudge, pull and redeploy',await bannerShape(bob.page)===shape0&&await bannerShape(alice.page)===shape0);
  // Two pins on the page; clicking the second while the first is open must move the popover to the second.
  await alice.page.keyboard.press('Escape');
  await comment(alice.page,'spec.summary.body','Alice says: second target');
  await alice.page.locator('.ca-pin').nth(1).waitFor();
  await alice.page.locator('.ca-pin').first().click();
  await alice.page.locator('.ca-popover').waitFor();
  const pop1=await alice.page.locator('.ca-popover').boundingBox();
  await alice.page.locator('.ca-pin').nth(1).click();
  await alice.page.locator('.ca-popover',{hasText:'second target'}).waitFor();
  const pop2=await alice.page.locator('.ca-popover').boundingBox();
  const pin2=await alice.page.locator('.ca-pin').nth(1).boundingBox();
  ok('clicking another pin re-anchors the popover to it',Math.abs(pop1.y-pop2.y)>20&&Math.abs(pop2.y-pin2.y)<80);
  await alice.page.screenshot({path:`${outputDir}/shared-app.png`});
  // Departure: Bob closes; Alice should see 1 within poll+grace after Bob's last poll, plus her own next poll (≤10 s).
  const t0=Date.now();
  await bob.ctx.close();
  await alice.page.locator('[data-testid="presence"]',{hasText:/^.*1$/}).waitFor({timeout:12000});
  const gone=(Date.now()-t0)/1000;
  ok(`a closed tab leaves the viewer count within 10 s (took ${gone.toFixed(1)} s)`,gone<=10.5);
  await alice.ctx.close();
} finally {
  await browser.close();
  server.kill();fake.close();
  await rm(work,{recursive:true,force:true}).catch(()=>{});
  await writeFile(`${outputDir}/shared-app-results.json`,JSON.stringify({report,coverage:'Real browser UI, real server, real anno.mjs; fake Platform API. No real messages created.'},null,2));
  if(report.some(r=>!r.pass)) console.log(logs);
}