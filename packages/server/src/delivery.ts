import {randomUUID} from 'node:crypto';
import type {Delivery,RuntimeMode,Speech} from '../../protocol/src/index.ts';

export function sentences(text:string):string[]{
  return (text.match(/[^。！？!?\n]+[。！？!?]?/g)||[text]).map(s=>s.trim()).filter(Boolean);
}
export function makeDelivery(sessionId:string,kind:Speech['kind'],text:string,taskId?:string):Delivery {
  return {deliveryId:randomUUID(),sessionId,taskId,kind,text,status:'queued',sentenceIndex:0,sentenceCount:kind==='message'?1:sentences(text).length||1,createdAt:Date.now(),updatedAt:Date.now()};
}
export function deliverySentences(delivery:Delivery,provider:RuntimeMode):Speech[]{
  const parts=delivery.kind==='message'?[delivery.text]:sentences(delivery.text);
  return parts.map((text,index)=>({speechId:randomUUID(),deliveryId:delivery.deliveryId,sessionId:delivery.sessionId,taskId:delivery.taskId,kind:delivery.kind,text,provider,sentenceIndex:index,sentenceCount:delivery.sentenceCount}));
}

/** A local RMS pulse is only tentative. Cloud speech and model work own separate IDs. */
export class InputGate {
  local?:string; cloud?:string; processing?:string;
  private timer?:NodeJS.Timeout;
  constructor(private released:()=>void,readonly graceMs=1200){}
  get blocked(){return Boolean(this.local||this.cloud||this.processing);}
  startLocal(id:string){clearTimeout(this.timer);this.local=id;}
  endLocal(id:string){
    if(this.local!==id)return;
    clearTimeout(this.timer);
    this.timer=setTimeout(()=>{if(this.local===id){this.local=undefined;this.released();}},this.graceMs);
    this.timer.unref?.();
  }
  startCloud(id:string){clearTimeout(this.timer);this.local=undefined;this.cloud=id;this.processing=undefined;}
  endCloud(id:string){if(this.cloud===id){this.cloud=undefined;this.processing=id;}}
  process(id:string){if(this.cloud===id)this.cloud=undefined;this.local=undefined;this.processing=id;}
  finish(id:string){if(this.cloud===id)this.cloud=undefined;if(this.processing===id)this.processing=undefined;this.released();}
  reset(){clearTimeout(this.timer);this.local=undefined;this.cloud=undefined;this.processing=undefined;}
}
