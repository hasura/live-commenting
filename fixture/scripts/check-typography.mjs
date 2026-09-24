import {launchBrowser} from './browser.mjs';
import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
const output = process.env.TEST_OUTPUT_DIR || '/tmp/live-commenting-typography';
await mkdir(output, {recursive: true});
import {writeFile} from 'node:fs/promises';

const browser = await launchBrowser();
const context = await browser.newContext({viewport:{width:1200,height:900}});
const page=await context.newPage();
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.goto(process.env.FIXTURE_URL || 'http://127.0.0.1:5180/');
await page.waitForSelector('.ca-toolbar');
await page.evaluate(async()=>{
 const ReactModule=await import('/node_modules/.vite/deps/react.js');
 const React=ReactModule.default ?? ReactModule;
 const ReactDOM=await import('/node_modules/.vite/deps/react-dom_client.js');
 const createRoot=ReactDOM.createRoot ?? ReactDOM.default.createRoot;
 const {TextComposer}=await import('/src/annotations/Composer.tsx');
 const {ThreadList}=await import('/src/annotations/Thread.tsx');
 const {TooltipProvider}=await import('/src/annotations/ui/tooltip.tsx');
 const {Toaster}=await import('/src/ui/sonner.tsx');
 const sonnerSource=await (await fetch('/src/ui/sonner.tsx')).text();
 const sonnerPath=sonnerSource.match(/from "(\/node_modules\/\.vite\/deps\/sonner\.js[^"]*)"/)[1];
 const {toast}=await import(sonnerPath);
 const e=React.createElement;
 const author={id:'audit-person',name:'Typography QA'};
 const rootEntry={kind:'comment',id:'audit-comment',author,createdAt:new Date().toISOString(),body:[{kind:'text',value:'Comment body, paragraph, and reply example.'}]};
 const status={kind:'resolve',id:'audit-status',actor:{id:'bot',name:'Hasura Bot'},actorKind:'bot',at:new Date().toISOString(),note:'Resolution note with enough text to read.'};
 const doc={id:'audit-discussion',status:'resolved',refs:[{kind:'anno_id',id:'missing-audit',label:'Annotation target heading'}],comments:[rootEntry],log:[rootEntry,status]};
 const container=document.createElement('div');container.id='font-audit';document.body.append(container);
 container.style.cssText='position:absolute;top:120px;left:40px;width:380px;z-index:2147483500;background:white;padding:12px';
 createRoot(container).render(e(React.Fragment,null,
  e(TooltipProvider,null,e('div',{className:'ca-root'},
   e('div',{className:'ca-popover-head'},e('div',{className:'ca-popover-title'},'Grouped discussion heading')),
   e('div',{className:'ca-tray-head'},'Unanchored discussion heading'),
   e('span',{className:'ca-chip',style:{position:'relative',left:0}},'Hover target label'),
   e('button',{className:'ca-pin',style:{position:'relative',transform:'none'}},'12'),
   e(ThreadList,{threads:[doc],Composer:TextComposer,onReply:()=>{},onResolve:()=>{},onReopen:()=>{},onWiden:()=>{},onDismiss:()=>{},widenTo:'Parent block',unanchoredIds:new Set(['audit-discussion'])}),
   e(TextComposer,{onSubmit:()=>{},onCancel:()=>{}}),
   e('kbd',null,'Esc')
  )),
  e(Toaster)
 ));
 window.auditToast=()=>toast('Other reviewer posted a comment',{id:'font-audit-toast',duration:Infinity,description:'Optional description typography',action:{label:'Jump',onClick:()=>{}}});
});
await page.waitForSelector('#font-audit .ca-comment-body');
await page.evaluate(()=>window.auditToast());
await page.waitForSelector('[data-sonner-toast]');
const selectors=[
'.ca-root','.ca-chip','.ca-pin','.ca-tool','.ca-count','.ca-root kbd','.ca-popover-title','.ca-composer-input','.ca-hint','.ca-btn','.ca-btn-ghost','.ca-thread-target','.ca-thread-label','.ca-tag','.ca-avatar','.ca-comment-author','.ca-comment-time','.ca-comment:not(.ca-status) .ca-comment-body','.ca-widen','.ca-widen b','.ca-tray-head','.ca-status .ca-comment-body','.ca-status-word','.ca-status-note','.ca-toaster','.review-toast','[data-sonner-toast] [data-title]','[data-sonner-toast] [data-description]','[data-sonner-toast] [data-button]','.ca-icon-button'];
async function sample(width) {
 await page.setViewportSize({width,height:1000});
 return page.evaluate(selectors=>selectors.map(selector=>{
  const n=document.querySelector('#font-audit '+selector)||document.querySelector(selector);
  if(!n)return {selector,missing:true};
  const s=getComputedStyle(n);return {selector,size:s.fontSize,family:s.fontFamily,weight:s.fontWeight,lineHeight:s.lineHeight,color:s.color,background:s.backgroundColor,opacity:s.opacity,fontStyle:s.fontStyle,textTransform:s.textTransform,numeric:s.fontVariantNumeric,decoration:s.textDecorationLine,letterSpacing:s.letterSpacing,caps:s.fontVariantCaps,text:n.textContent.slice(0,80),...(selector==='.ca-composer-input'?{placeholder:{size:getComputedStyle(n,'::placeholder').fontSize,color:getComputedStyle(n,'::placeholder').color,opacity:getComputedStyle(n,'::placeholder').opacity}}: {})};
 }),selectors);
}
const desktop=await sample(1200),compact=await sample(375);
await page.setViewportSize({width:1200,height:1000});
await page.locator('#font-audit .ca-thread-target').hover();
await page.waitForSelector('[data-slot="tooltip-content"]');
const tooltip=await page.locator('[data-slot="tooltip-content"]').first().evaluate(n=>{const s=getComputedStyle(n);return {size:s.fontSize,family:s.fontFamily,weight:s.fontWeight,lineHeight:s.lineHeight,color:s.color,background:s.backgroundColor,opacity:s.opacity,fontStyle:s.fontStyle,textTransform:s.textTransform,numeric:s.fontVariantNumeric,decoration:s.textDecorationLine,text:n.textContent}});

const expected = JSON.parse(await readFile(new URL('./typography-expectations.json', import.meta.url), 'utf8'));
for (const rows of [desktop, compact]) {
 for (const row of rows) {
  assert.ok(!row.missing, row.selector);
  const exp = expected[row.selector];
  assert.ok(exp, `Missing expectation for ${row.selector}`);
  for (const key of ['size','lineHeight','weight']) assert.equal(row[key],exp[key],`${row.selector} ${key}`);
  assert.ok(row.family.includes(row.selector.endsWith('kbd') ? 'ui-monospace' : 'ui-sans-serif'),row.selector+' family');
  assert.equal(row.fontStyle,'normal',row.selector+' normal style');
 }
}
assert.equal(tooltip.size,'12px');
assert.equal(tooltip.lineHeight,'16px');
assert.ok(tooltip.family.includes('ui-sans-serif'));
assert.equal(desktop.find(r=>r.selector==='.ca-status-word').textTransform,'uppercase');
assert.equal(desktop.find(r=>r.selector==='.ca-status-word').caps,'normal');
assert.equal(desktop.find(r=>r.selector==='.ca-pin').numeric,'tabular-nums');
assert.equal(desktop.find(r=>r.selector==='.ca-composer-input').placeholder.opacity,'1');
assert.equal(desktop.find(r=>r.selector==='[data-sonner-toast] [data-button]').background,'rgb(37, 99, 235)');
assert.equal(desktop.find(r=>r.selector==='[data-sonner-toast] [data-description]').color,'rgb(71, 85, 105)');
// Independent exported composer and portal under hostile inherited host text styles.
await page.evaluate(async()=>{
 const ReactModule=await import('/node_modules/.vite/deps/react.js');
 const React=ReactModule.default ?? ReactModule;
 const ReactDOM=await import('/node_modules/.vite/deps/react-dom_client.js');
 const {TextComposer}=await import('/src/annotations/Composer.tsx');
 const {TooltipProvider}=await import('/src/annotations/ui/tooltip.tsx');
 const c=document.createElement('div'); c.id='standalone';
 c.style.cssText='font:bold italic 25px/2 serif;letter-spacing:3px;text-transform:uppercase;font-variant:small-caps';
 document.body.append(c);
 (ReactDOM.createRoot ?? ReactDOM.default.createRoot)(c).render(
 React.createElement(TooltipProvider,null,React.createElement(TextComposer,{autoFocus:false,onSubmit:()=>{},onCancel:()=>{}})));
});
await page.waitForSelector('#standalone .ca-composer-input');
const isolated=await page.locator('#standalone .ca-composer-input').evaluate(n=>{
 const s=getComputedStyle(n);return [s.fontFamily,s.fontSize,s.lineHeight,s.fontWeight,s.fontStyle,s.letterSpacing,s.textTransform,s.fontVariantCaps];
});
assert.ok(isolated[0].includes('ui-sans-serif'));
assert.deepEqual(isolated.slice(1),['16px','24px','400','normal','normal','none','normal']);
// Generated labels can grow without clipping, including three-digit markers.
await page.evaluate(()=>{
 const root=document.querySelector('#font-audit .ca-root');
 const pin=document.createElement('button');pin.className='ca-pin ca-pin-resolved';pin.id='wide-pin';
 pin.style.cssText='position:relative;transform:none';pin.textContent='999';root.append(pin);
 const active=document.createElement('button');active.className='ca-tool ca-tool-active';active.innerHTML='<span class="ca-count">99</span>';root.append(active);
});
const pin=page.locator('#wide-pin');
assert.ok(await pin.evaluate(n=>n.scrollWidth<=n.clientWidth));
assert.equal(await pin.evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(100, 116, 139)');
await pin.hover();
assert.equal(await pin.evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(71, 85, 105)');
assert.equal(await page.locator('#font-audit .ca-tool-active .ca-count').evaluate(n=>getComputedStyle(n).color),'rgb(29, 78, 216)');
assert.ok(await page.locator('[data-sonner-toast] [data-button]').first().evaluate(n=>n.getBoundingClientRect().height>=32));
assert.deepEqual(errors,[]);
await page.screenshot({path:output+'/typography-desktop.png'});
await writeFile(output+'/typography-results.json',JSON.stringify({desktop,compact,tooltip,isolated,errors},null,2));
console.log('PASS: 33 computed styles at desktop/375px; portal tooltip; standalone inheritance; status, placeholder, toast, marker and count states.');
await context.close(); await browser.close();
