import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir,cp,readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
const lane=process.argv[2]??'candidate';
if(!['baseline','candidate'].includes(lane))throw Error('Usage: node scripts/snapshot-lab.mjs baseline|candidate');
const dest=resolve(`public-lab/${lane}`);
if(lane==='baseline'&&existsSync(`${dest}/lab.html`))throw Error('Baseline already frozen. Do not overwrite the comparison reference.');
// This commit adds only the test fixtures to the unchanged 0.2.0 library.
// Never label the current candidate code as "baseline" on a fresh checkout.
const baselineRef='279bc34';
let temporary;
try {
 let cwd=process.cwd();
 if(lane==='baseline'){
  temporary=await mkdtemp(join(tmpdir(),'commenting-baseline-'));
  execFileSync('git',['worktree','add','--detach',temporary,baselineRef],{stdio:'inherit'});
  cwd=join(temporary,'fixture');
  execFileSync('npm',['ci'],{cwd,stdio:'inherit'});
 }
 execFileSync('npm',['run','build'],{cwd,stdio:'inherit'});
 await mkdir(dest,{recursive:true});await cp(join(cwd,'dist'),dest,{recursive:true});
 for(const file of ['index.html','lab.html']){
  const html=await readFile(`${dest}/${file}`,'utf8');
  await writeFile(`${dest}/${file}`,html.replaceAll('"/assets/',`"/${lane}/assets/`));
 }
 await writeFile(`${dest}/revision.json`,JSON.stringify({
  revision:execFileSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8'}).trim(),
  diff:execFileSync('git',['diff','--stat','--','src/annotations'],{cwd,encoding:'utf8'}).trim(),
  builtAt:new Date().toISOString(),lane
 },null,2));
 console.log(`Snapshot ready at /${lane}/lab.html`);
}finally{
 if(temporary){
  execFileSync('git',['worktree','remove','--force',temporary]);
  await rm(temporary,{recursive:true,force:true});
 }
}
