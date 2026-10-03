/** Real gestures and SQLite refs for chart labels/controls, on the isolated harness. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';
import {reset,readDoc} from './dev-client.mjs';
const url=process.env.FIXTURE_URL??'http://127.0.0.1:5280';
const out=process.env.TEST_OUTPUT_DIR??'test-output';await mkdir(out,{recursive:true});
const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1280,height:950}}),report=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
const ok=(name,value)=>{assert.ok(value,name);report.push(name);console.log('PASS',name);};
const target=id=>page.locator(`[data-anno-id="${id}"]`);
async function mode(on){
 const close=page.locator('.ca-popover .ca-close,.ca-tray .ca-close');if(await close.count())await close.first().click();
 const button=page.getByRole('button',{name:'Comment mode',exact:true});
 if((await button.getAttribute('aria-pressed')==='true')!==on)await button.click();
}
async function post(message){
 await page.locator('.ca-composer-input').fill(message);
 await page.getByRole('button',{name:'Comment',exact:true}).click();await page.locator('.ca-composer-input').waitFor({state:'detached'});
 return (await readDoc(page)).threads.at(-1);
}
async function click(id,message){await mode(true);await target(id).scrollIntoViewIfNeeded();await target(id).click();return post(message);}
try{
 await reset(page,url);
 const title=await click('charts.basic.bar.heading','Chart UI: title wording');
 ok('title uses ordinary ID and chart context',title.refs[0].kind==='anno_id'&&title.refs[0].semantic.role==='title'&&title.refs[0].semantic.chartId==='charts.basic.bar.plot');
 await target(title.refs[0].id).evaluate(el=>el.textContent='Renamed chart title');
 ok('renaming title preserves the discussion and historical label',await page.locator(`[data-thread-id="${title.id}"]`).isVisible()&&(await readDoc(page)).threads[0].refs[0].label===title.refs[0].label);
 await mode(true);
 const subtitle=target('charts.basic.bar.subtitle');await subtitle.scrollIntoViewIfNeeded();
 const selection=await subtitle.evaluate(el=>{const node=el.firstChild;const a=document.createRange(),b=document.createRange();a.setStart(node,0);a.setEnd(node,1);b.setStart(node,12);b.setEnd(node,13);const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return {x:x.x+.1,y:x.y+x.height/2,ex:y.right-.1,ey:y.y+y.height/2};});
 await page.mouse.move(selection.x,selection.y);await page.mouse.down();await page.mouse.move(selection.ex,selection.ey,{steps:10});await page.mouse.up();
 const quote=await post('Chart UI: subtitle phrase');
 ok('external subtitle retains native text selection',quote.refs[0].kind==='text'&&quote.refs[0].id==='charts.basic.bar.subtitle'&&quote.refs[0].quote.length>5);
 const legend=await click('charts.basic.pie.legend.billing','Chart UI: billing legend entry');
 ok('legend links to a category without capturing all its points',legend.refs[0].kind==='anno_id'&&legend.refs[0].semantic.categoryKey==='billing'&&!('members' in legend.refs[0]));
 await target('charts.basic.pie.legend.billing').evaluate(el=>{el.parentElement.append(el);el.lastChild.textContent='Billing renamed';});
 ok('legend reorder and rename keep its stable ID',await page.locator(`[data-thread-id="${legend.id}"]`).isVisible()&&await page.locator('.ca-tag-unanchored').count()===0);
 const svgId='charts.basic.line.label.metric';
 const label=await click(svgId,'Chart UI: SVG metric label');
 ok('internal SVG label is a whole-element ID target',label.refs[0].kind==='anno_id'&&label.refs[0].id===svgId&&label.refs[0].semantic.seriesKey==='requests');
 await mode(true);await target(svgId).scrollIntoViewIfNeeded();
 const box=await target(svgId).boundingBox(),before=(await readDoc(page)).threads.length;
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2-70,box.y+100,{steps:10});await page.mouse.up();
 ok('drag beginning on an internal label does not turn into a plot selection',await page.locator('.ca-thread-draft').count()===0&&(await readDoc(page)).threads.length===before);
 await target('charts.basic.line.plot').scrollIntoViewIfNeeded();
 const plot=await target('charts.basic.line.plot').boundingBox();
 const caption=await target(svgId).boundingBox();
 await page.mouse.move(plot.x+plot.width*.5,plot.y+plot.height*.8);await page.mouse.down();await page.mouse.move(caption.x+caption.width/2,caption.y+caption.height/2,{steps:10});await page.mouse.up();
 const rect=await post('Chart UI: plot drag crossing the label');
 ok('plot drag stays a data rectangle when it crosses a label',rect.refs[0].kind==='chart'&&rect.refs[0].selection==='rectangle'&&rect.refs[0].members.length>0&&rect.refs[0].members.every(m=>m.kind==='point'));
 await mode(false);
 const graph=target('charts.basic.network.plot');
 await page.getByRole('group',{name:'Simple graph layout',exact:true}).getByRole('button',{name:'Sankey',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-basic=network] [data-layout]')?.dataset.layout==='sankey');
 const control=await click('charts.basic.network.layout.force','Chart UI: explain this layout control');
 ok('Comment mode annotates a control without activating it',control.refs[0].kind==='anno_id'&&await graph.getAttribute('data-layout')==='sankey');
 await mode(false);await target('charts.basic.network.layout.force').click();
 ok('normal mode still activates the control',await graph.getAttribute('data-layout')==='force');
 await page.locator('details[data-advanced=cartesian]').evaluate(el=>el.open=true);
 const dense=await click('charts.B.legend.series-2','Chart UI: series legend across renderers');
 await mode(false);await page.locator('[data-fixture=B]').getByRole('button',{name:'Canvas',exact:true}).click();
 await page.goto(url+`/?anno_discussion=${dense.id}#fixture-B`);
 // Reload resets local renderer; switch again while the saved discussion is open.
 await mode(false);await page.locator('[data-fixture=B]').getByRole('button',{name:'Canvas',exact:true}).click();
 const body=(await readDoc(page)).threads.find(t=>t.id===dense.id);
 ok('HTML legend remains an ordinary target for a Canvas chart',await target('charts.B.plot').getAttribute('data-renderer')==='canvas'&&await target(body.refs[0].id).isVisible()&&body.refs[0].semantic.seriesKey==='Series 2');
 ok('axes and ticks have no new annotation targets',await page.locator('.chart-examples [data-anno-id*=".axis."]').count()===0);
 ok('no browser errors',errors.length===0);
 console.log(`${report.length} chart element checks passed`);
}finally{await writeFile(`${out}/chart-elements.json`,JSON.stringify({report,errors},null,2));await browser.close();}
