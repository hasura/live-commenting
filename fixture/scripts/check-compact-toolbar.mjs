/**
 * Compact toolbar + missing-target regression.
 * Isolated dev browser with seeded localStorage; no live state changes.
 */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';

const outputDir=process.env.TEST_OUTPUT_DIR??'test-output';
await mkdir(outputDir,{recursive:true});
const report=[],errors=[];
const ok=(name,value)=>{report.push({name,pass:!!value});console.log(value?'PASS':'FAIL',name);assert.ok(value,name);};
const base='http://localhost:5180';
const author={id:'qa',name:'Review QA'};
const comment=(id,text)=>({id,author,createdAt:'2026-09-17T11:50:00Z',body:[{kind:'text',value:text}]});
const doc={version:1,threads:[
  {id:'qa-figure',status:'open',refs:[{kind:'anno_id',id:'spec.reference.figure',label:'Prior art screenshot'}],comments:[comment('c1','Remove the screenshot for testing.')]},
  {id:'qa-navigation',status:'resolved',refs:[{kind:'anno_id',id:'doc.toc.wireframe',label:'Jump to Wireframe'}],comments:[comment('c2','Hide the Wireframe navigation item only.')]}
]};
const browser=await launchBrowser();
const context=await browser.newContext({viewport:{width:1400,height:950}});
const page=await context.newPage();
page.on('pageerror',error=>errors.push(error.message));
try {
  await page.goto(base,{waitUntil:'networkidle'});
  await page.evaluate(doc=>localStorage.setItem('annotation-fixture-doc',JSON.stringify(doc)),doc);
  await page.reload({waitUntil:'networkidle'});
  ok('temporary flag unmounts only the intended figure and nav link',await page.locator('[data-anno-id="spec.reference.figure"],[data-anno-id="doc.toc.wireframe"]').count()===0);
  ok('Wireframe content and dedicated image example remain',await page.locator('[data-anno-id="wireframe.panel"],[data-anno-id="spec.image-example.image"]').count()===2);
  ok('other sidebar links remain',await page.locator('.doc-side .side-link').count()===5);
  const unanchored=page.locator('[data-testid="unanchored"]');
  ok('only open missing-target conversations are counted initially',(await unanchored.innerText()).trim()==='1');
  ok('unanchored tray starts closed',await page.locator('.ca-tray').count()===0);
  await unanchored.click();
  await page.locator('.ca-tray').waitFor();
  ok('unanchored toggle opens the snapshot tray',await unanchored.getAttribute('aria-pressed')==='true'&&(await page.locator('.ca-tray-body').innerText()).includes('Prior art screenshot'));
  await page.locator('[data-testid="toggle-resolved"]').click();
  ok('desktop outside filter click dismisses the tray',await page.locator('.ca-tray').count()===0);
  await unanchored.click();
  ok('resolved missing-target conversation appears when resolved enabled',(await unanchored.innerText()).trim()==='2'&&(await page.locator('.ca-tray-body').innerText()).includes('Jump to Wireframe'));
  const unchanged=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('annotation-fixture-doc')));
  ok('hiding targets preserves every stored comment',JSON.stringify(await unchanged())===JSON.stringify(doc));
  await unanchored.click();
  ok('same toggle closes the tray',await page.locator('.ca-tray').count()===0&&await unanchored.getAttribute('aria-pressed')==='false');
  await unanchored.focus();await page.keyboard.press('Enter');
  ok('keyboard activation opens the tray',await page.locator('.ca-tray').isVisible());
  await page.keyboard.press('Escape');
  ok('Escape closes the unanchored tray',await page.locator('.ca-tray').count()===0);
  await unanchored.click();
  await page.getByRole('button',{name:'Close unanchored comments',exact:true}).click();
  ok('tray Close resets the toolbar toggle',await page.locator('.ca-tray').count()===0&&await unanchored.getAttribute('aria-pressed')==='false');
  for(const width of [1400,375,320]){
    await page.setViewportSize({width,height:812});
    ok(`${width}px segmented group stays together`,await page.locator('.ca-tool-segments button').evaluateAll(els=>new Set(els.map(e=>e.getBoundingClientRect().top)).size===1));
    await unanchored.click();
    await page.waitForTimeout(100);
    const bar=await page.locator('.ca-toolbar').boundingBox();
    const tray=await page.locator('.ca-tray').boundingBox();
    ok(`${width}px unanchored tray fits its responsive layout`,width<480
      ? bar===null&&tray.x===2&&tray.width===width-4&&Math.abs(tray.y+tray.height-810)<1&&tray.height<=649.6
      : tray.x>=0&&tray.x+tray.width<=width&&tray.y>=0&&tray.y+tray.height<bar.y);
    await page.mouse.move(0,0);await page.evaluate(()=>document.activeElement?.blur());
    await page.screenshot({path:`${outputDir}/v4-compact-${width}.png`});
    await page.locator('.ca-tray .ca-close').click();
    ok(`${width}px closing the tray restores toolbar`,await page.locator('.ca-toolbar').isVisible());
  }
  // Prove restoring the gates restores the exact IDs and existing comments.
  // Rewriting the served dev module in this browser only; repo flag stays true.
  await page.route('**/src/fixture/SpecPage.tsx*',async route=>{
    const response=await route.fetch();
    const text=await response.text();
    assert.ok(text.includes('const TEMPORARY_DEBUG_HIDE = true'));
    await route.fulfill({response,body:text.replace('const TEMPORARY_DEBUG_HIDE = true','const TEMPORARY_DEBUG_HIDE = false')});
  });
  await page.setViewportSize({width:1400,height:950});
  await page.reload({waitUntil:'networkidle'});
  await page.locator('[data-testid="toggle-resolved"]').click();
  ok('restoring flag restores both original target IDs',await page.locator('[data-anno-id="spec.reference.figure"],[data-anno-id="doc.toc.wireframe"]').count()===2);
  ok('restored targets re-anchor without editing saved comments',(await unanchored.innerText()).trim()==='0'&&await page.locator('.ca-pin').count()===2&&JSON.stringify(await unchanged())===JSON.stringify(doc));
  // Non-debug refresh must not show when already on the latest build.
  await page.route('**/src/App.tsx*',async route=>{
    const response=await route.fetch();
    const text=await response.text();
    assert.ok(text.includes('const TEMPORARY_DEBUG_TOOLBAR = true'));
    await route.fulfill({response,body:text.replace('const TEMPORARY_DEBUG_TOOLBAR = true','const TEMPORARY_DEBUG_TOOLBAR = false')});
  });
  await page.reload({waitUntil:'networkidle'});
  ok('current-build Refresh is hidden when debug is off',await page.locator('[data-testid="refresh"]').count()===0);
  ok('no browser exceptions',errors.length===0);
} finally {
  await writeFile(`${outputDir}/compact-toolbar-results.json`,JSON.stringify({report,errors},null,2));
  await context.close();await browser.close();
}