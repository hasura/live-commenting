import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir,cp,readFile,writeFile} from 'node:fs/promises';
const lane=process.argv[2]??'candidate';
if(!['baseline','candidate'].includes(lane))throw Error('Usage: node scripts/snapshot-lab.mjs baseline|candidate');
const dest=`public-lab/${lane}`;
if(lane==='baseline'&&existsSync(`${dest}/lab.html`))throw Error('Baseline already frozen. Do not overwrite the comparison reference.');
execFileSync('npm',['run','build'],{stdio:'inherit'});
await mkdir(dest,{recursive:true});await cp('dist',dest,{recursive:true});
for(const file of ['index.html','lab.html']){
 const html=await readFile(`${dest}/${file}`,'utf8');
 await writeFile(`${dest}/${file}`,html.replaceAll('"/assets/',`"/${lane}/assets/`));
}
await writeFile(`${dest}/revision.json`,JSON.stringify({
 revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 diff:execFileSync('git',['diff','--stat','--','src/annotations'],{encoding:'utf8'}).trim(),
 builtAt:new Date().toISOString(),lane
},null,2));
console.log(`Snapshot ready at /${lane}/lab.html`);
