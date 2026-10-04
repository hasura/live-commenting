/** Option B: isolated controlled documents only. Never contacts the live server. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';
const out=process.env.TEST_OUTPUT_DIR??'test-output/comments-panel';
await mkdir(out,{recursive:true});
const browser=await launchBrowser(), report=[], errors=[];
const ok=(name,value)=>{console.log(value?'PASS':'FAIL',name);report.push({name,pass:!!value});assert.ok(value,name);};
const host=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<script type="module">
import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;
</script><style>
body{margin:0;font-family:system-ui}main{padding:24px;min-height:1900px}
section{margin-top:140px;height:160px;max-width:280px}#sticky{position:sticky;top:0;height:40px;background:#eee}
#nested{height:100px;overflow:auto;position:relative}#inside{margin-top:300px;height:40px}
</style></head><body><main id="targets">
<div id="sticky" data-anno-id="sticky">Sticky first</div>
<section id="a" data-anno-id="a" data-anno-label="First section">Alpha prose for text selections</section>
<section id="b" data-anno-id="b" data-anno-label="Second section">Beta prose</section>
<div id="nested"><p id="inside" data-anno-id="inside">Clipped but anchored</p></div>
<section id="c" data-anno-id="c">Last section</section></main><div id="mount"></div>
<script type="module">
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import {Annotations} from '/src/annotations/index.ts';
const mount=ReactDOM.createRoot(document.getElementById('mount'));
let doc={version:1,threads:[]},version=0,readOnly=false,focus=null;
function render(){mount.render(React.createElement(Annotations,{key:version,root:document.getElementById('targets'),author:{id:'qa',name:'QA'},
 annotations:doc,readOnly,focus,onChange:next=>{doc=next;render();}}));}
window.reset=(threads,ro=false)=>{doc={version:1,threads};version++;readOnly=ro;focus=null;render();};
window.update=threads=>{doc={version:1,threads};render();};
window.doc=()=>doc;window.focusComment=id=>{focus={threadId:id,nonce:Date.now()};render();};
render();
</script></body></html>`;
const thread=(id,refs,status='open',n=1)=>({
 id,status,refs:refs.map(r=>typeof r==='string'?{kind:'anno_id',id:r,label:r}:r),
 comments:Array.from({length:n},(_,i)=>({id:`${id}-c${i}`,author:{id:'qa',name:'QA Reviewer'},
 createdAt:`2026-09-24T00:00:${String(i).padStart(2,'0')}Z`,body:[{kind:'text',value:`${id} comment ${i}`}]})),
});
try{
 for(const [profile,width] of [['desktop',1280],['desktop',390],['mobile',390],['mobile',320]]){
  const context=await browser.newContext({viewport:{width,height:850},...(profile==='mobile'?{hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'}:{})});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/comments-panel-harness',r=>r.fulfill({contentType:'text/html',body:host}));
  await page.goto('http://localhost:5180/comments-panel-harness',{waitUntil:'networkidle'});
  const prefix=`${profile} ${width}px`;
  const panel=page.locator('.ca-comments-panel'), card=id=>panel.locator(`[data-thread-id="${id}"]`);
  const visibleCards=panel.locator('.ca-thread:visible');
  const trigger=page.getByTestId('toggle-comments'), markers=page.getByTestId('toggle-markers');
  const setFilter=async label=>{await panel.getByRole('button',{name:`${label} discussions`,exact:true}).click();};
  const reset=async(threads,ro=false)=>{
   await page.evaluate(({threads,ro})=>window.reset(threads,ro),{threads,ro});
   await page.waitForTimeout(100);
  };
  const open=async()=>{await trigger.click();await panel.waitFor({state:'visible'});};
  const seed=[
   thread('z-orphan',['gone']),
   thread('d-last',['c'],'resolved',2),
   thread('b-second',['b'], 'open',2),
   thread('p-partial',['missing','a']),
   thread('s-sticky',['sticky']),
   thread('i-clipped',['inside']),
   thread('a-first',['a'],'resolved'),
   thread('q-invalid',[{kind:'text',id:'b',label:'Invalid quote',start:0,end:8,quote:'not here'}]),
  ];
  await reset(seed);await open();
  ok(`${prefix}: All default, all discussions appear exactly once`,await visibleCards.count()===8&&await panel.getByRole('button',{name:'All discussions'}).getAttribute('aria-pressed')==='true');
  ok(`${prefix}: DOM order, partial anchor once, unanchored last`,JSON.stringify(await visibleCards.evaluateAll(es=>es.map(e=>e.dataset.threadId)))===JSON.stringify(['s-sticky','a-first','p-partial','b-second','i-clipped','d-last','q-invalid','z-orphan']));
  ok(`${prefix}: partial-invalid badge and valid navigation`,await card('p-partial').locator('.ca-tag-unanchored').count()===1&&await card('p-partial').getByRole('button',{name:'Show on page'}).count()===1);
  ok(`${prefix}: clipped != unanchored; invalid text != anchored`,await card('i-clipped').locator('.ca-tag-unanchored').count()===0&&await card('q-invalid').getByRole('button',{name:'Show on page'}).count()===0);
  ok(`${prefix}: old duplicate filters gone`,await page.getByTestId('toggle-resolved').count()===0&&await page.getByTestId('unanchored').count()===0);
  await card('b-second').locator('.ca-thread-target').click();
  ok(`${prefix}: ordinary reading never scrolls page`,await page.evaluate(()=>scrollY)===0);
  await markers.click();
  ok(`${prefix}: markers independently hidden; reader stays open`,await page.locator('.ca-pin').count()===0&&await panel.isVisible());
  await setFilter('Resolved');
  ok(`${prefix}: resolved filter and count`,await visibleCards.count()===2&&(await trigger.locator('.ca-count').innerText())==='2');
  await markers.click();
  ok(`${prefix}: marker filter matches reader`,await page.locator('.ca-pin:not(.ca-pin-resolved)').count()===0&&await page.locator('.ca-pin-resolved').count()===2);
  await setFilter('Open');
  ok(`${prefix}: open-only markers and reader`,await visibleCards.count()===6&&await page.locator('.ca-pin-resolved').count()===0);
  await setFilter('All');
  await card('b-second').getByRole('button',{name:'Reply',exact:true}).click();
  const editor=card('b-second').locator('.ca-composer-input');
  await editor.fill('Keep this draft');
  await page.evaluate(()=>window.savedEditor=document.querySelector('.ca-comments-panel [data-thread-id="b-second"] .ca-composer-input'));
  await setFilter('Resolved');await setFilter('All');
  ok(`${prefix}: filter preserves editor identity and draft`,await editor.evaluate(e=>e===window.savedEditor&&e.textContent==='Keep this draft'));
  await trigger.click();await open();
  ok(`${prefix}: close/reopen preserves draft`,await editor.evaluate(e=>e===window.savedEditor&&e.textContent==='Keep this draft'));
  // Incoming content before the current card must preserve its offset.
  await panel.locator('.ca-tray-body').evaluate(e=>{const c=e.querySelector('[data-thread-id="b-second"]');e.scrollTop+=c.getBoundingClientRect().top-e.getBoundingClientRect().top-10;});
  await page.waitForTimeout(80);
  const offset=()=>card('b-second').evaluate(e=>e.getBoundingClientRect().top-e.closest('.ca-tray-body').getBoundingClientRect().top);
  const before=await offset();
  await page.evaluate(t=>window.update([t,...window.doc().threads]),thread('0-new',['a'],'open',3));
  await page.waitForTimeout(120);
  ok(`${prefix}: incoming earlier discussion preserves reading position`,Math.abs(await offset()-before)<2);
  ok(`${prefix}: incoming data preserves reply editor`,await editor.evaluate(e=>e===window.savedEditor&&e.textContent==='Keep this draft'));
  const beforeNavigation=await offset();
  await card('b-second').getByRole('button',{name:'Show on page'}).click();
  await page.locator('.ca-popover').waitFor({state:'visible'});
  ok(`${prefix}: Show on page explicitly opens adjacent popup`,!await panel.isVisible()&&await page.locator('.ca-popover [data-thread-id="b-second"]').count()===1);
  await page.getByRole('button',{name:'Back to comments'}).click();
  ok(`${prefix}: Back restores same reply draft`,await panel.isVisible()&&await editor.evaluate(e=>e===window.savedEditor&&e.textContent==='Keep this draft'));
  ok(`${prefix}: Back restores exact reading offset`,Math.abs(await offset()-beforeNavigation)<2);
  await editor.fill('Posted reply');await card('b-second').getByRole('button',{name:'Reply',exact:true}).click();
  await editor.waitFor({state:'detached'});
  ok(`${prefix}: full-history reply persisted through controlled onChange`,await card('b-second').locator('[data-entry-kind="comment"]').count()===3);
  await page.evaluate(()=>scrollTo(0,0));
  await card('a-first').getByRole('button',{name:'Reopen',exact:true}).click();
  await card('a-first').getByRole('button',{name:'Resolve',exact:true}).click();
  ok(`${prefix}: status history retained in full reader`,await card('a-first').locator('[data-entry-kind="resolve"]').count()===1&&await card('a-first').locator('[data-entry-kind="reopen"]').count()===1);
  // Target removal/restoration while reader is open does not hide it.
  await page.evaluate(()=>{window.savedTarget=document.querySelector('#b');window.savedTarget.remove();});
  await page.waitForTimeout(100);
  ok(`${prefix}: target disappearance only adds badge`,await card('b-second').locator('.ca-tag-unanchored').count()===1&&await panel.isVisible());
  await page.evaluate(()=>document.querySelector('#a').after(window.savedTarget));
  await page.waitForTimeout(100);
  ok(`${prefix}: restored target reanchors without editing comments`,await card('b-second').locator('.ca-tag-unanchored').count()===0);
  for(const w of [width,320,390,width]){
   await page.setViewportSize({width:w,height:850});await page.waitForTimeout(80);
   const box=await panel.boundingBox(),bar=await page.locator('.ca-toolbar').boundingBox();
   ok(`${prefix} resized ${w}: panel and toolbar fit`,box.x>=0&&box.x+box.width<=w&&box.y>=0&&box.y+box.height<bar.y&&await page.locator('.ca-toolbar').evaluate(e=>e.scrollWidth<=e.clientWidth));
  }
  await page.screenshot({path:`${out}/option-b-${profile}-${width}.png`});
  await reset([thread('only',['a'])]);await open();await setFilter('Open');
  await card('only').getByRole('button',{name:'Resolve',exact:true}).click();
  ok(`${prefix}: resolving final result retains header/filter/empty state`,await panel.isVisible()&&await visibleCards.count()===0&&(await panel.innerText()).includes('No open discussions.'));
  await setFilter('Resolved');await card('only').getByRole('button',{name:'Reply',exact:true}).click();
  await card('only').locator('.ca-composer-input').fill('Reopen via reply');
  await card('only').getByRole('button',{name:'Reply & reopen',exact:true}).click();
  ok(`${prefix}: reply/reopen under Resolved leaves empty reader`,await panel.isVisible()&&await visibleCards.count()===0);
  await reset([]);await open();
  ok(`${prefix}: empty document reader remains available`,await panel.getByText('No comments yet.',{exact:true}).count()===1);
  await page.keyboard.press('Escape');ok(`${prefix}: Escape closes reader`,!await panel.isVisible());
  await trigger.focus();await page.keyboard.press('Enter');ok(`${prefix}: keyboard opens reader`,await panel.isVisible());
  await reset([thread('ro',['a'])],true);await open();
  ok(`${prefix}: read-only navigation but no mutation`,await panel.getByRole('button',{name:/^(Reply|Reopen|Resolve)$/}).count()===0&&await card('ro').getByRole('button',{name:'Show on page'}).count()===1);
  await reset([thread('focus-missing',['missing'],'resolved')]);
  await page.evaluate(()=>window.focusComment('focus-missing'));await panel.waitFor({state:'visible'});
  ok(`${prefix}: external focus opens missing resolved discussion`,await card('focus-missing').isVisible());
  await reset([
    thread('reverse',['b','a']),
    thread('text-later',[{kind:'text',id:'a',label:'Later range',start:6,end:11,quote:'prose'}]),
    thread('text-first',[{kind:'text',id:'a',label:'First range',start:0,end:5,quote:'Alpha'}]),
    thread('sticky',['sticky']),
  ]);
  await open();
  ok(`${prefix}: text offsets and earliest ref determine page order`,JSON.stringify(await visibleCards.evaluateAll(es=>es.map(e=>e.dataset.threadId)))===JSON.stringify(['sticky','reverse','text-first','text-later']));
  await page.evaluate(()=>scrollTo(0,500));await page.waitForTimeout(100);
  ok(`${prefix}: sticky scroll never reorders reader`,(await visibleCards.first().getAttribute('data-thread-id'))==='sticky');
  await card('reverse').getByRole('button',{name:'Show on page'}).click();
  await page.waitForTimeout(500);
  ok(`${prefix}: reverse refs navigate to marker's first valid anchor`,await page.locator('.ca-popover [data-thread-id="reverse"]').count()===1&&await page.locator('.ca-pin-active').getAttribute('data-ca-targets').then(s=>s.includes('b')));
  await page.evaluate(()=>scrollTo(0,0));
  // A single anchored popup still closes on resolve with Open selected.
  await reset([thread('popup',['a'])]);await open();await setFilter('Open');await panel.locator('.ca-close').click();
  await page.locator('.ca-pin').first().click();await page.locator('.ca-popover').getByRole('button',{name:'Resolve',exact:true}).click();
  ok(`${prefix}: filtered last popup closes without resurrection`,await page.locator('.ca-popover').count()===0);
  await open();await setFilter('All');await panel.locator('.ca-close').click();
  ok(`${prefix}: changing filter doesn't resurrect closed popup`,await page.locator('.ca-popover').count()===0);
  await page.locator('.ca-pin').first().click();
  await page.locator('.ca-popover').getByRole('button',{name:'Reopen',exact:true}).click();
  await page.locator('.ca-popover').getByRole('button',{name:'Resolve',exact:true}).click();
  ok(`${prefix}: All retains adjacent popup and resolution log`,await page.locator('.ca-popover .ca-thread-resolved').count()===1);
  await context.close();
 }
 ok('No browser errors',errors.length===0);
}finally{
 await writeFile(`${out}/comments-panel-results.json`,JSON.stringify({report,errors},null,2));
 await browser.close();
}