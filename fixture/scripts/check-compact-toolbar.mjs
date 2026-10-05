/** Unified toolbar + removed-target regression. Isolated dev state only. */
import assert from 'node:assert/strict';
import {resetAndSeed,readDoc} from './dev-client.mjs';
import {launchBrowser} from './browser.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
const out=process.env.TEST_OUTPUT_DIR??'test-output';await mkdir(out,{recursive:true});
const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1400,height:950}});
const report=[],errors=[],ok=(name,value)=>{report.push({name,pass:!!value});console.log(value?'PASS':'FAIL',name);assert.ok(value,name);};
page.on('pageerror',e=>errors.push(e.message));
const threads=['spec.reference.figure','spec.lede'].map((id,i)=>({
 id:'qa-compact-'+i,status:i?'resolved':'open',refs:[{kind:'anno_id',id,label:i?'Introduction':'Prior art screenshot'}],
 comments:[{id:'qa-compact-comment-'+i,author:{id:'qa',name:'QA'},createdAt:'2026-09-24T00:00:00Z',body:[{kind:'text',value:'Keep this history.'}]}]
}));
try{
 await resetAndSeed(page,threads);
 const before=await readDoc(page),reader=page.locator('.ca-tray'),toggle=page.getByTestId('toggle-comments');
 const targets='[data-anno-id="spec.reference.figure"],[data-anno-id="spec.lede"]';
 ok('Both test anchors present',await page.locator(targets).count()===2);
 await page.locator(targets).evaluateAll(es=>es.forEach(e=>e.remove()));
 await toggle.click();
 await page.waitForFunction(()=>document.querySelectorAll('.ca-tray .ca-tag-unanchored').length===2);
 ok('All includes removed open and resolved targets',await reader.locator('.ca-thread:visible').count()===2);
 ok('Filtering exists only inside reader',await page.locator('.ca-toolbar [data-testid="toggle-resolved"],.ca-toolbar [data-testid="unanchored"]').count()===0);
 for(const width of [1400,375,320]){
  await page.setViewportSize({width,height:812});
  await page.waitForTimeout(100);
  const box=await reader.boundingBox(),bar=await page.locator('.ca-toolbar').boundingBox();
  ok(`${width}: panel fits above toolbar`,box.x>=0&&box.x+box.width<=width&&box.y>=0&&box.y+box.height<bar.y);
  ok(`${width}: toolbar fits; segments stay together`,await page.locator('.ca-toolbar').evaluate(e=>e.scrollWidth<=e.clientWidth)&&await page.locator('.ca-tool-segments button').evaluateAll(es=>new Set(es.map(e=>e.getBoundingClientRect().top)).size===1));
  await page.getByTestId('toggle-markers').click();
  ok(`${width}: marker toggle never closes reader`,await reader.isVisible());
  await reader.getByRole('button',{name:'Open discussions'}).click();
  ok(`${width}: one open result`,await reader.locator('.ca-thread:visible').count()===1);
  for(const status of ['Open','Resolved']){
   await reader.getByRole('button',{name:status+' discussions',exact:true}).click();
   await page.waitForTimeout(80);
   ok(`${width}: ${status} filter is visible and accessible in toolbar`,(await toggle.innerText()).replace(/\s+/g,' ').trim()===`Comments · ${status} 1`&&await toggle.getAttribute('aria-label')===`Comments: ${status}`);
   const panelBox=await reader.boundingBox(),toolbarBox=await page.locator('.ca-toolbar').boundingBox();
   ok(`${width}: ${status} label fits without splitting marker controls`,await page.locator('.ca-toolbar').evaluate(e=>e.scrollWidth<=e.clientWidth)&&await page.locator('.ca-tool-segments button').evaluateAll(es=>new Set(es.map(e=>e.getBoundingClientRect().top)).size===1)&&panelBox.y+panelBox.height<toolbarBox.y);
   await reader.locator('.ca-close').click();
   ok(`${width}: closing reader retains the ${status} indicator`,(await toggle.innerText()).includes(status)&&!await reader.isVisible());
   await toggle.click();
  }
  await reader.getByRole('button',{name:'All discussions'}).click();
  ok(`${width}: All restores the compact unfiltered label`,(await toggle.innerText()).replace(/\s+/g,' ').trim()==='Comments 2'&&await toggle.getAttribute('aria-label')==='Comments');
  await reader.locator('.ca-close').click();ok(`${width}: Close resets expanded state`,await toggle.getAttribute('aria-expanded')==='false');
  await toggle.focus();await page.keyboard.press('Enter');ok(`${width}: keyboard reopens`,await reader.isVisible());
  await page.screenshot({path:`${out}/compact-${width}.png`});
 }
 ok('UI changes never edit saved history',JSON.stringify(await readDoc(page))===JSON.stringify(before));
 await page.reload({waitUntil:'networkidle'});await toggle.click();
 ok('Reload restores anchors and clears badges',await page.locator(targets).count()===2&&await reader.locator('.ca-tag-unanchored').count()===0);
 ok('Comments survive reanchoring',JSON.stringify(await readDoc(page))===JSON.stringify(before));
 ok('No browser exceptions',errors.length===0);
}finally{await writeFile(`${out}/compact-toolbar-results.json`,JSON.stringify({report,errors},null,2));await browser.close();}
