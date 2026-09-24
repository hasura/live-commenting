/** Presence disclosure: isolated host, real mouse/touch/keyboard; no live data or sends. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchBrowser } from './browser.mjs';
const out=process.env.TEST_OUTPUT_DIR??'test-output';await mkdir(out,{recursive:true});
const report=[],errors=[],ok=(name,value)=>{assert.ok(value,name);report.push({name,pass:true});console.log('PASS',name);};
const host=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;font:italic 24px/2 serif;letter-spacing:3px;text-transform:uppercase}#targets{padding:24px}#outside{margin:24px}</style>
<script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;
window.__vite_plugin_react_preamble_installed__=true;
</script>
<button id="outside">Outside</button><main id="targets"><h1 data-anno-id="title" data-anno-label="Title">Title</h1></main><div id="mount"></div>
<script type="module">
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import {Annotations,PresenceIndicator} from '/src/annotations/index.ts';
const e=React.createElement,root=ReactDOM.createRoot(document.getElementById('mount'));
let presence={count:2,viewers:['Alice Chen','Bob Rivera']},doc={version:1,threads:[]},wide=false;
function render(){root.render(e(Annotations,{root:document.getElementById('targets'),annotations:doc,
 author:{id:'qa',name:'QA'},onChange:next=>{doc=next;render()},
 toolbarActions:e(React.Fragment,null,e(PresenceIndicator,{presence}),
 e('button',{id:'next',className:'ca-tool',style:wide?{minWidth:280}:{},onClick:()=>window.__next=true},wide?'Refresh updated document':'Next'))}));}
window.__presence=p=>{presence=p;render()};window.__wide=()=>{wide=true;render()};render();
</script>`;
const browser=await launchBrowser();
async function setup(options={}){
 const context=await browser.newContext(options),page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/presence-harness',r=>r.fulfill({contentType:'text/html',body:host}));
 await page.goto('http://localhost:5180/presence-harness',{waitUntil:'networkidle'});
 await page.locator('[data-testid=presence]').waitFor();
 return {context,page};
}
const bubble=p=>p.locator('[data-testid=presence-bubble]');
const button=p=>p.locator('[data-testid=presence]');
const closed=async p=>bubble(p).waitFor({state:'detached'});
const opened=async p=>{await bubble(p).waitFor();await p.waitForFunction(()=>{const e=document.querySelector('[data-testid=presence-bubble]');return e&&getComputedStyle(e).visibility==='visible'&&e.getBoundingClientRect().width>0;});};
async function fits(page){
 return page.evaluate(()=>{
  const b=document.querySelector('[data-testid=presence-bubble]').getBoundingClientRect(),v=visualViewport;
  return b.left>=v.offsetLeft+7&&b.right<=v.offsetLeft+v.width-7&&b.top>=v.offsetTop+7&&b.bottom<=v.offsetTop+v.height-7;
 });
}
try{
 const {context,page}=await setup({viewport:{width:1200,height:900}});
 ok('real button, initially collapsed',await button(page).evaluate(e=>e.tagName==='BUTTON'&&e.getAttribute('aria-expanded')==='false'));
 await button(page).hover();await opened(page);
 ok('hover shows list of names, not a flat tooltip',await bubble(page).locator('li').allTextContents().then(n=>JSON.stringify(n)===JSON.stringify(['Alice Chen','Bob Rivera'])));
 ok('white surface and scoped readable typography',await bubble(page).evaluate(e=>{const s=getComputedStyle(e),n=getComputedStyle(e.querySelector('li'));return s.backgroundColor==='rgb(255, 255, 255)'&&n.fontSize==='14px'&&n.lineHeight==='20px'&&n.fontStyle==='normal'&&n.textTransform==='none'&&['normal','0px'].includes(n.letterSpacing);}));
 ok('labelled disclosure and arrow connected to trigger',await bubble(page).getAttribute('role')==='region'&&await bubble(page).locator('svg').count()===1&&await button(page).getAttribute('aria-controls')===await bubble(page).getAttribute('id'));
 await bubble(page).hover();await page.waitForTimeout(250);
 ok('moving pointer across tail into bubble keeps preview open',await bubble(page).isVisible());
 await page.locator('#outside').hover();await closed(page);
 ok('hover preview closes after leaving both surfaces',true);
 await button(page).hover();await opened(page);
 const tailGeometry=await page.evaluate(()=>{
  const t=document.querySelector('[data-testid=presence]').getBoundingClientRect(),path=document.querySelector('[data-testid=presence-bubble] svg path');
  // FloatingArrow uses a square SVG canvas; only its triangular path is the tail.
  const box=path.getBBox(),matrix=path.getScreenCTM();
  const points=[[box.x,box.y],[box.x+box.width,box.y],[box.x,box.y+box.height],[box.x+box.width,box.y+box.height]]
   .map(([x,y])=>new DOMPoint(x,y).matrixTransform(matrix));
  const left=Math.min(...points.map(p=>p.x)),right=Math.max(...points.map(p=>p.x));
  return {trigger:t.toJSON(),arrow:{left,width:right-left,bottom:Math.max(...points.map(p=>p.y))}};
 });
 console.log('Tail geometry',JSON.stringify(tailGeometry));
 ok('tail points at the actual button',tailGeometry.arrow.left+tailGeometry.arrow.width/2>=tailGeometry.trigger.left&&
  tailGeometry.arrow.left+tailGeometry.arrow.width/2<=tailGeometry.trigger.right&&
  tailGeometry.arrow.bottom<=tailGeometry.trigger.top&&tailGeometry.trigger.top-tailGeometry.arrow.bottom<12);
 await page.locator('#outside').hover();await closed(page);
 await button(page).hover();await opened(page);await button(page).click();
 await page.locator('#outside').hover();await page.waitForTimeout(300);
 ok('click pins existing hover preview after pointer leaves',await bubble(page).getAttribute('data-pinned')==='true');
 await button(page).click();await page.locator('#outside').hover();await page.waitForTimeout(200);
 ok('repeated trigger click keeps pinned disclosure open',await bubble(page).isVisible());
 await bubble(page).locator('li').first().click();
 ok('clicking inside does not dismiss',await bubble(page).isVisible());
 await page.evaluate(()=>window.__presence({count:3,viewers:['Alice Chen','Bob Rivera','Casey Park']}));
 await bubble(page).getByText('Casey Park').waitFor();
 ok('live updates retain open state and update count',await button(page).getAttribute('aria-label')==='3 viewing now'&&await bubble(page).getAttribute('data-pinned')==='true');
 await page.locator('#outside').click();await closed(page);await page.waitForTimeout(250);
 ok('outside click dismisses without reopening',await button(page).getAttribute('aria-expanded')==='false');
 // Normal keyboard navigation: focus previews, Enter/Space latch; Escape is local.
 await page.locator('#next').focus();await page.keyboard.press('Shift+Tab');await opened(page);
 ok('keyboard focus previews with visible focus outline',await button(page).evaluate(e=>e===document.activeElement&&e.matches(':focus-visible')&&getComputedStyle(e).outlineWidth==='2px'));
 await page.keyboard.press('Tab');await closed(page);
 ok('unpinned keyboard preview closes on Tab out',true);
 await page.keyboard.press('Shift+Tab');await opened(page);await page.keyboard.press('Enter');
 await page.keyboard.press('Tab');await page.waitForTimeout(100);
 ok('Enter pins and Tab navigation is not trapped',await page.locator('#next').evaluate(e=>e===document.activeElement)&&await bubble(page).getAttribute('data-pinned')==='true');
 await page.keyboard.press('Escape');await closed(page);
 ok('Escape dismisses pinned disclosure while focus is elsewhere',true);
 await page.keyboard.press('Shift+Tab');await page.keyboard.press('Space');await opened(page);
 ok('Space also pins',await bubble(page).getAttribute('data-pinned')==='true');
 await page.keyboard.press('Escape');await closed(page);await page.waitForTimeout(150);
 ok('Escape does not re-open a still-focused trigger',await button(page).evaluate(e=>e===document.activeElement&&e.getAttribute('aria-expanded')==='false'));
 await page.locator('#outside').click();
 // Presence controls and portal must not dismiss or consume drafts behind them.
 await page.getByRole('button',{name:'Comment mode',exact:true}).click();
 await page.locator('[data-anno-id=title]').click();
 const input=page.locator('.ca-composer-input');await input.fill('Keep my unsaved words');
 await button(page).click();await opened(page);await bubble(page).click();
 ok('trigger and portalled surface preserve desktop draft',await input.innerText()==='Keep my unsaved words');
 await page.keyboard.press('Escape');await closed(page);
 ok('first Escape closes only presence, not background draft',await input.innerText()==='Keep my unsaved words');
 await input.focus();await page.keyboard.press('Escape');await input.waitFor({state:'detached'});
 ok('next Escape still dismisses the draft normally',true);
 await page.getByRole('button',{name:'Comment mode',exact:true}).click();
 await button(page).click();await opened(page);
 await page.evaluate(()=>window.__presence({count:2,viewers:['Same Name','Same Name']}));
 await page.waitForFunction(()=>document.querySelectorAll('.ca-presence-list li').length===2&&document.querySelector('.ca-presence-list').textContent==='Same NameSame Name');
 ok('different viewers with duplicate display names are not collapsed',true);
 await page.evaluate(()=>window.__presence({count:1,viewers:['<img src=x onerror=alert(1)>']}));
 await bubble(page).getByText('<img src=x onerror=alert(1)>',{exact:true}).waitFor();
 ok('names render as inert text',await bubble(page).locator('img').count()===0);
 await page.evaluate(()=>window.__presence({count:0,viewers:[]}));
 await bubble(page).getByText('No current viewers.').waitFor();
 ok('empty live state explicit',true);
 await page.evaluate(()=>window.__presence(null));
 await bubble(page).getByText('Local preview — live presence is unavailable.').waitFor();
 ok('local preview is distinguished from empty live presence',await button(page).getAttribute('aria-label')==='Viewing now — local preview');
 await page.evaluate(()=>window.__presence({count:2,viewers:['Alice Chen','Bob Rivera']}));
 await page.screenshot({path:out+'/presence-desktop.png'});
 await context.close();
 // True touch/mobile on correctly sized host, avoiding unrelated demo overflow.
 for(const width of [375,320]){
  const {context:mobile,page:p}=await setup({viewport:{width,height:812},isMobile:true,hasTouch:true,
   userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});
  await button(p).tap();await opened(p);
  ok(`${width}: first tap pins`,await bubble(p).getAttribute('data-pinned')==='true');
  ok(`${width}: bubble remains inside actual visual viewport`,await fits(p));
  await bubble(p).locator('li').first().tap();await p.waitForTimeout(150);
  ok(`${width}: inside tap retains bubble`,await bubble(p).isVisible());
  await p.evaluate(()=>window.__wide());
  await p.waitForFunction(()=>{const t=document.querySelector('[data-testid=presence]').getBoundingClientRect(),b=document.querySelector('[data-testid=presence-bubble]').getBoundingClientRect();return b.bottom<t.top;});
  ok(`${width}: follows wrapped toolbar and keeps trigger reachable`,await fits(p));
  const names=Array.from({length:40},(_,i)=>i===0?'ExtremelyLongUnbrokenViewerName'.repeat(5):`Viewer ${i+1}`);
  await p.evaluate(names=>window.__presence({count:names.length,viewers:names}),names);
  await p.waitForFunction(()=>document.querySelectorAll('.ca-presence-list li').length===40);
  // The taller list re-flips the bubble above the trigger; wait for floating-ui to reposition before measuring.
  await p.waitForFunction(()=>{const t=document.querySelector('[data-testid=presence]').getBoundingClientRect(),b=document.querySelector('[data-testid=presence-bubble]').getBoundingClientRect();return b.bottom<t.top;});
  ok(`${width}: long names wrap and list scrolls without horizontal overflow`,await fits(p)&&await bubble(p).evaluate(e=>{const s=e.querySelector('.ca-presence-scroll');return e.scrollWidth<=e.clientWidth&&s.scrollHeight>s.clientHeight&&s.scrollWidth<=s.clientWidth;}));
  await bubble(p).locator('.ca-presence-scroll').focus();await p.keyboard.press('End');await p.waitForTimeout(200);
  ok(`${width}: keyboard can reach list end`,await bubble(p).evaluate(e=>e.querySelector('.ca-presence-scroll').scrollTop>0));
  // Real touch drag inside long list must not dismiss.
  const box=await bubble(p).boundingBox(),session=await p.context().newCDPSession(p),x=box.x+box.width/2,y=box.y+box.height-35;
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  for(let i=1;i<=6;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*20}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  ok(`${width}: touch scrolling does not dismiss`,await bubble(p).isVisible());
  await p.evaluate(()=>window.__presence({count:2,viewers:['Alice Chen','Bob Rivera']}));
  await p.screenshot({path:out+`/presence-mobile-${width}.png`});
  await p.locator('#outside').tap();await closed(p);
  ok(`${width}: outside tap dismisses`,true);
  await button(p).tap();await opened(p);await button(p).tap();
  ok(`${width}: repeated tap does not toggle closed`,await bubble(p).getAttribute('data-pinned')==='true');
  await p.locator('#outside').tap();await closed(p);
  await p.setViewportSize({width,height:320});await button(p).tap();await opened(p);
  ok(`${width}: short viewport is collision constrained`,await fits(p));
  await mobile.close();
 }
 ok('no browser exceptions',errors.length===0);
}finally{
 await writeFile(out+'/presence-results.json',JSON.stringify({report,errors},null,2));
 await browser.close();
}