import test from 'node:test';
import assert from 'node:assert/strict';
import {VoiceTransport} from '../src/transport.ts';
import {PROTOCOL_VERSION} from '../../protocol/src/index.ts';

test('handshake sends latest page snapshot and wake before audio, never replays stale queued configuration',()=>{
  const previous=globalThis.WebSocket;
  class Socket {
    static OPEN=1;static instances:Socket[]=[];
    readyState=0;bufferedAmount=0;binaryType='';sent:unknown[]=[];
    onopen=()=>{};onclose=()=>{};onerror=()=>{};onmessage=(_event:{data:string})=>{};
    constructor(_url:URL){Socket.instances.push(this);}
    send(data:unknown){this.sent.push(typeof data==='string'?JSON.parse(data):data);}
    open(){this.readyState=1;this.onopen();}
    ready(){this.onmessage({data:JSON.stringify({type:'ready',protocolVersion:PROTOCOL_VERSION})});}
    close(){this.readyState=3;this.onclose();}
  }
  (globalThis as any).WebSocket=Socket;
  try{
    for(const beforeOpen of [true,false]){
      const pcm=new ArrayBuffer(2);let transport:VoiceTransport;
      transport=new VoiceTransport('http://localhost:8765',message=>{if(message.type==='ready')transport.send({type:'session.wake',sessionId:'session'});},connected=>{if(connected)transport.audio(pcm);});
      transport.send({type:'actions.update',actions:[],contextVersion:1});
      transport.connect({type:'hello',protocolVersion:PROTOCOL_VERSION,projectId:'test',clientId:'client',context:{loaded:false},actions:[],contextVersion:1});
      const socket=Socket.instances.at(-1)!;
      if(!beforeOpen)socket.open();
      transport.updateHello({loaded:true},[],2);transport.send({type:'context.update',context:{loaded:true},contextVersion:2});
      if(beforeOpen)socket.open();
      assert.equal(socket.sent.length,1,'Only hello may precede ready');socket.ready();
      const messages=socket.sent.filter(m=>!(m instanceof ArrayBuffer)) as any[];
      let version=0;let context:unknown;
      for(const message of messages){if(message.contextVersion!==undefined)version=message.contextVersion;if(message.context)context=message.context;}
      assert.equal(version,2);assert.deepEqual(context,{loaded:true});
      assert.equal(messages.some(m=>m.type==='actions.update'&&m.contextVersion===1),false);
      assert.ok(socket.sent.findIndex((m:any)=>m.type==='session.wake')<socket.sent.indexOf(pcm));
      transport.destroy();
    }
  }finally{globalThis.WebSocket=previous;}
});
