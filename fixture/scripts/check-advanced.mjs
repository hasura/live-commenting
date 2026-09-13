import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
const outputDir=process.env.TEST_OUTPUT_DIR??'test-output';
await mkdir(outputDir,{recursive:true});
const b=await chromium.connectOverCDP(process.env.CDP_URL??'http://127.0.0.1:9222');
const context=await b.newContext({viewport:{width:1400,height:950}});
const page=await context.newPage();
const report=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
const ok=(name,condition)=>{report.push({name,pass:!!condition});console.log(condition?'PASS':'FAIL',name);assert.ok(condition,name);};
try{
 await page.goto('http://localhost:5180/',{waitUntil:'networkidle'});
 await page.evaluate(()=>localStorage.removeItem('annotation-fixture-doc'));
 await page.reload({waitUntil:'networkidle'});
 await page.locator('button[title="Comment mode"]').click();
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

 await page.keyboard.press('Escape');await page.locator('button[title="Comment mode"]').click();
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
   const {closeRound,flattenAnnotations,validateRevision,reconcileRevision}=await import('/src/annotations/review.ts');
   const {addReply,removeThread,setThreadStatus}=await import('/src/annotations/store.ts');
   const d=JSON.parse(localStorage.getItem('annotation-fixture-doc'));
   const round=closeRound(d,'<snapshot/>','round-test');
   const stable=JSON.stringify(round);
   const locked=JSON.stringify(addReply(round,d.threads[0].id,{author:{id:'x',name:'x'},body:[{kind:'text',value:'no'}]}))===stable &&
      JSON.stringify(removeThread(round,d.threads[0].id))===stable && JSON.stringify(setThreadStatus(round,d.threads[0].id,'resolved'))===stable;
   const copied=round.rounds[0].threads[0].comments[0].body[0].value;
   d.threads[0].comments[0].body[0].value='mutated outside';
   const before=[{id:'a',label:'A',fingerprint:'1'}];
   const after=[{id:'b',label:'B',fingerprint:'2',supersedes:'a'}];
   const changed=validateRevision(before,[{id:'a',label:'A',fingerprint:'2'}]);
   const textRef=round.threads[0].refs[0];
   const target=document.querySelector(`[data-anno-id="${textRef.id}"]`);
   const mismatch=rangeForRef(target,{...textRef,quote:'wrong'})===null;
   const rec=reconcileRevision({...round,threads:[{...round.threads[0],refs:[{kind:'anno_id',id:'a',label:'Original'}]}]},after,'v2');
   return {locked,immutable:round.rounds[0].threads[0].comments[0].body[0].value===copied,
     flatten:flattenAnnotations(round).includes(textRef.quote),valid:validateRevision(before,after).valid,
     rejects:!changed.valid&&!validateRevision(before,[]).valid&&!validateRevision(before,[...after,...after]).valid,
     mismatch,addressed:rec.threads[0].anchorState==='addressed'&&rec.threads[0].status==='open'};
 });
 for(const [k,v]of Object.entries(validations))ok(`pure helper: ${k}`,v);

 // Scroll-jump and top-of-viewport composer regressions.
 await page.keyboard.press('Escape');
 await page.locator('button[title="Comment mode"]').click();
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
 await page.getByRole('button',{name:'Cancel',exact:true}).click();

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
 ok('invalid quote becomes unanchored',await page.locator('.ca-tray-toggle').count()===1);
 ok('invalid quote does not draw highlight',await page.locator('.ca-selection-text').count()===0);
 ok('no browser exceptions',errors.length===0);
 await page.screenshot({path:`${outputDir}/advanced-headed.png`});
} finally {
 await writeFile(`${outputDir}/advanced-results.json`,JSON.stringify({report,errors},null,2));
 await context.close();await b.close();
}