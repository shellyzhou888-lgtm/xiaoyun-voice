class XiaoyunPlayer extends AudioWorkletProcessor {
  constructor() {
    super(); this.queue=[]; this.offset=0; this.phase=0; this.ended=false; this.id=''; this.frames=0; this.started=false;
    this.port.onmessage=({data})=>{
      if(data.type==='start'||data.type==='clear') {
        this.queue=[]; this.offset=0; this.phase=0; this.ended=false; this.id=data.id||''; this.started=false;
      } else if(data.type==='chunk'&&data.id===this.id) this.queue.push(new Int16Array(data.pcm));
      else if(data.type==='end'&&data.id===this.id) this.ended=true;
    };
  }
  process(inputs,outputs) {
    const out=outputs[0][0]; let energy=0;
    for(let i=0;i<out.length;i++) {
      while(this.queue.length&&this.offset>=this.queue[0].length) {
        this.offset-=this.queue[0].length; this.queue.shift();
      }
      const value=this.queue.length ? this.queue[0][this.offset]/32768 : 0;
      if(this.queue.length&&!this.started){this.started=true;this.port.postMessage({type:'started',id:this.id});}
      out[i]=value; energy+=value*value;
      if(this.queue.length) {this.phase+=24000/sampleRate; const step=Math.floor(this.phase); this.phase-=step; this.offset+=step;}
    }
    for(let channel=1;channel<outputs[0].length;channel++) outputs[0][channel].set(out);
    if(++this.frames%8===0) this.port.postMessage({type:'level',id:this.id,level:Math.sqrt(energy/out.length)});
    while(this.queue.length&&this.offset>=this.queue[0].length) {this.offset-=this.queue[0].length;this.queue.shift();}
    if(this.ended&&!this.queue.length) {this.ended=false;this.port.postMessage({type:'drained',id:this.id});}
    return true;
  }
}
registerProcessor('xiaoyun-player',XiaoyunPlayer);
