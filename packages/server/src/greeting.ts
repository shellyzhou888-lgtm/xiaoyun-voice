import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {config} from './config.ts';

interface CachedGreeting {model:string;voice:string;audio:string;text:string}
const file=()=>path.join(config.dataDir,'greeting.json');
let memory:CachedGreeting|undefined;
export async function getGreeting():Promise<CachedGreeting|undefined>{
  if(!memory){try{memory=JSON.parse(await readFile(file(),'utf8'));}catch{return undefined;}}
  return memory?.model===config.qwenModel&&memory.voice===config.qwenVoice?memory:undefined;
}
/** Cache only the model's greeting output. Microphone audio never enters this path. */
export async function saveGreeting(chunks:string[],text:string){
  if(!chunks.length)return;
  const pcm=Buffer.concat(chunks.map(chunk=>Buffer.from(chunk,'base64')));
  if(pcm.length>24000*2*6)return;
  memory={model:config.qwenModel,voice:config.qwenVoice,audio:pcm.toString('base64'),text:text||'在的。'};
  await writeFile(file(),JSON.stringify(memory),'utf8');
}
