import {useLayoutEffect,useRef,useState,type PointerEvent,type MouseEvent} from 'react';
import type {VoiceUIOptions} from '@xiaoyun/protocol';

const clamp=(value:number,min:number,max:number)=>Math.min(Math.max(min,max),Math.max(min,value));

/** Move the visual anchor only; capture, sessions and host page state are untouched. */
export function useDock(onActivate:()=>void,position?:VoiceUIOptions['position']) {
  const widget=useRef<HTMLElement>(null);
  const gesture=useRef<{x:number;y:number;left:number;top:number;moved:boolean}|null>(null);
  const suppressClick=useRef(false);
  const hasMoved=useRef(false);
  const [dragging,setDragging]=useState(false);
  const [touchControls,setTouchControls]=useState(false);
  const [panelsBelow,setPanelsBelow]=useState(false);

  function placePanels() {
    const root=widget.current;if(!root)return;
    const anchor=root.querySelector('.xy-character-button')!.getBoundingClientRect();
    const bounds=root.getBoundingClientRect();
    const panelWidth=Math.min(360,innerWidth-24);
    const left=clamp(anchor.left+anchor.width*.38-panelWidth,12,innerWidth-panelWidth-12);
    const below=anchor.top<200&&innerHeight-anchor.bottom>anchor.top;
    root.dataset.panels=below?'below':'above';
    setPanelsBelow(below);
    const controlsLeft=anchor.left>innerWidth-anchor.right;
    root.dataset.controlsSide=controlsLeft?'left':'right';
    root.style.setProperty('--xy-controls-space',`${Math.max(90,(controlsLeft?anchor.left:innerWidth-anchor.right)-24)}px`);
    root.style.setProperty('--xy-panel-shift',`${left-bounds.left}px`);
    root.style.setProperty('--xy-panel-width',`${panelWidth}px`);
    root.style.setProperty('--xy-panel-space',`${Math.max(100,(below?innerHeight-anchor.bottom:anchor.top)-40)}px`);
    root.style.setProperty('--xy-tail-x',`${clamp(anchor.left+anchor.width*.27-left,28,panelWidth-30)}px`);
  }
  function move(left:number,top:number) {
    const root=widget.current!;
    const anchor=root.querySelector<HTMLButtonElement>('.xy-character-button')!;
    left=clamp(left,12,innerWidth-anchor.offsetWidth-12);
    top=clamp(top,12,innerHeight-anchor.offsetHeight-12);
    root.style.setProperty('--xy-drag-right',`${innerWidth-left-anchor.offsetWidth-8}px`);
    root.style.setProperty('--xy-drag-bottom',`${innerHeight-top-anchor.offsetHeight}px`);
    placePanels();
  }
  useLayoutEffect(()=>{
    widget.current!.style.setProperty('--xiaoyun-right',`${position?.right??28}px`);
    widget.current!.style.setProperty('--xiaoyun-bottom',`${position?.bottom??22}px`);
    const resize=()=>{
      if(hasMoved.current){const root=widget.current!,bounds=root.getBoundingClientRect();move(bounds.right-8-root.querySelector<HTMLButtonElement>('.xy-character-button')!.offsetWidth,bounds.top);}
      else placePanels();
    };
    const outside=(event:globalThis.PointerEvent)=>{if(!event.composedPath().includes(widget.current!))setTouchControls(false);};
    resize();window.addEventListener('resize',resize);document.addEventListener('pointerdown',outside);
    return ()=>{window.removeEventListener('resize',resize);document.removeEventListener('pointerdown',outside);};
  },[]);
  function onPointerDown(event:PointerEvent<HTMLButtonElement>) {
    if(event.button!==0)return;
    const bounds=widget.current!.getBoundingClientRect();
    gesture.current={x:event.clientX,y:event.clientY,left:bounds.right-8-event.currentTarget.offsetWidth,top:bounds.top,moved:false};
    suppressClick.current=false;
    if(event.pointerType!=='mouse')setTouchControls(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event:PointerEvent<HTMLButtonElement>) {
    const start=gesture.current;if(!start)return;
    const dx=event.clientX-start.x,dy=event.clientY-start.y;
    if(!start.moved&&Math.hypot(dx,dy)<6)return;
    if(!start.moved){start.moved=true;hasMoved.current=true;setDragging(true);}
    move(start.left+dx,start.top+dy);
  }
  function finish(event:PointerEvent<HTMLButtonElement>) {
    if(!gesture.current)return;
    suppressClick.current=gesture.current.moved;gesture.current=null;setDragging(false);
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function onClick(event:MouseEvent<HTMLButtonElement>) {
    if(suppressClick.current&&event.detail!==0){suppressClick.current=false;event.preventDefault();return;}
    suppressClick.current=false;
    onActivate();
  }
  return {widget,dragging,touchControls,panelsBelow,onClick,onPointerDown,onPointerMove,onPointerUp:finish,onPointerCancel:finish};
}
