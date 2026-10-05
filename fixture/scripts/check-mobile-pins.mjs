/** Mobile marker sizes: isolated in-memory docs; never touches review-server state. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchBrowser } from './browser.mjs';

const out = process.env.TEST_OUTPUT_DIR ?? 'test-output/mobile-pins';
await mkdir(out, { recursive: true });
const browser = await launchBrowser(), results = [], errors = [];
const profiles = [
  { name: 'desktop-wide', width: 1280, size: 24 },
  { name: 'desktop-narrow', width: 390, size: 24 },
  { name: 'windows-touch-laptop', width: 1280, size: 24, hasTouch: true, touchPoints: 10,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36' },
  { name: 'iphone', width: 390, size: 36, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' },
  { name: 'android', width: 412, size: 36, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36' },
  { name: 'ipad-desktop-ua', width: 1024, size: 36, hasTouch: true, touchPoints: 5,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15' },
  { name: 'unknown', width: 390, size: 24, userAgent: 'UnidentifiedBrowser/1.0' },
  { name: 'explicit-mobile', width: 1280, size: 36, override: 'mobile' },
  { name: 'explicit-desktop-on-iphone', width: 390, size: 24, override: 'desktop', hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' },
];
function host(override) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{};
window.$RefreshSig$=()=>(type)=>type; window.__vite_plugin_react_preamble_installed__=true;
</script><style>
body{margin:0;height:1500px}
#targets > *{position:absolute;left:60px;margin:0;width:120px;height:60px}
#single{top:220px} #group{top:370px} #small{top:520px;width:30px;height:30px}
#fresh{top:660px} #resolved{top:820px} #fixed{position:fixed;top:120px;left:240px;width:60px}
</style></head><body><main id="targets">
<div id="single" data-anno-id="qa.single" data-anno-label="Single">Single</div>
<div id="group" data-anno-id="qa.group" data-anno-label="Group">Group</div>
<div id="small" data-anno-id="qa.small" data-anno-label="Small">Small</div>
<div id="fresh" data-anno-id="qa.fresh" data-anno-label="Fresh">Fresh draft</div>
<div id="resolved" data-anno-id="qa.resolved" data-anno-label="Resolved">Resolved</div>
<div id="fixed" data-anno-id="qa.fixed" data-anno-label="Fixed">Fixed</div>
</main><div id="mount"></div><script type="module">
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import {Annotations} from '/src/annotations/index.ts';
const author={id:'qa-person',name:'Isolated QA'};
let doc={version:1,threads:['single','group','group','small','resolved','fixed'].map((id,i)=>({
 id:'qa-discussion-'+i,status:id==='resolved'?'resolved':'open',refs:[{kind:'anno_id',id:'qa.'+id,label:id}],
 pin:{xPct:0.5,yPct:0.5},comments:[{id:'qa-comment-'+i,author,createdAt:'2026-09-24T00:00:00Z',body:[{kind:'text',value:'Seed '+i}]}]
}))};
let interaction=${JSON.stringify(override ? {deviceProfile:override} : {})};
const root=ReactDOM.createRoot(document.getElementById('mount'));
function render(){root.render(React.createElement(Annotations,{root:document.getElementById('targets'),author,annotations:doc,interaction,
 onChange:next=>{doc=next;render();}}));}
window.__setProfile=value=>{interaction={deviceProfile:value};render();};render();
</script></body></html>`;
}
const rect = async locator => locator.evaluate(e => {
  const r = e.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom };
});
try {
  for (const p of profiles) {
    const context = await browser.newContext({viewport:{width:p.width,height:950},hasTouch:p.hasTouch ?? false,
      ...(p.userAgent ? {userAgent:p.userAgent} : {})});
    if (p.touchPoints) await context.addInitScript(n => Object.defineProperty(navigator,'maxTouchPoints',{get:()=>n}), p.touchPoints);
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(`${p.name}: ${e.message}`));
    await page.route('**/mobile-pins-harness', r => r.fulfill({contentType:'text/html',body:host(p.override)}));
    await page.goto((process.env.FIXTURE_URL??'http://localhost:5180')+'/mobile-pins-harness', {waitUntil:'networkidle'});
    const pin = id => page.locator(`.ca-pin[data-ca-targets~="qa.${id}"]`);
    await pin('single').waitFor();
    const single = await rect(pin('single'));
    assert.equal(single.width, p.size, p.name+' width');
    assert.equal(single.height, p.size, p.name+' height');
    for (const id of ['group','small','fixed']) {
      assert.equal((await rect(pin(id))).width,p.size,`${p.name}: ${id} width`);
      assert.equal((await rect(pin(id))).height,p.size,`${p.name}: ${id} height`);
    }
    assert.equal(await pin('group').innerText(),'2','same-target discussions still cluster');
    const small = await rect(page.locator('#small')), smallPin = await rect(pin('small'));
    const smallOffset = p.size > 30 ? {x:small.right-2,y:small.y} : {x:small.x+15-2,y:small.y+15};
    assert.equal(smallPin.x,smallOffset.x,p.name+' small-target x');
    assert.equal(smallPin.bottom,smallOffset.y,p.name+' small-target y');
    await pin('single').click();
    await page.locator('.ca-popover').waitFor({state:'visible'});
    await page.waitForTimeout(100);
    const popup = await rect(page.locator('.ca-popover'));
    if (p.width >= 1024) {
      assert.ok(Math.abs(popup.x-single.right-12)<1,p.name+' popup gap');
      assert.ok(Math.abs(popup.y-single.y)<1,p.name+' popup top aligned');
    }
    await page.locator('.ca-popover').press('Escape');
    // All statuses are visible by default in the unified reader.
    await pin('resolved').waitFor();
    assert.equal((await rect(pin('resolved'))).width,p.size,p.name+' resolved size');
    await page.getByRole('button',{name:'Comment mode',exact:true}).click();
    await page.locator('#fresh').click();
    await page.locator('.ca-pin-draft').waitFor();
    assert.equal((await rect(page.locator('.ca-pin-draft'))).width,p.size,p.name+' draft width');
    assert.equal((await rect(page.locator('.ca-pin-draft'))).height,p.size,p.name+' draft height');
    await page.locator('.ca-popover').press('Escape');
    if (await page.getByRole('button',{name:'Comment mode',exact:true}).getAttribute('aria-pressed') === 'true')
      await page.getByRole('button',{name:'Comment mode',exact:true}).click();
    // Larger count badges must grow rather than clip their text.
    await pin('single').evaluate(e=>{e.textContent='12345';});
    assert.ok(await pin('single').evaluate(e=>e.scrollWidth<=e.clientWidth),p.name+' count not clipped');
    const wide = await rect(pin('single'));
    // An explicit override updates geometry and inherited CSS without remounting.
    await page.evaluate(()=>window.__setProfile('mobile'));
    await page.waitForTimeout(80);
    assert.equal((await rect(pin('fixed'))).height,36,p.name+' override mobile');
    await page.evaluate(()=>window.__setProfile('desktop'));
    await page.waitForTimeout(80);
    assert.equal((await rect(pin('fixed'))).height,24,p.name+' override desktop');
    results.push({profile:p.name,viewport:p.width,single,popup,wideCount:wide,passed:true});
    console.log(`PASS ${p.name}: ${single.width}×${single.height} CSS px; grouped/resolved/fixed/draft, small targets, popup, override`);
    await context.close();
  }
  assert.deepEqual(errors,[]);
} finally {
  await writeFile(`${out}/results.json`,JSON.stringify({results,errors},null,2));
  await browser.close();
}
