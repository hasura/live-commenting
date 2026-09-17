/**
 * Compact layout = viewport width < 480 CSS px (including desktop devices). Isolated localStorage fixture only;
 * no test comments are sent to the shared review backend.
 */
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';

const out=process.env.TEST_OUTPUT_DIR??'test-output';
await mkdir(out,{recursive:true});
const browser=await launchBrowser();
const context=await browser.newContext({viewport:{width:1400,height:950},hasTouch:true});
const page=await context.newPage();
const report=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
const ok=(name,pass)=>{report.push({name,pass:!!pass});console.log(pass?'PASS':'FAIL',name);assert.ok(pass,name);};
const author={id:'mobile-qa',name:'Review QA'};
const thread=(id,target,label,count=2,status='open')=>({id,status,refs:[{kind:'anno_id',id:target,label}],
  comments:Array.from({length:count},(_,i)=>({id:`${id}-c${i}`,author,createdAt:'2026-09-17T12:00:00Z',
    body:[{kind:'text',value:`Comment ${i+1}: testing scrollable comment history and the bottom-anchored popup.`}]}))});
const single=thread('single','spec.title','Spec title');
const multi=[single,thread('other','spec.title','Spec title',5)];
const missing=thread('missing','qa.missing','Missing annotation',8);
const missingResolved=thread('missing-resolved','qa.missing-resolved','Missing, resolved annotation',4,'resolved');
const seed=async threads=>{
  await page.goto('http://localhost:5180/',{waitUntil:'networkidle'});
  await page.evaluate(threads=>localStorage.setItem('annotation-fixture-doc',JSON.stringify({version:1,threads})),threads);
  await page.reload({waitUntil:'networkidle'});
};
const pin=()=>page.locator('.ca-pin[data-ca-targets~="spec.title"]').first();
const openBubble=async()=>{
  await pin().click();
  await page.locator('.ca-popover .ca-thread').first().waitFor();
  await page.waitForTimeout(120);
};
const closePopup=async(panel)=>{
  const close=panel.locator('.ca-close').first();
  await close.click();
  await panel.waitFor({state:'detached'});
  await page.locator('.ca-toolbar').waitFor({state:'visible'});
};
const sheet=async(panel,label)=>{
  await page.waitForTimeout(120);
  const {width,height}=page.viewportSize(), box=await panel.boundingBox();
  ok(`${label}: bottom-fixed, full-width with 2px edges`,box&&Math.abs(box.x-2)<1&&
    Math.abs(box.width-(width-4))<1&&Math.abs(box.y+box.height-(height-2))<1&&
    await panel.evaluate(el=>getComputedStyle(el).position)==='fixed');
  ok(`${label}: maximum 80% viewport height`,box.height<=height*.8+1&&box.y>=0);
  ok(`${label}: toolbar hidden from view and keyboard`,await page.locator('.ca-toolbar').isHidden()&&
    await page.locator('.ca-toolbar').evaluate(el=>getComputedStyle(el).display==='none'));
  ok(`${label}: no horizontal overflow`,await panel.evaluate(el=>el.scrollWidth<=el.clientWidth));
};
const desktopMetrics=async()=>{
  const results=[];
  for(const width of [480,768,1400]){
    await page.setViewportSize({width,height:950});
    await seed([single,missing]);
    await openBubble();
    results.push(await page.locator('.ca-popover').evaluate(el=>{
      const r=el.getBoundingClientRect(),s=getComputedStyle(el);
      return {kind:'bubble',x:r.x,y:r.y,width:r.width,height:r.height,radius:s.borderRadius,color:s.backgroundColor,position:s.position};
    }));
    await closePopup(page.locator('.ca-popover'));
    await page.locator('[data-testid="unanchored"]').click();
    await page.waitForTimeout(120);
    results.push(await page.locator('.ca-tray').evaluate(el=>{
      const r=el.getBoundingClientRect(),s=getComputedStyle(el);
      return {kind:'unanchored',x:r.x,y:r.y,width:r.width,height:r.height,radius:s.borderRadius,color:s.backgroundColor,position:s.position};
    }));
    ok(`${width}px: desktop toolbar remains visible with a popup`,await page.locator('.ca-toolbar').isVisible());
  }
  return results;
};
try {
  if(process.argv.includes('--record-desktop')){
    await writeFile(`${out}/mobile-desktop-before.json`,JSON.stringify(await desktopMetrics(),null,2));
    console.log('Recorded desktop baseline before mobile changes.');
  } else {
    const actual=await desktopMetrics();
    const baselinePath=process.env.DESKTOP_BASELINE;
    if (baselinePath) {
      const expected=JSON.parse(await readFile(baselinePath,'utf8'));
      ok('480px and wider desktop popup geometry/styling unchanged',JSON.stringify(actual)===JSON.stringify(expected));
    }
    for (const width of [320,375,479]) {
      await page.setViewportSize({width,height:812});
      await seed([single]);
      ok(`${width}px: toolbar visible without popup`,await page.locator('.ca-toolbar').isVisible());
      await page.locator('[data-testid="unanchored"]').click();
      ok(`${width}px: empty unanchored toggle does not hide toolbar`,await page.locator('.ca-tray').count()===0&&await page.locator('.ca-toolbar').isVisible());
      await openBubble();
      await sheet(page.locator('.ca-popover'),`${width}px single thread`);
      await closePopup(page.locator('.ca-popover'));
      ok(`${width}px: closing single restores toolbar`,await page.locator('.ca-toolbar').isVisible());
      await seed(multi);
      await openBubble();
      await sheet(page.locator('.ca-popover'),`${width}px grouped threads`);
      await page.locator('[data-thread-id="other"]').getByRole('button',{name:'Reply',exact:true}).click();
      await page.locator('.ca-composer-input').fill('Unsent reply survives resizing.');
      await sheet(page.locator('.ca-popover'),`${width}px reply composer`);
      await page.setViewportSize({width,height:430}); // reduced viewport geometry only, not an actual keyboard
      await sheet(page.locator('.ca-popover'),`${width}px reduced-height reply`);
      ok(`${width}px: reply preserved through height change`,await page.locator('.ca-composer-input').inputValue()==='Unsent reply survives resizing.');
      await page.setViewportSize({width:480,height:812});
      await page.waitForTimeout(150);
      ok(`${width}px → 480px: toolbar returns without dismissing reply`,await page.locator('.ca-toolbar').isVisible()&&
        await page.locator('.ca-composer-input').inputValue()==='Unsent reply survives resizing.');
      await page.setViewportSize({width,height:812});
      await sheet(page.locator('.ca-popover'),`${width}px restored mobile reply`);
      await page.locator('.ca-composer').getByRole('button',{name:'Cancel',exact:true}).click();
      ok(`${width}px: cancelling reply keeps parent popup and hides toolbar`,await page.locator('.ca-composer-input').count()===0&&await page.locator('.ca-popover').isVisible()&&await page.locator('.ca-toolbar').isHidden());
      await closePopup(page.locator('.ca-popover'));

      const viewportTarget='doc.header.version';
      await seed([thread('sticky',viewportTarget,'Version')]);
      await page.locator(`.ca-pin[data-ca-targets~="${viewportTarget}"]`).click();
      await page.locator('.ca-popover .ca-thread').waitFor();
      await sheet(page.locator('.ca-popover'),`${width}px viewport-layer bubble`);
      await closePopup(page.locator('.ca-popover'));

      await seed([single,missing,missingResolved]);
      await page.locator('[data-testid="toggle-resolved"]').click();
      await page.locator('[data-testid="unanchored"]').click();
      await sheet(page.locator('.ca-tray'),`${width}px unanchored group`);
      ok(`${width}px: long history scrolls inside the popup`,await page.locator('.ca-tray').evaluate(el=>{
        el.scrollTop=el.scrollHeight;return el.scrollHeight>el.clientHeight&&el.scrollTop>0;
      }));
      await page.locator('.ca-tray').evaluate(el=>el.scrollTop=0);
      await page.mouse.move(0,0);
      await page.evaluate(()=>document.activeElement?.blur());
      await page.waitForTimeout(250);
      await page.screenshot({path:`${out}/v4-mobile-sheet-${width}.png`});
      await closePopup(page.locator('.ca-tray'));
      await page.locator('[data-testid="toggle-resolved"]').click();
      await page.locator('[data-testid="unanchored"]').click();
      await sheet(page.locator('.ca-tray'),`${width}px single unanchored`);
      await page.keyboard.press('Escape');
      ok(`${width}px: Escape closes unanchored and restores toolbar`,await page.locator('.ca-tray').count()===0&&await page.locator('.ca-toolbar').isVisible());
      await page.locator('[data-testid="unanchored"]').click();
      await page.locator('.ca-tray').getByRole('button',{name:'Resolve',exact:true}).click();
      ok(`${width}px: resolving last unanchored thread restores toolbar`,await page.locator('.ca-tray').count()===0&&await page.locator('.ca-toolbar').isVisible());

      await seed([]);
      await page.getByRole('button',{name:'Comment mode',exact:true}).click();
      await page.locator('[data-anno-id="spec.title"]').click();
      await page.locator('.ca-composer-input').waitFor();
      await sheet(page.locator('.ca-popover'),`${width}px new comment`);
      await page.locator('.ca-composer-input').fill('Draft stays anchored to viewport bottom.');
      await page.evaluate(()=>window.scrollTo(0,600));
      await sheet(page.locator('.ca-popover'),`${width}px after document scroll`);
      await page.locator('.ca-thread-draft').getByRole('button',{name:'Cancel',exact:true}).click();
      ok(`${width}px: Cancel restores toolbar without saving draft`,await page.locator('.ca-toolbar').isVisible()&&
        await page.evaluate(()=>JSON.parse(localStorage.getItem('annotation-fixture-doc')).threads.length)===0);

      await page.locator('[data-anno-id="spec.title"]').scrollIntoViewIfNeeded();
      await page.locator('[data-anno-id="spec.title"]').click();
      await page.locator('.ca-composer-input').fill('A committed test comment.');
      await page.locator('.ca-thread-draft').getByRole('button',{name:'Comment',exact:true}).click();
      ok(`${width}px: submitting restores toolbar`,await page.locator('.ca-popover').count()===0&&await page.locator('.ca-toolbar').isVisible());
      await page.keyboard.press('Escape');
      await openBubble();
      await page.locator('.ca-thread').getByRole('button',{name:'Resolve',exact:true}).click();
      ok(`${width}px: resolving last visible thread restores toolbar`,await page.locator('.ca-popover').count()===0&&await page.locator('.ca-toolbar').isVisible());
    }
    ok('no browser exceptions',errors.length===0);
  }
} finally {
  await writeFile(`${out}/mobile-popups-results.json`,JSON.stringify({report,errors},null,2));
  await context.close();await browser.close();
}