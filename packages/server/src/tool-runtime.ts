import type {TaskSource} from '../../protocol/src/index.ts';

type WaitingRead = {start:()=>void; cancel:()=>void};
const waiting:WaitingRead[]=[];
let activeReads=0;
const MAX_READS=4;

/** All Harness instances and voice-direct tools share these four slots. */
export function runReadOnly<T>(signal:AbortSignal,run:()=>Promise<T>):Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve,reject)=>{
    const entry:WaitingRead={
      start:()=>{
        signal.removeEventListener('abort',entry.cancel);
        activeReads++;
        void Promise.resolve().then(()=>{signal.throwIfAborted();return run();}).then(resolve,reject).finally(()=>{
          activeReads--;
          while(activeReads<MAX_READS&&waiting.length)waiting.shift()!.start();
        });
      },
      cancel:()=>{
        const index=waiting.indexOf(entry);
        if(index>=0)waiting.splice(index,1);
        signal.removeEventListener('abort',entry.cancel);
        reject(signal.reason??new Error('任务已取消'));
      },
    };
    if(activeReads<MAX_READS)entry.start();
    else {waiting.push(entry);signal.addEventListener('abort',entry.cancel,{once:true});}
  });
}

function stableJson(value:unknown):string {
  return JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)
    ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
}

/** Owned by one task, retained during clarification and disposed on termination. */
export class TaskToolRuntime {
  private cache=new Map<string,Promise<unknown>>();
  private sources=new Map<string,TaskSource>();
  private detailedSources=new Set<string>();
  read<T>(name:string,args:unknown,signal:AbortSignal,run:()=>Promise<T>):Promise<T> {
    signal.throwIfAborted();
    const key=`${name}:${stableJson(args)}`;
    const found=this.cache.get(key);if(found)return found as Promise<T>;
    const promise=runReadOnly(signal,run).catch(error=>{if(this.cache.get(key)===promise)this.cache.delete(key);throw error;});
    this.cache.set(key,promise);return promise;
  }
  record(source:TaskSource,detailed=false) {
    let url:URL;try{url=new URL(source.url);}catch{return;}
    if(!['http:','https:'].includes(url.protocol))return;
    url.hash='';
    const key=url.href,previous=this.sources.get(key);
    if(!detailed&&this.detailedSources.has(key))return;
    if(detailed)this.detailedSources.add(key);
    this.sources.set(key,{...previous,...source,url:key});
  }
  getSources():TaskSource[]{return [...this.sources.values()].map(source=>({...source}));}
  release(){this.cache.clear();this.sources.clear();this.detailedSources.clear();}
}
