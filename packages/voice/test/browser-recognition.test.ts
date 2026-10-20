import assert from 'node:assert/strict';
import test from 'node:test';
import {startBrowserRecognition} from '../src/browser-recognition.ts';

test('browser recognition stops late input after close and preserves final text',()=>{
  let instance:FakeRecognition;
  class FakeRecognition {
    lang='';continuous=false;interimResults=false;
    onresult:((e:unknown)=>void)|null=null;onerror:((e:unknown)=>void)|null=null;onend:(()=>void)|null=null;
    aborted=false;constructor(){instance=this;}start(){}abort(){this.aborted=true;}
  }
  const previous=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{value:{SpeechRecognition:FakeRecognition},configurable:true});
  try{
    const texts:string[]=[];const interim:string[]=[];
    const stop=startBrowserRecognition(t=>texts.push(t),t=>interim.push(t),()=>assert.fail('Unexpected recognition error'));
    const handler=instance!.onresult!;
    handler({resultIndex:0,results:[{isFinal:false,0:{transcript:'广东'}}]});
    handler({resultIndex:0,results:[{isFinal:true,0:{transcript:'广东有多少光伏设施'}}]});
    assert.deepEqual(texts,['广东有多少光伏设施']);assert.equal(interim.length,2);
    stop();handler({resultIndex:0,results:[{isFinal:true,0:{transcript:'late'}}]});
    assert.equal(texts.length,1);assert.equal(instance!.aborted,true);
  }finally{if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');}
});
