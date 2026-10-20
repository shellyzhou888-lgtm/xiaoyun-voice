export class WakeWordDetector {
  private worker?:Worker;
  private loaded=false;
  private preparing?:Promise<void>;
  constructor(private assets:URL,private onWake:()=>void,private onStatus:(status:string,error?:boolean)=>void,private phrase='你好小云') {}
  prepare() {
    if(this.preparing)return this.preparing;
    this.preparing=new Promise<void>((resolve,reject)=>{
      // Bootstrap via a blob so an ESM hosted on the backend can be used by another localhost page.
      const bootstrap=`importScripts(${JSON.stringify(new URL('wake-worker.js',this.assets).href)});`;
      const blobUrl=URL.createObjectURL(new Blob([bootstrap],{type:'text/javascript'}));
      const worker=new Worker(blobUrl);URL.revokeObjectURL(blobUrl);this.worker=worker;
      worker.onmessage=({data})=>{
        if(data.type==='ready'){this.loaded=true;this.onStatus('本地唤醒已就绪');resolve();}
        else if(data.type==='wake')this.onWake();
        else if(data.type==='error'){this.onStatus(data.message,true);reject(new Error(data.message));}
      };
      worker.onerror=()=>{const msg='本地唤醒资源加载失败，请检查资源部署';this.onStatus(msg,true);reject(new Error(msg));};
      worker.postMessage({type:'init',baseUrl:new URL('kws/',this.assets).href,phrase:this.phrase});
    });
    return this.preparing;
  }
  feed(pcm:ArrayBuffer) {if(this.loaded&&this.worker){const copy=pcm.slice(0);this.worker.postMessage({type:'audio',pcm:copy},[copy]);}}
  reset() {this.worker?.postMessage({type:'reset'});}
  destroy(){this.worker?.terminate();this.worker=undefined;this.loaded=false;this.preparing=undefined;}
}
