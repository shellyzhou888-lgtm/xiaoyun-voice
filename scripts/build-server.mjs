import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('backend',{recursive:true});
await build({entryPoints:['packages/server/src/library.ts'],outfile:'backend/index.js',bundle:true,platform:'node',format:'esm',target:'node24',packages:'external'});
await copyFile('packages/server/src/python_worker.py','backend/python_worker.py');
