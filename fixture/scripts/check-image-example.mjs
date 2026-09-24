import {launchBrowser} from './browser.mjs';
import {reset, readDoc} from './dev-client.mjs';
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';

const outputDir=process.env.TEST_OUTPUT_DIR??'test-output';
await mkdir(outputDir,{recursive:true});
const browser=await launchBrowser();
const context=await browser.newContext({viewport:{width:1400,height:1050}});
const page=await context.newPage();
const errors=[],report=[];
page.on('pageerror',e=>errors.push(e.message));
const ok=(name,pass)=>{report.push({name,pass:!!pass});console.log(pass?'PASS':'FAIL',name);assert.ok(pass,name);};
const imageId='spec.image-example.image';
const selector=`[data-anno-id="${imageId}"]`;
try {
  await reset(page);
  await page.locator('button[aria-label="Comment mode"]').click();
  const image=page.locator(selector);
  await image.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const facts=await image.evaluate(el=>({
    tag:el.tagName,loaded:el.complete&&el.naturalWidth===960&&el.naturalHeight===540,
    captionTarget:el.parentElement.querySelector('figcaption')?.dataset.annoId,
    mode:el.dataset.annoMode,semantic:JSON.parse(el.dataset.annoSemantic)
  }));
  ok('PNG loaded and actual IMG is the region target',facts.tag==='IMG'&&facts.loaded&&facts.mode==='region');
  ok('caption is a separate text target',facts.captionTarget==='spec.image-example.caption');
  ok('image source retained in semantic metadata',facts.semantic.src==='/image-annotation-example.png');
  const box=await image.boundingBox();
  // Select the orange CTA in the raster, not an HTML button.
  const region={xPct:0.05,yPct:0.64,wPct:0.31,hPct:0.14};
  await page.mouse.move(box.x+box.width*region.xPct,box.y+box.height*region.yPct);
  await page.mouse.down();
  await page.mouse.move(box.x+box.width*(region.xPct+region.wPct),box.y+box.height*(region.yPct+region.hPct),{steps:15});
  ok('image rectangle preview visible during real mouse drag',await page.locator('.ca-selection-region').count()>0);
  await page.mouse.up();
  await page.locator('.ca-composer-input').fill('Example QA: make the orange button easier to read.');
  await page.keyboard.press('Enter');await page.locator('.ca-composer-input').waitFor({state:'detached'});
  const doc=await readDoc(page);
  const ref=doc.threads[0].refs[0];
  ok('comment references image, not enclosing figure',ref.kind==='region'&&ref.id===imageId);
  ok('region fractions match selected pixels',Object.entries(region).every(([k,v])=>Math.abs(ref[k]-v)<.005));
  await page.keyboard.press('Escape');
  await page.mouse.move(1,1);
  await page.reload({waitUntil:'networkidle'});
  const restored=await readDoc(page);
  ok('image comment survives reload',JSON.stringify(restored)===JSON.stringify(doc));
  for(const width of [1400,390]) {
    await page.setViewportSize({width,height:1050});
    await image.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const delta=await page.evaluate(({selector,region})=>{
      const t=document.querySelector(selector).getBoundingClientRect();
      const h=document.querySelector('.ca-selection-region').getBoundingClientRect();
      return Math.max(Math.abs(h.x-(t.x+t.width*region.xPct)),Math.abs(h.y-(t.y+t.height*region.yPct)),
        Math.abs(h.width-t.width*region.wPct),Math.abs(h.height-t.height*region.hPct));
    },{selector,region});
    ok(`image region stays aligned at ${width}px viewport`,delta<2);
    await page.screenshot({path:`${outputDir}/image-example-${width}.png`});
  }
  const payload=await page.evaluate(async()=>{
    const {flattenAnnotations}=await import('/src/annotations/review.ts');
    const d=await window.__annoDoc();
    return {summary:flattenAnnotations(d),ref:d.threads[0].refs[0]};
  });
  ok('document retains image region against the image target',payload.ref.id===imageId&&payload.ref.kind==='region');
  ok('bot summary identifies image and rectangle',payload.summary.includes('Sample launch graphic')&&payload.summary.includes('Region fractions:'));
  ok('no browser exceptions',errors.length===0);
  // Production render only, no authentication injection, mocks or save calls.
  const prod=await context.newPage();
  await prod.goto('http://localhost:5190/',{waitUntil:'networkidle'});
  ok('production app includes dedicated example',await prod.locator(selector).count()===1&&
    await prod.locator(selector).evaluate(el=>el.complete&&el.naturalWidth===960));
  ok('original reference figure restored',await prod.locator('[data-anno-id="spec.reference.figure"] img').getAttribute('src')==='/reference-screenshot.svg');
  ok('obsolete region-not-implemented wording removed',!(await prod.locator('#reference').innerText()).includes('out of scope'));
  await prod.locator('.image-annotation-example').scrollIntoViewIfNeeded();
  await prod.screenshot({path:`${outputDir}/image-example-production.png`});
} finally {
  await writeFile(`${outputDir}/image-example-results.json`,JSON.stringify({report,errors},null,2));
  await context.close();
  await browser.close();
}