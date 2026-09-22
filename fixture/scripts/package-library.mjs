import {writeFile,copyFile,readFile} from 'node:fs/promises';
import {build} from 'esbuild';
const {version,dependencies}=JSON.parse(await readFile('package.json','utf8')); // one version: fixture/package.json
await build({entryPoints:['src/annotations/review.ts'],bundle:true,format:'esm',platform:'node',outfile:'lib/review.js',external:['react']});
await build({entryPoints:['src/annotations/events.ts'],bundle:true,format:'esm',platform:'node',outfile:'lib/events.js',external:['react']});
await build({entryPoints:['src/anno.ts'],bundle:true,format:'esm',outfile:'lib/anno.js'});
await copyFile('../INSTRUCTIONS.md','lib/INSTRUCTIONS.md');
await copyFile('THIRD_PARTY_NOTICES.md','lib/THIRD_PARTY_NOTICES.md');
await writeFile('lib/package.json',JSON.stringify({
 name:'collaborative-html-annotation',version,type:'module',
 exports:{'.':{types:'./types/annotations/index.d.ts',import:'./index.js'},'./review':{types:'./types/annotations/review.d.ts',import:'./review.js'},'./events':{types:'./types/annotations/events.d.ts',import:'./events.js'},'./anno':{types:'./types/anno.d.ts',import:'./anno.js'},'./annotations.css':'./annotations.css'},
 peerDependencies:{react:'^19.0.0','react-dom':'^19.0.0','@floating-ui/react':'^0.27.20'},
 dependencies:{'lucide-react':dependencies['lucide-react'],'@radix-ui/react-tooltip':dependencies['@radix-ui/react-tooltip']},
 files:['index.js','review.js','events.js','anno.js','annotations.css','types','INSTRUCTIONS.md','THIRD_PARTY_NOTICES.md']
},null,2));
