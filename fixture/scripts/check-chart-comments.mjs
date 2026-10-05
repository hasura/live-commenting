/** Real host + SQLite on the isolated dev harness. No production resets.
 * Edits fixture data through Vite to exercise regeneration, restores it in finally.
 * No WebGL flags or contexts are enabled. The persistent review browser is untouched.
 */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';
import {reset,readDoc} from './dev-client.mjs';

const url=process.argv[2]??'http://127.0.0.1:5280/';
const origin=new URL(url).origin;
const output=process.env.TEST_OUTPUT_DIR??'test-output';await mkdir(output,{recursive:true});
const sourcePath=new URL('../src/fixture/charts/example-data.ts',import.meta.url);
const originalSource=await readFile(sourcePath,'utf8');let lastWritten=originalSource;
const report=[],errors=[];
const ok=(name,condition,detail)=>{assert.ok(condition,name);report.push({name,detail});console.log('PASS',name,detail?JSON.stringify(detail):'');};
const browser=await launchBrowser();
const page=await browser.newPage({viewport:{width:1280,height:950}});page.setDefaultTimeout(20000);
page.on('pageerror',e=>errors.push(e.message));
const target=id=>page.locator(`[data-anno-id="${id}"]`);
const feed=async()=> (await (await page.request.get(origin+'/api/state')).json()).events;
async function mode(on){
 const close=page.locator('.ca-popover .ca-close');if(await close.count())await close.click();
 const button=page.getByRole('button',{name:'Comment mode',exact:true});
 if((await button.getAttribute('aria-pressed')==='true')!==on)await button.click();
}
async function localMarks(id){return target(id).evaluate(el=>el.__annoChartV1?.getMarks()?.map(m=>({key:m.key,label:m.label,kind:m.kind,values:m.values,bounds:m.geometry.bounds}))??null);}
async function pointFor(id,key){
 await target(id).evaluate(el=>el.scrollIntoView({behavior:'instant',block:'center'}));
 return target(id).evaluate((el,key)=>{
  const m=el.__annoChartV1.getMarks().find(m=>m.key===key),r=el.getBoundingClientRect(),g=m.geometry,b=g.bounds;
  if(g.point)return {x:r.left+g.point.x,y:r.top+g.point.y};
  if(!g.path)return {x:r.left+b.x+b.width/2,y:r.top+b.y+b.height/2};
  const ctx=document.createElement('canvas').getContext('2d');if(g.matrix)ctx.setTransform(...g.matrix);ctx.lineWidth=Math.max(1,g.strokeWidth??0);
  const candidates=[];
  for(let y=b.y+.5;y<=b.y+b.height;y+=Math.max(1,b.height/40))for(let x=b.x+.5;x<=b.x+b.width;x+=Math.max(1,b.width/40)){
   if((g.fill!==false&&ctx.isPointInPath(g.path,x,y))||(g.strokeWidth&&ctx.isPointInStroke(g.path,x,y)))candidates.push({x,y,d:Math.hypot((x-b.x-b.width/2)/Math.max(1,b.width),(y-b.y-b.height/2)/Math.max(1,b.height))});
  }
  candidates.sort((a,b)=>a.d-b.d);if(candidates.length)return {x:r.left+candidates[0].x,y:r.top+candidates[0].y};
  throw Error('No interior point for '+key);
 },key);
}
async function post(text){
 await page.locator('.ca-composer-input').fill(text);
 await page.getByRole('button',{name:'Comment',exact:true}).click();
 await page.locator('.ca-composer-input').waitFor({state:'detached'});
 const event=(await feed()).find(e=>JSON.stringify(e.body).includes(text));
 assert.ok(event);
 if(event.refs[0].kind==='chart'&&event.refs[0].selection==='point')return event;
 assert.ok(event.refs[0].snapshot?.id);
 const response=await page.request.get(origin+'/api/snapshots/'+event.refs[0].snapshot.id);
 assert.equal(response.status(),200);
 const bytes=await response.body();assert.equal(bytes.readUInt32BE(16),event.refs[0].snapshot.width);
 return event;
}
async function clickMark(id,key,label){
 await mode(true);const point=await pointFor(id,key);await page.mouse.click(point.x,point.y);
 await page.locator('.ca-thread-draft').waitFor();
 const event=await post(`Chart integration: ${label}`);
 const card=page.locator(`[data-thread-id="${event.thread_id}"]`);
 ok(label+' shows its details without a disclosure',await card.locator('.ca-selected-data-single').isVisible()&&await card.locator('.ca-selection-details summary').count()===0);
 ok(label+' saves the selected identity',event.refs[0].kind==='chart'&&event.refs[0].selection==='point'&&event.refs[0].members[0].key===key);
 ok(label+' has immediate structured context',!!event.refs[0].members[0].label&&!event.refs[0].snapshot);
 return event;
}
async function writeCategories(rows){
 assert.equal(await readFile(sourcePath,'utf8'),lastWritten,'Concurrent source edit; refusing to overwrite it');
 lastWritten=originalSource.replace(/export const categoryData = \[[\s\S]*?\];/,`export const categoryData = ${JSON.stringify(rows,null,2)};`);
 await writeFile(sourcePath,lastWritten);
}
async function rectangle(id,region={x:.15,y:.2,w:.45,h:.5}){
 await mode(true);await target(id).evaluate(el=>el.scrollIntoView({behavior:'instant',block:'center'}));
 const b=await target(id).boundingBox();
 await page.mouse.move(b.x+b.width*region.x,b.y+b.height*region.y);await page.mouse.down();
 await page.mouse.move(b.x+b.width*(region.x+region.w),b.y+b.height*(region.y+region.h),{steps:10});await page.mouse.up();
 await page.locator('.ca-thread-draft').waitFor();
}
async function nativeCrop(id,label){
 await rectangle(id,{x:.2,y:.15,w:.6,h:.7});
 const event=await post(`Chart integration: ${label}`);
 const ink=await page.evaluate(async hash=>{const image=new Image();image.src='/api/snapshots/'+hash;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);const p=ctx.getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<p.length;i+=4)if(p[i]<220||p[i+1]<220||p[i+2]<220)n++;return n;},event.refs[0].snapshot.id);
 ok(label+' exports a nonblank immutable crop',ink>100&&event.refs[0].members.length>0,{pixels:ink,members:event.refs[0].members.length});
 return event;
}
try{
 await reset(page,url);
 const categories=await page.evaluate(async()=> (await import('/src/fixture/charts/example-data.ts')).categoryData);
 await mode(true);
 const bar='charts.basic.bar.plot';await target(bar).evaluate(el=>el.scrollIntoView({behavior:'instant',block:'center'}));
 const box=await target(bar).boundingBox(),marks=await localMarks(bar);
 const selected=marks.filter(m=>['requests/billing','requests/reports'].includes(m.key));
 const x=Math.min(...selected.map(m=>m.bounds.x))-2,y=Math.min(...selected.map(m=>m.bounds.y))-2;
 const right=Math.max(...selected.map(m=>m.bounds.x+m.bounds.width))+2,bottom=Math.max(...selected.map(m=>m.bounds.y+m.bounds.height))+2;
 await page.mouse.move(box.x+x,box.y+y);await page.mouse.down();
 await page.mouse.move(box.x+right,box.y+bottom,{steps:12});
 ok('rectangle preview names its fixed members',(await page.locator('.ca-selection-count').innerText())==='2 selected');
 await page.mouse.up();
 const area=await post('Chart integration: Billing and Reports rectangle');
 assert.deepEqual(area.refs[0].members.map(m=>m.key).sort(),['requests/billing','requests/reports']);
 ok('rectangle stores two identities and an immutable image',area.refs[0].selection==='rectangle');
 const details=page.locator('.ca-selection-details');
 ok('rectangle image is visible above one data disclosure',await details.locator(':scope > :first-child img').isVisible()&&await details.locator('summary').count()===1&&await details.locator('summary').innerText()==='2 data points');
 ok('multiple-point details start collapsed',await details.locator('.ca-selected-data').getAttribute('open')===null);
 await details.locator('summary').click();
 await details.getByText('2 of 2 selected items visible in this view',{exact:true}).waitFor();
 await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
 const activeDiscussion=page.locator(`.ca-popover [data-thread-id="${area.thread_id}"]`);
 ok('page scrolling does not move chart comments to Unanchored',await activeDiscussion.count()===1&&await activeDiscussion.locator('.ca-tag-unanchored').count()===0);
 await target(bar).evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
 const imageBefore=await (await page.request.get(origin+'/api/snapshots/'+area.refs[0].snapshot.id)).body();
 const outline=page.locator(`[data-ca-ref="${bar}"][data-ca-selection=rectangle]`);
 const widthBefore=(await outline.boundingBox()).width;
 await writeCategories([categories[1],categories[0],categories[3],categories[4],{...categories[2],requests:85}]);
 await page.waitForFunction(()=>document.querySelector('[data-anno-id="charts.basic.bar.plot"]')?.__annoChartV1?.getMarks()?.find(m=>m.key==='requests/reports')?.values.requests===85);
 await page.waitForFunction(({id,width})=>document.querySelector(`[data-ca-ref="${id}"][data-ca-selection=rectangle]`)?.getBoundingClientRect().width>width*1.7,{id:bar,width:widthBefore});
 const stored=(await feed()).find(e=>e.id===area.id);
 assert.deepEqual(stored.refs,area.refs);
 ok('reorder expands the enclosure without changing membership',true,{before:widthBefore,after:(await outline.boundingBox()).width});
 ok('historical values stay unchanged',stored.refs[0].members.find(m=>m.key==='requests/reports').values.requests===56);
 ok('value changes are disclosed',(await page.locator('.ca-selection-details').innerText()).includes('changed since selection'));
 assert.deepEqual(await (await page.request.get(origin+'/api/snapshots/'+area.refs[0].snapshot.id)).body(),imageBefore);
 ok('original image bytes survive data revision',true);
 await writeCategories(categories.filter(d=>d.id!=='reports'));
 await page.waitForFunction(()=>document.querySelector('[data-anno-id="charts.basic.bar.plot"]')?.__annoChartV1?.getMarks()?.length===4);
 await page.getByText('1 of 2 selected items visible in this view',{exact:true}).waitFor();
 ok('partial removal keeps the survivor and original membership',true);
 await writeCategories(categories.filter(d=>!['reports','billing'].includes(d.id)));
 await page.waitForFunction(()=>document.querySelector('[data-anno-id="charts.basic.bar.plot"]')?.__annoChartV1?.getMarks()?.length===3);
 await page.getByText('0 of 2 selected items visible in this view',{exact:true}).waitFor();
 ok('no surviving marks moves the discussion into Unanchored',await page.locator('.ca-tray .ca-original-image img').isVisible()&&await page.locator('.ca-pin').count()===0);
 await page.reload({waitUntil:'networkidle'});
 await page.goto(origin+`/?anno_discussion=${area.thread_id}`);
 await page.locator('.ca-tray .ca-selected-data summary').click();
 await page.getByText('0 of 2 selected items visible in this view',{exact:true}).waitFor();
 ok('deep link and reload open a missing chart selection in Unanchored',await page.locator('.ca-tray .ca-tag-unanchored').count()===1);
 await page.screenshot({path:`${output}/chart-unanchored.png`});
 await writeCategories(categories);
 await page.waitForFunction(()=>document.querySelector('[data-anno-id="charts.basic.bar.plot"]')?.__annoChartV1?.getMarks()?.length===5);
 await page.getByText('2 of 2 selected items visible in this view',{exact:true}).waitFor();
 ok('restored members re-anchor automatically',true);
 await mode(false);await page.reload({waitUntil:'networkidle'});
 const reloaded=(await feed()).find(e=>e.id===area.id);assert.deepEqual(reloaded.refs,area.refs);
 ok('chart reference and image survive browser reload',true);

 await clickMark('charts.basic.line.plot','["requests","2026-09-04"]','time-series date');
 await clickMark('charts.basic.pie.plot','billing','pie slice');
  await clickMark('charts.basic.scatter.plot','obs-b3','scatter observation');
  await nativeCrop('charts.basic.scatter.plot','Vega SVG rectangle');
 const graph='charts.basic.network.plot';
 const graphEvent=await clickMark(graph,'node/web','force node');
 await mode(false);
 await page.locator('[data-basic=network]').getByRole('button',{name:'Sankey',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-anno-id="charts.basic.network.plot"]')?.dataset.layout==='sankey');
 ok('force-to-Sankey retains node identity',(await localMarks(graph)).some(m=>m.key===graphEvent.refs[0].members[0].key));
  await clickMark(graph,'edge/web-api','Sankey ribbon');
  const svgGraph=await nativeCrop(graph,'ECharts SVG rectangle');
 await mode(false);
 await page.locator('[data-basic=network]').getByRole('button',{name:'CANVAS',exact:true}).click();
  await clickMark(graph,'node/mobile','Canvas Sankey node');
  const canvasGraph=await nativeCrop(graph,'ECharts Canvas rectangle');
  assert.deepEqual(canvasGraph.refs[0].members.map(m=>m.key).sort(),svgGraph.refs[0].members.map(m=>m.key).sort());
  ok('SVG and Canvas graph rectangles select the same identities',true);

 await mode(false);await page.locator('details[data-advanced]').evaluateAll(items=>items.forEach(el=>el.open=true));
 await page.locator('[data-fixture=B]').getByRole('button',{name:'Canvas',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-anno-id="charts.B.plot"]')?.__annoChartV1?.getMarks()?.length>1000);
 await clickMark('charts.B.plot','["Series 5",397]','dense Canvas observation');
 await mode(false);
 await page.locator('[data-fixture=D]').getByRole('button',{name:'Heatmap',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-anno-id="charts.D.plot"]')?.__annoChartV1?.getMarks()?.some(m=>m.kind==='bin'));
 const bin=(await localMarks('charts.D.plot')).find(m=>m.values.count>5);
 const binEvent=await clickMark('charts.D.plot',bin.key,'aggregate heatmap cell');
  ok('aggregate stores bounds and count',binEvent.refs[0].members[0].values.count>5&&binEvent.refs[0].members[0].values.x1>binEvent.refs[0].members[0].values.x0);
  await nativeCrop('charts.D.plot','Vega Canvas heatmap rectangle');
 await mode(false);
 await page.locator('[data-fixture=E]').getByRole('button',{name:'Treemap',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-anno-id="charts.E.plot"]')?.__annoChartV1?.getMarks()?.some(m=>m.kind==='tile'));
 const leaf=(await localMarks('charts.E.plot')).find(m=>m.bounds.width>30&&m.bounds.height>25);
  await clickMark('charts.E.plot',leaf.key,'treemap leaf');

  await mode(false);
  const canvasId='charts.B.plot';
  await target(canvasId).evaluate(el=>{el.__restoreMarks=el.__annoChartV1.getMarks;el.__annoChartV1.getMarks=()=>null;el.dispatchEvent(new CustomEvent('anno-chart-change',{bubbles:true}));});
  await rectangle(canvasId);
  const opaque=await post('Chart integration: opaque Canvas fallback');
  ok('opaque Canvas captures an image without fabricating membership',opaque.refs[0].kind==='chart'&&opaque.refs[0].members===null&&!!opaque.refs[0].snapshot.id);
  await target(canvasId).evaluate(el=>{el.__annoChartV1.getMarks=el.__restoreMarks;delete el.__restoreMarks;el.dispatchEvent(new CustomEvent('anno-chart-change',{bubbles:true}));});
  ok('later adapter availability does not rewrite an image selection',(await feed()).find(e=>e.id===opaque.id).refs[0].members===null);
  await rectangle('charts.basic.scatter.plot',{x:.005,y:.005,w:.03,h:.03});
  const empty=await post('Chart integration: an empty region');
  ok('empty region is distinct from unavailable membership',Array.isArray(empty.refs[0].members)&&empty.refs[0].members.length===0);

  await mode(false);
  await target(bar).evaluate(el=>{el.__annoChartV1.capture=()=>{throw Error('Simulated image export failure');};});
  await rectangle(bar);
  await page.locator('.ca-capture-error').waitFor();
  await page.locator('.ca-composer-input').fill('Chart integration: retry preserves my draft');
  const beforeFailure=(await feed()).length;
  ok('posting is disabled until image capture recovers',await page.getByRole('button',{name:'Comment',exact:true}).isDisabled());
  await page.keyboard.press('Enter');
  ok('failed image capture preserves the draft and writes nothing',(await feed()).length===beforeFailure&&(await page.locator('.ca-composer-input').innerText()).includes('retry preserves my draft'));
  await target(bar).evaluate(el=>{delete el.__annoChartV1.capture;});
  await page.getByRole('button',{name:'Retry image in current view',exact:true}).click();
  await page.locator('.ca-thread-draft img').waitFor({state:'attached'});
  ok('retry keeps the unsent text',(await page.locator('.ca-composer-input').innerText()).includes('retry preserves my draft'));
  await post('Chart integration: retry preserves my draft');

  await mode(false);await target(bar).evaluate(el=>{window.__pointCaptureCalled=false;el.__annoChartV1.capture=()=>{window.__pointCaptureCalled=true;throw Error('Point should not wait for an image');};});
  await clickMark(bar,'requests/search','point without an image exporter');
  ok('point posting never invokes image rendering',await page.evaluate(()=>window.__pointCaptureCalled===false));
  await target(bar).evaluate(el=>{delete el.__annoChartV1.capture;});

 await mode(true);const image=page.locator('[data-basic=raster] img');await image.evaluate(el=>el.scrollIntoView({behavior:'instant',block:'center'}));
 const r=await image.boundingBox();await page.mouse.move(r.x+r.width*.2,r.y+r.height*.2);await page.mouse.down();await page.mouse.move(r.x+r.width*.5,r.y+r.height*.6,{steps:10});await page.mouse.up();
  const fallback=await post('Chart integration: image-only fallback');
 ok('image-only fallback stores crop without invented keys',fallback.refs[0].kind==='region'&&fallback.refs[0].semantic.membership==='unavailable'&&!!fallback.refs[0].snapshot.id);
 ok('image-only crop is always visible without a disclosure',await page.locator('.ca-original-image img').isVisible()&&await page.locator('.ca-selection-details summary').count()===0);
  await mode(false);
  // Two different saved rectangles must not collapse merely because they share
  // a chart id. Proximity clustering remains allowed, but refs stay independent.
  ok('rectangle discussions retain independent selections',(await readDoc(page)).threads.filter(t=>t.refs[0]?.id===bar&&t.refs[0].selection==='rectangle').length===2);
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:950});await target(bar).evaluate(el=>el.scrollIntoView({behavior:'instant',block:'center'}));
  await page.waitForTimeout(300);
  const delta=await target(bar).evaluate(el=>{
   const b=el.getBoundingClientRect(),m=el.__annoChartV1.getMarks().filter(m=>['requests/billing','requests/reports'].includes(m.key));
   const r=document.querySelector('[data-ca-ref="charts.basic.bar.plot"][data-ca-selection=rectangle]').getBoundingClientRect();
   return Math.abs(r.left-b.left-(Math.min(...m.map(p=>p.geometry.bounds.x))-8));
  });
  ok(`enclosure follows resize at ${width}px`,delta<2,{errorPx:delta});
 }
 await page.getByTestId('toggle-comments').click();
 const reader=page.locator('.ca-comments-panel'),threads=(await readDoc(page)).threads;
 ok('unified reader includes every saved chart discussion',await reader.locator('.ca-thread:visible').count()===threads.length);
 const snapshots=threads.flatMap(t=>t.refs.filter(r=>r.snapshot));
 await page.waitForFunction(()=>[...document.querySelectorAll('.ca-comments-panel .ca-original-image img')].every(img=>img.complete&&img.naturalWidth>0));
 ok('unified reader renders the recorded chart and image snapshots',snapshots.length>0&&await reader.locator('.ca-original-image img').count()===snapshots.length);
 const readerArea=reader.locator(`[data-thread-id="${area.thread_id}"]`);
 await readerArea.locator('.ca-selected-data summary').click();
 await readerArea.getByText('2 of 2 selected items visible in this view',{exact:true}).waitFor();
 ok('reader resolves current members while preserving saved values',(await readerArea.innerText()).includes('2 of 2 selected items visible in this view')&&(await readerArea.innerText()).includes('requests: 56'));
 ok('WebGL stayed disabled',await page.locator('[data-fixture=F] canvas').count()===0);
 ok('no uncaught browser errors',errors.length===0,errors);
 console.log(`${report.length} chart commenting checks passed`);
}finally{
 if(await readFile(sourcePath,'utf8')===lastWritten)await writeFile(sourcePath,originalSource);
 else console.error('Fixture source changed concurrently; leaving the current file intact.');
 await writeFile(`${output}/chart-comments.json`,JSON.stringify({report,errors},null,2));
 await browser.close();
}
