import {useCallback,useLayoutEffect,useRef,useState} from 'react';
import type {ResultCard,VoiceUIOptions} from '@xiaoyun/protocol';
import {TERMINAL_TASK_STATUSES} from '@xiaoyun/protocol';

export const BUBBLE_EXIT_MS=620;

/** Reading pauses the countdown; streaming, speech and unfinished tasks never expire. */
export function useCardLifetime(card:ResultCard,paused:boolean,onClose:(id:string)=>void,options?:VoiceUIOptions) {
  const [hidden,setHidden]=useState(document.hidden);
  const longResult=(card.result?.markdown||card.markdown||'').length>240 || (card.result?.summary||card.transcript).length>240 || !!(card.result?.artifacts||card.artifacts)?.length;
  const duration=longResult?(options?.longResultMs??10000):(options?.shortResultMs??10000);
  const remaining=useRef(duration);
  const deliveryStatus=card.delivery?.status;
  const eligible=!card.pinned&&!card.speaking&&TERMINAL_TASK_STATUSES.includes(card.status)&&
    !['queued','generating','playing','failed'].includes(deliveryStatus||'');
  useLayoutEffect(()=>{
    const changed=()=>setHidden(document.hidden);
    document.addEventListener('visibilitychange',changed);
    return ()=>document.removeEventListener('visibilitychange',changed);
  },[]);
  useLayoutEffect(()=>{remaining.current=duration;},[duration,card.taskId,card.delivery?.deliveryId,card.pinned]);
  useLayoutEffect(()=>{
    if(!eligible||paused||hidden)return;
    const started=performance.now();
    const timer=setTimeout(()=>onClose(card.taskId),Math.max(0,remaining.current));
    return ()=>{clearTimeout(timer);remaining.current-=performance.now()-started;};
  },[eligible,paused,hidden,card.taskId,card.delivery?.deliveryId,card.pinned,duration,onClose]);
}

export interface CardPresence {card:ResultCard;exiting:boolean}
/** Active entries always use the incoming order. Departing entries keep only their visual gap. */
export function reconcileCardPresence(previous:CardPresence[],cards:ResultCard[]):CardPresence[] {
  const incoming=new Set(cards.map(card=>card.taskId));
  const ordered:CardPresence[]=cards.map(card=>({card,exiting:false}));
  previous.forEach((entry,index)=>{
    if(incoming.has(entry.card.taskId))return;
    const next=previous.slice(index+1).find(candidate=>incoming.has(candidate.card.taskId));
    const at=next?ordered.findIndex(candidate=>candidate.card.taskId===next.card.taskId):ordered.length;
    ordered.splice(at,0,{card:entry.card,exiting:true});
  });
  return ordered;
}
export function useCardPresence(cards:ResultCard[]) {
  const [present,setPresent]=useState(()=>cards.map(card=>({card,exiting:false})));
  useLayoutEffect(()=>setPresent(previous=>reconcileCardPresence(previous,cards)),[cards]);
  const remove=useCallback((id:string)=>setPresent(previous=>previous.filter(entry=>entry.card.taskId!==id||!entry.exiting)),[]);
  return {present,remove};
}

/** Animate the frame's height, never scale or blur the text inside it. */
export function useCardHeight() {
  const frame=useRef<HTMLElement>(null);
  const content=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    const outer=frame.current!,inner=content.current!;
    const resize=()=>{const height=`${inner.offsetHeight+2}px`;outer.style.height=height;outer.parentElement!.style.setProperty('--xy-card-height',height);};
    resize();
    const observer=new ResizeObserver(resize);observer.observe(inner);
    return ()=>observer.disconnect();
  },[]);
  return {frame,content};
}
