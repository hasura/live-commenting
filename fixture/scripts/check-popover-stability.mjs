/**
 * The popover must not relocate when its own content changes height (mention
 * picker opening/closing, typing). Its top stays on the target; only `shift`
 * may nudge it up when the taller panel no longer fits above the toolbar.
 * Nor when the host rerenders under it: a replaced or removed target must not
 * pull the draft to the viewport origin.
 * Isolated development harness only (scripts/dev-server.mjs); no test comments
 * are sent to a shared backend.
 */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {readDoc,resetAndSeed} from './dev-client.mjs';
import {launchBrowser} from './browser.mjs';

const out=process.env.TEST_OUTPUT_DIR??'test-output';await mkdir(out,{recursive:true});
const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1200,height:700}}),errors=[],report=[];
page.on('pageerror',e=>errors.push(e.message));
const ok=(name,value)=>{report.push({name,pass:!!value});console.log(value?'PASS':'FAIL',name);assert.ok(value,name);};
const popover=page.locator('.ca-popover'),input=page.locator('.ca-composer-input'),picker=page.locator('.ca-mention-picker');
const box=async()=>{const b=await popover.boundingBox();return {x:Math.round(b.x),y:Math.round(b.y),h:Math.round(b.height)};};
let id='spec.open.q1';
const target=()=>page.locator(`[data-anno-id="${id}"]`);
// Expected geometry of a `right-start` panel with shift: top on the target,
// clamped so the panel stays 8px from the top and above the toolbar.
const expected=async(h)=>{
  const tt=(await target().boundingBox()).y,toolbar=(await page.locator('.ca-toolbar').boundingBox()).height,H=page.viewportSize().height;
  return Math.round(Math.max(8,Math.min(tt,H-toolbar-10-h)));
};
const inPlace=async(opened)=>{const b=await box();const y=await expected(b.h);const pass=b.x===opened.x&&Math.abs(b.y-y)<=2;
  if(!pass)console.log('  got',JSON.stringify(b),'expected y',y);return pass;};

try{
 await resetAndSeed(page,[]);
 // Two placements: target mid-viewport (the panel fits) and near the bottom
 // (a taller panel no longer fits below the target, which is exactly when a
 // fallback placement used to throw the panel to the top-left corner).
 for(const [height,block,anchor] of [[900,'center','spec.goals.g1'],[900,'end','spec.open.q1'],[700,'end','spec.open.q1']]){
  id=anchor;
  const label=`${height}px/${block}/${anchor}`;
  await page.setViewportSize({width:1200,height});
  await target().evaluate((el,block)=>el.scrollIntoView({block}),block);
  await page.getByRole('button',{name:'Comment mode',exact:true}).click();
  await target().click();
  await input.waitFor();await page.waitForTimeout(150);
  const opened=await box();
  console.log(`  ${label} opened`,JSON.stringify(opened),'target top',Math.round((await target().boundingBox()).y));
  ok(`${label}: draft opens beside the target`,await inPlace(opened));

  await input.type('@');await picker.waitFor();await page.waitForTimeout(200);
  ok(`${label}: opening the mention picker grows the popover in place`,(await box()).h>opened.h&&await inPlace(opened));

  await input.type('a');await page.waitForTimeout(150);
  ok(`${label}: filtering the picker keeps the popover in place`,await inPlace(opened));

  await input.press('Backspace');await page.waitForTimeout(150);
  ok(`${label}: Backspace inside the query keeps the popover in place`,await picker.count()===1&&await inPlace(opened));

  await input.press('Escape');await page.waitForTimeout(200);
  ok(`${label}: Escape closes the picker only`,await picker.count()===0&&await input.count()===1);
  const closed=await box();
  ok(`${label}: popover returns to its opening size and position`,closed.x===opened.x&&closed.y===opened.y&&Math.abs(closed.h-opened.h)<=1);

  await input.press('Backspace');await input.type('@');await picker.waitFor();await page.waitForTimeout(150);
  await input.press('Escape');await page.waitForTimeout(150);
  const again=await box();
  ok(`${label}: @ then Escape directly keeps the draft in place`,await input.count()===1&&again.x===opened.x&&again.y===opened.y);

  await input.press('Escape');await popover.waitFor({state:'detached'});
  ok(`${label}: second Escape cancels the draft`,await popover.count()===0);
  await page.keyboard.press('Escape'); // leave comment mode
  await page.waitForTimeout(100);
 }

 // A reply composer inside an existing discussion uses the same popover.
 id='spec.open.q1';
 await resetAndSeed(page,[{id:'qa-thread-stable',status:'open',refs:[{kind:'anno_id',id,label:'Open question'}],
  comments:[{id:'qa-thread-stable-c0',author:{id:'stability-qa',name:'Stability QA'},createdAt:'2026-09-24T00:00:00Z',body:[{kind:'text',value:'Does this stay put?'}]}]}]);
 await page.setViewportSize({width:1200,height:700});
 await target().evaluate(el=>el.scrollIntoView({block:'end'}));
 await page.locator(`.ca-pin[data-ca-targets~="${id}"]`).click();
 await page.locator('.ca-popover .ca-thread').waitFor();
 await page.locator('.ca-popover').getByRole('button',{name:'Reply',exact:true}).click();
 await input.waitFor();await page.waitForTimeout(150);
 const replyOpened=await box();
 await input.type('@');await picker.waitFor();await page.waitForTimeout(200);
 ok('reply: mention picker keeps the discussion popover in place',await inPlace(replyOpened));
 await input.press('Escape');await page.waitForTimeout(150);
 const replyClosed=await box();
 ok('reply: Escape closes the picker and the popover stays put',await picker.count()===0&&replyClosed.x===replyOpened.x&&replyClosed.y===replyOpened.y);

 // ---- Host rerenders while a draft is open ---------------------------------
 // A host may recreate its nodes under the same ids (an app re-rendering
 // `dangerouslySetInnerHTML` on every poll, say). The draft must read the
 // element that is in the document now, not the one it opened on — a detached
 // node measures 0×0 at the viewport origin and used to pull the popover there.
 await resetAndSeed(page,[]);
 await page.setViewportSize({width:1200,height:700});
 const openDraftOn=async(anchor,block='center')=>{
  id=anchor;
  await target().evaluate((el,block)=>el.scrollIntoView({block}),block);
  await page.getByRole('button',{name:'Comment mode',exact:true}).click();
  await target().click();await input.waitFor();await page.waitForTimeout(150);
  return box();
 };
 const cancelDraft=async()=>{await input.press('Escape');await popover.waitFor({state:'detached'});await page.keyboard.press('Escape');await page.waitForTimeout(100);};
 const anchored=()=>page.locator('.ca-thread-draft').getAttribute('data-ca-draft-anchored');
 // Like inPlace, for a target top recorded before the element left the page.
 const heldInPlace=async(opened,top)=>{const b=await box();const toolbar=(await page.locator('.ca-toolbar').boundingBox()).height,H=page.viewportSize().height;
  const y=Math.round(Math.max(8,Math.min(top,H-toolbar-10-b.h)));const pass=b.x===opened.x&&Math.abs(b.y-y)<=2;
  if(!pass)console.log('  got',JSON.stringify(b),'expected y',y);return pass;};

 // 1. Same-id replacement, then the mention picker.
 let opened=await openDraftOn('spec.goals.g1');
 await target().evaluate(el=>el.replaceWith(el.cloneNode(true)));
 await page.waitForTimeout(250);
 ok('replaced node: the draft stays anchored to the new element',await anchored()==='true'&&await inPlace(opened));
 await input.type('@');await picker.waitFor();await page.waitForTimeout(200);
 ok('replaced node: opening the mention picker keeps the popover on the target',await inPlace(opened));
 await input.press('Escape');await page.waitForTimeout(150);
 ok('replaced node: Escape keeps the popover on the target',await picker.count()===0&&await inPlace(opened));

 // 2. Widen walks up from the live element.
 await page.locator('.ca-widen').click();await page.waitForTimeout(250);
 id='spec.goals';
 const widened=await box();
 ok('replaced node: Widen moves the draft to the enclosing section',(await page.locator('.ca-thread-draft .ca-thread-label').innerText()).trim()==='Goals'&&await inPlace(widened));
 await cancelDraft();

 // 3. Target removed: keep the draft and its text, say so, re-anchor when it returns.
 opened=await openDraftOn('spec.goals.g2');
 const g2Top=Math.round((await target().boundingBox()).y);
 await input.type('held across a rerender');
 await target().evaluate(el=>{window.__annoRemoved={el,parent:el.parentElement,next:el.nextSibling};el.remove();});
 await page.waitForTimeout(250);
 ok('removed target: the draft stays open where it was',await input.count()===1&&await anchored()==='false'&&await heldInPlace(opened,g2Top));
 ok('removed target: the heading says unanchored and the text is kept',
  await page.locator('.ca-thread-draft .ca-tag-unanchored').count()===1&&await page.locator('.ca-draft-unanchored').count()===1&&(await input.innerText()).includes('held across a rerender'));
 await input.type(' @');await picker.waitFor();await page.waitForTimeout(200); // a mention starts after whitespace
 ok('removed target: the mention picker does not move the popover',await heldInPlace(opened,g2Top));
 await input.press('Escape');await page.waitForTimeout(150);
 await page.evaluate(()=>{const r=window.__annoRemoved;r.parent.insertBefore(r.el,r.next);});
 await page.waitForTimeout(250);
 ok('restored target: the draft re-anchors',await anchored()==='true'&&await page.locator('.ca-thread-draft .ca-tag-unanchored').count()===0&&await inPlace(opened));
 await cancelDraft();

 // 4. Posting after a replacement files an ordinary anchored thread.
 opened=await openDraftOn('spec.goals.g3');
 await target().evaluate(el=>el.replaceWith(el.cloneNode(true)));
 await page.waitForTimeout(250);
 await input.type('survives the rerender');
 await page.locator('.ca-popover .ca-btn').click();
 await page.locator('.ca-popover .ca-thread:not(.ca-thread-draft)').waitFor();
 const doc=await readDoc(page);
 ok('replaced node: posting files an anchored thread on the same id',
  doc.threads.some(t=>t.refs[0]?.id==='spec.goals.g3')&&await page.locator('.ca-pin[data-ca-targets~="spec.goals.g3"]').count()===1);
 await page.keyboard.press('Escape');await popover.waitFor({state:'detached'});await page.keyboard.press('Escape');await page.waitForTimeout(100);

 // 5. Polls that bring nothing new leave the draft where it is.
 opened=await openDraftOn('spec.goals.g4');
 await input.type('waiting');
 await page.waitForTimeout(2500); // dev POLL_MS is 1000
 ok('empty polls: the draft stays put',await input.count()===1&&await inPlace(opened)&&(await input.innerText()).includes('waiting'));
 await cancelDraft();

 ok('no browser exceptions',errors.length===0);
}finally{
 await writeFile(`${out}/popover-stability-results.json`,JSON.stringify({report,errors},null,2));
 await browser.close();
}