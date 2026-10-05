/** Page-local drafts through real editors and navigation; no live database writes. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';
const base=process.env.FIXTURE_URL??'http://127.0.0.1:5280';
const out=process.env.TEST_OUTPUT_DIR??'test-output/drafts';await mkdir(out,{recursive:true});
const browser=await launchBrowser(),report=[],errors=[];
let lastPage;
const ok=(name,value)=>{report.push({name,pass:!!value});console.log(value?'PASS':'FAIL',name);assert.ok(value,name);};
const host=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;</script>
<style>body{margin:20px;font:16px system-ui}#targets{width:260px}section{padding:12px;margin-bottom:170px;border:1px solid #ccc}</style></head>
<body><main id="targets"><section data-anno-id="a" data-anno-label="Target A" onclick="window.pageActions++">Alpha</section><section data-anno-id="b" data-anno-label="Target B">Beta</section><div id="chart" data-anno-id="chart" data-anno-label="Chart" data-anno-mode="chart" style="width:260px;height:140px;background:#dbeafe"></div></main><div id="mount"></div>
<script type="module">
import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import {Annotations} from '/src/annotations/index.ts';
import {registerChart,pointGeometry} from '/src/chart.ts';
const capture=()=>{const c=document.createElement('canvas');c.width=260;c.height=140;const ctx=c.getContext('2d');ctx.fillStyle='#2563eb';ctx.fillRect(0,0,260,140);return c;};
registerChart(document.getElementById('chart'),{version:1,getMarks:()=>[{key:'one',label:'Point one',geometry:pointGeometry(100,80,4),values:{value:1}}],capture:()=>window.holdCapture?new Promise((resolve,reject)=>{window.pendingCapture={resolve:()=>resolve(capture()),reject};}):capture()});
const mount=ReactDOM.createRoot(document.getElementById('mount'));
let doc={version:1,threads:[]},generation=0;
const directory={key:'qa',botName:'Bot',entries:[{entity:'bot',id:'current',label:'Bot'},{entity:'user',id:'7e0b9d2a-4c1f-4b7e-9a3d-2f6c8e1b5a90',label:'Reviewer'}]};
const apply=next=>{doc=next;render();};
const save=next=>{window.calls++;if(window.failSave)return Promise.reject(Error('Simulated save failure'));if(window.holdSave)return new Promise((resolve,reject)=>{window.pending={next,resolve,reject};});apply(next);};
function render(){mount.render(React.createElement(Annotations,{key:generation,root:document.getElementById('targets'),annotations:doc,author:{id:'qa',name:'QA'},mentions:{directory},onChange:save}));}
window.reset=threads=>{doc={version:1,threads};generation++;window.calls=0;window.pageActions=0;window.failSave=false;window.holdSave=false;window.pending=null;window.holdCapture=false;window.pendingCapture=null;render();};
window.finish=success=>{const p=window.pending;window.pending=null;if(success){apply(p.next);p.resolve();}else p.reject(Error('Simulated save failure'));};
window.doc=()=>doc;window.reset([]);
</script></body></html>`;
const thread=(id,target)=>({id,status:'open',refs:[{kind:'anno_id',id:target,label:'Target '+target.toUpperCase()}],comments:[{id:id+'-comment',author:{id:'qa',name:'QA'},createdAt:'2026-10-05T00:00:00Z',body:[{kind:'text',value:'Existing comment'}]}]});
try {
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:{width:mobile?390:1200,height:850},...(mobile?{hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'}:{})});
  const page=await context.newPage(),prefix=mobile?'mobile':'desktop';lastPage=page;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/draft-harness',r=>r.fulfill({contentType:'text/html',body:host}));
  await page.goto(base+'/draft-harness',{waitUntil:'networkidle'});
  const panel=page.locator('.ca-comments-panel'),popup=page.locator('.ca-popover');
  const reset=async threads=>{await page.evaluate(t=>{window.reset(t);scrollTo(0,0);},threads);await page.waitForTimeout(80);};
  const openReader=async()=>{await page.getByTestId('toggle-comments').click();await panel.waitFor({state:'visible'});};
  const card=(surface,id)=>surface.locator('[data-thread-id="'+id+'"]');
  const input=()=>page.locator('.ca-composer-input:visible');
  const visibleEditors=()=>page.locator('.ca-composer-input:visible').count();
  const mode=page.getByRole('button',{name:'Comment mode',exact:true});

  await reset([]);await mode.click();await page.locator('[data-anno-id="a"]').click();
  await input().fill('Discard this new comment');await popup.locator('.ca-direct input').check();
  await page.locator('[data-anno-id="b"]').click();
  if(mobile){
    ok(`${prefix}: outside taps preserve the current popup`,await popup.locator('.ca-thread-label').innerText()==='Target A'&&(await input().innerText()).includes('Discard this new comment'));
    await popup.locator('.ca-close').click();await page.locator('[data-anno-id="b"]').click();
  }
  ok(`${prefix}: new target starts an empty editor with no retained delivery choice`,await popup.locator('.ca-thread-label').innerText()==='Target B'&&(await input().innerText()).trim()===''&&!await popup.locator('.ca-direct input').isChecked());
  await input().press('Control+z');
  ok(`${prefix}: Undo cannot recover text from the previous destination`,(await input().innerText()).trim()===''&&await visibleEditors()===1&&await page.evaluate(()=>window.calls===0));
  await input().fill('Close discards');await popup.locator('.ca-close').click();
  await page.locator('[data-anno-id="b"]').click();
  ok(`${prefix}: closing has no Resume or hidden new draft`,(await input().innerText()).trim()===''&&await page.getByTestId('resume-draft').count()===0);
  if(!mobile){
    await input().fill('Replace this with a chart selection');
    await page.locator('#chart').scrollIntoViewIfNeeded();const chartBox=await page.locator('#chart').boundingBox();
    await page.mouse.move(chartBox.x+40,chartBox.y+30);await page.mouse.down();await page.mouse.move(chartBox.x+150,chartBox.y+120,{steps:5});await page.mouse.up();
    ok('desktop: a rectangle gesture also replaces the current editor',await popup.locator('.ca-thread-label').innerText().then(s=>s.startsWith('Chart'))&&(await input().innerText()).trim()===''&&await visibleEditors()===1);
  }
  await popup.getByRole('button',{name:'Cancel',exact:true}).click();

  await reset([thread('one','a'),thread('two','a')]);
  await page.locator('.ca-pin').first().click();
  await card(popup,'one').getByRole('button',{name:'Reply',exact:true}).click();
  await input().fill('First thread text');await card(popup,'one').locator('.ca-direct input').check();
  await card(popup,'two').getByRole('button',{name:'Reply',exact:true}).click();
  ok(`${prefix}: Reply on a second thread replaces the first editor`,await card(popup,'one').locator('.ca-composer-input').count()===0&&await visibleEditors()===1&&(await input().innerText()).trim()===''&&!await card(popup,'two').locator('.ca-direct input').isChecked());
  await input().fill('Second thread text');
  await card(popup,'one').getByRole('button',{name:'Reply',exact:true}).click();
  ok(`${prefix}: returning to the first reply does not restore discarded text`,(await input().innerText()).trim()===''&&await page.evaluate(()=>window.calls===0&&window.doc().threads.every(t=>t.comments.length===1)));
  await input().fill('Close this reply');await popup.getByRole('button',{name:'Close comments',exact:true}).click();
  await page.locator('.ca-pin').first().click();
  ok(`${prefix}: reopening a marker shows histories without old editors`,await visibleEditors()===0);

  await reset([thread('one','a'),thread('two','a')]);await mode.click();await page.locator('.ca-pin').first().click();
  await card(popup,'one').getByRole('button',{name:'Reply',exact:true}).click();await input().fill('Reply before new comment');
  await page.locator(`[data-anno-id="${mobile?'a':'b'}"]`).click();
  if(mobile){
    ok(`${prefix}: mobile protection applies to grouped reply popups`,await card(popup,'one').locator('.ca-composer-input').isVisible());
    await popup.getByRole('button',{name:'Close comments',exact:true}).click();await page.locator('[data-anno-id="b"]').click();
  }
  ok(`${prefix}: switching from reply to a new comment has the same replacement rule`,await popup.locator('.ca-thread-draft').isVisible()&&(await input().innerText()).trim()===''&&await visibleEditors()===1);
  await input().fill('New comment before reader');await openReader();
  ok(`${prefix}: opening the reader discards the previous editor without changing mode`,await visibleEditors()===0&&await mode.getAttribute('aria-pressed')==='true');
  await card(panel,'one').getByRole('button',{name:'Reply',exact:true}).click();await input().fill('Reader first reply');
  await card(panel,'two').getByRole('button',{name:'Reply',exact:true}).click();
  ok(`${prefix}: the reader also allows only one editor`,await card(panel,'one').locator('.ca-composer-input').count()===0&&await visibleEditors()===1&&(await input().innerText()).trim()==='');
  await input().fill('Do not restore on navigation');await card(panel,'two').getByRole('button',{name:'Show on page',exact:true}).click();
  ok(`${prefix}: Show on page ends editing in the previous popup`,await visibleEditors()===0&&await popup.isVisible());
  await popup.getByRole('button',{name:'Back to comments',exact:true}).click();
  ok(`${prefix}: Back does not restore a hidden draft`,await panel.isVisible()&&await visibleEditors()===0);
  await card(panel,'one').getByRole('button',{name:'Reply',exact:true}).click();await input().fill('Keep while still shown');
  await panel.getByRole('button',{name:'Open discussions',exact:true}).click();
  ok(`${prefix}: a filter that keeps the editor visible preserves current text`,(await input().innerText())==='Keep while still shown');
  await panel.getByRole('button',{name:'Resolved discussions',exact:true}).click();await panel.getByRole('button',{name:'All discussions',exact:true}).click();
  ok(`${prefix}: filtering away the editor discards it`,await visibleEditors()===0);

  await card(panel,'one').getByRole('button',{name:'Reply',exact:true}).click();await input().fill('Keep on failure');
  await page.evaluate(()=>window.failSave=true);await card(panel,'one').getByRole('button',{name:'Reply',exact:true}).click();
  await card(panel,'one').locator('.ca-composer-error').waitFor();
  ok(`${prefix}: failed save preserves the active editor and text`,(await input().innerText())==='Keep on failure'&&await page.evaluate(()=>window.doc().threads[0].comments.length===1));
  await page.evaluate(()=>{window.failSave=false;window.holdSave=true;});await card(panel,'one').getByRole('button',{name:'Reply',exact:true}).click();
  await page.waitForFunction(()=>!!window.pending);
  ok(`${prefix}: posting protects the one active editor`,await panel.locator('.ca-close').isDisabled()&&await page.getByTestId('toggle-comments').isDisabled()&&await card(panel,'two').getByRole('button',{name:'Reply',exact:true}).isDisabled()&&await panel.getByRole('button',{name:'Resolved discussions',exact:true}).isDisabled());
  await page.locator('[data-anno-id="a"]').click();
  ok(`${prefix}: a blocked page click does not activate the artifact`,await visibleEditors()===1&&await page.evaluate(()=>window.pageActions===0));
  await input().press('Escape');await input().press('Enter');
  ok(`${prefix}: Escape and Enter cannot discard or duplicate a pending submission`,await visibleEditors()===1&&await page.evaluate(()=>window.calls===2));
  await page.evaluate(()=>window.finish(true));await input().waitFor({state:'detached'});
  ok(`${prefix}: success ends editing exactly once`,await page.evaluate(()=>window.doc().threads[0].comments.length===2)&&await visibleEditors()===0);

  await reset([]);await mode.click();await page.evaluate(()=>window.holdCapture=true);
  await page.locator('#chart').scrollIntoViewIfNeeded();const bounds=await page.locator('#chart').boundingBox();
  await page.mouse.move(bounds.x+40,bounds.y+30);await page.mouse.down();await page.mouse.move(bounds.x+150,bounds.y+120,{steps:5});await page.mouse.up();
  await input().fill('Discard the old capture');
  // Finish the rectangle gesture's synthetic-click guard before a new gesture.
  await page.waitForTimeout(500);
  const close=popup.locator('.ca-close');await close.click();
  await page.locator('[data-anno-id="a"]').click();await input().fill('New selection wins');
  await page.evaluate(()=>window.pendingCapture.reject(Error('Old capture failed')));await page.waitForTimeout(100);
  ok(`${prefix}: a discarded capture cannot replace a newer editor or its error state`,(await input().innerText())==='New selection wins'&&await page.locator('.ca-capture-error').count()===0&&await popup.locator('.ca-thread-label').innerText()==='Target A');
  await page.screenshot({path:`${out}/single-editor-${prefix}.png`});
  await context.close();
 }
 ok('No browser errors',errors.length===0);
}catch(error){
 if(lastPage&&!lastPage.isClosed()){
  console.log('Failure state',await lastPage.evaluate(()=>({toolbar:document.querySelector('.ca-toolbar')?.innerText,reader:document.querySelector('.ca-comments-panel')?.hidden,editors:[...document.querySelectorAll('.ca-composer-input')].map(e=>e.textContent)})));
  await lastPage.screenshot({path:`${out}/failure.png`});
 }
 throw error;
}finally{await writeFile(`${out}/drafts-results.json`,JSON.stringify({report,errors},null,2));await browser.close();}
