export interface AudioCallbacks {
  onPCM:(pcm:ArrayBuffer,rms:number)=>void;
  onLevel:(level:number)=>void;
  onDrained:(speechId:string)=>void;
  onStarted:(speechId:string)=>void;
}
export class AudioEngine {
  private context?:AudioContext;
  private player?:AudioWorkletNode;
  private capture?:AudioWorkletNode;
  private stream?:MediaStream;
  private source?:MediaStreamAudioSourceNode;
  private loading?:Promise<void>;
  private currentId='';
  private pending:Array<{id:string;pcm:ArrayBuffer}>=[];
  private endId='';
  private speech?:SpeechSynthesisUtterance;
  private demoTimer?:ReturnType<typeof setTimeout>;
  private micGeneration=0;
  private disposed=false;
  constructor(private assets:URL,private callbacks:AudioCallbacks) {}
  async preparePlayback() {
    if(this.disposed)throw new Error('音频组件已销毁');
    if(!this.context) this.context=new AudioContext({sampleRate:24000,latencyHint:'interactive'});
    const resume=this.context.resume();
    if(!this.loading) this.loading=this.loadPlayer();
    await Promise.all([resume,this.loading]);
  }
  private async loadPlayer() {
    const context=this.context!;
    await context.audioWorklet.addModule(new URL('player.worklet.js',this.assets));
    if(this.context!==context) return;
    this.player=new AudioWorkletNode(context,'xiaoyun-player',{numberOfInputs:0,outputChannelCount:[1]});
    this.player.connect(context.destination);
    this.player.port.onmessage=({data})=>{
      if(data.id!==this.currentId) return;
      if(data.type==='level') this.callbacks.onLevel(data.level);
      if(data.type==='drained') this.callbacks.onDrained(data.id);
      if(data.type==='started') this.callbacks.onStarted(data.id);
    };
    if(this.currentId) this.player.port.postMessage({type:'start',id:this.currentId});
    for(const item of this.pending) this.player.port.postMessage({type:'chunk',id:item.id,pcm:item.pcm},[item.pcm]);
    this.pending=[];
    if(this.endId===this.currentId&&this.endId) this.finish(this.endId);
  }
  async enableMicrophone() {
    const generation=this.micGeneration;
    await this.preparePlayback();
    if(this.disposed||generation!==this.micGeneration)return;
    if(this.stream) return;
    const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}});
    if(this.disposed||generation!==this.micGeneration||!this.context){stream.getTracks().forEach(t=>t.stop());return;}
    this.stream=stream;
    await this.context!.audioWorklet.addModule(new URL('capture.worklet.js',this.assets));
    if(this.stream!==stream) {stream.getTracks().forEach(t=>t.stop());return;}
    this.source=this.context!.createMediaStreamSource(stream);
    this.capture=new AudioWorkletNode(this.context!,'xiaoyun-capture',{numberOfOutputs:1,outputChannelCount:[1]});
    this.capture.port.onmessage=({data})=>this.callbacks.onPCM(data.pcm,data.rms);
    this.source.connect(this.capture); this.capture.connect(this.context!.destination);
  }
  disableMicrophone() {
    this.micGeneration++;
    this.capture?.disconnect(); if(this.capture) this.capture.port.onmessage=null;
    this.source?.disconnect(); this.stream?.getTracks().forEach(t=>t.stop());
    this.capture=undefined;this.source=undefined;this.stream=undefined;
  }
  start(id:string) {
    this.stop();this.currentId=id;this.endId='';
    this.player?.port.postMessage({type:'start',id});
  }
  enqueue(id:string,base64:string) {
    if(id!==this.currentId) return;
    const raw=atob(base64),bytes=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
    if(this.player) this.player.port.postMessage({type:'chunk',id,pcm:bytes.buffer},[bytes.buffer]);
    else this.pending.push({id,pcm:bytes.buffer});
  }
  finish(id:string) {if(id!==this.currentId)return;this.endId=id;this.player?.port.postMessage({type:'end',id});}
  playDemo(id:string,text:string,onText:(text:string)=>void) {
    this.start(id);onText(text);
    if('speechSynthesis' in window) {
      const utterance=new SpeechSynthesisUtterance(text);
      this.speech=utterance;utterance.lang='zh-CN';utterance.rate=1.13;
      utterance.voice=speechSynthesis.getVoices().find(v=>v.lang.startsWith('zh'))??null;
      utterance.onstart=()=>{if(this.currentId===id){this.callbacks.onStarted(id);this.callbacks.onLevel(0.09);}};
      utterance.onend=()=>{if(this.currentId===id){this.callbacks.onLevel(0);this.callbacks.onDrained(id);}};
      utterance.onerror=()=>this.demoFallback(id,text);
      speechSynthesis.speak(utterance);
      // Some Windows installations expose speechSynthesis but never start an utterance.
      this.demoTimer=setTimeout(()=>{if(this.currentId===id&&!speechSynthesis.speaking)this.demoFallback(id,text);},1800);
    } else this.demoFallback(id,text);
  }
  private demoFallback(id:string,text:string) {
    if(id!==this.currentId) return;
    clearTimeout(this.demoTimer);
    this.demoTimer=setTimeout(()=>{if(this.currentId===id)this.callbacks.onDrained(id);},Math.min(4500,Math.max(900,text.length*65)));
  }
  stop() {
    this.currentId='';this.pending=[];this.endId='';
    this.player?.port.postMessage({type:'clear'});
    clearTimeout(this.demoTimer);
    if(this.speech) {this.speech.onend=null;this.speech.onerror=null;speechSynthesis.cancel();this.speech=undefined;}
    this.callbacks.onLevel(0);
  }
  destroy() {
    this.disposed=true;
    this.stop();this.disableMicrophone();this.player?.disconnect();
    void this.context?.close();this.context=undefined;this.player=undefined;
  }
}
