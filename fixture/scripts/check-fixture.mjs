/**
 * Fixture self-check.
 *
 * Asserts the artefact renders, that its `data-anno-*` contract holds (unique
 * ids, a label on every target, parseable semantics), and that each planted
 * hit-test case actually exhibits the geometry it claims. If someone "tidies"
 * the CSS and a planted case stops being hard, this fails loudly rather than
 * quietly making the test suite easier.
 *
 * Also asserts overlay-to-element alignment *after scrolling*, in all three
 * positioning contexts. The absence of that check is what let a real bug ship:
 * the inspector verified the header was sticky but never that its outline
 * tracked it, so outlines drifted away from the header as the page scrolled.
 *
 *   node scripts/check-fixture.mjs [url]
 *
 * Needs the dev server running. Resolves a browser via scripts/browser.mjs —
 * set CHROME_PATH if it can't find one, HEADED=1 to watch the run.
 */
import { launchBrowser } from './browser.mjs';

const URL = process.argv[2] ?? 'http://localhost:5180/';
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const errors = [];
// /favicon.ico is requested by the browser unprompted and is not part of the
// artefact; every other failed request is a real problem.
const IGNORED_REQUESTS = [/\/favicon\.ico$/];
page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
page.on('requestfailed', (r) => errors.push(`REQUESTFAILED ${r.url()}`));
page.on('response', (r) => {
  if (r.status() < 400) return;
  if (IGNORED_REQUESTS.some((re) => re.test(r.url()))) return;
  errors.push(`HTTP ${r.status()} ${r.url()}`);
});

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.removeItem('annotation-fixture-doc'));
await page.reload({ waitUntil: 'networkidle' });

// ---- the data-anno-* contract ---------------------------------------------

const contract = await page.evaluate(() => {
  const root = document.getElementById('artefact-root');
  const all = [...root.querySelectorAll('[data-anno-id]')];

  const byMode = {};
  const seen = new Set();
  const duplicates = [];
  const missingLabel = [];
  const badSemantic = [];
  // 'block' is implicit and must NOT be emitted — it's 63 of 86 targets.
  const redundantMode = [];

  for (const el of all) {
    const mode = el.dataset.annoMode ?? 'block';
    byMode[mode] = (byMode[mode] ?? 0) + 1;
    if (el.dataset.annoMode === 'block') redundantMode.push(el.dataset.annoId);
    if (seen.has(el.dataset.annoId)) duplicates.push(el.dataset.annoId);
    seen.add(el.dataset.annoId);
    if (!el.dataset.annoLabel?.trim()) missingLabel.push(el.dataset.annoId);
    if (el.dataset.annoSemantic !== undefined) {
      try {
        JSON.parse(el.dataset.annoSemantic);
      } catch {
        badSemantic.push(el.dataset.annoId);
      }
    }
  }
  return { total: all.length, byMode, duplicates, missingLabel, badSemantic, redundantMode };
});

console.log(`targets: ${contract.total}  ${JSON.stringify(contract.byMode)}\n`);
ok('ids are unique', contract.duplicates.length === 0, contract.duplicates.join(', '));
ok('every target has a label', contract.missingLabel.length === 0, contract.missingLabel.join(', '));
ok('semantic payloads parse', contract.badSemantic.length === 0, contract.badSemantic.join(', '));
ok(
  'block mode is implicit, never emitted',
  contract.redundantMode.length === 0,
  `${contract.redundantMode.length} emit it needlessly`,
);

// ---- planted case geometry -------------------------------------------------

const geom = await page.evaluate(() => {
  const root = document.getElementById('artefact-root');
  const el = (id) => root.querySelector(`[data-anno-id="${CSS.escape(id)}"]`);
  const rect = (id) => el(id)?.getBoundingClientRect();
  const same = (a, b) =>
    !!a && !!b &&
    Math.abs(a.x - b.x) < 0.6 && Math.abs(a.y - b.y) < 0.6 &&
    Math.abs(a.width - b.width) < 0.6 && Math.abs(a.height - b.height) < 0.6;

  const up = rect('wireframe.msg.m1.react.up');
  const down = rect('wireframe.msg.m1.react.down');
  const badge = rect('wireframe.msg.m1.react.up.count');
  const badgeEl = el('wireframe.msg.m1.react.up.count');
  const menu = rect('doc.header.menu');
  const para = el('spec.summary.body');
  const list = el('wireframe.threads');
  const cellEl = el('decisions.d-2.call');
  const cell = cellEl && JSON.parse(cellEl.dataset.annoSemantic);

  // A block target inside prose: has an id, and no explicit mode (block is
  // implicit) or an explicit block mode.
  const inlineBlocks = para
    ? [...para.querySelectorAll('[data-anno-id]')].filter(
        (n) => (n.dataset.annoMode ?? 'block') === 'block',
      ).length
    : 0;

  return {
    c1: same(rect('wireframe.msg.m2'), rect('wireframe.msg.m2.body')),
    c2: !!up && !!down && Math.abs(down.left - up.right) <= 1.1,
    c3: !!up && !!badge && (badge.top < up.top - 1 || badge.right > up.right + 1),
    // The badge must also win the paint order, or its own centre hit-tests to
    // the neighbouring button and the case is occluded rather than planted.
    c3z: !!badgeEl && getComputedStyle(badgeEl).zIndex !== 'auto',
    c4: !!menu && menu.width <= 20 && menu.height <= 20,
    c5: para?.dataset.annoMode === 'text' && inlineBlocks >= 2,
    c5n: inlineBlocks,
    c6: !!list && list.scrollHeight > list.clientHeight + 4,
    c7: getComputedStyle(el('doc.header')).position === 'sticky',
    c10: !!(cell && cell.row && cell.column && cell.value),
  };
});

ok('case 1 — card and body rects identical', geom.c1);
ok('case 2 — reaction buttons share an edge', geom.c2);
ok('case 3 — badge escapes its parent box', geom.c3);
ok('case 3 — badge wins paint order over its sibling', geom.c3z);
// elementFromPoint needs the badge on screen, so scroll it in first.
const c3hit = await page.evaluate(async () => {
  const el = document.querySelector('[data-anno-id="wireframe.msg.m1.react.up.count"]');
  el.scrollIntoView({ block: 'center' });
  await new Promise((r) => setTimeout(r, 250));
  const b = el.getBoundingClientRect();
  const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
  return hit?.dataset?.annoId ?? hit?.className ?? 'nothing';
});
ok('case 3 — badge centre hit-tests to the badge',
   c3hit === 'wireframe.msg.m1.react.up.count', `hit ${c3hit}`);
ok('case 4 — target smaller than a 24px pin', geom.c4);
ok('case 5 — block targets inside text-mode prose', geom.c5, `${geom.c5n} inline block target(s)`);
ok('case 6 — thread list actually overflows', geom.c6);
ok('case 7 — header is sticky', geom.c7);
ok('case 10 — grid cells carry row/column/value', geom.c10);

// case 8 — conditional mount adds targets
const before = await page.locator('#artefact-root [data-anno-id]').count();
await page.click('[data-anno-id="doc.header.menu"]');
await page.waitForSelector('[data-anno-id="doc.header.menu.list"]');
const after = await page.locator('#artefact-root [data-anno-id]').count();
ok(`case 8 — conditional mount adds targets (${before} → ${after})`, after > before);
await page.click('[data-anno-id="doc.header.menu"]');

// case 9 — reorder must not change the id set
const msgIds = () =>
  page.$$eval('#artefact-root [data-anno-id^="wireframe.msg."]', (els) =>
    els.map((e) => e.dataset.annoId).sort(),
  );
const pre = await msgIds();
await page.click('[data-anno-id="wireframe.panel.sort"]');
await page.waitForTimeout(150);
const post = await msgIds();
ok('case 9 — id set stable across reorder', JSON.stringify(pre) === JSON.stringify(post) && pre.length > 0);
await page.click('[data-anno-id="wireframe.panel.sort"]');

// ---- overlay alignment through scroll -------------------------------------
// The regression guard. Outlines must stay on their elements in all three
// positioning contexts: normal flow, sticky/fixed, and inside an inner scroll
// container.

await page.click('.dev-panel-toggle');
await page.check('.dev-check input'); // outline all targets
// Park the pointer away from the panel: hovering a planted-case row fires its
// onMouseEnter, which narrows the outlines to that case's targets.
await page.mouse.move(20, 400);
await page.waitForTimeout(400);

const alignment = async (label) => {
  const r = await page.evaluate(() => {
    const root = document.getElementById('artefact-root');
    let worst = { id: null, drift: 0 };
    let compared = 0;
    for (const box of document.querySelectorAll('.dev-box')) {
      // Match by id, not label: labels are non-unique by contract.
      const id = box.dataset.devTarget;
      const br = box.getBoundingClientRect();
      if (!id || br.width === 0) continue;
      const el = root.querySelector(`[data-anno-id="${CSS.escape(id)}"]`);
      if (!el) continue;
      const er = el.getBoundingClientRect();
      if (er.width === 0) continue;
      compared++;
      const drift = Math.abs(er.top - br.top) + Math.abs(er.left - br.left);
      if (drift > worst.drift) worst = { id, drift: Math.round(drift) };
    }
    return { ...worst, compared };
  });
  // A vacuous pass is worse than a failure: assert we actually compared boxes.
  ok(`overlay aligned ${label}`, r.compared > 10 && r.drift <= 3,
     `${r.compared} compared, worst drift ${r.drift}px on ${r.id ?? '—'}`);
};

await alignment('at scroll top');
await page.evaluate(() => window.scrollTo({ top: 900, behavior: 'instant' }));
await page.waitForTimeout(450);
await alignment('after page scroll (incl. sticky header + sidebar)');

await page.evaluate(() => {
  document.querySelector('[data-anno-id="wireframe.panel"]').scrollIntoView({ block: 'center' });
});
await page.waitForTimeout(350);
await page.evaluate(() => {
  document.querySelector('[data-anno-id="wireframe.threads"]').scrollTop = 90;
});
await page.waitForTimeout(450);
await alignment('after inner scroll-container scroll');

// And nothing may be drawn outside the container that clips it.
const escapees = await page.evaluate(() => {
  const root = document.getElementById('artefact-root');
  const list = root.querySelector('[data-anno-id="wireframe.threads"]');
  const lr = list.getBoundingClientRect();
  const inside = new Set(
    [...list.querySelectorAll('[data-anno-id]')].map((n) => n.dataset.annoLabel),
  );
  return [...document.querySelectorAll('.dev-box')].filter((box) => {
    const tag = box.querySelector('.dev-box-tag')?.textContent;
    if (!inside.has(tag)) return false;
    const r = box.getBoundingClientRect();
    return r.width > 0 && (r.bottom < lr.top - 4 || r.top > lr.bottom + 4);
  }).length;
});
ok('case 6 — no outline escapes the inner scroll container', escapees === 0, `${escapees} escapee(s)`);

await page.screenshot({ path: 'fixture.png', fullPage: true });
await browser.close();

let failed = results.some((r) => !r.pass);
console.log(`\nconsole/network errors: ${errors.length ? errors.join(' | ') : 'none'}`);
if (errors.length) failed = true;
console.log(failed ? '\nFIXTURE CHECK FAILED' : '\nfixture check passed');
process.exit(failed ? 1 : 0);
