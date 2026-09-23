/**
 * The popover must not relocate when its own content changes height (mention
 * picker opening/closing, typing). Its top stays on the target; only `shift`
 * may nudge it up when the taller panel no longer fits above the toolbar.
 * Isolated development harness only (scripts/dev-server.mjs); no test comments
 * are sent to a shared backend.
 */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resetAndSeed} from './dev-client.mjs';
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

 ok('no browser exceptions',errors.length===0);
}finally{
 await writeFile(`${out}/popover-stability-results.json`,JSON.stringify({report,errors},null,2));
 await browser.close();
}