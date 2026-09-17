/**
 * Browser coverage of the exported per-instance policy API and standalone
 * composer. Test-only HTML host; no production endpoints or persistent state.
 */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';
const out=process.env.TEST_OUTPUT_DIR??'test-output';
await mkdir(out,{recursive:true});
const browser=await launchBrowser();
const context=await browser.newContext({viewport:{width:375,height:950},hasTouch:true});
const page=await context.newPage(), report=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
const ok=(name,value)=>{assert.ok(value,name);report.push({name,pass:true});console.log('PASS',name);};
const host=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
</script></head><body><main id="targets"><h1 data-anno-id="qa.title" data-anno-label="Policy title">Policy target</h1>
<p data-anno-id="qa.other" data-anno-label="Other">Another target</p></main><div id="mount"></div>
<button id="outside" data-anno-ignore style="position:fixed;right:2px;top:180px;z-index:2147483647">Outside</button>
<script type="module">
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
const {createRoot}=ReactDOM;
import {Annotations, TextComposer, DeviceBehaviorProvider} from '/src/annotations/index.ts';
import {TooltipProvider} from '/src/annotations/ui/tooltip.tsx';
window.__focusCalls=[];
const nativeFocus=HTMLElement.prototype.focus;
HTMLElement.prototype.focus=function(...args){
 if(this.matches('.ca-composer-input'))window.__focusCalls.push({args:args.length,preventScroll:args[0]?.preventScroll??null});
 return nativeFocus.apply(this,args);
};
const author={id:'qa',name:'Isolated QA'};
let doc={version:1,threads:['qa.title','qa.missing'].map((id,i)=>({id:'t'+i,status:'open',
 refs:[{kind:'anno_id',id,label:id}],comments:[{id:'c'+i,author,createdAt:'2026-09-17T12:00:00Z',body:[{kind:'text',value:'Seed'}]}]}))};
const root=createRoot(document.getElementById('mount'));
let interaction={deviceProfile:'mobile',enterBehavior:'send'}, standalone=false;
function render(){
 const content=standalone
  ? React.createElement(TooltipProvider,null,React.createElement(TextComposer,{onSubmit:b=>window.__standaloneSent=b,onCancel:()=>{}}))
  : React.createElement(Annotations,{root:document.getElementById('targets'),author,annotations:doc,interaction,
    onChange:next=>{doc=next;window.__doc=doc;render();}});
 root.render(content);
}
window.__update=next=>{interaction=next;render();};
window.__standalone=()=>{standalone=true;render();};
window.__doc=doc;render();
</script></body></html>`;
await page.route('**/policy-harness',r=>r.fulfill({contentType:'text/html',body:host}));
const panel=kind=>page.locator(kind==='bubble'?'.ca-popover':'.ca-tray');
const trigger=kind=>page.locator(kind==='bubble'?'.ca-pin':'[data-testid="unanchored"]').first();
const open=async(kind)=>{
 await trigger(kind).click();await panel(kind).locator('.ca-thread').first().waitFor();await page.waitForTimeout(80);
};
try{
 for(const kind of ['bubble','unanchored']){
  await page.goto('http://localhost:5180/policy-harness',{waitUntil:'networkidle'});
  await open(kind);
  await panel(kind).getByRole('button',{name:'Reply',exact:true}).click();
  const input=panel(kind).locator('.ca-composer-input');
  await input.fill('Mobile hardware keyboard');
  ok(`${kind}: explicit Enter override shows hint`,await page.getByLabel('Keyboard shortcuts',{exact:true}).count()===1);
  ok(`${kind}: override retains mobile native focus`,await page.evaluate(()=>window.__focusCalls.every(c=>c.args===0)));
  await page.locator('#outside').click();
  ok(`${kind}: override retains mobile no-dismiss`,await input.inputValue()==='Mobile hardware keyboard');
  await input.press('Enter');
  ok(`${kind}: overridden Enter sends once`,await input.count()===0&&await panel(kind).locator('[data-entry-kind="comment"]').count()===2);
  await panel(kind).getByRole('button',{name:'Reply',exact:true}).click();
  await input.fill('Keep me');
  await page.evaluate(()=>window.__savedInput=document.querySelector('.ca-composer-input'));
  const calls=await page.evaluate(()=>window.__focusCalls.length);
  await page.evaluate(()=>window.__update({deviceProfile:'mobile',enterBehavior:'newline'}));
  await page.getByLabel('Keyboard shortcuts',{exact:true}).waitFor({state:'detached'});
  ok(`${kind}: changing preference preserves composer node and text`,await input.evaluate(e=>e===window.__savedInput&&e.value==='Keep me'));
  ok(`${kind}: changing preference does not refocus`,await page.evaluate(()=>window.__focusCalls.length)===calls);
  await input.press('Enter');
  ok(`${kind}: changed preference updates handler`,await input.inputValue()==='Keep me\n');
  await page.evaluate(()=>window.__update({deviceProfile:'desktop',enterBehavior:'newline'}));
  await page.waitForTimeout(80);
  await page.locator('#outside').click();
  ok(`${kind}: profile override updates dismissal without changing layout`,await panel(kind).count()===0);
  await open(kind);await panel(kind).getByRole('button',{name:'Reply',exact:true}).click();
  ok(`${kind}: desktop Enter-newline override retains no-scroll focus`,
    await page.evaluate(()=>window.__focusCalls.at(-1).preventScroll===true));
  ok(`${kind}: narrow desktop still has sheet`,await panel(kind).evaluate(e=>getComputedStyle(e).position==='fixed'&&Math.abs(e.getBoundingClientRect().width-(innerWidth-4))<1));
  await input.fill('Desktop newline preference');await input.press('Enter');
  ok(`${kind}: desktop explicit newline never sends`,await input.inputValue()==='Desktop newline preference\n');
  await panel(kind).getByRole('button',{name:'Reply',exact:true}).click();
  ok(`${kind}: Reply button remains usable`,await input.count()===0);
 }
 // Standalone composer resolves defaults through the same helper, with no layer.
 await page.goto('http://localhost:5180/policy-harness',{waitUntil:'networkidle'});
 await page.evaluate(()=>window.__standalone());
 const input=page.locator('.ca-composer-input');
 await input.waitFor();await input.fill('Standalone');
 await input.press('Enter');
 ok('Standalone narrow desktop retains Enter-to-send',await page.evaluate(()=>window.__standaloneSent?.[0]?.value==='Standalone'));
 ok('No browser exceptions',errors.length===0);
}finally{
 await writeFile(`${out}/device-integration-results.json`,JSON.stringify({report,errors},null,2));
 await context.close();await browser.close();
}