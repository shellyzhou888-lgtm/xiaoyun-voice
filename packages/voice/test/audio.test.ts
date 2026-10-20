import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function processor(name:string,rate:number){
  let Processor:any;
  const messages:any[]=[];
  class Base{port={postMessage:(data:any)=>messages.push(data),onmessage:null as any};}
  vm.runInNewContext(readFileSync(new URL(`../public/assets/${name}.worklet.js`,import.meta.url),'utf8'),{
    AudioWorkletProcessor:Base,sampleRate:rate,registerProcessor:(_name:string,ctor:any)=>{Processor=ctor;},
    Int16Array,Float32Array,Math,
  });
  const instance=new Processor();
  return {instance,messages};
}

test('48 kHz microphone becomes continuous 16 kHz PCM in 100 ms packets',()=>{
  const {instance,messages}=processor('capture',48000);
  for(let i=0;i<375;i++)instance.process([[new Float32Array(128).fill(0.25)]]);
  assert.equal(messages.length,10);
  assert.equal(messages.reduce((sum,m)=>sum+new Int16Array(m.pcm).length,0),16000);
  assert.ok(messages.every(m=>Math.abs(m.rms-0.25)<0.001));
});

test('player reports completion after draining, rejects cancelled speech chunks',()=>{
  const {instance,messages}=processor('player',24000);
  const send=(data:any)=>instance.port.onmessage({data});
  const tick=()=>instance.process([],[[new Float32Array(128)]]);
  send({type:'start',id:'old'});send({type:'chunk',id:'old',pcm:new Int16Array(256).fill(1000).buffer});
  send({type:'end',id:'old'});tick();assert.equal(messages.filter(m=>m.type==='drained').length,0);
  tick();assert.deepEqual(messages.filter(m=>m.type==='drained').map(m=>m.id),['old']);
  send({type:'start',id:'new'});send({type:'chunk',id:'old',pcm:new Int16Array(999).buffer});
  send({type:'end',id:'new'});tick();tick();
  assert.deepEqual(messages.filter(m=>m.type==='drained').map(m=>m.id),['old','new']);
});
