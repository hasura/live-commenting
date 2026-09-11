import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const base='http://127.0.0.1:5190';
const out=process.env.TEST_OUTPUT_DIR??'test-output/recreated';
await mkdir(out,{recursive:true});
const statePath='runtime-state/state.json';
const fingerprint=async()=>createHash('sha256').update(await readFile(statePath)).digest('hex');
const before=await fingerprint();
const report=[];
const ok=(name,condition)=>{report.push({name,pass:!!condition});console.log(condition?'PASS':'FAIL',name);assert.ok(condition,name);};
const browser=await chromium.connectOverCDP(process.env.CDP_URL??'http://127.0.0.1:9222');
const context=await browser.newContext({viewport:{width:1400,height:1050}});
try {
  const ready=await fetch(base+'/readyz');
  ok('unauthenticated readiness is empty 204',ready.status===204&&(await ready.text())==='');
  const unauthorized=await fetch(base+'/api/state');
  ok('API still requires visitor identity',unauthorized.status===401);
  const invalid=await fetch(base+'/api/state',{headers:{'X-PromptQL-Visitor-Token':'invalid'}});
  ok('malformed identity rejected',invalid.status===401);
  const token=process.env.PROMPTQL_VISITOR_TOKEN;
  assert.ok(token,'Set PROMPTQL_VISITOR_TOKEN to a captured X-PromptQL-Visitor-Token value, never the VM user JWT');
  const payload=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
  const actor=payload.sub ?? payload['https://promptql.hasura.io']?.['x-hasura-promptql-user-id'];
  const response=await fetch(base+'/api/state',{headers:{'X-PromptQL-Visitor-Token':token}});
  const saved=await response.json();
  ok('real platform validates read-only requesting-user access',response.status===200&&saved.user?.id===actor);
  ok('all four review rounds remain available',saved.revision===4&&saved.doc.rounds.length===4);
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{
    const req=route.request();
    assert.ok(req.url().startsWith(base+'/api/'));
    assert.equal(req.method(),'GET','This live verification must not submit any shared state');
    await route.continue({headers:{...req.headers(),'x-promptql-visitor-token':token}});
  });
  await page.goto(base,{waitUntil:'networkidle'});
  await page.getByRole('status').filter({hasText:'Shared review loaded.'}).waitFor();
  ok('recreated UI loads authenticated shared review',(await page.locator('.review-banner').innerText()).includes(saved.user.name));
  await page.getByRole('button',{name:'Sent rounds (4)'}).click();
  ok('all four immutable rounds render',await page.locator('.review-history details').count()===4);
  await page.getByRole('button',{name:'Sent rounds (4)'}).click();
  ok('image example preserved',await page.locator('[data-anno-id="spec.image-example.image"]').evaluate(el=>el.complete&&el.naturalWidth===960));
  ok('Save all preserved without creating a test review',await page.getByRole('button',{name:'Save all',exact:true}).isDisabled());
  await page.screenshot({path:out+'/recreated-app.png',fullPage:true});
  ok('no browser errors',errors.length===0);
  ok('live shared state unchanged',await fingerprint()===before);
  await writeFile(out+'/recreated-app-results.json',JSON.stringify({
    report,coverage:'Localhost read-only QA with a captured visitor token; does not verify hosted consent.',stateSha256:before
  },null,2));
}finally{
  await context.close();await browser.close();
}