import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.LAB_URL??'http://127.0.0.1:5188/candidate/lab.html';
const out=process.env.TEST_OUTPUT_DIR??'public-lab/evidence/candidate';
await mkdir(out,{recursive:true});
const browser=await chromium.connectOverCDP(process.env.CDP_URL??'http://127.0.0.1:9222');
const results=[];
const targets={spec:'spec.intro',ui:'ui.title',deck:'deck.title.0'};
const sizes=[['desktop',1440,900,false],['pane',768,900,false],['phone',390,844,true],['small',320,568,true],['landscape',844,390,true],['short',390,422,true]];
const settle=page=>page.waitForTimeout(250);
try{
 for(const [name,width,height,touch] of sizes)for(const fixture of ['spec','ui','deck']){
  const context=await browser.newContext({viewport:{width,height},isMobile:touch,hasTouch:touch,deviceScaleFactor:1});
  const page=await context.newPage();const r={fixture,viewport:name,checks:[],errors:[]};
  page.on('pageerror',e=>r.errors.push(e.message));
  const check=(s,b)=>{r.checks.push({name:s,pass:!!b});assert.ok(b,s);};
  const key=`mobile-lab-${fixture}-candidate-v1`;
  try{
   await page.goto(`${base}?fixture=${fixture}`,{waitUntil:'networkidle'});
   await settle(page);
   const bar=await page.locator('.ca-toolbar').boundingBox();
   r.toolbar=bar;
   check('header fits one 44px row',bar.x===0&&bar.y===0&&Math.abs(bar.width-(await page.evaluate(()=>visualViewport.width)))<1&&bar.height<=46);
   const target=page.locator(`[data-anno-id="${targets[fixture]}"]`);
   await page.locator('button[title="Comment mode"]').click();
   await target.scrollIntoViewIfNeeded();await settle(page);
   const box=await target.boundingBox();
   if(touch)await page.touchscreen.tap(box.x+20,box.y+20);
   else await page.mouse.click(box.x+20,box.y+20);
   const input=page.locator('.ca-composer-input');
   await input.waitFor({state:'visible'});await input.fill('Please clarify this for a new reviewer.');
   await settle(page);
   const panel=await page.locator('.ca-popover').boundingBox();
   r.panel=panel;r.target=await target.boundingBox();
   const compact=width<=700||height<=480;
   check('surface matches responsive mode',await page.locator('.ca-footer').count()===(compact?1:0));
   check('surface stays below header and inside viewport',panel.y>=bar.height&&panel.y+panel.height<=height+1);
   if(compact){
    check('footer spans viewport',panel.x===0&&Math.abs(panel.width-width)<1);
    check('footer reaches bottom',Math.abs(panel.y+panel.height-height)<1);
    check('selected target has visible context',r.target.y<panel.y-10&&r.target.y+r.target.height>bar.height);
   }
   await page.screenshot({path:`${out}/${fixture}-${name}-draft.png`});
   await page.keyboard.press('Escape');await settle(page);
   check('Escape minimizes rather than deletes',!(await input.isVisible())&&await page.getByRole('button',{name:/Resume draft/}).count()===1);
   await page.getByRole('button',{name:/Resume draft/}).click();
   check('draft retained on resume',await input.inputValue()==='Please clarify this for a new reviewer.');
   await input.waitFor({state:'visible'}); await settle(page);
   check('resume focuses editor',await input.evaluate(el=>document.activeElement===el));
   await input.press('Enter');await settle(page);
   check('comment stored',await page.evaluate(k=>JSON.parse(localStorage.getItem(k)).threads.length,key)===1);
   await page.locator('.ca-pin').first().click();await settle(page);
   await page.getByRole('button',{name:'Reply',exact:true}).click();
   await input.fill('Reply draft that should survive.');
   await page.keyboard.press('Escape');
   await page.getByRole('button',{name:/Resume draft/}).click();
   check('reply retained on resume',await input.inputValue()==='Reply draft that should survive.');
   await page.getByRole('button',{name:'Reply',exact:true}).click();
   check('reply stored',await page.evaluate(k=>JSON.parse(localStorage.getItem(k)).threads[0].comments.length,key)===2);
   await page.keyboard.press('Escape');
   await page.locator('.ca-pin').first().click();await settle(page);
   check('one pin click reopens minimized discussion',await page.locator('.ca-popover').isVisible());
   await page.keyboard.press('Escape');
   await page.locator('button[title="Comment mode"]').click();
   await page.locator('button[title="Show or hide all comments"]').click();
   await page.locator('button[title="Comment mode"]').click();
   await page.locator('button[title="Comment mode"]').click();
   check('comments stay visible after mode exit',await page.locator('.ca-pin').count()===1);
   check('no page horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   check('no JS exceptions',r.errors.length===0);
  }catch(e){r.failure=e.message.split('\n')[0];await page.screenshot({path:`${out}/${fixture}-${name}-failure.png`});}
  console.log(JSON.stringify(r));results.push(r);await context.close();
 }
}finally{
 await writeFile(`${out}/responsive-results.json`,JSON.stringify({results,browser:await browser.version(),emulationOnly:true},null,2));
 await browser.close();
}
if(results.length!==18||results.some(r=>r.failure))process.exitCode=1;
