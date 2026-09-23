/** Opening focus, configured-name explanation, and hover responsiveness.
 * Synthetic in-memory host only; no live comments, credentials or sends.
 */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';
const out=process.env.TEST_OUTPUT_DIR??'test-output';await mkdir(out,{recursive:true});
const report=[],errors=[],timings=[];
const ok=(name,value)=>{report.push({name,pass:!!value});console.log(value?'PASS':'FAIL',name);assert.ok(value,name);};
const host=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;font:16px/1.5 system-ui}main{padding:90px 24px;max-width:250px}h1{font-size:22px}#outside{position:fixed;top:8px;right:10px}</style>
<script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
</script>
<button id="outside">Outside</button><main id="targets"><h1 data-anno-id="title" data-anno-label="Review specification">Review specification</h1></main><div id="mount"></div>
<script type="module">
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import {Annotations,PresenceIndicator} from '/src/annotations/index.ts';
const e=React.createElement,root=ReactDOM.createRoot(document.getElementById('mount')),author={id:'qa',name:'QA'};
let doc={version:1,threads:[]},focus=null,botName='Hasura Bot';
const comment=i=>({id:'c'+i,author,createdAt:'2026-09-23T18:00:00Z',body:[{kind:'text',value:'Seed comment'}]});
window.__seed=(n,missing=false)=>{doc={version:1,threads:Array.from({length:n},(_,i)=>({id:'d'+i,status:'open',
 refs:[{kind:'anno_id',id:missing?'missing':'title',label:'Review specification'}],comments:[comment(i)]}))};render()};
window.__jump=()=>{focus={threadId:'d0',eventId:'c0',nonce:Date.now()};render()};
window.__name=name=>{botName=name;render()};
window.__poll=()=>render();
window.__reject=false;window.__saveCount=0;
function render(){
 const directory={key:botName,botName,updatedAt:'now',entries:[{entity:'bot',id:'current',label:botName}]};
 root.render(e(Annotations,{root:document.getElementById('targets'),annotations:doc,focus,author,mentions:{directory},
 toolbarActions:e(PresenceIndicator,{presence:{count:2,viewers:['Alice','Bob']}}),
 onChange:next=>{window.__saveCount++;if(window.__reject)throw Error('Synthetic save failure');doc=next;render()}}));
}
render();
</script>`;
const browser=await launchBrowser();
async function setup(options){
 const context=await browser.newContext({...options,...(options.isMobile?{
  userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
 }:{})}),page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/tooltip-behavior-harness',r=>r.fulfill({contentType:'text/html',body:host}));
 await page.goto('http://localhost:5180/tooltip-behavior-harness',{waitUntil:'networkidle'});
 return {context,page};
}
async function reset(page,n=1,missing=false){
 await page.reload({waitUntil:'networkidle'});await page.evaluate(({n,missing})=>window.__seed(n,missing),{n,missing});
 await page.waitForTimeout(70);
}
const noHint=async(page)=>{await page.waitForTimeout(350);return await page.getByRole('tooltip').count()===0;};
const press=async(locator,touch)=>touch?locator.tap():locator.click();
async function newDraft(page,touch){
 await reset(page,0);
 await press(page.getByRole('button',{name:'Comment mode',exact:true}),touch);
 await press(page.locator('[data-anno-id=title]'),touch);
 await page.locator('.ca-composer-input').waitFor();
}
try{
 for(const profile of [
  {name:'desktop',viewport:{width:1280,height:900}},
  {name:'narrow-desktop',viewport:{width:375,height:812}},
  {name:'touch-375',viewport:{width:375,height:812},isMobile:true,hasTouch:true},
  {name:'touch-320',viewport:{width:320,height:640},isMobile:true,hasTouch:true},
 ]){
  const {name,...options}=profile,{context,page}=await setup(options),touch=options.isMobile;
  for(const n of [1,2])for(const method of ['pointer','keyboard','deep-link']){
   await reset(page,n);
   const pin=page.locator('.ca-pin').first();
   if(method==='pointer')await press(pin,touch);
   else if(method==='keyboard'){await pin.focus();await page.keyboard.press('Enter');}
   else await page.evaluate(()=>window.__jump());
   const panel=page.locator('.ca-popover');await panel.waitFor();
   ok(`${name} ${n} ${method}: no unsolicited opening hint`,await noHint(page));
   ok(`${name} ${n} ${method}: labelled dialog owns neutral focus`,await panel.evaluate(e=>
    e===document.activeElement&&e.getAttribute('role')==='dialog'&&e.getAttribute('aria-label')&&e.tabIndex===-1));
   await page.keyboard.press('Tab');await page.getByRole('tooltip').waitFor();
   ok(`${name} ${n} ${method}: intentional Tab hint remains`,await page.getByRole('tooltip').innerText().then(t=>t.includes(n===1?'Review specification':'Close comments')));
   await page.keyboard.press('Tab');await page.keyboard.press('Escape');
   await panel.waitFor({state:'detached'});
   ok(`${name} ${n} ${method}: Escape closes and restores keyboard/pointer opener`,
    method==='deep-link'||await pin.evaluate(e=>e===document.activeElement));
  }
  for(const n of [1,2]){
   await reset(page,n,true);
   await press(page.locator('[data-testid=unanchored]'),touch);
   await page.locator('.ca-tray').waitFor();
   ok(`${name} unanchored ${n}: no opening hint`,await noHint(page));
   await page.locator('.ca-tray .ca-thread').first().getByRole('button',{name:'Reply',exact:true}).click();
   const input=page.locator('.ca-composer-input');await input.waitFor();
   ok(`${name} unanchored ${n}: reply autofocus retained`,await input.evaluate(e=>e===document.activeElement));
  }
  await newDraft(page,touch);
  let input=page.locator('.ca-composer-input');
  ok(`${name}: new discussion textbox prefocused, no hint`,await input.evaluate(e=>e===document.activeElement)&&await noHint(page));
  await page.keyboard.type('Start typing immediately');
  ok(`${name}: typing without another click reaches textbox`,await input.innerText()==='Start typing immediately');
  ok(`${name}: expected device input policy`,await page.locator('.ca-composer [aria-label="Keyboard shortcuts"]').count()===(touch?0:1));
  await page.evaluate(()=>window.__editor=document.querySelector('.ca-composer-input'));
  await page.setViewportSize({width:options.viewport.width,height:520});await page.evaluate(()=>window.__poll());
  ok(`${name}: resize/poll does not replace or defocus new draft`,await input.evaluate(e=>e===document.activeElement&&e===window.__editor&&e.textContent==='Start typing immediately'));
  await page.screenshot({path:`${out}/${name}-draft-focused.png`});
  await press(page.locator('.ca-composer').getByRole('button',{name:'Comment',exact:true}),touch);
  await input.waitFor({state:'detached'});
  ok(`${name}: first save opens saved discussion without hint`,await page.locator('.ca-popover .ca-comment-body').innerText()==='Start typing immediately'&&await noHint(page));
  await press(page.locator('.ca-thread-actions').getByRole('button',{name:'Reply',exact:true}),touch);
  input=page.locator('.ca-composer-input');await input.waitFor();
  ok(`${name}: saved discussion Reply still autofocuses`,await input.evaluate(e=>e===document.activeElement));
  await input.fill('Keep reply');await page.evaluate(()=>window.__poll());
  ok(`${name}: live update retains focused reply and text`,await input.evaluate(e=>e===document.activeElement&&e.textContent==='Keep reply'));
  await page.evaluate(()=>window.__reject=true);
  await press(page.locator('.ca-composer').getByRole('button',{name:'Reply',exact:true}),touch);
  await page.getByRole('alert').waitFor();
  ok(`${name}: failed save retains editable reply`,await input.innerText()==='Keep reply'&&await input.getAttribute('contenteditable')==='true');
  await page.locator('.ca-composer').getByRole('button',{name:'Cancel',exact:true}).click();
  await page.locator('.ca-close').click();
  await context.close();
 }
 const {context,page}=await setup({viewport:{width:1280,height:900}});
 for(const botName of ['Hasura Bot','Lilo','Review & Support']){
  await newDraft(page,false);await page.evaluate(name=>window.__name(name),botName);
  const input=page.locator('.ca-composer-input');await input.fill('@pro');
  await page.getByRole('option',{name:`${botName} Bot`,exact:true}).click();
  const control=page.locator('.ca-direct-control'),expected=`Remove @${botName} from the comment to not post directly to ${botName}.`;
  await control.click();await page.getByRole('tooltip').waitFor();
  ok(`${botName}: exact configured-name opt-out explanation`,await page.getByRole('tooltip').innerText()===expected);
  ok(`${botName}: explanation also in accessible name`,(await control.getAttribute('aria-label')).includes(expected));
  ok(`${botName}: semantic bot selection still forces checked/disabled`,await page.locator('.ca-direct input').isChecked()&&await page.locator('.ca-direct input').isDisabled());
  await input.fill('No bot mention');
  ok(`${botName}: removing mention restores enabled choice`,await page.locator('.ca-direct input').isEnabled()&&!(await page.locator('.ca-direct input').isChecked()));
  ok(`${botName}: tooltip interaction never submits`,await page.evaluate(()=>window.__saveCount)===0);
 }
 // Observe DOM removal after actual pointer exit, not wall-clock round trips.
 for(let trial=0;trial<5;trial++){
  await reset(page,0);
  const trigger=page.locator('[data-testid=presence]'),bubble=page.locator('[data-testid=presence-bubble]');
  await trigger.hover();await bubble.waitFor();await page.waitForTimeout(60);
  const a=await trigger.boundingBox(),b=await bubble.boundingBox();
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:14});
  ok(`presence ${trial}: safe corridor keeps hover preview open`,await bubble.count()===1);
  await page.evaluate(()=>{
   window.__timing={start:null,end:null};
   document.querySelector('[data-testid=presence-bubble]').addEventListener('pointerleave',()=>window.__timing.start=performance.now(),{once:true});
   const obs=new MutationObserver(()=>{
    if(window.__timing.start!==null&&!document.querySelector('[data-testid=presence-bubble]')){
     window.__timing.end=performance.now();obs.disconnect();
    }
   });obs.observe(document.body,{subtree:true,childList:true});
  });
  await page.mouse.move(700,300);await page.mouse.move(710,310);await bubble.waitFor({state:'detached'});
  const timing=await page.evaluate(()=>window.__timing.end-window.__timing.start);timings.push(timing);
 }
 const median=[...timings].sort((a,b)=>a-b)[2];
 console.log('Hover exit milliseconds',JSON.stringify(timings),'median',median);
 ok('hover exit median has no previous 120ms wait',median<100);
 await reset(page,1);
 await page.locator('.ca-pin').click();await noHint(page);
 await page.locator('.ca-thread-target').hover();await page.getByRole('tooltip').waitFor();
 ok('intentional title hover still opens hint',await page.getByRole('tooltip').innerText().then(t=>t.includes('Review specification')));
 // Leave the previous hint's pointer corridor before entering another trigger.
 // A one-event teleport between siblings can leave Radix in its transit state.
 await page.locator('#outside').hover();
 const outsideBox=await page.locator('#outside').boundingBox();
 await page.mouse.move(outsideBox.x+15,outsideBox.y+5,{steps:5});
 await page.getByRole('tooltip').waitFor({state:'detached'});
 const closeBox=await page.locator('.ca-close').boundingBox();
 await page.mouse.move(closeBox.x+closeBox.width/2,closeBox.y+closeBox.height/2,{steps:20});
 await page.getByRole('tooltip').filter({hasText:'Close comments'}).waitFor();
 ok('intentional Close hover still opens hint',true);
 await page.locator('.ca-close').click();
 await page.locator('[data-testid=presence]').click();await page.mouse.move(700,300);await page.waitForTimeout(250);
 ok('click-pinned presence does not disappear on pointer exit',await page.locator('[data-testid=presence-bubble]').getAttribute('data-pinned')==='true');
 await page.locator('#outside').click();
 ok('outside press still dismisses pinned presence',await page.locator('[data-testid=presence-bubble]').count()===0);
 await context.close();
 ok('no browser exceptions',errors.length===0);
}finally{
 await writeFile(out+'/tooltip-behavior-results.json',JSON.stringify({report,timings,errors},null,2));
 await browser.close();
}