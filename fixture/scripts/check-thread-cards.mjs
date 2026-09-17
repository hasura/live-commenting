/**
 * Thread-card visual language + action tooltips.
 * Isolated browser/localStorage only. Never writes to the live review backend.
 */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';

const out=process.env.TEST_OUTPUT_DIR??'test-output';
await mkdir(out,{recursive:true});
const report=[],errors=[];
const ok=(name,value)=>{report.push({name,pass:!!value});console.log(value?'PASS':'FAIL',name);assert.ok(value,name);};
const browser=await launchBrowser();
const context=await browser.newContext({viewport:{width:1400,height:950}});
const page=await context.newPage();
page.on('pageerror',e=>errors.push(e.message));
const base='http://localhost:5180';
const author={id:'qa',name:'Review QA'};
const thread=(id,target,label,status='open')=>({id,status,refs:[{kind:'anno_id',id:target,label}],comments:[
  {id:`${id}-c1`,author,createdAt:'2026-09-17T12:20:00Z',body:[{kind:'text',value:`First comment for ${label}.`}]},
  {id:`${id}-c2`,author,createdAt:'2026-09-17T12:21:00Z',body:[{kind:'text',value:'A second comment, not a second thread.'}]}
]});
const a=thread('a','spec.title','Spec title'), b=thread('b','spec.title','Spec title'), resolved=thread('c','spec.title','Spec title','resolved');
const missing=thread('missing','qa.missing-target','Missing annotation'),missing2=thread('missing2','qa.missing-target-2','Another missing annotation');
const seed=async threads=>{
  await page.goto(base,{waitUntil:'networkidle'});
  await page.evaluate(threads=>localStorage.setItem('annotation-fixture-doc',JSON.stringify({version:1,threads})),threads);
  await page.reload({waitUntil:'networkidle'});
};
const tip=async trigger=>{
  await page.mouse.move(0,0);
  await page.locator('.doc-header-title').click();
  await trigger.hover();
  await page.getByRole('tooltip').waitFor();
  const text=await page.getByRole('tooltip').innerText();
  await page.mouse.move(0,0);
  return text;
};
const color=loc=>loc.evaluate(el=>getComputedStyle(el).backgroundColor);
const openPin=async()=>{
  await page.locator('.ca-pin').first().click();
  await page.locator('.ca-popover .ca-thread').first().waitFor();
};
const checkHeading=async(card)=>{
  return await card.locator('.ca-thread-target svg').count()===0
    &&await card.locator('.ca-thread-target > .ca-thread-label').count()===1
    &&await card.locator('.ca-thread-label').evaluate(el=>getComputedStyle(el).fontSize==='14px');
};
try {
  await seed([a]);
  const comments=page.locator('[data-testid="toggle-comments"]');
  const resolvedToggle=page.locator('[data-testid="toggle-resolved"]');
  const unanchored=page.locator('[data-testid="unanchored"]');
  ok('shown comments advertise Hide comments',await tip(comments)==='Hide comments');
  await comments.click();
  ok('hidden comments advertise Show comments',await tip(comments)==='Show comments');
  await comments.click();
  ok('hidden resolved threads advertise Show resolved threads',await tip(resolvedToggle)==='Show resolved threads');
  await resolvedToggle.click();
  ok('shown resolved threads advertise Hide resolved threads',await tip(resolvedToggle)==='Hide resolved threads');
  await comments.click();
  ok('hiding all comments changes resolved action back to Show',await tip(resolvedToggle)==='Show resolved threads');
  await resolvedToggle.click();
  ok('Show resolved restores the hidden comment layer',await comments.getAttribute('aria-pressed')==='true'&&await resolvedToggle.getAttribute('aria-pressed')==='true');
  await resolvedToggle.click();
  ok('unanchored closed tooltip describes Show',await tip(unanchored)==='Show unanchored (comments whose targets can no longer be found in this artifact)');
  await unanchored.click();
  ok('unanchored enabled tooltip describes Hide',await tip(unanchored)==='Hide unanchored (comments whose targets can no longer be found in this artifact)');
  await unanchored.click();
  const outline=await page.locator('.ca-tool-comment').evaluate(el=>getComputedStyle(el).borderColor);
  ok('inactive Comment outline matches segmented group',outline===await page.locator('.ca-tool-segments').evaluate(el=>getComputedStyle(el).borderColor));
  ok('inactive Comment retains a visible border',outline==='rgba(255, 255, 255, 0.2)');
  await openPin();
  let pop=page.locator('.ca-popover'), card=pop.locator('.ca-thread');
  ok('one thread with two comments is one white card',await card.count()===1&&await color(pop)==='rgb(255, 255, 255)'&&await color(card)==='rgb(255, 255, 255)');
  ok('single thread has no aggregate header',await pop.locator('.ca-popover-head').count()===0&&!await pop.evaluate(el=>el.classList.contains('ca-popover-multiple')));
  ok('open thread has a 14px label without a state icon',await checkHeading(card));
  ok('single thread contains reply/resolve and Close',await card.getByRole('button',{name:'Reply',exact:true}).count()===1&&await card.getByRole('button',{name:'Resolve',exact:true}).count()===1&&await card.getByRole('button',{name:'Close comments',exact:true}).count()===1);
  await page.mouse.move(0,0);
  await page.screenshot({path:`${out}/v4-thread-single.png`});
  await card.getByRole('button',{name:'Close comments',exact:true}).click();
  ok('single-thread Close dismisses popup',await page.locator('.ca-popover').count()===0);

  await seed([a,b,resolved]);
  await resolvedToggle.click();
  await openPin();
  pop=page.locator('.ca-popover');
  ok('multiple-thread popup has a light-blue outer surface',await color(pop)==='rgb(239, 246, 255)');
  ok('aggregate heading is plain N threads without any thread-state icon',
    (await pop.locator('.ca-popover-title').innerText())==='3 threads'
    &&await pop.locator('.ca-popover-head svg:not(.lucide-x)').count()===0);
  ok('every grouped thread is a separate rounded white card',await pop.locator('.ca-thread').evaluateAll(els=>els.length===3&&els.every(el=>getComputedStyle(el).backgroundColor==='rgb(255, 255, 255)'&&getComputedStyle(el).borderRadius==='6px'&&getComputedStyle(el).borderWidth==='1px')));
  ok('open and resolved cards use icon-free 14px labels',
    await checkHeading(pop.locator('[data-thread-id="a"]'))&&await checkHeading(pop.locator('[data-thread-id="c"]')));
  ok('each grouped thread owns its reply and status action',await pop.locator('.ca-thread').evaluateAll(els=>els.every(el=>el.querySelectorAll('.ca-thread-actions button').length===2)));
  await pop.locator('[data-thread-id="a"]').getByRole('button',{name:'Reply',exact:true}).click();
  ok('reply composer is inside its thread, not outside the cards',await pop.locator('[data-thread-id="a"] .ca-composer').count()===1);
  await page.locator('.ca-composer-input').fill('Reply within the first thread.');
  await page.keyboard.press('Enter');
  ok('reply only updates its own thread',await pop.locator('[data-thread-id="a"] .ca-comment-body').count()===3&&await pop.locator('[data-thread-id="b"] .ca-comment-body').count()===2);
  for(const width of [1400,375,320]){
    await page.setViewportSize({width,height:950});
    await page.waitForTimeout(150);
    const box=await pop.boundingBox(),bar=await page.locator('.ca-toolbar').boundingBox();
    ok(`${width}px grouped popup fits above toolbar`,box.x>=0&&box.x+box.width<=width&&box.y>=0&&box.y+box.height<bar.y);
    ok(`${width}px grouped popup has no horizontal overflow`,await pop.evaluate(el=>el.scrollWidth<=el.clientWidth));
    await page.mouse.move(0,0);await page.waitForTimeout(300);
    await page.screenshot({path:`${out}/v4-thread-group-${width}.png`});
  }
  await pop.getByRole('button',{name:'Close comments',exact:true}).click();
  await page.setViewportSize({width:1400,height:950});

  await seed([a,b]);
  await openPin();
  await page.locator('[data-thread-id="a"]').getByRole('button',{name:'Resolve',exact:true}).click();
  await page.waitForTimeout(150);
  ok('resolving one of two threads collapses group into direct single card',await page.locator('.ca-popover .ca-thread').count()===1&&await page.locator('.ca-popover-head').count()===0&&await color(page.locator('.ca-popover'))==='rgb(255, 255, 255)');

  await seed([]);
  await page.getByRole('button',{name:'Comment mode',exact:true}).click();
  await page.locator('[data-anno-id="spec.title"]').click();
  await page.locator('.ca-thread-draft').waitFor();
  ok('new comment uses a direct white thread card and icon-free label',await checkHeading(page.locator('.ca-thread-draft'))&&await page.locator('.ca-popover-head').count()===0);
  ok('draft Comment/Cancel controls live inside the thread boundary',await page.locator('.ca-thread-draft').getByRole('button',{name:'Comment',exact:true}).count()===1&&await page.locator('.ca-thread-draft').getByRole('button',{name:'Cancel',exact:true}).count()===1);
  await page.locator('.ca-composer-input').fill('Draft in a thread card.');
  await page.keyboard.press('Enter');
  ok('draft submits without changing stored schema',await page.evaluate(()=>JSON.parse(localStorage.getItem('annotation-fixture-doc')).threads.length)===1);

  await seed([missing]);
  await unanchored.click();
  let tray=page.locator('.ca-tray');
  ok('one unanchored thread uses the direct white-card surface',await color(tray)==='rgb(255, 255, 255)'&&await tray.locator('.ca-tray-head').count()===0);
  ok('unanchored thread has an icon-free 14px saved annotation label',await checkHeading(tray.locator('.ca-thread')));
  await seed([missing,missing2]);
  await unanchored.click();
  tray=page.locator('.ca-tray');
  ok('multiple unanchored threads reuse light-blue group and white cards',await color(tray)==='rgb(239, 246, 255)'&&await tray.locator('.ca-thread').count()===2&&(await tray.locator('.ca-tray-head > span').innerText())==='2 threads'&&await tray.locator('.ca-tray-head svg:not(.lucide-x)').count()===0);
  await tray.locator('[data-thread-id="missing"]').getByRole('button',{name:'Reply',exact:true}).click();
  await page.locator('.ca-composer-input').fill('Reply to a missing target.');
  await page.keyboard.press('Enter');
  ok('unanchored thread preserves history and supports a reply in its own card',await tray.locator('[data-thread-id="missing"] .ca-comment-body').count()===3);
  ok('UI vocabulary contains no conversations or messages',!/(conversation|message)/i.test(await tray.innerText()));

  // Real click and keyboard transitions; both positioning layers must obey the
  // same one-popup invariant. This never touches the shared review backend.
  for (const [kind,target,label,count] of [
    ['document','spec.title','Spec title',1],
    ['viewport','doc.header.version','Version',2],
  ]) {
    const anchored = Array.from({length:count},(_,i)=>thread(`switch-${i}`,target,label));
    await seed([...anchored,missing,missing2]);
    const pin = page.locator(`.ca-pin[data-ca-targets~="${target}"]`).first();
    await pin.click();
    await page.locator('.ca-popover .ca-thread').first().waitFor();
    await unanchored.click();
    await page.locator('.ca-tray').waitFor();
    ok(`${kind}: showing unanchored closes the bubble popup`,
      await page.locator('.ca-popover').count()===0 && await pin.getAttribute('aria-expanded')==='false');
    await pin.click();
    await page.locator('.ca-popover .ca-thread').first().waitFor();
    ok(`${kind}: clicking bubble closes the unanchored popup`,
      await page.locator('.ca-tray').count()===0 && await unanchored.getAttribute('aria-pressed')==='false');
    ok(`${kind}: bubble leaves unanchored tooltip advertising Show`,
      (await unanchored.getAttribute('aria-label')).startsWith('Show unanchored'));
    await page.keyboard.press('Escape');
    ok(`${kind}: closing bubble does not resurrect the unanchored popup`,
      await page.locator('.ca-popover,.ca-tray').count()===0);
    // Keyboard activation must not rely on a pointerdown outside the popup.
    await pin.focus(); await page.keyboard.press('Enter');
    await page.locator('.ca-popover .ca-thread').first().waitFor();
    await unanchored.focus(); await page.keyboard.press('Enter');
    await page.locator('.ca-tray').waitFor();
    ok(`${kind}: keyboard opening unanchored also closes the bubble`,
      await page.locator('.ca-popover').count()===0);
    await pin.focus(); await page.keyboard.press('Enter');
    await page.locator('.ca-popover .ca-thread').first().waitFor();
    ok(`${kind}: keyboard opening bubble also closes unanchored`,
      await page.locator('.ca-tray').count()===0);
    for (const width of [1400,375,320]) {
      await page.setViewportSize({width,height:950});
      await page.waitForTimeout(150);
      const panel=page.locator('.ca-popover');
      ok(`${kind}: ${width}px icon-free 14px labels exceed usernames`,
        await panel.locator('.ca-thread').evaluateAll(cards=>cards.every(card=>{
          const noIcon=!card.querySelector('.ca-thread-target svg');
          const label=getComputedStyle(card.querySelector('.ca-thread-label'));
          const name=getComputedStyle(card.querySelector('.ca-comment-author'));
          return noIcon && label.fontSize==='14px' && parseFloat(label.fontSize)>parseFloat(name.fontSize);
        })));
      ok(`${kind}: ${width}px headers fit popup`,
        await panel.evaluate(el=>el.scrollWidth<=el.clientWidth));
      if (kind==='document' && width===1400) await page.screenshot({path:`${out}/v4-thread-single.png`});
    }
    await page.setViewportSize({width:1400,height:950});
  }
  await seed([missing,missing2]);
  await unanchored.click();
  ok('unanchored cards also use icon-free 14px annotation labels',
    await page.locator('.ca-tray .ca-thread').evaluateAll(cards=>cards.length===2 && cards.every(card=>
      !card.querySelector('.ca-thread-target svg') &&
      getComputedStyle(card.querySelector('.ca-thread-label')).fontSize==='14px' &&
      parseFloat(getComputedStyle(card.querySelector('.ca-thread-label')).fontSize)>
      parseFloat(getComputedStyle(card.querySelector('.ca-comment-author')).fontSize)
    )));
  await page.getByRole('button',{name:'Comment mode',exact:true}).click();
  ok('starting a comment closes the unanchored popup',await page.locator('.ca-tray').count()===0);
  await page.locator('[data-anno-id="spec.title"]').click();
  await page.locator('.ca-thread-draft').waitFor();
  ok('draft header has an icon-free 14px label',await checkHeading(page.locator('.ca-thread-draft')));
  await unanchored.focus(); await page.keyboard.press('Enter');
  await page.locator('.ca-tray').waitFor();
  ok('opening unanchored via keyboard closes the draft popup',await page.locator('.ca-popover').count()===0);
  ok('toolbar icons remain 16px',await page.locator('.ca-toolbar svg').evaluateAll(icons=>
    icons.length===7 && icons.every(icon=>icon.getBoundingClientRect().width===16 && icon.getBoundingClientRect().height===16)));

  // Badge colours distinguish states; both badges remain when both apply.
  const missingResolved=thread('missing-resolved','qa.missing-resolved','A long annotation label for an unanchored resolved thread','resolved');
  await seed([a,resolved,missing,missingResolved]);
  await resolvedToggle.click();
  await openPin();
  ok('resolved badge keeps its green treatment',await page.locator('[data-thread-id="c"] .ca-tag').evaluate(el=>
    el.textContent==='resolved' && getComputedStyle(el).backgroundColor==='rgb(236, 253, 245)' && getComputedStyle(el).color==='rgb(4, 120, 87)'));
  ok('open anchored thread has no status badge',await page.locator('[data-thread-id="a"] .ca-tag').count()===0);
  await unanchored.click();
  const singleBadge=page.locator('[data-thread-id="missing"] .ca-tag-unanchored');
  ok('unanchored badge is text-only amber',await singleBadge.evaluate(el=>
    el.textContent==='unanchored' && !el.querySelector('svg') && getComputedStyle(el).backgroundColor==='rgb(255, 251, 235)' && getComputedStyle(el).color==='rgb(180, 83, 9)'));
  ok('resolved and unanchored badges coexist',JSON.stringify(await page.locator('[data-thread-id="missing-resolved"] .ca-tag').allTextContents())===JSON.stringify(['resolved','unanchored']));
  ok('both badge styles share geometry',await page.locator('[data-thread-id="missing-resolved"]').evaluate(card=>{
    const badges=[...card.querySelectorAll('.ca-tag')].map(el=>getComputedStyle(el));
    return ['borderRadius','fontSize','fontWeight','padding'].every(key=>badges[0][key]===badges[1][key]);
  }));
  for (const width of [1400,375,320]) {
    await page.setViewportSize({width,height:950});
    await page.waitForTimeout(150);
    ok(`${width}px unanchored badges and long labels stay within their cards`,
      await page.locator('.ca-tray').evaluate(el=>el.scrollWidth<=el.clientWidth &&
        [...el.querySelectorAll('.ca-thread')].every(card=>card.scrollWidth<=card.clientWidth)));
    ok(`${width}px popup headers contain only labels, badges and Close`,
      await page.locator('.ca-tray .ca-thread-head').evaluateAll(heads=>heads.every(head=>
        !head.querySelector('svg:not(.lucide-x)') &&
        getComputedStyle(head.querySelector('.ca-thread-label')).fontSize==='14px')));
    await page.mouse.move(0,0);
    await page.evaluate(()=>document.activeElement?.blur());
    await page.waitForTimeout(300);
    await page.screenshot({path:`${out}/v4-thread-badges-${width}.png`});
  }
  ok('no browser exceptions',errors.length===0);
} finally {
  await writeFile(`${out}/thread-cards-results.json`,JSON.stringify({report,errors},null,2));
  await context.close();await browser.close();
}