/**
 * Isolated regression for Resolve -> Show resolved. A test-only controlled host;
 * never reads or changes live fixture comments. Keyboard toolbar activation
 * avoids masking a stale popup selection with desktop outside-pointer dismissal.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchBrowser } from './browser.mjs';

const out = process.env.TEST_OUTPUT_DIR ?? 'test-output';
await mkdir(out, { recursive: true });
const browser = await launchBrowser();
const report = [], errors = [];
const ok = (name, value) => {
  report.push({ name, pass: !!value });
  console.log(value ? 'PASS' : 'FAIL', name);
  assert.ok(value, name);
};
const host = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:24px;font-family:sans-serif}#targets{max-width:260px;margin-top:70px}</style>
<script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
</script></head><body><main id="targets">
<h1 data-anno-id="qa.title" data-anno-label="Resolve target">Resolve target</h1>
<p>Isolated popup lifecycle test.</p></main><div id="mount"></div>
<script type="module">
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import {Annotations} from '/src/annotations/index.ts';
const root=ReactDOM.createRoot(document.getElementById('mount'));
const author={id:'qa',name:'Isolated QA'};
let doc={version:1,threads:[]}, readOnly=false;
window.__resetVersion=0;
window.__changes=0;
function render(){
 root.render(React.createElement('div',{'data-reset':window.__resetVersion},
  React.createElement(Annotations,{key:window.__resetVersion,
   root:document.getElementById('targets'),annotations:doc,author,readOnly,debugToolbar:true,
   onChange:next=>{doc=next;window.__doc=doc;window.__changes++;render();}})));
}
window.__reset=(threads,readonly=false)=>{
 doc={version:1,threads};readOnly=readonly;window.__doc=doc;
 window.__changes=0;window.__resetVersion++;render();
};
render();
</script></body></html>`;

const makeThread = (id, kind, status = 'open') => ({
  id, status,
  refs: [{ kind: 'anno_id', id: kind === 'bubble' ? 'qa.title' : 'qa.missing', label: 'Resolve target' }],
  comments: [{
    id: `${id}-c`, author: { id: 'qa', name: 'Isolated QA' },
    createdAt: '2026-09-17T16:00:00Z', body: [{ kind: 'text', value: `Comment ${id}` }],
  }],
});
try {
  for (const profile of ['desktop', 'mobile']) for (const width of [375, 1400]) {
    const context = await browser.newContext({
      viewport: { width, height: 950 }, hasTouch: true,
      userAgent: profile === 'mobile'
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/resolve-popup-harness', r => r.fulfill({ contentType: 'text/html', body: host }));
    await page.goto((process.env.FIXTURE_URL??'http://localhost:5180')+'/resolve-popup-harness', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.__reset === 'function');
    const reset = async (threads, readOnly = false) => {
      await page.evaluate(({ threads, readOnly }) => window.__reset(threads, readOnly), { threads, readOnly });
      await page.waitForFunction(() =>
        document.querySelector('#mount > div')?.dataset.reset === String(window.__resetVersion));
    };
    const panel = kind => page.locator(kind === 'bubble' ? '.ca-popover' : '.ca-tray:visible');
    const trigger = kind => page.locator(kind === 'bubble' ? '.ca-pin' : '[data-testid="toggle-comments"]').first();
    const filter = async label => {
      if (!await page.locator('.ca-tray').isVisible()) await page.getByTestId('toggle-comments').click();
      await page.getByRole('button', {name: label+' discussions', exact:true}).click();
      await page.locator('.ca-tray .ca-close').click();
    };
    const open = async kind => { await trigger(kind).click(); await panel(kind).waitFor(); };
    const resolve = async (kind,id) => {
      await panel(kind).locator(`[data-thread-id="${id}"]`).getByRole('button',{name:'Resolve',exact:true}).click();
    };
    for (const kind of ['bubble','unanchored']) {
      const prefix = `${profile} ${width}px ${kind}`;
      for (const sibling of [false,true]) {
        await reset([makeThread('only',kind),...(sibling?[makeThread('resolved-sibling',kind,'resolved')]:[])]);
        await filter('Open');await open(kind);
        ok(`${prefix}: Open hides resolved siblings`,await panel(kind).locator('.ca-thread:visible').count()===1);
        await resolve(kind,'only');
        await page.waitForTimeout(80);
        ok(`${prefix}: filtered final result closes popup but retains reader`,kind==='bubble'
          ? await panel(kind).count()===0
          : await panel(kind).isVisible()&&await panel(kind).locator('.ca-thread:visible').count()===0);
        ok(`${prefix}: one status event preserves comment`,await page.evaluate(()=>window.__changes===1
          &&window.__doc.threads[0].comments.length===1
          &&window.__doc.threads[0].log.filter(e=>e.kind==='resolve').length===1));
        await filter('All');
        ok(`${prefix}: changing filter never resurrects closed popup`,await page.locator('.ca-popover').count()===0);
        await open(kind);
        ok(`${prefix}: explicit opening includes resolved histories`,await panel(kind).locator('.ca-thread-resolved:visible').count()===(sibling?2:1));
      }
      await reset([makeThread('first',kind),makeThread('last',kind)]);
      await filter('Open');await open(kind);await resolve(kind,'first');
      await panel(kind).locator('[data-thread-id="first"]').waitFor({state:'hidden'});
      ok(`${prefix}: surviving filtered card stays visible`,await panel(kind).locator('.ca-thread:visible').count()===1);
      await resolve(kind,'last');await filter('All');
      ok(`${prefix}: group selection stays closed after last result disappears`,await page.locator('.ca-popover').count()===0);

      await reset([makeThread('shown',kind)]);await open(kind);
      await resolve(kind,'shown');await panel(kind).locator('.ca-thread-resolved').waitFor();
      ok(`${prefix}: default All retains resolved card`,await panel(kind).getByRole('button',{name:'Reopen',exact:true}).count()===1);
      await panel(kind).getByRole('button',{name:'Reopen',exact:true}).click();
      ok(`${prefix}: Reopen still works`,await panel(kind).getByRole('button',{name:'Resolve',exact:true}).count()===1);

      await reset([makeThread('readonly',kind)],true);await open(kind);
      ok(`${prefix}: read-only has no mutation controls`,await panel(kind).getByRole('button',{name:/^(Resolve|Reopen|Reply)$/}).count()===0
        &&await page.evaluate(()=>window.__changes===0));
    }
    await context.close();
  }
  ok('No browser exceptions', errors.length === 0);
} finally {
  await writeFile(`${out}/resolve-popup-results.json`, JSON.stringify({ report, errors }, null, 2));
  await browser.close();
}