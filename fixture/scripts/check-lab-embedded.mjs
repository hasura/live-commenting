import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.connectOverCDP(process.env.CDP_URL??'http://127.0.0.1:9222');
const context=await browser.newContext({viewport:{width:1280,height:1000}});
const page=await context.newPage();
const results=[];
const check=(name,pass)=>{results.push({name,pass:!!pass});assert.ok(pass,name);console.log('PASS',name);};
try{
 await page.goto('http://127.0.0.1:5188/',{waitUntil:'networkidle'});
 await page.locator('#size').selectOption('390x844');
 await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
 const frame=page.frameLocator('#view');
 await frame.locator('button[title="Comment mode"]').click();
 await frame.locator('[data-anno-id="spec.intro"]').click();
 await frame.locator('.ca-composer-input').fill('Draft survives responsive resize');
 await page.locator('#size').selectOption('1440x900');
 await page.waitForTimeout(200);
 check('Draft retained on mobile to desktop resize',await frame.locator('.ca-composer-input').inputValue()==='Draft survives responsive resize');
 await page.locator('#size').selectOption('390x844');
 await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
 await frame.locator('.ca-composer .ca-btn').click();
 check('Comment can be posted inside the iframe',await frame.locator('.ca-pin').count()===1);
 await page.locator('#fixture').selectOption('ui');
 await frame.locator('[data-anno-id="ui.title"]').waitFor();
 check('UI fixture has separate state',await frame.locator('.ca-pin').count()===0);
 await page.locator('#fixture').selectOption('spec');
 await frame.locator('.ca-pin').waitFor();
 check('Returning to spec restores its comment',await frame.locator('.ca-pin').count()===1);
 check('Published fixture loads its image',await frame.locator('img').first().evaluate(el=>el.complete&&el.naturalWidth>0));
 await page.locator('#size').selectOption('390x422');
 await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
 await frame.locator('.ca-pin').click();
 await page.screenshot({path:'public-lab/evidence/embedded-lab.png'});
}finally{
 await writeFile('public-lab/evidence/embedded-checks.json',JSON.stringify(results,null,2));
 await context.close();await browser.close();
}
