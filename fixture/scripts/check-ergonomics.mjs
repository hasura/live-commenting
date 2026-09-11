import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
const outputDir=process.env.TEST_OUTPUT_DIR??'test-output';
await mkdir(outputDir,{recursive:true});
const browser=await chromium.connectOverCDP('http://127.0.0.1:9222');
const results=[];
const ok=(name,pass)=>{results.push({name,pass:!!pass});console.log(pass?'PASS':'FAIL',name);assert.ok(pass,name);};
let context;
try{
 context=await browser.newContext({viewport:{width:1200,height:900},hasTouch:true});
 const page=await context.newPage();
 await page.goto('http://localhost:5180/',{waitUntil:'networkidle'});
 await page.locator('button[title="Comment mode"]').click();
 const target=page.locator('[data-anno-id="spec.lede"]');
 const box=await target.boundingBox();
 await page.touchscreen.tap(box.x+20,box.y+20);
 await page.locator('.ca-composer-input').fill('Tap comment');
 await page.keyboard.press('Enter');
 let doc=await page.evaluate(()=>JSON.parse(localStorage.getItem('annotation-fixture-doc')));
 ok('touch tap opens block composer and saves',doc.threads[0].refs[0].kind==='anno_id');
 const figure=page.locator('[data-anno-mode="region"]').first();
 await figure.scrollIntoViewIfNeeded();await page.waitForTimeout(150);
 const f=await figure.boundingBox();
 const cdp=await context.newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:f.x+50,y:f.y+50}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:f.x+180,y:f.y+130}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await page.locator('.ca-composer-input').fill('Touch region');await page.keyboard.press('Enter');
 doc=await page.evaluate(()=>JSON.parse(localStorage.getItem('annotation-fixture-doc')));
 ok('touch drag saves region',doc.threads.at(-1).refs[0].kind==='region');
 await page.keyboard.press('Escape');
 await target.scrollIntoViewIfNeeded();
 await page.evaluate(()=>{
   const p=document.querySelector('[data-anno-id="spec.lede"]');
   const r=document.createRange();r.setStart(p.firstChild,4);r.setEnd(p.firstChild,18);
   const s=getSelection();s.removeAllRanges();s.addRange(r);
 });
 await page.keyboard.press('Alt+Enter');
 await page.locator('.ca-composer-input').waitFor({state:'visible'});
 ok('Alt+Enter annotates a native text range',await page.locator('.ca-composer').count()===1);
 await page.locator('.ca-composer-input').fill('Keyboard text');
 await page.keyboard.press('Shift+Tab');
 ok('dialog reverse Tab wraps to last control',await page.evaluate(()=>document.querySelector('.ca-popover').contains(document.activeElement)));
 await page.keyboard.press('Escape');
 ok('dialog Escape discards draft',await page.locator('.ca-composer').count()===0);
 const text=await page.evaluate(async()=>{
   const {readManifest}=await import('/src/annotations/manifest.ts');
   const {applyRevision,validateRevision}=await import('/src/annotations/review.ts');
   const root=document.createElement('div');
   root.innerHTML='<section data-anno-id="s" data-anno-label="Section"><p data-anno-id="a" data-anno-label="A">First</p></section>';
   const before=readManifest(root);
   root.querySelector('p').outerHTML='<p data-anno-id="b" data-anno-label="B" data-anno-supersedes="a">New</p>';
   const after=readManifest(root);
   const d={version:1,threads:[]};
   let rejected=false;
   try{applyRevision(d,before,[],'v2');}catch{rejected=true;}
   return {supersedes:after.find(x=>x.id==='b').supersedes==='a',
     parentStable:before[0].fingerprint===after[0].fingerprint,
     valid:validateRevision(before,after).valid,rejected,
     immutable:d.threads.length===0};
 });
 for(const [k,v]of Object.entries(text))ok(`manifest: ${k}`,v);
 await page.locator('button[title="Comment mode"]').click();
 const region=await figure.boundingBox();
 await figure.scrollIntoViewIfNeeded();await page.waitForTimeout(100);
 const r=await figure.boundingBox();
 await page.mouse.move(r.x+40,r.y+40);await page.mouse.down();
 await page.mouse.move(r.x+130,r.y+100,{steps:6});await page.keyboard.press('Escape');await page.mouse.up();
 ok('Escape cancels in-progress region',await page.locator('.ca-composer').count()===0&&await page.locator('.ca-selection-region').count()===1);
 ok('region cancel does not create discussion',(await page.evaluate(()=>JSON.parse(localStorage.getItem('annotation-fixture-doc')).threads.length))===2);
 await page.keyboard.press('Escape');
 await page.locator('button[title="Show or hide all comments"]').click();
 ok('hide comments also hides text and region overlays',await page.locator('.ca-selection').count()===0);
}finally{
 await writeFile(`${outputDir}/ergonomics-results.json`,JSON.stringify(results,null,2));
 await context?.close();await browser.close();
}