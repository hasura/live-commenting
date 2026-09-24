/** Isolated browser behavior audit and regression tests; never touches live comments. */
import assert from 'node:assert/strict';
import {resetAndSeed, readDoc} from './dev-client.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';
const out=process.env.TEST_OUTPUT_DIR??'test-output';
await mkdir(out,{recursive:true});
const browser=await launchBrowser();
const mobile=process.env.QA_DEVICE==='mobile';
const profile=mobile?'mobile':'desktop';
const ctx=await browser.newContext({viewport:{width:1400,height:950},hasTouch:true,userAgent:mobile
  ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
  : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36'});
console.log('Device profile:',profile,'(Chromium emulation, not a physical device test)');
await ctx.addInitScript(() => {
  const nativeFocus = HTMLElement.prototype.focus;
  window.__composerFocusCalls = [];
  HTMLElement.prototype.focus = function (...args) {
    if (this.matches('.ca-composer-input')) {
      window.__composerFocusCalls.push({argumentCount:args.length,preventScroll:args[0]?.preventScroll??null});
    }
    return nativeFocus.apply(this,args);
  };
});
const page=await ctx.newPage();
const focusPolicyMatches=mobile=>page.evaluate(mobile=>{
  const calls=window.__composerFocusCalls;
  return calls.length>0&&calls.every(call=>mobile?call.argumentCount===0:call.preventScroll===true);
},mobile);
const report=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
const ok=(name,pass)=>{report.push({name,pass:!!pass});console.log(pass?'PASS':'FAIL',name);assert.ok(pass,name);};
const thread=(id,target,label)=>(id=`qa-thread-${id}`,{id,status:'open',refs:[{kind:'anno_id',id:target,label}],
  comments:[{id:id+'-c',author:{id:'qa',name:'Review QA'},createdAt:'2026-09-17T12:00:00Z',body:[{kind:'text',value:'Review comment.'}]}]});
const data=[thread('a','spec.title','Spec title'),thread('u','qa.missing','Missing annotation')];
const panel=kind=>page.locator(kind==='bubble'?'.ca-popover':'.ca-tray');
const trigger=kind=>kind==='bubble'?page.locator('.ca-pin[data-ca-targets~="spec.title"]').first():page.locator('[data-testid="unanchored"]');
const seed=async()=>{
  await resetAndSeed(page,data);
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
    await seed();await open(kind);
    const visibilityToggle=page.locator('[data-testid="toggle-comments"]');
    await visibilityToggle.focus();await page.keyboard.press('Enter');
    result.keyboardHideCommentsCloses=await panel(kind).count()===0;
    await visibilityToggle.focus();await page.keyboard.press('Enter');await page.waitForTimeout(100);
    result.keyboardShowCommentsRestoresPopup=await panel(kind).count()===1;
    results.push(result);
  }
  const filename=process.env.AUDIT_NAME??'popup-desktop-audit';
  await writeFile(`${out}/${filename}.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
};
try{
  if(process.argv.includes('--audit')) await audit();
  else{
    for(const width of [320,375,479,480,1400]){
      // Width controls layout only; behavior follows the emulated device profile.
      await page.setViewportSize({width,height:950});
      for(const kind of ['bubble','unanchored']){
        await seed();await open(kind);
        await page.locator('#qa-outside').click();
        ok(`${width}px ${kind}: outside ${mobile?'keeps':'dismisses'} popup`,(await panel(kind).count()>0)===mobile);
        if(!mobile) await open(kind);
        await page.locator('#qa-outside').tap();
        ok(`${width}px ${kind}: touch outside follows device policy`,(await panel(kind).count()>0)===mobile);
        if(!mobile) await open(kind);
        await panel(kind).getByRole('button',{name:'Reply',exact:true}).click();
        const input=page.locator('.ca-composer-input');
        ok(`${width}px ${kind}: reply autofocus preserved`,await input.evaluate(e=>document.activeElement===e));
        ok(`${width}px ${kind}: reply focus ${mobile?'allows native scrolling':'preserves desktop scroll policy'}`,await focusPolicyMatches(mobile));
        ok(`${width}px ${kind}: shortcut hint ${mobile?'absent':'present'}`,await page.getByLabel('Keyboard shortcuts',{exact:true}).count()===(mobile?0:1));
        await input.fill('First line');await input.press('Enter');
        if(mobile){
          ok(`${width}px ${kind}: Enter adds newline, never sends`,await input.evaluate(e=>e.textContent === '' ? '' : [...e.childNodes].map(p=>[...p.childNodes].filter(n=>!(n.nodeName==='BR'&&n.classList.contains('ProseMirror-trailingBreak'))).map(n=>n.nodeName==='BR'?'\n':n.textContent).join('')).join('\n'))==='First line\n'&&
            await panel(kind).locator('[data-entry-kind="comment"]').count()===1);
          await input.press('Shift+Enter');
          ok(`${width}px ${kind}: Shift+Enter also adds newline`,await input.evaluate(e=>e.textContent === '' ? '' : [...e.childNodes].map(p=>[...p.childNodes].filter(n=>!(n.nodeName==='BR'&&n.classList.contains('ProseMirror-trailingBreak'))).map(n=>n.nodeName==='BR'?'\n':n.textContent).join('')).join('\n'))==='First line\n\n');
          await page.locator('#qa-outside').click();
          ok(`${width}px ${kind}: outside preserves reply text`,await input.evaluate(e=>e.textContent === '' ? '' : [...e.childNodes].map(p=>[...p.childNodes].filter(n=>!(n.nodeName==='BR'&&n.classList.contains('ProseMirror-trailingBreak'))).map(n=>n.nodeName==='BR'?'\n':n.textContent).join('')).join('\n'))==='First line\n\n');
          await panel(kind).getByRole('button',{name:'Reply',exact:true}).click();
        }
        await input.waitFor({state:'detached'});
        ok(`${width}px ${kind}: ${mobile?'Reply button':'Enter'} posts exactly once`,await panel(kind).locator('[data-entry-kind="comment"]').count()===2&&await input.count()===0);
        await panel(kind).getByRole('button',{name:'Reply',exact:true}).click();
        await input.fill('IME draft');
        await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true});
        ok(`${width}px ${kind}: IME Enter does not submit`,await input.count()===1&&await panel(kind).locator('[data-entry-kind="comment"]').count()===2);
        await input.press('Escape');
        ok(`${width}px ${kind}: Escape cancels reply only`,await panel(kind).count()===1&&await input.count()===0);
        await panel(kind).locator('.ca-close').click();
        ok(`${width}px ${kind}: explicit close restores toolbar`,await panel(kind).count()===0&&await page.locator('.ca-toolbar').isVisible());
        if(width>=480){
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
      ok(`${width}px new comment: focus ${mobile?'allows native scrolling':'preserves desktop scroll policy'}`,await focusPolicyMatches(mobile));
      await input.fill('New comment');await input.press('Enter');
      if(mobile){
        ok(`${width}px new comment: Enter does not submit`,await input.evaluate(e=>e.textContent === '' ? '' : [...e.childNodes].map(p=>[...p.childNodes].filter(n=>!(n.nodeName==='BR'&&n.classList.contains('ProseMirror-trailingBreak'))).map(n=>n.nodeName==='BR'?'\n':n.textContent).join('')).join('\n'))==='New comment\n');
        await page.locator('#qa-outside').click();
        ok(`${width}px new comment: outside preserves draft`,await input.evaluate(e=>e.textContent === '' ? '' : [...e.childNodes].map(p=>[...p.childNodes].filter(n=>!(n.nodeName==='BR'&&n.classList.contains('ProseMirror-trailingBreak'))).map(n=>n.nodeName==='BR'?'\n':n.textContent).join('')).join('\n'))==='New comment\n');
        await draft.getByRole('button',{name:'Comment',exact:true}).click();
      }
      await input.waitFor({state:'detached'});
      ok(`${width}px new comment: ${mobile?'button':'Enter'} submits`,await input.count()===0&&await readDoc(page).then(d=>d.threads.length)===3);
    }
    // An outside annotated target must not replace a mobile popup with a draft,
    // even if comment mode was already active before the popup opened.
    if(mobile) for(const width of [375,844]) for(const kind of ['bubble','unanchored']){
      await page.setViewportSize({width,height:950});await seed();
      await page.getByRole('button',{name:'Comment mode',exact:true}).click();
      await open(kind);
      // A test-only visible target: the wide anchored popup can cover the lede.
      // Keep it outside the annotation UI and avoid force-clicking covered text.
      await page.evaluate(()=>{
        const el=document.createElement('div');
        el.setAttribute('data-anno-id','qa.outside-target');
        el.setAttribute('data-anno-label','Outside target');
        el.setAttribute('data-anno-mode','region');
        el.style.cssText='position:fixed;top:80px;left:4px;width:100px;height:60px;background:white;z-index:2147483647';
        el.textContent='Outside target';
        document.querySelector('#artifact-root').append(el);
      });
      const outsideTarget=page.locator('[data-anno-id="qa.outside-target"]');
      await outsideTarget.tap();
      ok(`mobile ${width}px ${kind}: outside annotated target in comment mode preserves popup`,await panel(kind).count()===1&&await page.locator('.ca-thread-draft').count()===0);
      ok(`mobile ${width}px ${kind}: region capture stays disabled while popup open`,
        await outsideTarget.evaluate(e=>e.style.touchAction!=='none'));
      const box=await outsideTarget.boundingBox();
      await page.mouse.move(box.x+10,box.y+10);await page.mouse.down();
      await page.mouse.move(box.x+70,box.y+45,{steps:5});await page.mouse.up();
      ok(`mobile ${width}px ${kind}: outside drag cannot replace popup`,
        await panel(kind).count()===1&&await page.locator('.ca-thread-draft,.ca-selection-region').count()===0);
    }
    // Width changes only layout; never alter focus, text or Enter policy.
    for(const kind of ['bubble','unanchored']){
      await page.setViewportSize({width:479,height:950});await seed();await open(kind);
      await panel(kind).getByRole('button',{name:'Reply',exact:true}).click();
      const input=page.locator('.ca-composer-input');
      await input.fill('Resize');
      const focusCount=await page.evaluate(()=>window.__composerFocusCalls.length);
      for(const width of [480,844,375,479]){
        await page.setViewportSize({width,height:950});
        await page.waitForTimeout(120);
        ok(`${profile} ${kind} resize ${width}px: hint stays tied to policy`,
          await page.getByLabel('Keyboard shortcuts',{exact:true}).count()===(mobile?0:1));
        ok(`${profile} ${kind} resize ${width}px: focus and text survive`,
          await input.evaluate(e=>e===document.activeElement&&e.textContent==='Resize'));
        ok(`${profile} ${kind} resize ${width}px: no autofocus repeat`,
          await page.evaluate(()=>window.__composerFocusCalls.length)===focusCount);
      }
      await input.press('Shift+Enter');
      ok(`${profile} ${kind}: Shift+Enter stays newline`,await input.evaluate(e=>e.textContent === '' ? '' : [...e.childNodes].map(p=>[...p.childNodes].filter(n=>!(n.nodeName==='BR'&&n.classList.contains('ProseMirror-trailingBreak'))).map(n=>n.nodeName==='BR'?'\n':n.textContent).join('')).join('\n'))==='Resize\n');
      await input.press('Enter');
      if(!mobile)await input.waitFor({state:'detached'});
      ok(`${profile} ${kind}: Enter stays ${mobile?'newline':'send'} after resize`,
        mobile?await input.evaluate(e=>e.textContent === '' ? '' : [...e.childNodes].map(p=>[...p.childNodes].filter(n=>!(n.nodeName==='BR'&&n.classList.contains('ProseMirror-trailingBreak'))).map(n=>n.nodeName==='BR'?'\n':n.textContent).join('')).join('\n'))==='Resize\n\n':await input.count()===0);
    }
    ok('no browser exceptions',errors.length===0);
  }
}finally{
 await writeFile(`${out}/popup-interactions-${profile}-results.json`,JSON.stringify({report,errors},null,2));
 await ctx.close();await browser.close();
}