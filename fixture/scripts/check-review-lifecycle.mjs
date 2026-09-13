import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
const browser=await chromium.connectOverCDP('http://127.0.0.1:9222');
const results=[];await mkdir('public-lab/evidence/candidate',{recursive:true});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const page=await context.newPage();
const ok=(name,pass)=>{results.push({name,pass:!!pass});console.log(pass?'PASS':'FAIL',name);assert.ok(pass,name);};
const wait=()=>page.waitForTimeout(300);
const key='mobile-lab-ui-candidate-v1';
const input=page.locator('.ca-composer-input');
try{
 await page.goto('http://127.0.0.1:5188/candidate/lab.html?fixture=ui',{waitUntil:'networkidle'});
 await page.getByTitle('Comment mode',{exact:true}).click();
 await page.locator('[data-anno-id="ui.invite"]').tap();
 await input.fill('Do not lose this on an outside tap.');
 ok('commenting on button suppresses real action',await page.getByTestId('invite-clicks').innerText()==='0');
 // A blank left edge is outside the panel/toolbar and all targets.
 await page.touchscreen.tap(2,250);await wait();
 ok('outside tap minimizes',!(await input.isVisible()));
 await page.getByRole('button',{name:/Resume draft/}).click();await wait();
 ok('outside tap retains exact draft',await input.inputValue()==='Do not lose this on an outside tap.');
 await page.setViewportSize({width:1440,height:900});await wait();
 ok('desktop resize retains text and uses popover',await input.inputValue()==='Do not lose this on an outside tap.'&&await page.locator('.ca-footer').count()===0);
 await page.setViewportSize({width:390,height:422});await wait();
 ok('short view restores footer with same text',await input.inputValue()==='Do not lose this on an outside tap.'&&await page.locator('.ca-footer').count()===1);
 // Model visualViewport keyboard geometry separately; this is NOT a real OS keyboard.
 await page.evaluate(()=>{
  const vv=window.visualViewport;
  window.__originalVV={};
  for(const [k,v] of Object.entries({height:280,offsetTop:15})){
    Object.defineProperty(vv,k,{configurable:true,get:()=>v});
  }
  vv.dispatchEvent(new Event('resize'));
 });await wait();
 const panel=await page.locator('.ca-footer').boundingBox();
 const header=await page.locator('.ca-toolbar').boundingBox();
 ok('simulated visual viewport keeps footer above keyboard',Math.abs(panel.y+panel.height-295)<1&&panel.y>=header.y+header.height);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await wait();
 ok('Cancel removes editor and draft notice',await input.count()===0&&await page.getByRole('button',{name:/Resume draft/}).count()===0);
 await page.reload();await page.setViewportSize({width:390,height:844});
 await page.getByTitle('Comment mode',{exact:true}).click();
 await page.locator('[data-anno-id="ui.title"]').tap();await input.fill('Stored review');
 await page.locator('.ca-composer .ca-btn').click();await wait();
 await page.locator('[data-anno-id="ui.invite"]').tap();await input.fill('Unposted second review');
 await page.keyboard.press('Escape');await wait();
 ok('minimized unposted editor blocks Send',await page.locator('.ca-send').isDisabled());
 await page.getByRole('button',{name:/Resume draft/}).click();await wait();
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByText('Test controls',{exact:true}).click();
 await page.getByRole('checkbox').check();
 await page.locator('.ca-send').click();
 ok('busy disables repeated send',await page.locator('.ca-send').isDisabled());
 await page.waitForTimeout(850);
 ok('failure exposes retry, preserves review',await page.locator('.ca-send').innerText()==='Retry send\n1'&&await page.evaluate(k=>JSON.parse(localStorage.getItem(k)).rounds?.length??0,key)===0);
 await page.getByRole('checkbox').uncheck();
 await page.locator('.ca-send').click();await page.waitForTimeout(850);
 ok('success says Sent and disables repeat',await page.locator('.ca-send').innerText()==='Sent'&&await page.locator('.ca-send').isDisabled());
 ok('success locks exactly one simulated round',await page.evaluate(k=>JSON.parse(localStorage.getItem(k)).rounds.length,key)===1);
 // Reach final content: footer reserved padding not a permanently obscured region.
 await page.getByTitle('Comment mode',{exact:true}).click();
 await page.locator('[data-anno-id="ui.save"]').scrollIntoViewIfNeeded();
 await page.locator('[data-anno-id="ui.save"]').tap();await input.fill('Bottom target');
 await wait(); const save=await page.locator('[data-anno-id="ui.save"]').boundingBox(),footer=await page.locator('.ca-footer').boundingBox();
 ok('last target reachable above footer',save.y>=45&&save.y+save.height<=footer.y+1);
 await page.screenshot({path:'public-lab/evidence/candidate/ui-bottom-target.png'});
}finally{
 await writeFile('public-lab/evidence/candidate/lifecycle-results.json',JSON.stringify(results,null,2));
 await context.close();await browser.close();
}
