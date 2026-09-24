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
    await page.goto('http://localhost:5180/resolve-popup-harness', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.__reset === 'function');
    const reset = async (threads, readOnly = false) => {
      await page.evaluate(({ threads, readOnly }) => window.__reset(threads, readOnly), { threads, readOnly });
      await page.waitForFunction(() =>
        document.querySelector('#mount > div')?.dataset.reset === String(window.__resetVersion));
    };
    const panel = kind => page.locator(kind === 'bubble' ? '.ca-popover' : '.ca-tray');
    const trigger = kind => page.locator(kind === 'bubble' ? '.ca-pin' : '[data-testid="unanchored"]').first();
    const allPopups = page.locator('.ca-popover,.ca-tray');
    const resolvedToggle = page.locator('[data-testid="toggle-resolved"]');
    const toggleResolved = async () => {
      await resolvedToggle.focus();
      await page.keyboard.press('Enter');
    };
    const open = async kind => {
      await trigger(kind).click();
      await panel(kind).locator('.ca-thread').first().waitFor();
    };
    const resolve = async (kind, id) => {
      await panel(kind).locator(`[data-thread-id="${id}"]`).getByRole('button', { name: 'Resolve', exact: true }).click();
    };
    const remainsClosed = async name => {
      await page.waitForTimeout(100);
      ok(name, await allPopups.count() === 0);
    };
    for (const kind of ['bubble', 'unanchored']) {
      const prefix = `${profile} ${width}px ${kind}`;
      for (const hiddenSibling of [false, true]) {
        await reset([
          makeThread('only', kind),
          ...(hiddenSibling ? [makeThread('already-resolved', kind, 'resolved')] : []),
        ]);
        await open(kind);
        ok(`${prefix}: only open card visible (hidden sibling=${hiddenSibling})`,
          await panel(kind).locator('.ca-thread').count() === 1);
        await resolve(kind, 'only');
        await allPopups.waitFor({ state: 'detached' });
        ok(`${prefix}: resolving last card restores toolbar`, await page.locator('.ca-toolbar').isVisible());
        ok(`${prefix}: one resolve event, comment preserved`, await page.evaluate(() =>
          window.__changes === 1 &&
          window.__doc.threads.find(t => t.id === 'only').status === 'resolved' &&
          window.__doc.threads.find(t => t.id === 'only').comments.length === 1 &&
          window.__doc.threads.find(t => t.id === 'only').log.filter(e => e.kind === 'resolve').length === 1));
        if (kind === 'unanchored') {
          ok(`${prefix}: unanchored selection cleared`, await trigger(kind).getAttribute('aria-pressed') === 'false');
        }
        await toggleResolved();
        await remainsClosed(`${prefix}: Show resolved cannot resurrect popup (hidden sibling=${hiddenSibling})`);
        await open(kind);
        ok(`${prefix}: explicit reopening still works`,
          await panel(kind).locator('.ca-thread-resolved').count() === (hiddenSibling ? 2 : 1));
      }

      await reset([makeThread('first', kind), makeThread('last', kind)]);
      await open(kind);
      await resolve(kind, 'first');
      await panel(kind).locator('[data-thread-id="first"]').waitFor({ state: 'detached' });
      ok(`${prefix}: grouped popup keeps remaining open card`,
        await panel(kind).locator('.ca-thread').count() === 1 &&
        await panel(kind).locator('[data-thread-id="last"]').count() === 1);
      await resolve(kind, 'last');
      await allPopups.waitFor({ state: 'detached' });
      await toggleResolved();
      await remainsClosed(`${prefix}: final card in group closes selection permanently`);

      await reset([makeThread('shown', kind)]);
      await toggleResolved();
      await open(kind);
      await resolve(kind, 'shown');
      await panel(kind).locator('.ca-thread-resolved').waitFor();
      ok(`${prefix}: with resolved shown, popup stays open`,
        await panel(kind).getByRole('button', { name: 'Reopen', exact: true }).count() === 1);
      await panel(kind).getByRole('button', { name: 'Reopen', exact: true }).click();
      ok(`${prefix}: Reopen still works in retained popup`,
        await panel(kind).locator('.ca-thread-resolved').count() === 0 &&
        await panel(kind).getByRole('button', { name: 'Resolve', exact: true }).count() === 1);

      await reset([makeThread('readonly', kind)], true);
      await open(kind);
      ok(`${prefix}: read-only hides mutation controls`, await panel(kind).getByRole('button', { name: /^(Resolve|Reopen|Reply)$/ }).count() === 0);
      ok(`${prefix}: read-only attempt neither resolves nor closes`,
        await panel(kind).count() === 1 && await page.evaluate(() =>
          window.__changes === 0 && window.__doc.threads[0].status === 'open'));
    }
    await context.close();
  }
  ok('No browser exceptions', errors.length === 0);
} finally {
  await writeFile(`${out}/resolve-popup-results.json`, JSON.stringify({ report, errors }, null, 2));
  await browser.close();
}