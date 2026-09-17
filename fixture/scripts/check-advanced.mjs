import {launchBrowser} from './browser.mjs';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
const outputDir=process.env.TEST_OUTPUT_DIR??'test-output';
await mkdir(outputDir,{recursive:true});
const b=await launchBrowser();
const context=await b.newContext({viewport:{width:1400,height:950}});
const page=await context.newPage();
const report=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
const ok=(name,condition)=>{report.push({name,pass:!!condition});console.log(condition?'PASS':'FAIL',name);assert.ok(condition,name);};
try{
 await page.goto('http://localhost:5180/',{waitUntil:'networkidle'});
 await page.evaluate(()=>localStorage.removeItem('annotation-fixture-doc'));
 await page.reload({waitUntil:'networkidle'});
 await page.locator('button[aria-label="Comment mode"]').click();
 const el=page.locator('[data-anno-id="spec.lede"]');
 await el.scrollIntoViewIfNeeded();
 const points=await el.evaluate(el=>{
  const n=el.firstChild,r=document.createRange();
  r.setStart(n,2);r.setEnd(n,16);const boxes=[...r.getClientRects()];
  return {x1:boxes[0].left+1,y1:boxes[0].top+8,x2:boxes.at(-1).right-1,y2:boxes.at(-1).top+8};
 });
 await page.mouse.move(points.x1,points.y1);await page.mouse.down();
 await page.mouse.move(points.x2,points.y2,{steps:12});await page.mouse.up();
 await page.locator('.ca-composer-input').fill('Precise text range');
 await page.keyboard.press('Enter');
 let doc=await page.evaluate(()=>JSON.parse(localStorage.getItem('annotation-fixture-doc')));
 ok('real mouse text drag creates TextRef',doc.threads[0].refs.some(r=>r.kind==='text'&&r.quote.length>3));
 ok('text highlight renders',await page.locator('.ca-selection-text').count()>0);

 const split=await page.evaluate(async()=>{
  const {refsFromRange}=await import('/src/annotations/selection.ts');
  const root=document.querySelector('#artifact-root');
  const r=document.createRange();r.selectNodeContents(document.querySelector('[data-anno-id="spec.summary.body"]'));
  const a=refsFromRange(root,r);
  r.setStart(document.querySelector('[data-anno-id="spec.goals.g1"]').firstChild,2);
  r.setEnd(document.querySelector('[data-anno-id="spec.goals.g2"]').firstChild,20);
  return {a,b:refsFromRange(root,r)};
 });
 ok('atomic inline token snapped as block',split.a.some(r=>r.id==='spec.summary.token'&&r.kind==='anno_id'));
 ok('outer text splits around atomic block',split.a.filter(r=>r.kind==='text').length>=2);
 ok('cross-block selection preserves distinct refs',new Set(split.b.map(r=>r.id)).size===2);
 ok('no parent duplicate for cross-block selection',split.b.every(r=>r.kind==='text'));

 await page.keyboard.press('Escape');await page.locator('button[aria-label="Comment mode"]').click();
 const region=page.locator('[data-anno-mode="region"]').first();
 await region.scrollIntoViewIfNeeded();await page.waitForTimeout(180);
 const rect=await region.boundingBox();
 await page.mouse.move(rect.x+rect.width*.2,rect.y+rect.height*.2);
 await page.mouse.down();await page.mouse.move(rect.x+rect.width*.6,rect.y+rect.height*.6,{steps:12});
 ok('region preview renders while dragging',await page.locator('.ca-selection-region').count()>0);
 await page.mouse.up();await page.locator('.ca-composer-input').fill('Precise image region');await page.keyboard.press('Enter');
 doc=await page.evaluate(()=>JSON.parse(localStorage.getItem('annotation-fixture-doc')));
 const rr=doc.threads.at(-1).refs[0];
 ok('real mouse rectangle creates fractional RegionRef',rr.kind==='region'&&Math.abs(rr.xPct-.2)<.01&&Math.abs(rr.wPct-.4)<.01);
 await page.setViewportSize({width:900,height:900});
 await page.waitForTimeout(200);
 const alignment=await page.evaluate(()=>{
   const t=document.querySelector('[data-anno-mode="region"]').getBoundingClientRect();
   const h=document.querySelector('.ca-selection-region').getBoundingClientRect();
   return Math.abs(h.width/t.width-.4);
 });
 ok('region survives responsive reflow',alignment<.01);
 await page.setViewportSize({width:1400,height:950});

 const validations=await page.evaluate(async()=>{
   const {rangeForRef}=await import('/src/annotations/selection.ts');
   const {flattenAnnotations}=await import('/src/annotations/review.ts');
   const {addReply,setThreadStatus}=await import('/src/annotations/store.ts');
   const {diffDoc,foldEvents}=await import('/src/annotations/events.ts');
   const d=JSON.parse(localStorage.getItem('annotation-fixture-doc'));
   const author={id:'x',name:'Xin'};
   const replied=addReply(d,d.threads[0].id,{author,body:[{kind:'text',value:'a reply'}]});
   const resolved=setThreadStatus(replied,d.threads[0].id,'resolved',{author});
   const events=diffDoc(d,resolved);
   const marker=resolved.threads[0].resolution;
   // Replay the log the way a server would: stamp seq/actor/time and fold.
   const opening=diffDoc({version:1,threads:[]},d);
   const log=[...opening,...events].map((e,i)=>({...e,seq:i+1,actor:{...author,kind:'user'},created_at:new Date(0).toISOString()}));
   const folded=foldEvents(log);
   const textRef=d.threads[0].refs[0];
   const target=document.querySelector(`[data-anno-id="${textRef.id}"]`);
   const mismatch=rangeForRef(target,{...textRef,quote:'wrong'})===null;
   return {
     diff:events.length===2&&events[0].kind==='comment'&&!events[0].refs&&events[1].kind==='resolve',
     marker:marker?.actor.id==='x'&&marker.actorKind==='user',
     openingCarriesRefs:opening.every(e=>e.refs?.length),
     fold:folded.threads.length===d.threads.length&&folded.threads[0].comments.length===d.threads[0].comments.length+1&&folded.threads[0].status==='resolved',
     reopenClears:foldEvents([...log,{id:'r1',thread_id:d.threads[0].id,kind:'reopen',seq:99,actor:{...author,kind:'bot'},created_at:'2026-01-01T00:00:00Z'}]).threads[0].resolution===undefined,
     immutable:JSON.stringify(setThreadStatus(resolved,d.threads[0].id,'resolved'))===JSON.stringify(resolved),
     flatten:flattenAnnotations(resolved).includes(textRef.quote)&&/Xin \([^\n]+\): RESOLVED/.test(flattenAnnotations(resolved)),
     mismatch};
 });
 for(const [k,v]of Object.entries(validations))ok(`pure helper: ${k}`,v);

 // Scroll-jump and top-of-viewport composer regressions.
 await page.keyboard.press('Escape');
 await page.locator('button[aria-label="Comment mode"]').click();
 await page.evaluate(()=>window.scrollTo(0,650));
 await page.waitForTimeout(180);
 const beforeScroll=await page.evaluate(()=>scrollY);
 const top=await page.locator('[data-anno-id="doc.header.version"]').boundingBox();
 await page.mouse.click(top.x+top.width/2,top.y+top.height/2);
 await page.locator('.ca-composer-input').waitFor({state:'visible'});
 ok('focus does not scroll the page',Math.abs(await page.evaluate(()=>scrollY)-beforeScroll)<1);
 const pop=await page.locator('.ca-popover').boundingBox();
 ok('top-edge popover stays inside viewport',pop.y>=7 && pop.y+pop.height<=943);
 await page.locator('.ca-composer-input').fill('IME draft');
 await page.locator('.ca-composer-input').dispatchEvent('keydown',{key:'Enter',isComposing:true,bubbles:true});
 ok('IME Enter does not submit',await page.locator('.ca-composer-input').count()===1);
 await page.keyboard.press('Escape');

 // DOM node replacement under same id must update layout.
 const swapped=await page.evaluate(async()=>{
   const target=document.querySelector('[data-anno-mode="region"]');
   const n=target.cloneNode(true);n.style.marginLeft='25px';target.replaceWith(n);
   await new Promise(r=>setTimeout(r,200));
   const t=n.getBoundingClientRect(),h=document.querySelector('.ca-selection-region').getBoundingClientRect();
   return Math.abs(h.left-(t.left+.2*t.width))<2;
 });
 ok('DOM replacement remeasures live target',swapped);

 // True range mismatch is surfaced in the tray (not an invented highlight).
 await page.evaluate(()=>{
  const p=document.querySelector('[data-anno-id="spec.lede"]');p.textContent='Entirely different paragraph.';
 });
 await page.waitForTimeout(200);
 ok('invalid quote becomes unanchored',Number(await page.locator('[data-testid="unanchored"]').innerText())>0);
 ok('invalid quote does not draw highlight',await page.locator('.ca-selection-text').count()===0);
 ok('no browser exceptions',errors.length===0);
 await page.screenshot({path:`${outputDir}/advanced-headed.png`});
} finally {
 await writeFile(`${outputDir}/advanced-results.json`,JSON.stringify({report,errors},null,2));
 await context.close();await b.close();
}