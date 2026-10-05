/** Shared popup and toolbar rules, tested independently of review-server data. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';
const base=process.env.FIXTURE_URL??'http://localhost:5180';
const out=process.env.TEST_OUTPUT_DIR??'test-output/transitions';
await mkdir(out,{recursive:true});
const browser=await launchBrowser(),report=[],errors=[];
let lastPage;
const ok=(name,pass)=>{report.push({name,pass:!!pass});console.log(pass?'PASS':'FAIL',name);assert.ok(pass,name);};
const host=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;</script>
<style>body{margin:0;font:16px system-ui}main{min-height:1600px;padding:20px;width:160px}section{height:60px;margin-bottom:30px;background:#eef2ff}button{font:inherit}</style></head><body>
<main id="targets"><section id="a" data-anno-id="a" data-anno-label="Alpha" onclick="window.actions++">Alpha</section><section id="b" data-anno-id="b" data-anno-label="Beta" onclick="window.actions++">Beta</section></main><div id="mount"></div>
<script type="module">
import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import {Annotations} from '/src/annotations/index.ts';
const author={id:'qa',name:'QA'};
const thread=(id,target)=>({id,status:'open',refs:[{kind:'anno_id',id:target,label:target==='a'?'Alpha':'Beta'}],comments:[{id:id+'-comment',author,createdAt:'2026-10-05T00:00:00Z',body:[{kind:'text',value:'Saved '+id}]}]});
let doc,generation=0;const mount=ReactDOM.createRoot(document.getElementById('mount'));
const apply=next=>{doc=next;render();};
function render(){mount.render(React.createElement(React.Fragment,null,React.createElement('span',{'data-qa-generation':generation,hidden:true}),React.createElement(Annotations,{key:generation,root:document.getElementById('targets'),author,annotations:doc,onChange:next=>{window.saves++;if(window.hold)return new Promise((resolve,reject)=>{window.finish=success=>{if(success){apply(next);resolve();}else reject(Error('Save failed'));};});apply(next);}})));}
window.reset=()=>{doc={version:1,threads:[thread('one','a'),thread('two','a'),thread('three','b')]};generation++;window.actions=0;window.saves=0;window.hold=false;render();return generation;};window.reset();
</script></body></html>`;
const profiles=[
 {name:'desktop',width:1200}, {name:'narrow desktop',width:390},
 {name:'phone',width:390,mobile:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'},
 {name:'tablet',width:1024,mobile:true,userAgent:'Mozilla/5.0 (Linux; Android 15; Tablet)'},
];
try{
 for(const profile of profiles){
  const context=await browser.newContext({viewport:{width:profile.width,height:850},...(profile.mobile?{hasTouch:true,userAgent:profile.userAgent}:{})});
  const page=await context.newPage();lastPage=page;page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/transitions-harness',r=>r.fulfill({contentType:'text/html',body:host}));
  await page.goto(base+'/transitions-harness',{waitUntil:'networkidle'});
  const reader=page.locator('.ca-comments-panel'),popup=page.locator('.ca-popover');
  const mode=page.getByRole('button',{name:'Comment mode',exact:true}),eye=page.getByTestId('toggle-markers'),comments=page.getByTestId('toggle-comments');
  const editor=()=>page.locator('.ca-composer-input:visible');
  const pin=id=>page.locator('.ca-pin[data-ca-targets~="'+id+'"]');
  const reset=async()=>{const generation=await page.evaluate(()=>{scrollTo(0,0);return window.reset();});await page.waitForFunction(n=>document.querySelector('[data-qa-generation]')?.dataset.qaGeneration===String(n),generation);await pin('a').waitFor();};
  const on=async value=>{if((await mode.getAttribute('aria-pressed')==='true')!==value)await mode.click();};
  const background=async id=>{const target=page.locator('#'+id);if(profile.mobile)await target.tap({position:{x:8,y:8}});else await target.click({position:{x:8,y:8}});};
  const unchanged=async text=>editor().evaluate((e,text)=>e===window.savedEditor&&e.textContent===text,text);

  for(const kind of ['new','marker','reader']){
   await reset();const surface=kind==='reader'?reader:popup;
   if(kind==='new'){await on(true);await background('a');}
   else{
    if(kind==='reader')await comments.click();else await pin('a').click();
    await surface.locator('[data-thread-id="one"]').getByRole('button',{name:'Reply',exact:true}).click();
   }
   const text='Keep '+kind;await editor().fill(text);await editor().evaluate(e=>window.savedEditor=e);
   const initial=await mode.getAttribute('aria-pressed');
   await mode.click();await mode.click();
   ok(`${profile.name} ${kind}: mode toggles keep popup, editor and marker preference`,await surface.isVisible()&&await unchanged(text)&&await eye.getAttribute('aria-pressed')==='true');
   await eye.click();
   ok(`${profile.name} ${kind}: hiding markers retains the same editor`,await surface.isVisible()&&await unchanged(text)&&await page.locator('.ca-pin').count()===0&&await mode.getAttribute('aria-pressed')===initial);
   await mode.click();await mode.click();
   ok(`${profile.name} ${kind}: mode never forces hidden markers on`,await eye.getAttribute('aria-pressed')==='false'&&await unchanged(text)&&await page.locator('.ca-pin').count()===0);
   await eye.click();
   ok(`${profile.name} ${kind}: showing markers leaves popup and text intact`,await surface.isVisible()&&await unchanged(text));
   await surface.locator('.ca-close').click();
   ok(`${profile.name} ${kind}: Close discards editor but preserves controls`,await editor().count()===0&&await mode.getAttribute('aria-pressed')===initial&&await eye.getAttribute('aria-pressed')==='true');
   if(kind==='new')await background('a');
   else{
    if(kind==='reader')await comments.click();else await pin('a').click();
    await surface.locator('[data-thread-id="one"]').getByRole('button',{name:'Reply',exact:true}).click();
   }
   await editor().fill('Escape discards this');await editor().press('Escape');
   ok(`${profile.name} ${kind}: Escape from editor closes the whole popup`,!await surface.isVisible()&&await editor().count()===0&&await mode.getAttribute('aria-pressed')===initial);
  }

  for(const commenting of [false,true]){
   await reset();await on(commenting);await comments.click();
   await pin('a').click();
   ok(`${profile.name} mode ${commenting}: marker replaces reader`,!await reader.isVisible()&&await popup.locator('.ca-thread').count()===2);
   await pin('b').click();
   ok(`${profile.name} mode ${commenting}: another marker replaces popup`,await popup.locator('[data-thread-id="three"]').count()===1);
   await pin('b').click();
   ok(`${profile.name} mode ${commenting}: selected marker closes without changing mode`,await popup.count()===0&&await mode.getAttribute('aria-pressed')===String(commenting));

   for(const kind of ['reader','marker']){
    if(kind==='reader')await comments.click();else await pin('a').click();
    const surface=kind==='reader'?reader:popup;
    await surface.locator('[data-thread-id="one"]').getByRole('button',{name:'Reply',exact:true}).click();await editor().fill('Outside test');
    const actionsBefore=await page.evaluate(()=>window.actions);await background('b');
    if(profile.mobile){
     ok(`${profile.name} ${kind} mode ${commenting}: outside tap leaves popup and page untouched`,await surface.isVisible()&&(await editor().innerText())==='Outside test'&&await page.evaluate(()=>window.actions===0));
     await surface.locator('.ca-close').click();
    }else if(commenting){
     ok(`${profile.name} ${kind}: outside target opens exactly one blank comment`,await popup.locator('.ca-thread-draft').count()===1&&(await popup.locator('.ca-thread-label').innerText())==='Beta'&&(await editor().innerText()).trim()===''&&await page.evaluate(n=>window.actions===n,actionsBefore));
     await popup.locator('.ca-close').click();
    }else{
     ok(`${profile.name} ${kind}: ordinary outside click closes without swallowing the app click`,!await surface.isVisible()&&await editor().count()===0&&await page.evaluate(n=>window.actions===n+1,actionsBefore));
    }
   }
   ok(`${profile.name}: navigation and dismissal keep Comment mode`,await mode.getAttribute('aria-pressed')===String(commenting));
  }

  await reset();await on(true);await comments.click();await eye.click();
  const first=reader.locator('[data-thread-id="one"]');
  await first.getByRole('button',{name:'Reply',exact:true}).click();await editor().fill('Navigation discards this');
  await first.getByRole('button',{name:'Show on page',exact:true}).click();
  await popup.waitFor({state:'visible'});
  ok(`${profile.name}: Show on page replaces reader without changing mode/visibility`,await popup.isVisible()&&!await reader.isVisible()&&await editor().count()===0&&await mode.getAttribute('aria-pressed')==='true'&&await eye.getAttribute('aria-pressed')==='false');
  await popup.getByRole('button',{name:'Reply',exact:true}).click();await editor().fill('Discard on Back');
  await popup.getByRole('button',{name:'Back to comments',exact:true}).click();
  await reader.waitFor({state:'visible'});
  ok(`${profile.name}: Back replaces popup and discards its editor`,await reader.isVisible()&&await popup.count()===0&&await editor().count()===0&&await eye.getAttribute('aria-pressed')==='false');
  await page.keyboard.press('Escape');
  ok(`${profile.name}: Escape closes popup before changing Comment mode`,!await reader.isVisible()&&await mode.getAttribute('aria-pressed')==='true');
  await page.keyboard.press('Escape');
  ok(`${profile.name}: Escape with no popup exits mode without showing markers`,await mode.getAttribute('aria-pressed')==='false'&&await eye.getAttribute('aria-pressed')==='false');

  // A hidden mounted reader must never dismiss an editor in the current popup.
  await on(true);await background('a');await editor().fill('Post with hidden markers');
  await editor().evaluate(e=>window.savedEditor=e);await on(false);
  await page.evaluate(()=>window.hold=true);await popup.getByRole('button',{name:'Comment',exact:true}).click();
  ok(`${profile.name}: pending save disables navigation and mode controls`,await mode.isDisabled()&&await eye.isDisabled()&&await comments.isDisabled());
  await background('b');await page.keyboard.press('Escape');
  ok(`${profile.name}: pending save protects text with Comment mode off`,await unchanged('Post with hidden markers')&&await page.evaluate(()=>window.actions===0&&window.saves===1));
  await page.evaluate(()=>window.finish(false));await popup.getByRole('alert').waitFor();
  ok(`${profile.name}: failure keeps editor and control state`,await unchanged('Post with hidden markers')&&await mode.isEnabled()&&await mode.getAttribute('aria-pressed')==='false'&&await eye.getAttribute('aria-pressed')==='false');
  await page.evaluate(()=>window.hold=false);await popup.getByRole('button',{name:'Comment',exact:true}).click();await editor().waitFor({state:'detached'});
  ok(`${profile.name}: successful post keeps popup without changing mode/visibility`,await popup.isVisible()&&await mode.getAttribute('aria-pressed')==='false'&&await eye.getAttribute('aria-pressed')==='false');
  await page.screenshot({path:`${out}/${profile.name.replaceAll(' ','-')}.png`});
  await context.close();
 }
 ok('No browser errors',errors.length===0);
}catch(error){
 if(lastPage&&!lastPage.isClosed())await lastPage.screenshot({path:`${out}/failure.png`});
 throw error;
}finally{await writeFile(`${out}/results.json`,JSON.stringify({report,errors},null,2));await browser.close();}
