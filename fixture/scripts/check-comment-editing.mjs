/** Editing gestures through the real host and isolated SQLite dev harness. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';
import {resetAndSeed,readDoc} from './dev-client.mjs';
const out=process.env.TEST_OUTPUT_DIR??'test-output/comment-editing';
await mkdir(out,{recursive:true});
const browser=await launchBrowser(),report=[],errors=[];
let lastPage;
const ok=(name,pass)=>{console.log(pass?'PASS':'FAIL',name);report.push({name,pass:!!pass});assert.ok(pass,name);};
const comment=(id,value)=>({id,author:{id:'qa',name:'QA'},createdAt:'2026-10-06T00:00:00Z',body:[{kind:'text',value}]});
const threads=[{id:'qa-edit-thread-one',status:'open',refs:[{kind:'anno_id',id:'spec.title',label:'Title'}],comments:[comment('qa-edit-opening','Original opening'),comment('qa-edit-reply','Original reply')]},
 {id:'qa-edit-thread-two',status:'open',refs:[{kind:'anno_id',id:'spec.goals.g1',label:'Goal'}],comments:[comment('qa-edit-other','Other discussion')]}];
try{
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:{width:mobile?393:1200,height:852},...(mobile?{hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'}:{})});
  const page=await context.newPage(),label=mobile?'mobile':'desktop';lastPage=page;page.on('pageerror',e=>errors.push(e.message));
  await resetAndSeed(page,threads);await page.getByTestId('toggle-comments').click();
  const panel=page.locator('.ca-comments-panel'),card=panel.locator('[data-thread-id="qa-edit-thread-one"]');
  const opening=card.locator('[data-event-id="qa-edit-opening"]'),reply=card.locator('[data-event-id="qa-edit-reply"]');
  const input=()=>page.locator('.ca-composer-input:visible');
  const edit=async entry=>{await entry.getByRole('button',{name:'Edit comment',exact:true}).click();await input().waitFor();};
  const save=async()=>{await page.getByRole('button',{name:'Save changes',exact:true}).click();await input().waitFor({state:'detached'});};
  const body=entry=>entry.locator(':scope > .ca-comment-body');
  const logLength=async()=> (await readDoc(page)).threads.find(t=>t.id===threads[0].id).log.length;
  const original=await readDoc(page),initialTime=await opening.locator('.ca-comment-time').getAttribute('datetime');
  await edit(opening);
  ok(`${label}: edit preloads text and current unchecked intent`,await input().innerText()==='Original opening'&&!await opening.locator('.ca-direct input').isChecked());
  ok(`${label}: no-op and empty edits cannot save`,await page.getByRole('button',{name:'Save changes',exact:true}).isDisabled());
  await input().fill('');ok(`${label}: empty body is disabled`,await page.getByRole('button',{name:'Save changes',exact:true}).isDisabled());
  await input().fill('Abandon this edit');await edit(reply);
  ok(`${label}: another edit discards unsaved text and uses one editor`,await input().count()===1&&await input().innerText()==='Original reply'&&await body(opening).innerText()==='Original opening');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  ok(`${label}: abandoning edits never writes history`,JSON.stringify(await readDoc(page))===JSON.stringify(original));

  await edit(opening);await input().fill('Saved correction');
  const mode=page.getByRole('button',{name:'Comment mode',exact:true}),eye=page.getByTestId('toggle-markers');
  await input().evaluate(e=>window.savedEdit=e);await mode.click();await eye.click();await mode.click();await eye.click();
  ok(`${label}: mode and visibility preserve the active edit`,await input().evaluate(e=>e===window.savedEdit&&e.textContent==='Saved correction'));
  let release;
  await page.route('**/api/event',async route=>{await new Promise(resolve=>release=resolve);await route.continue();});
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await page.getByRole('button',{name:'Saving…',exact:true}).waitFor();
  ok(`${label}: pending save protects editor and navigation`,await mode.isDisabled()&&await eye.isDisabled()&&await page.getByTestId('toggle-comments').isDisabled()&&await reply.getByRole('button',{name:'Edit comment',exact:true}).isDisabled());
  await input().press('Escape');ok(`${label}: pending Escape does not discard edit`,await input().count()===1);
  while(!release)await new Promise(resolve=>setTimeout(resolve,10));release();await input().waitFor({state:'detached'});await page.unroute('**/api/event');
  let doc=await readDoc(page),thread=doc.threads.find(t=>t.id===threads[0].id);
  ok(`${label}: save changes wording without adding or moving comments`,thread.comments.length===2&&thread.comments[0].id==='qa-edit-opening'&&thread.comments[1].id==='qa-edit-reply'
    &&thread.log.length===3&&thread.log[0].body[0].value==='Original opening'&&thread.log[2].kind==='edit'&&thread.log[2].commentId==='qa-edit-opening');
  ok(`${label}: creation time and selection remain unchanged`,await opening.locator('.ca-comment-time').getAttribute('datetime')===initialTime&&JSON.stringify(thread.refs)===JSON.stringify(original.threads[0].refs));

  await edit(opening);await input().fill('Keep me after failure');
  const beforeFailure=await logLength();
  await page.route('**/api/event',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"Test save unavailable"}'}));
  await page.getByRole('button',{name:'Save changes',exact:true}).click();await opening.getByRole('alert').waitFor();
  ok(`${label}: failed save keeps text and history unchanged`,await input().innerText()==='Keep me after failure'&&await logLength()===beforeFailure);
  await page.unroute('**/api/event');await page.getByRole('button',{name:'Cancel',exact:true}).click();
  ok(`${label}: Cancel restores latest saved body`,await body(opening).innerText()==='Saved correction');
  await edit(opening);await input().fill('Discard for a reply');await card.getByRole('button',{name:'Reply',exact:true}).click();
  ok(`${label}: reply replaces edit with blank composer`,await input().count()===1&&(await input().innerText()).trim()===''&&await body(opening).innerText()==='Saved correction');
  await edit(opening);ok(`${label}: edit replaces reply and reloads saved wording`,await input().innerText()==='Saved correction'&&await input().count()===1);
  await opening.locator('.ca-direct input').check();await save();
  await edit(opening);ok(`${label}: editing defaults to last saved checked choice`,await opening.locator('.ca-direct input').isChecked());
  await opening.locator('.ca-direct input').uncheck();await save();
  await edit(opening);ok(`${label}: checkbox-only correction changes the next edit default`,!await opening.locator('.ca-direct input').isChecked());
  await input().fill('@promptql');await page.getByRole('option').first().click();await input().press('End');await input().type(' corrected request');
  ok(`${label}: inline bot mention keeps checkbox checked and locked`,await opening.locator('.ca-direct input').isChecked()&&await opening.locator('.ca-direct input').isDisabled());
  await save();await edit(opening);
  ok(`${label}: inline mention retains its behavior when editing again`,await opening.locator('.ca-direct input').isChecked()&&await opening.locator('.ca-direct input').isDisabled());
  await input().fill('Final quiet correction');await opening.locator('.ca-direct input').uncheck();await save();
  await card.getByRole('button',{name:'Resolve',exact:true}).click();await card.locator('.ca-thread-head .ca-tag').waitFor();
  await edit(opening);await input().fill('Corrected after completion');await save();
  thread=(await readDoc(page)).threads.find(t=>t.id===threads[0].id);
  ok(`${label}: editing a resolved thread never reopens it`,thread.status==='resolved'&&thread.log.at(-1).kind==='edit'&&!thread.log.some(e=>e.kind==='reopen'));
  await edit(opening);await input().fill('Discard when filtered away');
  await panel.getByRole('button',{name:'Open discussions',exact:true}).click();
  await panel.getByRole('button',{name:'All discussions',exact:true}).click();
  ok(`${label}: filtering away discards edit instead of retaining a hidden draft`,await input().count()===0&&await body(opening).innerText()==='Corrected after completion');
  await edit(opening);await input().fill('Keyboard edit');
  if(mobile){
   const beforeEnter=await logLength();await input().press('Enter');
   ok('mobile: Enter adds a newline without saving',await input().count()===1&&await logLength()===beforeEnter);
   await page.getByRole('button',{name:'Cancel',exact:true}).click();
  }else{
   await input().press('Enter');await input().waitFor({state:'detached'});
   ok('desktop: Enter saves the edit',await body(opening).innerText()==='Keyboard edit');
  }
  await opening.locator('.ca-edit-history > summary').click();
  ok(`${label}: Edited reveals the original and saved corrections`,await opening.locator('.ca-revision').count()>=6&&(await opening.locator('.ca-revision').first().innerText()).includes('Original opening'));
  ok(`${label}: history and editor fit the discussion surface`,await panel.evaluate(e=>e.scrollWidth<=e.clientWidth&&e.getBoundingClientRect().right<=innerWidth));
  await page.screenshot({path:`${out}/${label}-history.png`});
  await opening.locator('.ca-edit-history > summary').click();await edit(opening);
  await page.screenshot({path:`${out}/${label}-editor.png`});
  await input().press('Escape');ok(`${label}: Escape closes popup and discards edit`,!await panel.isVisible()&&await input().count()===0);
  await page.getByTestId('toggle-comments').click();ok(`${label}: reopening has no retained edit`,await input().count()===0);
  await context.close();
 }
 ok('No browser exceptions',errors.length===0);
}catch(error){if(lastPage&&!lastPage.isClosed())await lastPage.screenshot({path:`${out}/failure.png`});throw error;}
finally{await writeFile(`${out}/results.json`,JSON.stringify({report,errors},null,2));await browser.close();}
