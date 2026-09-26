/**
 * Additive chart-fixture regression. Run against `npm run dev`.
 * Keeps the original planted cases in check-fixture.mjs; this covers the six
 * same-DOM charts, mode switches, stable target ids, and comment persistence.
 * Synthetic comments go only to the dev harness, never the published app.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { launchBrowser } from './browser.mjs';
import { reset, readDoc } from './dev-client.mjs';

const url = process.argv[2] ?? 'http://localhost:5180/';
const output = process.env.TEST_OUTPUT_DIR ?? 'test-output';
await mkdir(output, { recursive: true });
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errors.push(`HTTP ${r.status()}: ${r.url()}`); });
const checks = [];
const ok = (name, condition) => { checks.push({ name, pass: !!condition }); assert.ok(condition, name); console.log(`ok ${name}`); };
const chart = id => page.locator(`[data-fixture="${id}"]`);
const choose = async (id, group, option) => {
  await chart(id).getByRole('group', { name: group, exact: true }).getByRole('button', { name: option, exact: true }).click();
  await page.waitForTimeout(450);
};
const ready = async () => {
  await page.locator('[data-ready="vega"]').filter({ hasText: 'Ready' }).waitFor();
  await page.waitForFunction(() => document.querySelector('[data-fixture="F"] .ledger')?.textContent.includes('8,000'));
};
const contract = async () => page.locator('#artifact-root').evaluate(root => {
  const all = [...root.querySelectorAll('[data-anno-id]')];
  return {
    ids: all.map(e => e.dataset.annoId),
    invalid: all.filter(e => !e.dataset.annoLabel || e.dataset.annoMode === 'block' ||
      (e.dataset.annoSemantic && !JSON.parse(e.dataset.annoSemantic))).map(e => e.dataset.annoId),
  };
});
try {
  await reset(page, url);
  await ready();
  ok('six fixtures mounted together, without iframe boundaries', await page.locator('.chart-examples [data-fixture]').count() === 6 && await page.locator('.chart-examples iframe').count() === 0);
  const initial = await contract();
  ok('unique, labelled, parseable annotation targets', new Set(initial.ids).size === initial.ids.length && initial.invalid.length === 0);
  ok('all original fixture ids still present', initial.ids.filter(id => !id.startsWith('charts.')).length === 90);

  // Optional local pre-change snapshot proves styles and geometry are unchanged.
  if (process.env.BASELINE_JSON) {
    const before = JSON.parse(await readFile(process.env.BASELINE_JSON, 'utf8'));
    const after = await page.locator('.doc').evaluate(doc => {
      const props = ['fontFamily','fontSize','lineHeight','color','backgroundColor','padding','margin','border','position','display','width','height'];
      return [...doc.querySelectorAll('[data-anno-id]')].map(el => ({ id:el.dataset.annoId,label:el.dataset.annoLabel,text:el.textContent,
        style:Object.fromEntries(props.map(p => [p,getComputedStyle(el)[p]])),
        rect:{x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height} }));
    });
    assert.deepEqual(after, before);
    ok('original 90 targets: identical text, labels, computed styles and geometry', true);
  }

  await choose('A', 'Window', 'Last 60 days');
  await chart('A').getByLabel('Hide Gamma stack').check();
  await page.locator('.chart-examples .tabs a').last().click();
  await page.locator('.chart-examples .tabs a').first().click();
  ok('jump navigation preserves chart controls', await chart('A').getByLabel('Hide Gamma stack').isChecked() && await chart('A').getByRole('button', { name:'Last 60 days', exact:true }).getAttribute('aria-pressed') === 'true');
  await choose('B','Line renderer','Canvas');
  ok('Nivo Canvas has nonzero display and buffer size', await chart('B').locator('canvas').evaluate(c => c.width > 100 && c.getBoundingClientRect().width > 100));
  await choose('C','Composition mode','Pie / SVG');
  await choose('C','Composition mode','ReportLab / PNG');
  ok('ReportLab image loads and is a region target', await chart('C').locator('img').evaluate(img => img.complete && img.naturalWidth > 100 && img.dataset.annoMode === 'region'));
  await choose('D','Density geometry','Heatmap');
  await choose('D','Vega renderer','SVG');
  await page.locator('[data-ready="vega"]').filter({ hasText: 'Ready' }).waitFor();
  ok('Vega SVG heatmap rendered', await chart('D').locator('.vega-holder svg.marks').count() === 1);
  await choose('E','Structure','Treemap');
  await choose('E','ECharts renderer','SVG');
  ok('ECharts SVG treemap rendered', await chart('E').locator('.plot svg').count() === 1);
  await chart('F').getByLabel('Auto-rotate').check();
  await chart('F').getByRole('button', { name:'Reset camera', exact:true }).click();
  ok('Three.js reset stops auto-rotation; WebGL canvas exists', !await chart('F').getByLabel('Auto-rotate').isChecked() && await chart('F').locator('canvas[data-renderer="webgl"]').count() === 1);

  await page.locator('.chart-examples').getByLabel('Stress data').check();
  await page.waitForFunction(() => document.querySelector('[data-fixture="F"] .ledger')?.textContent.includes('30,000'));
  await page.locator('[data-ready="vega"]').filter({ hasText: 'Ready' }).waitFor();
  ok('stress counts update in B, D, F', (await chart('B').locator('.ledger').textContent()).includes('24,000') && (await chart('D').locator('.ledger').textContent()).includes('20,000'));
  await page.locator('.chart-examples').getByLabel('Stress data').uncheck();
  await ready();
  const final = await contract();
  const base = initial.ids.filter(id => id !== 'charts.C.plot').sort();
  const toggled = final.ids.filter(id => id !== 'charts.C.raster').sort();
  assert.deepEqual(toggled, base);
  ok('target ids stable across modes, except the deliberate SVG/image swap', true);

  const firstInfo = chart('A').locator('.source summary');
  await firstInfo.click();
  ok('wiki provenance remains expandable', await chart('A').locator('.source[open]').count() === 1);
  await firstInfo.click();

  for (const id of ['A', 'F']) {
    const downloaded = page.waitForEvent('download');
    await chart(id).getByRole('button', { name:'Save PNG', exact:true }).click();
    const file = await downloaded;
    ok(`chart ${id} exports PNG`, file.suggestedFilename().endsWith('.png') && await file.failure() === null);
  }
  const manifestDownload = page.waitForEvent('download');
  await page.getByRole('button', {name:'Download test manifest',exact:true}).click();
  ok('test manifest downloads', (await manifestDownload).suggestedFilename() === 'chart-coverage-manifest.json');

  // Real user gesture through the unchanged annotation layer.
  await page.getByRole('button', { name:'Comment mode', exact:true }).click();
  await page.locator('[data-anno-id="charts.B.plot"]').click({position:{x:180,y:170}});
  await page.locator('.ca-composer-input').fill('Chart fixture smoke test');
  await page.keyboard.press('Enter');
  await page.waitForFunction(async () => {
    const d = await window.__annoDoc();
    return d.threads.some(t => t.refs[0]?.id === 'charts.B.plot');
  });
  ok('comment saves against Canvas plot stable id', (await readDoc(page)).threads.some(t => t.refs[0]?.id === 'charts.B.plot'));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.reload({waitUntil:'networkidle'});
  await ready();
  ok('comment survives reload', (await readDoc(page)).threads.some(t => t.refs[0]?.id === 'charts.B.plot'));

  for (const id of 'ABCDEF') {
    await chart(id).scrollIntoViewIfNeeded();
    await page.waitForTimeout(180);
    await chart(id).screenshot({path:`${output}/chart-${id}.png`});
  }
  for (const width of [560, 375, 320]) {
    await page.setViewportSize({width,height:900});
    await page.waitForTimeout(600);
    const bounds = await page.locator('.chart-examples').evaluate(root => ({
      width:root.getBoundingClientRect().width,
      scroll:root.scrollWidth,
      cards:[...root.querySelectorAll('[data-fixture]')].map(el => ({w:el.getBoundingClientRect().width, sw:el.scrollWidth}))
    }));
    ok(`chart section fits ${width}px`, bounds.width <= width && bounds.scroll <= bounds.width + 1 && bounds.cards.every(c => c.sw <= c.w + 1));
  }
  await page.locator('.chart-examples').screenshot({path:`${output}/charts-mobile.png`});
  ok('no page/network errors', errors.length === 0);
} finally {
  await writeFile(`${output}/chart-examples.json`, JSON.stringify({checks,errors},null,2));
  await browser.close();
}