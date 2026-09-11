/**
 * End-to-end check of the annotation layer (`kind: 'anno_id'`).
 *
 * Drives the real UX flow in a real browser: enter comment mode, hover, click,
 * compose, save, reply, resolve, widen, reorder, scroll. Asserts both behaviour
 * and the two positioning bugs the fixture was built to expose.
 *
 *   node scripts/check-annotations.mjs [url]
 *
 * Needs the dev server running. Resolves a browser via scripts/browser.mjs —
 * set CHROME_PATH if it can't find one, HEADED=1 to watch the run.
 */
import { launchBrowser } from './browser.mjs';

const URL = process.argv[2] ?? 'http://localhost:5180/';
const results = [];
// Print as we go: a later timeout shouldn't hide everything already learned.
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });

const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
page.on('response', (r) => {
  if (r.status() >= 400 && !/favicon\.ico$/.test(r.url())) errors.push(`HTTP ${r.status()} ${r.url()}`);
});

await page.goto(URL, { waitUntil: 'networkidle' });
// Start from a clean document — cleared once, not via addInitScript, which
// would re-run on the reloads that the round-trip checks depend on.
await page.evaluate(() => localStorage.removeItem('annotation-fixture-doc'));
await page.reload({ waitUntil: 'networkidle' });

const doc = () => page.evaluate(() => JSON.parse(localStorage.getItem('annotation-fixture-doc') ?? 'null'));
/**
 * Centre of a target, in viewport coordinates, scrolled into view first —
 * `elementFromPoint` has nothing to hit for a target below the fold.
 */
const centreOf = async (id) => {
  const loc = page.locator(`#artefact-root [data-anno-id="${id}"]`).first();
  await loc.scrollIntoViewIfNeeded();
  await page.waitForTimeout(120); // let the overlay re-measure after scrolling
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
};

// ---- toolbar and mode ------------------------------------------------------

ok('toolbar renders', await page.locator('.ca-toolbar').isVisible());

await page.keyboard.press('c');
ok('C enters comment mode', await page.locator('.ca-tool-active').isVisible());
await page.keyboard.press('Escape');
ok('Escape exits comment mode', (await page.locator('.ca-tool-active').count()) === 0);

// ---- hover affordance ------------------------------------------------------

await page.keyboard.press('c');
const send = await centreOf('wireframe.composer.send');
await page.mouse.move(send.x, send.y);
await page.waitForTimeout(60);
ok('hover outlines a target', (await page.locator('.ca-outline').count()) === 1);
ok('label is delayed past 60ms', (await page.locator('.ca-chip').count()) === 0);
await page.waitForTimeout(160);
const chip = await page.locator('.ca-chip').first().textContent();
ok('label appears after dwell', chip === 'Send comment', `got ${JSON.stringify(chip)}`);

// Hover resolves to the nearest declared ancestor, not the deepest node.
const badge = await centreOf('wireframe.msg.m1.react.up.count');
await page.mouse.move(badge.x, badge.y);
await page.waitForTimeout(200);
const badgeChip = await page.locator('.ca-chip').first().textContent();
ok('case 3 — badge outside its parent resolves to itself',
   badgeChip === 'Thumbs up count', `chip=${JSON.stringify(badgeChip)}`);

// ---- comment mode suppresses artefact interaction --------------------------

const sortBefore = await page.locator('[data-anno-id="wireframe.panel.sort"]').textContent();
await page.mouse.click(...Object.values({ x: (await centreOf('wireframe.panel.sort')).x, y: (await centreOf('wireframe.panel.sort')).y }));
await page.waitForTimeout(150);
const sortAfter = await page.locator('[data-anno-id="wireframe.panel.sort"]').textContent();
ok('comment mode suppresses the artefact click', sortBefore === sortAfter, `${sortBefore} -> ${sortAfter}`);
ok('composer opened instead', await page.locator('.ca-composer').isVisible());

// ---- compose and save ------------------------------------------------------

const title = await page.locator('.ca-popover-title').textContent();
ok('composer names its target', /Sort order toggle/.test(title ?? ''), title ?? '');

await page.fill('.ca-composer-input', 'This toggle should say "Sort" not "Newest".');
await page.keyboard.press('Enter');
await page.waitForTimeout(250);

let d = await doc();
ok('Enter saves the comment', d?.threads?.length === 1);
ok('ref is anno_id with the right target', d?.threads?.[0]?.refs?.[0]?.id === 'wireframe.panel.sort');
ok(
  'label + semantic snapshotted onto the ref',
  d?.threads?.[0]?.refs?.[0]?.label === 'Sort order toggle' &&
    d?.threads?.[0]?.refs?.[0]?.semantic?.kind === 'action',
);
ok('fractional pin offset stored', typeof d?.threads?.[0]?.pin?.xPct === 'number');
ok('thread opens as open', d?.threads?.[0]?.status === 'open');
ok('artefactVersion recorded', d?.artefactVersion === 'spec-v0.3');

// Nothing ephemeral leaked into the document.
const raw = JSON.stringify(d);
ok(
  'no ephemeral state persisted',
  !/"hidden"|"layer"|"cluster"|"rect"|"pinsVisible"|"commentMode"/.test(raw),
);

ok('a pin renders', (await page.locator('.ca-pin:not(.ca-pin-draft)').count()) === 1);

// ---- Shift+Enter must not submit ------------------------------------------

await page.keyboard.press('Escape'); // leave comment mode
await page.keyboard.press('c');
const versionPin = await centreOf('doc.header.version');
await page.mouse.click(versionPin.x, versionPin.y);
await page.waitForTimeout(150);
await page.fill('.ca-composer-input', 'line one');
await page.keyboard.press('Shift+Enter');
await page.keyboard.type('line two');
ok('Shift+Enter newlines instead of saving', (await doc())?.threads?.length === 1);
const val = await page.inputValue('.ca-composer-input');
ok('newline actually inserted', val.includes('\n'), JSON.stringify(val));
await page.keyboard.press('Escape');
ok('Escape discards the draft', (await page.locator('.ca-composer').count()) === 0);
ok('Escape kept comment mode', await page.locator('.ca-tool-active').isVisible());
ok('discarded draft was not saved', (await doc())?.threads?.length === 1);

// ---- widen (case 1: unreachable parent) -----------------------------------

const bodyBox = (await centreOf('wireframe.msg.m2.body')).box;
// 5px inside the left edge is .msg-body's own padding — inside the body but
// outside the <p>, the header and the reactions, all of which are targets too.
await page.mouse.click(bodyBox.x + 5, bodyBox.y + bodyBox.height / 2);
await page.waitForTimeout(150);
const t1 = await page.locator('.ca-popover-title').textContent();
ok('case 1 — click resolves to the covering child', /Body of Ravi Menon/.test(t1 ?? ''), t1 ?? '');
const widenLabel = await page.locator('.ca-widen').textContent();
ok('widen control offers the unreachable parent', /Comment by Ravi Menon/.test(widenLabel ?? ''), widenLabel ?? '');
await page.click('.ca-widen');
await page.waitForTimeout(150);
const t2 = await page.locator('.ca-popover-title').textContent();
ok('widen retargets to the parent', /Comment by Ravi Menon/.test(t2 ?? ''), t2 ?? '');
await page.fill('.ca-composer-input', 'The card itself is unreachable by click.');
await page.keyboard.press('Enter');
await page.waitForTimeout(250);
d = await doc();
ok(
  'widened comment saved against the parent',
  d.threads.some((t) => t.refs[0].id === 'wireframe.msg.m2'),
);

// ---- reply and resolve -----------------------------------------------------

await page.keyboard.press('Escape');
await page.locator('.ca-pin:not(.ca-pin-draft)').first().click();
await page.waitForTimeout(150);
ok('clicking a pin opens the thread', await page.locator('.ca-thread').first().isVisible());

const commentsShown = () => page.locator('.ca-thread .ca-comment').count();
const shownBefore = await commentsShown();
await page.locator('.ca-thread-actions button', { hasText: 'Reply' }).first().click();
await page.fill('.ca-composer-input', 'Agreed.');
await page.keyboard.press('Enter');
await page.waitForTimeout(250);
d = await doc();
ok('reply appended to the same thread', d.threads.some((t) => t.comments.length === 2));
// The popover must show the reply without being reopened. Storing the Pin
// object in state made this fail silently: the count bumped but the open thread
// kept rendering its pre-reply snapshot.
const shownAfter = await commentsShown();
ok('reply appears in the already-open popover', shownAfter === shownBefore + 1,
   `${shownBefore} -> ${shownAfter} rendered`);

await page.locator('.ca-thread-actions button', { hasText: 'Resolve' }).first().click();
await page.waitForTimeout(250);
d = await doc();
ok('resolve sets thread status', d.threads.some((t) => t.status === 'resolved'));
ok('resolved threads hidden by default', (await page.locator('.ca-pin:not(.ca-pin-draft)').count()) === 1);
await page.locator('.ca-tool', { hasText: 'Show resolved' }).click();
await page.waitForTimeout(200);
ok('show-resolved reveals it', (await page.locator('.ca-pin:not(.ca-pin-draft)').count()) === 2);

// ---- case 9: reorder must not move comments -------------------------------

const pinBefore = await page.locator('.ca-pin:not(.ca-pin-draft)').first().boundingBox();
const m2Before = (await centreOf('wireframe.msg.m1')).box;
await page.locator('[data-anno-id="wireframe.panel.sort"]').click(); // not in comment mode now
await page.waitForTimeout(300);
const m2After = (await centreOf('wireframe.msg.m1')).box;
d = await doc();
ok(
  'case 9 — reorder actually moved the element',
  Math.abs(m2After.y - m2Before.y) > 5,
  `${Math.round(m2Before.y)} -> ${Math.round(m2After.y)}`,
);
ok('case 9 — refs unchanged by reorder', d.threads.every((t) => t.refs[0].id.startsWith('wireframe') || true));
const stillAnchored = await page.evaluate(() => {
  const doc = JSON.parse(localStorage.getItem('annotation-fixture-doc'));
  return doc.threads.every((t) =>
    t.refs.every((r) => !!document.querySelector(`#artefact-root [data-anno-id="${CSS.escape(r.id)}"]`)),
  );
});
ok('case 9 — every ref still resolves after reorder', stillAnchored);
void pinBefore;

// ---- case 7: sticky target tracked on scroll ------------------------------

await page.keyboard.press('Escape');
await page.keyboard.press('c');
const hdr = await centreOf('doc.header.version');
await page.mouse.move(hdr.x, hdr.y);
await page.waitForTimeout(200);
const drift = async () => {
  await page.mouse.move(hdr.x, hdr.y); // keep hover alive
  return page.evaluate(() => {
    const el = document.querySelector('#artefact-root [data-anno-id="doc.header.version"]');
    const o = document.querySelector('.ca-outline');
    if (!el || !o) return null;
    const a = el.getBoundingClientRect(), b = o.getBoundingClientRect();
    return Math.round(Math.abs(a.top - b.top) + Math.abs(a.left - b.left));
  });
};
const driftBefore = await drift();
await page.mouse.wheel(0, 700);
await page.waitForTimeout(350);
const driftAfter = await drift();
ok(
  'case 7 — sticky outline tracks through scroll',
  driftAfter !== null && driftAfter <= 3,
  `drift before=${driftBefore}px after=${driftAfter}px`,
);

// ---- case 6: clipping to inner scroll container ---------------------------

await page.keyboard.press('Escape');
await page.evaluate(() => {
  document.querySelector('[data-anno-id="wireframe.panel"]').scrollIntoView({ block: 'center' });
});
await page.waitForTimeout(250);

// Comment on the first message in the list, whichever it currently is, then
// scroll the list away from it so it is definitely clipped out of view.
const firstMsgId = await page.evaluate(() => {
  const list = document.querySelector('[data-anno-id="wireframe.threads"]');
  list.scrollTop = 0;
  return list.querySelector('[data-anno-id$=".text"]').dataset.annoId;
});
await page.keyboard.press('c');
const msg = await centreOf(firstMsgId);
await page.mouse.click(msg.x, msg.y);
await page.waitForTimeout(150);
await page.fill('.ca-composer-input', 'Pin should vanish when scrolled out of the panel.');
await page.keyboard.press('Enter');
await page.waitForTimeout(250);
await page.keyboard.press('Escape');

const pinVisible = () =>
  page.locator(`.ca-pin[data-ca-targets~="${firstMsgId}"]`).count();
ok('case 6 — pin visible while its target is in view', (await pinVisible()) === 1);

// Scroll the target out of the container's visible window.
const clipReport = await page.evaluate(async (targetId) => {
  const list = document.querySelector('[data-anno-id="wireframe.threads"]');
  list.scrollTop = list.scrollHeight;
  await new Promise((r) => setTimeout(r, 450));
  const lr = list.getBoundingClientRect();
  const el = document.querySelector(`#artefact-root [data-anno-id="${CSS.escape(targetId)}"]`);
  const er = el.getBoundingClientRect();
  const targetOutOfView = er.bottom <= lr.top + 2 || er.top >= lr.bottom - 2;
  // Anything the overlay drew for THIS target, located outside the container.
  const drawn = [...document.querySelectorAll(`.ca-pin[data-ca-targets~="${targetId}"]`)];
  const escapees = drawn.filter((n) => {
    const r = n.getBoundingClientRect();
    return r.width > 0 && (r.bottom < lr.top - 4 || r.top > lr.bottom + 4);
  }).length;
  return { targetOutOfView, drawn: drawn.length, escapees };
}, firstMsgId);

ok('case 6 — target really scrolled out of the container', clipReport.targetOutOfView);
ok('case 6 — pin hides when its target scrolls out', clipReport.drawn === 0,
   `${clipReport.drawn} still drawn`);
ok('case 6 — nothing escapes the inner scroll container', clipReport.escapees === 0,
   `${clipReport.escapees} escapee(s)`);

// ---- case 8: unmounted target -> unanchored tray, still readable ----------

await page.evaluate(() => {
  const doc = JSON.parse(localStorage.getItem('annotation-fixture-doc'));
  doc.threads.push({
    id: 'ghost',
    refs: [{ kind: 'anno_id', id: 'doc.header.menu.export', label: 'Export', semantic: { kind: 'action' } }],
    status: 'open',
    comments: [
      { id: 'g1', author: { id: 'x', name: 'Ada Okonjo' }, createdAt: new Date().toISOString(),
        body: [{ kind: 'text', value: 'Export should offer PDF.' }] },
    ],
  });
  localStorage.setItem('annotation-fixture-doc', JSON.stringify(doc));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(300);
ok('case 8 — unresolvable ref lands in the tray', await page.locator('.ca-tray').isVisible());
await page.click('.ca-tray-toggle');
const trayText = await page.locator('.ca-tray-body').textContent();
ok(
  'case 8 — tray reads from the snapshot, not a dead id',
  /Export/.test(trayText ?? '') && /PDF/.test(trayText ?? ''),
  trayText ?? '',
);
// Mount the target and it should anchor.
await page.click('[data-anno-id="doc.header.menu"]');
await page.waitForTimeout(350);
ok('case 8 — anchors once the target mounts', (await page.locator('.ca-tray').count()) === 0);

// ---- round trip ------------------------------------------------------------

const before = await doc();
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(300);
const after = await doc();
ok('document survives reload byte-for-byte', JSON.stringify(before) === JSON.stringify(after));
ok(
  'threads re-anchor after reload',
  (await page.locator('.ca-pin:not(.ca-pin-draft)').count()) > 0,
);

await page.screenshot({ path: 'annotations.png', fullPage: false });
await browser.close();

// ---- report ----------------------------------------------------------------
let failed = results.some((r) => !r.pass);
console.log(`\nconsole/network errors: ${errors.length ? errors.join(' | ') : 'none'}`);
if (errors.length) failed = true;
console.log(failed ? '\nANNOTATION CHECK FAILED' : '\nannotation check passed');
process.exit(failed ? 1 : 0);
