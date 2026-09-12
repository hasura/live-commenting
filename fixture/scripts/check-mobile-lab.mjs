import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
const base=process.env.LAB_URL ?? 'http://127.0.0.1:5188/baseline/lab.html';
const out=process.env.TEST_OUTPUT_DIR ?? 'public-lab/evidence';
await mkdir(out,{recursive:true});
const browser=await chromium.connectOverCDP(process.env.CDP_URL ?? 'http://127.0.0.1:9222');
const results=[];
const sizes=[['desktop',1440,900,false],['pane',768,900,false],['phone',390,844,true],['small',320,568,true],['landscape',844,390,true],['short',390,422,true]];
const targets={spec:'spec.intro',ui:'ui.title',deck:'deck.title.0'};
const round=o=>o&&Object.fromEntries(Object.entries(o).map(([k,v])=>[k,typeof v==='number'?Math.round(v*10)/10:v]));
async function rect(page,selector){return round(await page.locator(selector).first().boundingBox());}
async function pause(page){await page.waitForTimeout(200);}
try{
 for(const [name,width,height,touch] of sizes){
  for(const fixture of ['spec','ui','deck']){
   const context=await browser.newContext({viewport:{width,height},isMobile:touch,hasTouch:touch,deviceScaleFactor:1});
   const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
   const r={fixture,viewport:name,width,height,touch,errors};
   try{
    await page.goto(`${base}?fixture=${fixture}`,{waitUntil:'networkidle'});
    await page.screenshot({path:`${out}/${fixture}-${name}-idle.png`});
    r.idle={toolbar:await rect(page,'.ca-toolbar'),overflow:await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)};
    const mode=page.locator('button[title="Comment mode"]');await mode.click();
    const target=page.locator(`[data-anno-id="${targets[fixture]}"]`);
    await target.scrollIntoViewIfNeeded(); const box=await target.boundingBox();
    if(touch)await page.touchscreen.tap(box.x+20,box.y+20); else await page.mouse.click(box.x+20,box.y+20);
    await page.locator('.ca-composer-input').waitFor({state:'visible',timeout:3500});await pause(page);
    r.draft={target:round(box),popover:await rect(page,'.ca-popover'),textarea:await rect(page,'.ca-composer-input'),toolbar:await rect(page,'.ca-toolbar'),font:await page.locator('.ca-composer-input').evaluate(el=>getComputedStyle(el).fontSize)};
    await page.locator('.ca-composer-input').fill('Please make this clearer for a first-time visitor.');
    await page.screenshot({path:`${out}/${fixture}-${name}-draft.png`});
    await page.locator('.ca-composer .ca-btn').click({timeout:2000});
    await pause(page);
    r.posted=await page.evaluate(f=>JSON.parse(localStorage.getItem(`mobile-lab-${f}-v1`))?.threads.length,fixture);
    r.pin=await rect(page,'.ca-pin');
    await page.locator('.ca-pin').first().click({timeout:2000});await pause(page);
    r.readPanel=await rect(page,'.ca-popover');
    await page.getByRole('button',{name:'Reply',exact:true}).click({timeout:2000});
    await page.locator('.ca-composer-input').fill('Reply from the same test pass.');
    await page.getByRole('button',{name:'Reply',exact:true}).click({timeout:2000});
    r.replyCount=await page.evaluate(f=>JSON.parse(localStorage.getItem(`mobile-lab-${f}-v1`)).threads[0].comments.length,fixture);
    await page.keyboard.press('Escape');await page.keyboard.press('Escape');
    await page.locator('button[title="Show or hide all comments"]').click();
    await mode.click();await mode.click();
    r.pinsAfterExitFromHidden=await page.locator('.ca-pin').count();
    r.overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
   }catch(e){r.failure=e.message.split('\n')[0];}
   results.push(r);console.log(JSON.stringify(r));await context.close();
  }
 }
}finally{
 await writeFile(`${out}/baseline-audit.json`,JSON.stringify({revision:'f1f7349',browser:await browser.version(),device:'Chromium viewport/touch emulation; not a physical mobile device',results},null,2));
 await browser.close();
}
if(results.length!==18 || results.some(r=>r.failure || r.errors.length || r.posted!==1 || r.replyCount!==2)) process.exitCode=1;
