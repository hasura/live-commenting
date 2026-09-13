import {chromium} from 'playwright-core';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.connectOverCDP('http://127.0.0.1:9222');
const results=[];
try{
 for(const lane of ['baseline','candidate']){
  const ctx=await browser.newContext({viewport:{width:1440,height:900}});
  const page=await ctx.newPage();
  const url=`http://127.0.0.1:5188/${lane}/lab.html?fixture=ui`;
  await page.goto(url,{waitUntil:'networkidle'});
  await page.getByTitle('Comment mode',{exact:true}).click();
  await page.locator('[data-anno-id="ui.title"]').click();
  await page.locator('textarea').fill('Performance seed');
  await page.locator('.ca-composer .ca-btn').click();
  const key=lane==='baseline'?'mobile-lab-ui-v1':'mobile-lab-ui-candidate-v1';
  await page.evaluate(({key})=>{
    const doc=JSON.parse(localStorage.getItem(key));
    const seed=doc.threads[0],targets=[...document.querySelectorAll('[data-anno-id]')];
    doc.threads=Array.from({length:120},(_,i)=>({
      ...seed,id:`perf-${i}`,refs:[{kind:'anno_id',id:targets[i%targets.length].dataset.annoId,label:targets[i%targets.length].dataset.annoLabel}],
      pin:{xPct:(i%5)/5,yPct:.5},comments:seed.comments.map(c=>({...c,id:`comment-${i}`}))
    }));
    localStorage.setItem(key,JSON.stringify(doc));
  },{key});
  await page.reload({waitUntil:'networkidle'});
  const stats=await page.evaluate(async()=>{
    let targetMeasures=0;
    const orig=Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect=function(){
      if(this.hasAttribute('data-anno-id'))targetMeasures++;
      return orig.call(this);
    };
    const frames=[],start=performance.now();let last=start;
    for(let i=0;i<90;i++){
      scrollTo(0,Math.floor(450*(1-Math.cos(i/12))));
      await new Promise(requestAnimationFrame);
      const now=performance.now();frames.push(now-last);last=now;
    }
    Element.prototype.getBoundingClientRect=orig;
    frames.sort((a,b)=>a-b);
    return {targetMeasures,p50ms:frames[45],p95ms:frames[85],durationMs:performance.now()-start,pins:document.querySelectorAll('.ca-pin').length};
  });
  results.push({lane,threads:120,...stats});console.log(JSON.stringify(results.at(-1)));
  await ctx.close();
 }
}finally{await writeFile('public-lab/evidence/candidate/performance.json',JSON.stringify({note:'Local headed Chromium diagnostic, not a production benchmark',results},null,2));await browser.close();}
