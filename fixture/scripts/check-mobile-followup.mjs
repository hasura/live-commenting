/** Touch state + asynchronous first-save regressions. Isolated browser host;
 * local promises only: never uses shared comments, notifications or live data. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';
const out=process.env.TEST_OUTPUT_DIR??'test-output';await mkdir(out,{recursive:true});
const report=[],errors=[],ok=(name,v)=>{assert.ok(v,name);report.push({name,pass:true});console.log('PASS',name);};
const browser=await launchBrowser();
const mobile=await browser.newContext({viewport:{width:375,height:812},isMobile:true,hasTouch:true,
 userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});
const page=await mobile.newPage();page.on('pageerror',e=>errors.push(e.message));
const host=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;
window.__vite_plugin_react_preamble_installed__=true;
</script>
<main id="targets" style="padding:30px"><h1 data-anno-id="title" data-anno-label="Title">Title</h1>
<p data-anno-id="other" data-anno-label="Other">Other target</p></main><div id="mount"></div>
<script type="module">
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import {Annotations} from '/src/annotations/index.ts';
const root=ReactDOM.createRoot(document.getElementById('mount')),author={id:'qa',name:'QA'};
let doc={version:1,threads:[]},showRefresh=false;
window.__saveCount=0;window.__deferred=false;window.__initialBot=false;
const directory={key:'test',botName:'Lilo',updatedAt:'now',entries:[{entity:'bot',id:'current',label:'Lilo'}]};
const comment=(id)=>({id,author,createdAt:new Date().toISOString(),body:[{kind:'text',value:'Seed'}]});
function render(){root.render(React.createElement(Annotations,{root:document.getElementById('targets'),annotations:doc,author,
 interaction:{deviceProfile:'mobile'},mentions:{directory},
 toolbarActions:showRefresh?React.createElement('button',{className:'ca-tool ca-tool-refresh',style:{minWidth:300},onClick:()=>window.__refreshed=true},'Refresh updated review'):null,
 onChange:async next=>{
  window.__saveCount++;
  if(window.__deferred)await new Promise((resolve,reject)=>{window.__complete=()=>{doc=next;render();resolve();};window.__reject=()=>reject(Error('Save failed — keep this draft.'));});
  else {doc=next;render();}
 }}));}
window.__seed=()=>{doc={version:1,threads:[
 {id:'open',status:'open',refs:[{kind:'anno_id',id:'title',label:'Title'}],comments:[comment('a')]},
 {id:'resolved',status:'resolved',refs:[{kind:'anno_id',id:'other',label:'Other'}],comments:[comment('b')]},
 {id:'missing',status:'open',refs:[{kind:'anno_id',id:'missing',label:'Missing'}],comments:[comment('c')]}
]};render();};
window.__showRefresh=()=>{showRefresh=true;render();};
window.__reset=()=>{doc={version:1,threads:[]};render();};
render();
</script>`;
await page.route('**/followup-harness',r=>r.fulfill({contentType:'text/html',body:host}));
const input=page.locator('.ca-composer-input');
const draft=async()=>{
 await page.locator('.ca-toolbar').waitFor();
 await page.evaluate(()=>window.__reset());
 await page.locator('.ca-pin').waitFor({state:'detached'});
 const mode=page.getByRole('button',{name:'Comment mode',exact:true});
 if(await mode.getAttribute('aria-pressed')!=='true')await mode.tap();
 await page.locator('[data-anno-id=title]').tap();
 await input.waitFor();
};
const saved=()=>page.locator('.ca-popover .ca-comment-body');
try{
 await page.goto('http://localhost:5180/followup-harness',{waitUntil:'networkidle'});
 await page.evaluate(()=>window.__seed());
 ok('touch context reports non-hover coarse input',await page.evaluate(()=>matchMedia('(hover:none)').matches&&matchMedia('(pointer:coarse)').matches));
 for(const selector of ['[data-testid=toggle-comments]','[data-testid=toggle-resolved]','[data-testid=unanchored]','[aria-label="Comment mode"]']){
  const control=page.locator(selector);
  if(await control.getAttribute('aria-pressed')==='true')await control.tap();
  await control.tap();
  const selected=await control.evaluate(e=>getComputedStyle(e).backgroundColor);
  await control.tap();
  ok(`${selector}: tap off clears selected fill without blurring`,await control.getAttribute('aria-pressed')==='false'&&
   await control.evaluate(e=>getComputedStyle(e).backgroundColor)==='rgba(0, 0, 0, 0)'&&selected!=='rgba(0, 0, 0, 0)');
 }
 // Tablet/external keyboard: state styling must not erase visible focus.
 const control=page.locator('[data-testid=toggle-comments]');
 await control.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
 ok('keyboard focus outline preserved on touch device',await control.evaluate(e=>e.matches(':focus-visible')&&getComputedStyle(e).outlineStyle==='solid'&&getComputedStyle(e).outlineWidth==='2px'));
 await page.goto('http://localhost:5180/followup-harness',{waitUntil:'networkidle'});
 await draft();
 await input.fill('@pro');await page.getByRole('option',{name:'Lilo Bot'}).tap();
 ok('touch mention checks and disables checkbox',await page.locator('.ca-direct input').isChecked()&&await page.locator('.ca-direct input').isDisabled());
 await page.locator('.ca-direct-control').tap();await page.getByRole('tooltip').waitFor();
 ok('touch tap exposes opt-out explanation',await page.getByRole('tooltip').innerText()==='Remove the @mention from the comment to not post to Lilo.');
 await input.fill('Plain first comment');
 await page.locator('.ca-btn').tap();await saved().waitFor();
 ok('first comment remains open on mobile',await saved().innerText()==='Plain first comment'&&await input.count()===0);
 ok('first comment shows Reply and preserves toolbar',await page.locator('.ca-thread-actions').getByRole('button',{name:'Reply',exact:true}).isVisible()&&await page.locator('.ca-toolbar').isVisible());
 const oldBar=await page.locator('.ca-toolbar').boundingBox();
 await page.evaluate(()=>window.__showRefresh());
 await page.waitForFunction(()=>{
  const p=document.querySelector('.ca-popover').getBoundingClientRect(),t=document.querySelector('.ca-toolbar').getBoundingClientRect();
  return p.bottom<=t.y-7;
 });
 const wrappedBar=await page.locator('.ca-toolbar').boundingBox();
 ok('popup follows increased height when toolbar wraps',wrappedBar.height>oldBar.height);
 await page.getByRole('button',{name:'Refresh updated review'}).tap();
 ok('wrapped Refresh control is touch reachable while popup open',await page.evaluate(()=>window.__refreshed===true)&&await page.locator('.ca-popover').isVisible());
 await page.locator('.ca-close').tap();
 // Pending save: retention, failure, retry, no premature close.
 await draft();await input.fill('Deferred first comment');
 await page.evaluate(()=>window.__deferred=true);
 await page.locator('.ca-btn').tap();
 ok('pending first save leaves draft open and disabled',await input.innerText()==='Deferred first comment'&&await input.getAttribute('contenteditable')==='false');
 await page.evaluate(()=>window.__reject());await page.locator('.ca-composer-error').waitFor();
 ok('rejected first save keeps editable draft',await input.innerText()==='Deferred first comment'&&await input.getAttribute('contenteditable')==='true');
 await page.locator('.ca-btn').tap();await page.evaluate(()=>window.__complete());
 await input.waitFor({state:'detached'});await saved().filter({hasText:'Deferred first comment'}).waitFor();
 ok('successful retry opens the newly saved discussion',await saved().filter({hasText:'Deferred first comment'}).count()===1);
 await page.locator('.ca-close').first().tap();
 // Do not re-open a dismissed pending save or clobber a newer draft.
 await draft();await input.fill('Late completion');
 await page.locator('.ca-btn').tap();
 await page.locator('.ca-close').tap();
 await page.evaluate(()=>window.__complete());
 await page.waitForTimeout(150);
 ok('late save does not reopen dismissed popup',await page.locator('.ca-popover').count()===0);
 await draft();await input.fill('Older pending save');
 await page.locator('.ca-btn').tap();await page.locator('.ca-close').tap();
 await page.locator('[data-anno-id=other]').tap();await input.fill('New unsent draft');
 await page.evaluate(()=>window.__complete());await page.waitForTimeout(150);
 ok('late save does not replace newer draft',await input.innerText()==='New unsent draft'&&await page.locator('.ca-thread-label').innerText()==='Other');
 await page.screenshot({path:out+'/mobile-followup.png'});
 ok('no browser exceptions',errors.length===0);
}finally{
 await writeFile(out+'/mobile-followup-results.json',JSON.stringify({report,errors},null,2));
 await mobile.close();await browser.close();
}