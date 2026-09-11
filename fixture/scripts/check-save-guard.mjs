import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const out=process.env.TEST_OUTPUT_DIR??'test-output';await mkdir(out,{recursive:true});
const b=await chromium.connectOverCDP('http://127.0.0.1:9222');
const context=await b.newContext({viewport:{width:1400,height:950}});
const page=await context.newPage(),report=[];
const ok=(name,pass)=>{report.push({name,pass:!!pass});console.log(pass?'PASS':'FAIL',name);assert.ok(pass,name);};
let sends=0,request=null;
try{
 await page.route('**/api/**',async route=>{
  if(route.request().url().endsWith('/api/save')){
   sends++;request=route.request().postDataJSON();return route.abort('failed');
  }
  return route.fulfill({json:{revision:0,user:{id:'local-test',name:'Local test only'},doc:{version:1,threads:[],rounds:[]}}});
 });
 await page.goto('http://127.0.0.1:5190/',{waitUntil:'networkidle'});
 await page.locator('button[title="Comment mode"]').click();
 const target=page.locator('[data-anno-id="spec.lede"]');const r=await target.boundingBox();
 await page.mouse.click(r.x+20,r.y+20);
 await page.locator('.ca-composer-input').fill('Posted first comment');await page.keyboard.press('Enter');
 await page.mouse.click(r.x+100,r.y+20);
 await page.locator('.ca-composer-input').fill('Still typing second comment');
 await page.getByRole('button',{name:/Save all/}).click();
 ok('Save all preserves unposted composer text',(await page.locator('.ca-composer-input').inputValue())==='Still typing second comment');
 ok('Save all does not send incomplete draft',sends===0);
 ok('Save all explains why save blocked',(await page.getByRole('status').innerText()).includes('Post or cancel'));
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:/Save all/}).click();
 await page.getByRole('button',{name:'Check same save (1)'}).waitFor();
 ok('uncertain network delivery locks editing',await page.locator('.ca-tool-active').count()===1);
 await page.locator('button[title="Comment mode"]').click();
 ok('comment mode cannot reopen during uncertain save',!(await page.locator('button[title="Comment mode"]').getAttribute('aria-pressed')==='true'));
 const firstId=request.saveId;
 await page.getByRole('button',{name:'Check same save (1)'}).click();
 await page.waitForTimeout(250);
 ok('retry uses identical Save ID',request.saveId===firstId && sends===2);
 await page.reload({waitUntil:'networkidle'});
 ok('pending uncertain save survives browser reload',(await page.getByRole('button',{name:'Check same save (1)'}).count())===1);
 ok('blocked draft still downloadable',await page.getByRole('button',{name:'Download draft'}).isEnabled());
}finally{
 await writeFile(`${out}/save-guard-results.json`,JSON.stringify(report,null,2));
 await context.close();await b.close();
}