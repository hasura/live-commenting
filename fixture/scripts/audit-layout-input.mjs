/**
 * Isolated regression probe: layout width and device input policy are independent.
 * Chromium device/UA emulation is NOT physical iOS or keyboard-device testing.
 * Uses a separate Vite development host and localStorage; never the live server.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {launchBrowser} from './browser.mjs';

const cwd=fileURLToPath(new URL('../',import.meta.url));
const port=Number(process.env.AUDIT_PORT??5182), origin=`http://127.0.0.1:${port}`;
const out=`${cwd}/test-output/layout-input-audit`;
await mkdir(out,{recursive:true});
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd,stdio:['ignore','pipe','pipe']});
let serverLog='';
server.stdout.on('data',d=>serverLog+=d);
server.stderr.on('data',d=>serverLog+=d);
let browser;
const cases=[
  {name:'Desktop, narrow viewer',width:375,touch:false,ua:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'},
  {name:'Desktop, wide viewer',width:1024,touch:false,ua:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'},
  {name:'iPhone profile, narrow',width:375,touch:true,ua:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'},
  {name:'iPhone profile, wide',width:844,touch:true,ua:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'},
  {name:'iPad desktop-UA profile, wide',width:1024,touch:true,touches:5,ua:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'},
  {name:'Windows touchscreen profile, narrow',width:375,touch:true,ua:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'},
];
const makeThread=(id,target)=>({id,status:'open',refs:[{kind:'anno_id',id:target,label:id==='a'?'Spec title':'Missing annotation'}],comments:[
  {id:id+'-c',author:{id:'qa',name:'Isolated QA'},createdAt:'2026-09-17T12:00:00Z',body:[{kind:'text',value:'Seed comment'}]}
]});
const expectedMobile=c=>/iPhone|iPad/.test(c.name);
const seed={version:1,threads:[makeThread('a','spec.title'),makeThread('u','qa.missing')]};
const results=[], errors=[];
try{
  let ready=false;
  for(let i=0;i<60;i++){
    if(server.exitCode!==null)throw new Error(`Vite exited: ${serverLog}`);
    try{const r=await fetch(origin);if(r.ok){ready=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,250));
  }
  assert.ok(ready,'isolated Vite ready');
  browser=await launchBrowser();
  for(const c of cases){
    const context=await browser.newContext({viewport:{width:c.width,height:950},hasTouch:c.touch,userAgent:c.ua});
    await context.addInitScript(({seed,touches})=>{
      if(touches)Object.defineProperty(navigator,'maxTouchPoints',{get:()=>touches});
      localStorage.setItem('annotation-fixture-doc',JSON.stringify(seed));
      window.__qaFocus=[];
      const focus=HTMLElement.prototype.focus;
      HTMLElement.prototype.focus=function(...args){
        if(this.matches('.ca-composer-input'))window.__qaFocus.push({args:args.length,preventScroll:args[0]?.preventScroll??null});
        return focus.apply(this,args);
      };
    },{seed,touches:c.touches});
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(`${c.name}: ${e.message}`));
    try{
      for(const kind of ['bubble','unanchored']){
        await page.goto(origin,{waitUntil:'networkidle'});
        await page.evaluate(()=>{
          const b=document.createElement('button');
          b.id='qa-outside';b.textContent='Outside';b.setAttribute('data-anno-ignore','');
          b.style.cssText='position:fixed;right:2px;top:2px;z-index:2147483647';
          document.body.append(b);
        });
        const popup=page.locator(kind==='bubble'?'.ca-popover':'.ca-tray');
        const trigger=page.locator(kind==='bubble'?'.ca-pin[data-ca-targets~="spec.title"]':'[data-testid="unanchored"]').first();
        await trigger.click();await popup.locator('.ca-thread').waitFor();
        await page.waitForTimeout(100);
        const geometry=await popup.evaluate(e=>({position:getComputedStyle(e).position,width:e.getBoundingClientRect().width}));
        const toolbarHidden=await page.locator('.ca-toolbar').isHidden();
        await page.locator('#qa-outside').click();
        const outsideCloses=await popup.count()===0;
        if(outsideCloses){await trigger.click();await popup.locator('.ca-thread').waitFor();}
        await popup.getByRole('button',{name:'Reply',exact:true}).click();
        const input=popup.locator('.ca-composer-input');
        assert.ok(await input.evaluate(e=>document.activeElement===e),'reply autofocus');
        const hint=await popup.getByLabel('Keyboard shortcuts',{exact:true}).count()>0;
        const enterKeyHint=await input.getAttribute('enterkeyhint');
        const focusCalls=await page.evaluate(()=>window.__qaFocus);
        await input.fill('Audit reply');
        await input.press('Enter');
        await page.waitForTimeout(50);
        const doc=await page.evaluate(()=>JSON.parse(localStorage.getItem('annotation-fixture-doc')));
        const sends=doc.threads.find(t=>t.id===(kind==='bubble'?'a':'u')).comments.length===2;
        const compact=c.width<480, mobile=expectedMobile(c);
        assert.equal(sends,!mobile,'Enter policy must be device based');
        assert.equal(hint,!mobile);
        assert.equal(outsideCloses,!mobile);
        assert.equal(toolbarHidden,compact);
        assert.ok(focusCalls.length>0&&focusCalls.every(f=>mobile?f.args===0:f.preventScroll===true));
        if(mobile)assert.equal(await input.inputValue(),'Audit reply\n');
        if(compact){
          assert.equal(geometry.position,'fixed');assert.equal(geometry.width,c.width-4);
        }
        results.push({profile:c.name,kind,width:c.width,emulatedTouch:c.touch,layout:compact?'bottom sheet':'wide layout',
          toolbarHidden,outsideCloses,enter:sends?'send':'newline',shortcutHint:hint,enterKeyHint,
          focus:focusCalls.at(-1)?.args===0?'native scrolling':'preventScroll:true'});
      }
    }finally{await context.close();}
  }
  assert.equal(errors.length,0,'browser exceptions');
  const evidence={scope:'Device policy regression; Chromium UA/touch/viewport emulation, not physical-device or hardware-keyboard detection.',results,errors};
  await writeFile(`${out}/results.json`,JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence,null,2));
  console.log(`PASS: ${results.length} profile/popup combinations; no live comments touched.`);
}finally{
  if(browser)await browser.close();
  server.kill('SIGTERM');
  await writeFile(`${out}/vite.log`,serverLog);
}