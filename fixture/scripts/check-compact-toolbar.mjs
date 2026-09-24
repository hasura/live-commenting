/**
 * Compact toolbar + missing-target regression.
 * Isolated development harness with seeded discussions; no live state changes.
 */
import assert from 'node:assert/strict';
import {resetAndSeed, readDoc} from './dev-client.mjs';
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
  {id:'qa-figure',status:'open',refs:[{kind:'anno_id',id:'spec.reference.figure',label:'Prior art screenshot'}],comments:[comment('qa-figure-c1','Remove the screenshot for testing.')]},
  {id:'qa-navigation',status:'resolved',refs:[{kind:'anno_id',id:'doc.toc.wireframe',label:'Jump to Wireframe'}],comments:[comment('qa-navigation-c2','Hide the Wireframe navigation item only.')]}
]};
const browser=await launchBrowser();
const context=await browser.newContext({viewport:{width:1400,height:950}});
const page=await context.newPage();
page.on('pageerror',error=>errors.push(error.message));
try {
  await resetAndSeed(page,doc.threads,base+'/');
  ok('normal fixture contains the figure and Wireframe nav link',await page.locator('[data-anno-id="spec.reference.figure"],[data-anno-id="doc.toc.wireframe"]').count()===2);
  ok('all sidebar links restored',await page.locator('.doc-side .side-link').count()===6);
  // Simulate removed targets in this test browser only, never in shipped source.
  await page.evaluate(()=>document.querySelectorAll('[data-anno-id="spec.reference.figure"],[data-anno-id="doc.toc.wireframe"]').forEach(el=>el.remove()));
  await page.locator('[data-testid="unanchored"]').waitFor();
  ok('Wireframe content and dedicated image example remain',await page.locator('[data-anno-id="wireframe.panel"],[data-anno-id="spec.image-example.image"]').count()===2);
  ok('other sidebar links survive test-only removal',await page.locator('.doc-side .side-link').count()===5);
  const unanchored=page.locator('[data-testid="unanchored"]');
  ok('only open missing-target threads are counted initially',(await unanchored.innerText()).trim()==='1');
  ok('unanchored tray starts closed',await page.locator('.ca-tray').count()===0);
  await unanchored.click();
  await page.locator('.ca-tray').waitFor();
  ok('unanchored toggle opens the snapshot tray',await unanchored.getAttribute('aria-pressed')==='true'&&(await page.locator('.ca-tray-body').innerText()).includes('Prior art screenshot'));
  await page.locator('[data-testid="toggle-resolved"]').click();
  ok('desktop outside filter click dismisses the tray',await page.locator('.ca-tray').count()===0);
  await unanchored.click();
  ok('resolved missing-target thread appears when resolved enabled',(await unanchored.innerText()).trim()==='2'&&(await page.locator('.ca-tray-body').innerText()).includes('Jump to Wireframe'));
  const summary=d=>d.threads.map(t=>({id:t.id,status:t.status,refs:t.refs,bodies:t.comments.map(c=>c.body)}));
  ok('hiding targets preserves every stored comment',JSON.stringify(summary(await readDoc(page)))===JSON.stringify(summary(doc)));
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
      ? bar!==null&&tray.x===2&&tray.width===width-4&&Math.abs(tray.y+tray.height-(bar.y-8))<1&&tray.height<=649.6
      : tray.x>=0&&tray.x+tray.width<=width&&tray.y>=0&&tray.y+tray.height<bar.y);
    await page.mouse.move(0,0);await page.evaluate(()=>document.activeElement?.blur());
    await page.screenshot({path:`${outputDir}/v4-compact-${width}.png`});
    await page.locator('.ca-tray .ca-close').click();
    ok(`${width}px closing the tray restores toolbar`,await page.locator('.ca-toolbar').isVisible());
  }
  // Reload restores original markup and existing comments without source rewriting.
  await page.setViewportSize({width:1400,height:950});
  await page.reload({waitUntil:'networkidle'});
  await page.locator('[data-testid="toggle-resolved"]').click();
  ok('reload restores both original target IDs',await page.locator('[data-anno-id="spec.reference.figure"],[data-anno-id="doc.toc.wireframe"]').count()===2);
  ok('restored targets re-anchor without editing saved comments',await unanchored.count()===0&&await page.locator('.ca-pin').count()===2&&JSON.stringify(summary(await readDoc(page)))===JSON.stringify(summary(doc)));
  ok('current-build Refresh is hidden by default',await page.locator('[data-testid="refresh"]').count()===0);
  ok('no browser exceptions',errors.length===0);
} finally {
  await writeFile(`${outputDir}/compact-toolbar-results.json`,JSON.stringify({report,errors},null,2));
  await context.close();await browser.close();
}