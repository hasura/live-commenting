/** Isolated browser behavior audit and regression tests; never touches live comments. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';
const out=process.env.TEST_OUTPUT_DIR??'test-output';
await mkdir(out,{recursive:true});
const browser=await launchBrowser();
const ctx=await browser.newContext({viewport:{width:1400,height:950},hasTouch:true});
const page=await ctx.newPage();
const report=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
const ok=(name,pass)=>{report.push({name,pass:!!pass});console.log(pass?'PASS':'FAIL',name);assert.ok(pass,name);};
const thread=(id,target,label)=>({id,status:'open',refs:[{kind:'anno_id',id:target,label}],
  comments:[{id:id+'-c',author:{id:'qa',name:'Review QA'},createdAt:'2026-09-17T12:00:00Z',body:[{kind:'text',value:'Review comment.'}]}]});
const data=[thread('a','spec.title','Spec title'),thread('u','qa.missing','Missing annotation')];
const panel=kind=>page.locator(kind==='bubble'?'.ca-popover':'.ca-tray');
const trigger=kind=>kind==='bubble'?page.locator('.ca-pin[data-ca-targets~="spec.title"]').first():page.locator('[data-testid="unanchored"]');
const seed=async()=>{
  await page.goto('http://localhost:5180/',{waitUntil:'networkidle'});
  await page.evaluate(threads=>localStorage.setItem('annotation-fixture-doc',JSON.stringify({version:1,threads})),data);
  await page.reload({waitUntil:'networkidle'});
  await page.evaluate(()=>{
    const el=document.createElement('button');el.textContent='Outside';el.id='qa-outside';
    el.setAttribute('data-anno-ignore','');el.style.cssText='position:fixed;right:2px;top:2px;z-index:2147483647';
    document.body.append(el);
  });
};
const open=async kind=>{
  await trigger(kind).click();await panel(kind).waitFor();
  await panel(kind).locator('.ca-thread').first().waitFor();await page.waitForTimeout(120);
};
const focused=()=>page.evaluate(()=>{
  const e=document.activeElement;
  return {tag:e?.tagName,cls:e?.className,label:(e?.getAttribute('aria-label')??e?.textContent)?.slice(0,120)};
});
const audit=async()=>{
  const results=[];
  await page.setViewportSize({width:1400,height:950});
  for(const kind of ['bubble','unanchored']){
    await seed();await open(kind);
    const result={kind,role:await panel(kind).getAttribute('role'),tag:await panel(kind).evaluate(e=>e.tagName),focusOnOpen:await focused()};
    await page.locator('#qa-outside').click();result.outsideCloses=await panel(kind).count()===0;
    await seed();await open(kind);
    await panel(kind).locator('.ca-close').click();await page.waitForTimeout(80);result.focusAfterClose=await focused();
    await seed();await open(kind);
    const controls=panel(kind).locator('button:not(:disabled),textarea,input,[tabindex="0"]');
    await controls.last().focus();await page.keyboard.press('Tab');
    result.tabStaysInside=await panel(kind).evaluate(e=>e.contains(document.activeElement));
    await seed();await open(kind);await trigger(kind).click();result.triggerCloses=await panel(kind).count()===0;
    await seed();await open(kind);await page.keyboard.press('Escape');result.escapeCloses=await panel(kind).count()===0;
    await seed();await open(kind);
    await panel(kind).getByRole('button',{name:'Reply',exact:true}).click();
    result.replyAutofocus=await page.locator('.ca-composer-input').evaluate(e=>e===document.activeElement);
    await page.locator('.ca-composer-input').fill('Unsent audit reply');
    await page.keyboard.press('Escape');
    result.replyEscapeKeepsPopup=await panel(kind).count()===1&&await page.locator('.ca-composer-input').count()===0;
    await seed();await open(kind);
    await page.locator('[data-testid="toggle-comments"]').click();
    result.hideCommentsCloses=await panel(kind).count()===0;
    await page.locator('[data-testid="toggle-comments"]').click();await page.waitForTimeout(100);
    result.showCommentsRestoresPopup=await panel(kind).count()===1;
    results.push(result);
  }
  const filename=process.env.AUDIT_NAME??'popup-desktop-audit';
  await writeFile(`${out}/${filename}.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
};
try{
  if(process.argv.includes('--audit')) await audit();
  else{
    for(const width of [320,375,479,480,1400]){
      const mobile=width<480;
      await page.setViewportSize({width,height:950});
      for(const kind of ['bubble','unanchored']){
        await seed();await open(kind);
        await page.locator('#qa-outside').click();
        ok(`${width}px ${kind}: outside ${mobile?'keeps':'dismisses'} popup`,(await panel(kind).count()>0)===mobile);
        if(!mobile) await open(kind);
        await page.locator('#qa-outside').tap();
        ok(`${width}px ${kind}: touch outside follows width policy`,(await panel(kind).count()>0)===mobile);
        if(!mobile) await open(kind);
        await panel(kind).getByRole('button',{name:'Reply',exact:true}).click();
        const input=page.locator('.ca-composer-input');
        ok(`${width}px ${kind}: reply autofocus preserved`,await input.evaluate(e=>document.activeElement===e));
        ok(`${width}px ${kind}: shortcut hint ${mobile?'absent':'present'}`,await page.getByLabel('Keyboard shortcuts',{exact:true}).count()===(mobile?0:1));
        await input.fill('First line');await input.press('Enter');
        if(mobile){
          ok(`${width}px ${kind}: Enter adds newline, never sends`,await input.inputValue()==='First line\n'&&
            await panel(kind).locator('[data-entry-kind="comment"]').count()===1);
          await input.press('Shift+Enter');
          ok(`${width}px ${kind}: Shift+Enter also adds newline`,await input.inputValue()==='First line\n\n');
          await page.locator('#qa-outside').click();
          ok(`${width}px ${kind}: outside preserves reply text`,await input.inputValue()==='First line\n\n');
          await panel(kind).getByRole('button',{name:'Reply',exact:true}).click();
        }
        ok(`${width}px ${kind}: ${mobile?'Reply button':'Enter'} posts exactly once`,await panel(kind).locator('[data-entry-kind="comment"]').count()===2&&await input.count()===0);
        await panel(kind).getByRole('button',{name:'Reply',exact:true}).click();
        await input.fill('IME draft');
        await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true});
        ok(`${width}px ${kind}: IME Enter does not submit`,await input.count()===1&&await panel(kind).locator('[data-entry-kind="comment"]').count()===2);
        await input.press('Escape');
        ok(`${width}px ${kind}: Escape cancels reply only`,await panel(kind).count()===1&&await input.count()===0);
        await panel(kind).locator('.ca-close').click();
        ok(`${width}px ${kind}: explicit close restores toolbar`,await panel(kind).count()===0&&await page.locator('.ca-toolbar').isVisible());
        if(!mobile){
          await open(kind);await trigger(kind).click();
          ok(`${width}px ${kind}: trigger closes without reopening`,await panel(kind).count()===0);
          await open(kind);await trigger(kind==='bubble'?'unanchored':'bubble').click();
          ok(`${width}px ${kind}: switching popup stays exclusive`,await page.locator('.ca-popover,.ca-tray').count()===1&&await panel(kind).count()===0);
        }
      }
      await seed();
      await page.getByRole('button',{name:'Comment mode',exact:true}).click();
      await page.locator('[data-anno-id="spec.title"]').click();
      const draft=page.locator('.ca-thread-draft'), input=page.locator('.ca-composer-input');
      await input.waitFor();
      ok(`${width}px new comment: autofocus preserved`,await input.evaluate(e=>e===document.activeElement));
      await input.fill('New comment');await input.press('Enter');
      if(mobile){
        ok(`${width}px new comment: Enter does not submit`,await input.inputValue()==='New comment\n');
        await page.locator('#qa-outside').click();
        ok(`${width}px new comment: outside preserves draft`,await input.inputValue()==='New comment\n');
        await draft.getByRole('button',{name:'Comment',exact:true}).click();
      }
      ok(`${width}px new comment: ${mobile?'button':'Enter'} submits`,await input.count()===0&&await page.evaluate(()=>JSON.parse(localStorage.getItem('annotation-fixture-doc')).threads.length)===3);
    }
    // An outside annotated target must not replace a mobile popup with a draft,
    // even if comment mode was already active before the popup opened.
    for(const kind of ['bubble','unanchored']){
      await page.setViewportSize({width:375,height:950});await seed();
      await page.getByRole('button',{name:'Comment mode',exact:true}).click();
      await open(kind);
      await page.locator('[data-anno-id="spec.lede"]').tap();
      ok(`mobile ${kind}: outside annotated target in comment mode preserves popup`,await panel(kind).count()===1&&await page.locator('.ca-thread-draft').count()===0);
    }
    // Width changes must update hint and key behavior without remounting the composer.
    for(const kind of ['bubble','unanchored']){
      await page.setViewportSize({width:479,height:950});await seed();await open(kind);
      await panel(kind).getByRole('button',{name:'Reply',exact:true}).click();await page.locator('.ca-composer-input').fill('Resize');
      await page.setViewportSize({width:480,height:950});await page.getByLabel('Keyboard shortcuts',{exact:true}).waitFor();
      ok(`${kind}: resizing preserves focus and text`,await page.locator('.ca-composer-input').evaluate(e=>e===document.activeElement&&e.value==='Resize'));
      await page.locator('.ca-composer-input').press('Shift+Enter');
      ok(`${kind}: desktop Shift+Enter remains newline`,await page.locator('.ca-composer-input').inputValue()==='Resize\n');
      await page.setViewportSize({width:479,height:950});await page.getByLabel('Keyboard shortcuts',{exact:true}).waitFor({state:'detached'});
      await page.locator('.ca-composer-input').press('Enter');
      ok(`${kind}: re-entering mobile changes Enter without losing draft`,await page.locator('.ca-composer-input').inputValue()==='Resize\n\n');
    }
    ok('no browser exceptions',errors.length===0);
  }
}finally{
 await writeFile(`${out}/popup-interactions-results.json`,JSON.stringify({report,errors},null,2));
 await ctx.close();await browser.close();
}