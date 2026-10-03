/** Real chart rectangles -> SQLite -> image display. Never resets live reviews. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';
import {reset,readDoc} from './dev-client.mjs';
const base=process.env.FIXTURE_URL??'http://127.0.0.1:5280';
const out=process.env.TEST_OUTPUT_DIR??'test-output';await mkdir(out,{recursive:true});
const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1491,height:950}}),report=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
const ok=(name,value)=>{assert.ok(value,name);report.push(name);console.log('PASS',name);};
const target=page.locator('[data-anno-id="charts.C.plot"]');
// Exact fractions from the reported seven-member selection.
const region={xPct:.25,yPct:.10099239864864865,wPct:.23142857142857143,hPct:.3162162162162162};
try{
 await reset(page,base+'/#fixture-C');
 for(const [width,chartMode] of [[1491,'Donut / SVG'],[1280,'Pie / SVG']]){
  await page.setViewportSize({width,height:950});
  const close=page.locator('.ca-popover .ca-close');if(await close.count())await close.click();
  const mode=page.getByRole('button',{name:'Comment mode',exact:true});
  if(await mode.getAttribute('aria-pressed')==='true')await mode.click();
  await page.locator('[data-fixture=C]').getByRole('button',{name:chartMode,exact:true}).click();
  await target.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
  await page.waitForFunction(()=>document.querySelector('[data-anno-id="charts.C.plot"]')?.__annoChartV1?.getMarks()?.length===18);
  await mode.click();
  const originalStyle=await target.getAttribute('style'),margin=await target.evaluate(el=>parseFloat(getComputedStyle(el).marginLeft));
  assert.ok(margin>100,'This case needs a real centring margin');
  const box=await target.boundingBox();
  await page.mouse.move(box.x+box.width*region.xPct,box.y+box.height*region.yPct);await page.mouse.down();
  await page.mouse.move(box.x+box.width*(region.xPct+region.wPct),box.y+box.height*(region.yPct+region.hPct),{steps:10});await page.mouse.up();
  await page.locator('.ca-composer-input').fill(`Capture alignment: ${chartMode}`);
  await page.getByRole('button',{name:'Comment',exact:true}).click();await page.locator('.ca-composer-input').waitFor({state:'detached'});
  const thread=(await readDoc(page)).threads.at(-1),ref=thread.refs[0];
  ok(`${chartMode}: real rectangle selects chart segments`,ref.kind==='chart'&&ref.selection==='rectangle'&&ref.members.length===7);
  const response=await page.request.get(base+'/api/snapshots/'+ref.snapshot.id),bytes=await response.body();
  assert.equal(response.status(),200);
  const ink=await page.evaluate(async id=>{const img=new Image();img.src='/api/snapshots/'+id;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const p=ctx.getImageData(0,0,c.width,c.height).data;let color=0;for(let i=0;i<p.length;i+=4)if(Math.max(p[i],p[i+1],p[i+2])-Math.min(p[i],p[i+1],p[i+2])>40)color++;return color;},ref.snapshot.id);
  ok(`${chartMode}: stored PNG contains coloured segments`,ink>3000);
  ok(`${chartMode}: capture leaves the live layout untouched`,await target.getAttribute('style')===originalStyle&&await target.evaluate(el=>parseFloat(getComputedStyle(el).marginLeft))===margin);
  // Moving the target within its parent must not change its border-box image.
  // Remove only the live root margin for an independent alignment reference,
  // then restore it. Its size, contents and descendant transforms stay the same.
  const reference=await target.evaluate(async(el,region)=>{
   const {captureSelection}=await import('/src/annotations/capture.ts'),{readTarget}=await import('/src/annotations/target.ts');
   const saved=el.getAttribute('style');
   try{el.style.margin='0';return (await captureSelection(readTarget(el),region)).dataUrl;}
   finally{if(saved===null)el.removeAttribute('style');else el.setAttribute('style',saved);}
  },ref.region);
  ok(`${chartMode}: centred crop matches the zero-margin reference pixel-for-pixel`,bytes.equals(Buffer.from(reference.split(',')[1],'base64')));
  await writeFile(`${out}/composition-${width}.png`,bytes);
  await page.goto(base+`/?anno_discussion=${thread.id}#fixture-C`,{waitUntil:'networkidle'});
  await page.locator('.ca-original-image img').waitFor();
  ok(`${chartMode}: saved image loads after reload`,await page.locator('.ca-original-image img').evaluate(img=>img.complete&&img.naturalWidth>0));
  ok(`${chartMode}: snapshot stays immutable`,(await(await page.request.get(base+'/api/snapshots/'+ref.snapshot.id)).body()).equals(bytes));
 }
 ok('no browser errors',errors.length===0);
}finally{await writeFile(`${out}/capture-alignment.json`,JSON.stringify({report,errors},null,2));await browser.close();}
