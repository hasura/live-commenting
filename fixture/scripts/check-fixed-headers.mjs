/** Fixed panel chrome and one reachable scroll body. Isolated host, never live data. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';
const out=process.env.TEST_OUTPUT_DIR??'test-output';await mkdir(out,{recursive:true});
const report=[],errors=[];
const ok=(name,value)=>{report.push({name,pass:!!value});console.log(value?'PASS':'FAIL',name);assert.ok(value,name);};
const host=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;font:16px/1.5 system-ui}main{padding:64px 24px;max-width:240px}h1{font-size:22px}#outside{position:fixed;top:4px;right:8px}</style>
<script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;
window.__vite_plugin_react_preamble_installed__=true;
</script>
<button id="outside">Outside</button><main id="targets"><h1 data-anno-id="title" data-anno-label="Review specification">Review specification</h1></main><div id="mount"></div>
<script type="module">
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import {Annotations} from '/src/annotations/index.ts';
const e=React.createElement,root=ReactDOM.createRoot(document.getElementById('mount'));
let doc={version:1,threads:[]},focus=null,wide=false,readOnly=false;
const author={id:'qa',name:'Review QA'};
window.__render=()=>root.render(e(Annotations,{root:document.getElementById('targets'),annotations:doc,focus,readOnly,author,
  onChange:next=>{if(window.__reject)throw Error('Test save failure');doc=next;window.__render()},
  toolbarActions:e('button',{className:'ca-tool',style:wide?{minWidth:280}:{},onClick:()=>window.__refreshed=true},'Refresh')}));
window.__seed=(threads,ro=false)=>{doc={version:1,threads};readOnly=ro;window.__render()};
window.__remove=id=>{doc={...doc,threads:doc.threads.filter(t=>t.id!==id)};window.__render()};
window.__add=t=>{doc={...doc,threads:[...doc.threads,t]};window.__render()};
window.__jump=(threadId,eventId)=>{focus={threadId,eventId,nonce:Date.now()};window.__render()};
window.__wide=()=>{wide=true;window.__render()};
window.__render();
</script>`;
const browser=await launchBrowser();
const author={id:'qa',name:'Review QA'};
const make=(id,{missing=false,resolved=false,label='Review specification',count=28}={})=>({
 id,status:resolved?'resolved':'open',refs:[{kind:'anno_id',id:missing?`missing-${id}`:'title',label}],
 comments:Array.from({length:count},(_,i)=>({id:`${id}-${i}`,author,createdAt:'2026-09-23T17:00:00Z',
 body:[{kind:'text',value:`Comment ${i+1}. Long review history with context and detailed feedback. `.repeat(3)}]}))
});
async function setup(options){
 const context=await browser.newContext(options),page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/fixed-header-harness',r=>r.fulfill({contentType:'text/html',body:host}));
 await page.goto('http://localhost:5180/fixed-header-harness',{waitUntil:'networkidle'});
 return {context,page};
}
async function seed(page,threads,readOnly=false){
 await page.reload({waitUntil:'networkidle'});
 await page.evaluate(({threads,readOnly})=>window.__seed(threads,readOnly),{threads,readOnly});
 await page.waitForTimeout(120);
}
async function open(page,missing,mobile=false){
 const trigger=page.locator(missing?'[data-testid=unanchored]':'.ca-pin').first();
 if(mobile)await trigger.tap();else await trigger.click();
 const panel=page.locator(missing?'.ca-tray':'.ca-popover');
 await panel.locator('.ca-thread').first().waitFor();await page.waitForTimeout(180);
 return panel;
}
const parts=(panel,multiple)=>({
 header:panel.locator(multiple?':scope > header':'.ca-thread-head'),
 scroll:panel.locator(multiple?':scope > .ca-popover-body, :scope > .ca-tray-body':'.ca-thread-body'),
 close:panel.locator('.ca-close'),
});
async function metrics(panel,multiple){
 return panel.evaluate((p,multiple)=>{
  const header=p.querySelector(multiple?':scope > header':'.ca-thread-head'),s=p.querySelector(multiple?':scope > .ca-popover-body, :scope > .ca-tray-body':'.ca-thread-body');
  const h=header.getBoundingClientRect(),r=p.getBoundingClientRect(),b=s.getBoundingClientRect(),c=p.querySelector('.ca-close').getBoundingClientRect(),t=document.querySelector('.ca-toolbar').getBoundingClientRect();
  return {headerTop:h.top-r.top,headerBottom:h.bottom-r.top,closeTop:c.top-r.top,
   fixed:!s.contains(header),shellScroll:p.scrollTop,scroll:s.scrollTop,overflow:s.scrollHeight>s.clientHeight,
   scrollOwners:[p,...p.querySelectorAll('*')].filter(e=>/auto|scroll/.test(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight).length,
   hit:p.querySelector('.ca-close').contains(document.elementFromPoint(c.x+c.width/2,c.y+c.height/2)),
   contained:c.left>=r.left&&c.right<=r.right&&c.top>=r.top&&c.bottom<=r.bottom,
   headerClear:b.top>=h.bottom-1,bodyHeight:b.height,
   fits:r.left>=0&&r.right<=visualViewport.width+1&&r.top>=0&&r.bottom<=t.top-7,
   noX:p.scrollWidth<=p.clientWidth&&s.scrollWidth<=s.clientWidth,
  };
 },multiple);
}
try{
 for(const profile of [
  {name:'desktop',viewport:{width:1280,height:900}},
  {name:'narrow-desktop',viewport:{width:375,height:812}},
  {name:'touch-375',viewport:{width:375,height:812},isMobile:true,hasTouch:true},
  {name:'touch-320',viewport:{width:320,height:640},isMobile:true,hasTouch:true},
 ]){
  const {name,...options}=profile,{context,page}=await setup(options);
  for(const missing of [false,true])for(const multiple of [false,true]){
   const tag=`${name} ${missing?'unanchored':'anchored'} ${multiple?'group':'single'}`;
   await seed(page,[make('a',{missing}),...(multiple?[make('b',{missing})]:[])]);
   const panel=await open(page,missing,options.isMobile),{header,scroll,close}=parts(panel,multiple);
   let before=await metrics(panel,multiple);
   ok(`${tag}: one scroll owner below header, viewport fit`,before.fixed&&before.scrollOwners===1&&before.headerClear&&before.fits&&before.noX);
   ok(`${tag}: one labelled close control and correct title/count`,await close.count()===1&&await close.getAttribute('aria-label')!==null&&await header.innerText().then(s=>s.includes(multiple?'2 threads':'Review specification')));
   // Exercise real input before deterministic top/middle/end geometry assertions.
   if(options.isMobile){
    const cdp=await context.newCDPSession(page),r=await scroll.boundingBox();
    const x=r.x+r.width/2,y=r.y+r.height-32;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let i=1;i<=8;i++){
     await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*22}]});
     await page.waitForTimeout(20);
    }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await cdp.detach();
   }else{
    await scroll.hover();await page.mouse.wheel(0,400);
   }
   await page.waitForTimeout(200);
   ok(`${tag}: real ${options.isMobile?'touch':'wheel'} scroll moves body`,(await metrics(panel,multiple)).scroll>0);
   for(const fraction of [.5,1]){
    await scroll.evaluate((e,f)=>e.scrollTop=(e.scrollHeight-e.clientHeight)*f,fraction);
    const after=await metrics(panel,multiple);
    ok(`${tag}: ${fraction===1?'bottom':'middle'} keeps header and close fixed/clickable`,
     Math.abs(after.headerTop-before.headerTop)<1&&Math.abs(after.closeTop-before.closeTop)<1&&after.hit&&after.contained&&after.shellScroll===0&&after.headerClear);
   }
   // Keyboard scrollable region also works for read-only content; no focus trap.
   await page.waitForTimeout(600); // Let touch momentum finish before switching input modality.
   await scroll.evaluate(e=>e.scrollTop=0);
   await scroll.focus();await page.keyboard.press('End');await page.waitForTimeout(350);
   console.log('Keyboard region',tag,await scroll.evaluate(e=>({top:e.scrollTop,focused:e===document.activeElement,role:e.getAttribute('role')})));
   ok(`${tag}: keyboard can scroll labelled region`,await scroll.getAttribute('role')==='region'&&(await metrics(panel,multiple)).scroll>0);
   if(!missing)await panel.screenshot({path:`${out}/${name}-${multiple?'group':'single'}-scrolled.png`});
   if(options.isMobile)await close.tap();else await close.click();
   ok(`${tag}: close works without scrolling back`,await panel.count()===0);
  }
  // Long title + both badges: title bounded, close separated, no squeezed reading area.
  const long='A deliberately long annotation title with important context '.repeat(15)+'Unbroken'.repeat(15);
  await seed(page,[make('long',{missing:true,resolved:true,label:long})]);
  await page.locator('[data-testid=toggle-resolved]').click();
  const panel=await open(page,true),{scroll,close}=parts(panel,false);
  let m=await metrics(panel,false);
  ok(`${name}: long title/both badges fit with body space`,m.noX&&m.contained&&m.bodyHeight>80&&await panel.locator('.ca-tag').count()===2);
  ok(`${name}: complete title remains accessible`,await panel.locator('.ca-thread-target').getAttribute('aria-label')===long);
  await panel.locator('.ca-thread-target').focus();await page.getByRole('tooltip').waitFor();
  ok(`${name}: full title available in focus hint`,(await page.getByRole('tooltip').innerText()).includes(long));
  await scroll.focus();await page.keyboard.press('End');await page.waitForTimeout(200);
  await page.setViewportSize({width:profile.viewport.width,height:430});await page.waitForTimeout(180);
  m=await metrics(panel,false);
  ok(`${name}: short viewport preserves close and body`,m.fits&&m.hit&&m.bodyHeight>70);
  await close.click();
  await context.close();
 }
 // Stateful mutations: do not remount the survivor's editor on count/width changes.
 const {context,page}=await setup({viewport:{width:1280,height:900}});
 await seed(page,[make('a'),make('b')]);
 let panel=await open(page,false);
 await panel.locator('[data-thread-id=a]').getByRole('button',{name:'Reply',exact:true}).click();
 await page.locator('.ca-composer-input').fill('Unsent reply must survive.');
 await page.evaluate(()=>window.__editor=document.querySelector('.ca-composer-input'));
 await page.evaluate(()=>window.__remove('b'));await page.waitForTimeout(180);
 ok('group -> single keeps same editor node and draft',await page.evaluate(()=>window.__editor===document.querySelector('.ca-composer-input')&&window.__editor.textContent==='Unsent reply must survive.'));
 ok('group -> single uses only body scroll, title+close',await metrics(panel,false).then(m=>m.scrollOwners===1&&m.fixed&&m.headerClear));
 await page.evaluate(t=>window.__add(t),make('b'));await page.waitForTimeout(180);
 ok('single -> group keeps same editor node and draft',await page.evaluate(()=>window.__editor===document.querySelector('.ca-composer-input')&&window.__editor.textContent==='Unsent reply must survive.'));
 await page.setViewportSize({width:320,height:430});await page.waitForTimeout(180);
 ok('breakpoint/height change keeps same editor node',await page.evaluate(()=>window.__editor===document.querySelector('.ca-composer-input')));
 await page.evaluate(()=>window.__wide());await page.waitForTimeout(180);
 ok('wrapped toolbar stays below panel',await metrics(panel,true).then(m=>m.fits&&m.hit));
 await page.evaluate(()=>window.__reject=true);
 await page.locator('.ca-composer').getByRole('button',{name:'Reply',exact:true}).click();
 await page.getByRole('alert').waitFor();
 ok('failed reply retains editable draft',await page.locator('.ca-composer-input').innerText()==='Unsent reply must survive.');
 // The submit button now owns focus. Cancel explicitly; Escape on a non-editor
 // control correctly closes the entire popup rather than cancelling the editor.
 await page.locator('.ca-composer').getByRole('button',{name:'Cancel',exact:true}).click();
 await panel.locator('.ca-close').click();
 // Read-only keyboard scroll and deep-linked last event.
 await page.setViewportSize({width:1280,height:900});
 await seed(page,[make('readonly')],true);
 await page.evaluate(()=>window.__jump('readonly','readonly-27'));
 panel=page.locator('.ca-popover');await panel.waitFor();await page.waitForTimeout(700);
 const event=panel.locator('[data-event-id=readonly-27]');
 ok('deep link scrolls last event below fixed heading',await event.evaluate(el=>{
  const e=el.getBoundingClientRect(),s=el.closest('.ca-thread-body').getBoundingClientRect();return e.top>=s.top-1&&e.bottom<=s.bottom+1;
 }));
 ok('read-only body is keyboard reachable',await panel.locator('.ca-thread-body').getAttribute('tabindex')==='0');
 // Draft with many lines uses same fixed heading; content and submit stay reachable.
 await seed(page,[]);
 await page.getByRole('button',{name:'Comment mode',exact:true}).click();
 await page.locator('[data-anno-id=title]').click();
 await page.locator('.ca-composer-input').fill(Array.from({length:35},(_,i)=>`Draft line ${i+1}`).join('\n'));
 panel=page.locator('.ca-popover');
 await page.setViewportSize({width:375,height:430});await page.waitForTimeout(200);
 let {scroll,close}=parts(panel,false);
 await scroll.evaluate(e=>e.scrollTop=e.scrollHeight);
 ok('long new draft keeps heading and close',await metrics(panel,false).then(m=>m.hit&&m.fixed&&m.scrollOwners===1&&m.headerClear&&m.fits));
 ok('new draft submit controls reachable at bottom',await panel.getByRole('button',{name:'Comment',exact:true}).evaluate(el=>{
  const r=el.getBoundingClientRect(),s=el.closest('.ca-thread-body').getBoundingClientRect();return r.top>=s.top&&r.bottom<=s.bottom;
 }));
 await close.click();ok('new draft close works while body scrolled',await panel.count()===0);
 await context.close();
 ok('no browser exceptions',errors.length===0);
}finally{
 await writeFile(`${out}/fixed-headers-results.json`,JSON.stringify({report,errors},null,2));
 await browser.close();
}
