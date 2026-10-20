import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
export default defineConfig({
  root:fileURLToPath(new URL('.',import.meta.url)),
  publicDir:'public',
  plugins:[{
    name:'standalone-types',
    generateBundle(){
      const declarations=readFileSync(new URL('../protocol/src/index.ts',import.meta.url),'utf8')
        .replace(/export const TERMINAL_TASK_STATUSES:TaskStatus\[\] = .*?;/,'');
      this.emitFile({type:'asset',fileName:'index.d.ts',source:declarations+'\nexport declare function createVoiceAssistant(options:VoiceAssistantOptions):VoiceAssistant;\n'});
    }
  }],
  build:{target:'es2022',lib:{entry:'src/index.ts',formats:['es'],fileName:()=> 'voice.js'},rollupOptions:{output:{inlineDynamicImports:true}},minify:true},
  define:{'process.env.NODE_ENV':'"production"'}
});
