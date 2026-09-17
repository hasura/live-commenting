/** Pure classifier/derived-policy tests, including SSR-safe defaults. */
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp, rm, mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';

const work=await mkdtemp(join(tmpdir(),'device-policy-'));
const report=[];
const ok=(name,condition)=>{assert.ok(condition,name);report.push({name,pass:true});};
try{
 const file=join(work,'device.cjs');
 await build({entryPoints:['src/annotations/device.ts'],bundle:true,format:'cjs',platform:'node',outfile:file});
 const {detectDeviceProfile,deriveDeviceBehavior,readDeviceCharacteristics}=createRequire(import.meta.url)(file);
 const cases=[
  ['Windows desktop',{userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',maxTouchPoints:0},'desktop'],
  ['Windows touch laptop',{userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',maxTouchPoints:10},'desktop'],
  ['Mac desktop',{userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',maxTouchPoints:0},'desktop'],
  ['Linux desktop',{userAgent:'Mozilla/5.0 (X11; Linux x86_64)',maxTouchPoints:0},'desktop'],
  ['ChromeOS',{userAgent:'Mozilla/5.0 (X11; CrOS x86_64)',maxTouchPoints:10},'desktop'],
  ['iPhone',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',maxTouchPoints:5},'mobile'],
  ['iPad old UA',{userAgent:'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)',maxTouchPoints:5},'mobile'],
  ['iPad Mac UA',{userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',maxTouchPoints:5},'mobile'],
  ['Android phone',{userAgent:'Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile',maxTouchPoints:5},'mobile'],
  ['Android tablet false hint',{userAgent:'Mozilla/5.0 (Linux; Android 15; Tablet)',maxTouchPoints:5,mobileHint:false},'mobile'],
  ['Mobile positive hint',{userAgent:'opaque',maxTouchPoints:0,mobileHint:true},'mobile'],
  ['Platform Android',{userAgent:'opaque',maxTouchPoints:0,mobileHint:false,platformHint:'Android'},'mobile'],
  ['Platform Windows',{userAgent:'opaque',maxTouchPoints:10,platformHint:'Windows'},'desktop'],
  ['Unknown',{userAgent:'opaque',maxTouchPoints:0},'unknown'],
  ['Unknown touch',{userAgent:'opaque',maxTouchPoints:10,mobileHint:false},'unknown'],
  ['Unknown false hint',{userAgent:'',maxTouchPoints:0,mobileHint:false},'unknown'],
 ];
 for(const [name,device,expected] of cases){
  ok(name,detectDeviceProfile(device)===expected);
  const base=deriveDeviceBehavior(device);
  ok(`${name}: default Enter`,base.enterSends===(expected==='desktop'));
  ok(`${name}: coherent flags`,base.showEnterShortcut===base.enterSends&&
    base.enterKeyHint===(base.enterSends?undefined:'enter')&&
    base.protectOpenPopup===!base.dismissOnOutsidePress&&
    base.allowComposerFocusScroll===(expected!=='desktop'));
  for(const enterBehavior of ['send','newline']){
   const override=deriveDeviceBehavior(device,{enterBehavior});
   ok(`${name}: explicit ${enterBehavior}`,override.enterSends===(enterBehavior==='send'));
   ok(`${name}: Enter override keeps platform policies`,override.allowComposerFocusScroll===base.allowComposerFocusScroll&&
    override.dismissOnOutsidePress===base.dismissOnOutsidePress&&override.protectOpenPopup===base.protectOpenPopup);
  }
  for(const deviceProfile of ['mobile','desktop','unknown']){
   const override=deriveDeviceBehavior(device,{deviceProfile});
   ok(`${name}: explicit profile ${deviceProfile}`,override.deviceProfile===deviceProfile&&override.enterSends===(deviceProfile==='desktop'));
  }
 }
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 try{
  Object.defineProperty(globalThis,'navigator',{value:undefined,configurable:true});
  ok('SSR unknown default',deriveDeviceBehavior(readDeviceCharacteristics()).deviceProfile==='unknown');
 }finally{
  if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);
  else delete globalThis.navigator;
 }
 const out=process.env.TEST_OUTPUT_DIR??'test-output';
 await mkdir(out,{recursive:true});
 await writeFile(`${out}/device-policy-results.json`,JSON.stringify({report},null,2));
 console.log(`PASS ${report.length} classifier/flag assertions`);
}finally{await rm(work,{recursive:true,force:true});}