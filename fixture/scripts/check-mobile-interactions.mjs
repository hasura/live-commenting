import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.connectOverCDP(process.env.CDP_URL??'http://127.0.0.1:9222');
const base='http://127.0.0.1:5188/baseline/lab.html';
const results=[];
async function test(name,run){
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const page=await context.newPage();
 try {const detail=await run(page,context);results.push({name,...detail});console.log(JSON.stringify(results.at(-1)));}
 catch(e){results.push({name,error:e.message});console.log('ERROR',name,e.message);}
 await context.close();
}
const mode=page=>page.locator('button[title="Comment mode"]');
const wait=page=>page.waitForTimeout(200);
async function touchDrag(page,context,box,dx,dy){
 const cdp=await context.newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x,y:box.y}]});
 for(let i=1;i<=10;i++){
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+dx*i/10,y:box.y+dy*i/10}]});await page.waitForTimeout(25);
 }
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait(page);
}
try {
await test('Commenting a real button suppresses its action',async page=>{
 await page.goto(base+'?fixture=ui');await mode(page).click();
 await page.locator('[data-anno-id="ui.invite"]').tap();
 await page.locator('.ca-composer-input').fill('Invite button feedback');
 return {inviteClicks:await page.getByTestId('invite-clicks').innerText(),composerVisible:await page.locator('.ca-composer-input').isVisible()};
});
await test('Tapping outside a draft discards its unsent text',async page=>{
 await page.goto(base+'?fixture=spec');await mode(page).click();await page.locator('[data-anno-id="spec.intro"]').tap();
 await page.locator('.ca-composer-input').fill('Unposted draft that must not disappear');
 await page.touchscreen.tap(8,120);await wait(page);
 return {composerCount:await page.locator('.ca-composer-input').count(),textStillInDOM:await page.locator('body').innerText().then(t=>t.includes('Unposted draft')),localState:await page.evaluate(()=>localStorage.getItem('mobile-lab-spec-v1'))};
});
await test('Region drag competes with finger scrolling',async(page,context)=>{
 await page.goto(base+'?fixture=spec');const figure=page.locator('[data-anno-mode="region"]');
 await figure.scrollIntoViewIfNeeded();await wait(page);const b=await figure.boundingBox();
 const before=await page.evaluate(()=>scrollY);await touchDrag(page,context,{x:b.x+100,y:b.y+b.height/2},0,-70);
 const normal=await page.evaluate(before=>scrollY-before, before);
 await figure.scrollIntoViewIfNeeded();await mode(page).click();await wait(page);const c=await figure.boundingBox();
 const start=await page.evaluate(()=>scrollY); const actionBefore=await figure.evaluate(el=>getComputedStyle(el).touchAction);await touchDrag(page,context,{x:c.x+100,y:c.y+c.height/2},25,-70);
 const end=await page.evaluate(()=>scrollY);const composer=await page.locator('.ca-composer-input').count();
 await page.screenshot({path:'public-lab/evidence/spec-phone-region-scroll.png'});
 return {normalScrollDelta:normal,commentModeScrollDelta:end-start,composerOpened:composer>0,touchActionDuringGesture:actionBefore};
});
await test('Slide navigation treats a hidden slide as missing target',async page=>{
 await page.goto(base+'?fixture=deck');await mode(page).click();await page.locator('[data-anno-id="deck.title.0"]').tap();
 await page.locator('.ca-composer-input').fill('Slide one review');await page.locator('.ca-composer .ca-btn').click();
 await mode(page).click();await page.getByRole('button',{name:'Next slide',exact:true}).click();await wait(page);
 const tray=await page.locator('.ca-tray').innerText();const pins=await page.locator('.ca-pin').count();
 await page.screenshot({path:'public-lab/evidence/deck-phone-hidden-slide.png'});
 await page.getByRole('button',{name:'Previous slide',exact:true}).click();await wait(page);
 return {onSlideTwo:{tray,pins},onReturnPins:await page.locator('.ca-pin').count()};
});
await test('Two comments on different targets both use marker 1',async page=>{
 await page.goto(base+'?fixture=spec');await mode(page).click();
 for(const id of ['spec.title','spec.intro']){
  await page.locator(`[data-anno-id="${id}"]`).tap();await page.locator('.ca-composer-input').fill('Review '+id);await page.locator('.ca-composer .ca-btn').click();
 }
 return {markerLabels:await page.locator('.ca-pin').allTextContents()};
});
await test('Simulated delivery preserves failure and locks success',async page=>{
 await page.goto(base+'?fixture=ui');
 await page.getByText('Test controls',{exact:true}).click();
 await page.getByRole('checkbox').check();
 await mode(page).click();await page.locator('[data-anno-id="ui.title"]').tap();await page.locator('.ca-composer-input').fill('Review');
 await page.locator('.ca-composer .ca-btn').click();
 await page.getByRole('button',{name:'Save all (1)',exact:true}).click();await page.waitForTimeout(900);
 const failure=await page.locator('.lab-safety [role=status]').innerText();
 await page.getByRole('checkbox').uncheck();
 await page.getByRole('button',{name:'Save all (1)',exact:true}).click();await page.waitForTimeout(900);
 const success=await page.locator('.lab-safety [role=status]').innerText();
 return {failure,success,sendDisabled:await page.getByRole('button',{name:'Save all',exact:true}).isDisabled(),rounds:await page.evaluate(()=>JSON.parse(localStorage.getItem('mobile-lab-ui-v1')).rounds.length)};
});
}finally{await writeFile('public-lab/evidence/interaction-audit.json',JSON.stringify(results,null,2));await browser.close();}
