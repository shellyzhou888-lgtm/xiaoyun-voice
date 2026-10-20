import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type WebSocket from 'ws';
import {WebSocketServer} from 'ws';
import type {ServerMessage,Speech} from '../../protocol/src/index.ts';
import {InputGate,makeDelivery} from '../src/delivery.ts';
const dataDir=await mkdtemp(path.join(tmpdir(),'xiaoyun-delivery-'));
process.env.DATA_DIR=dataDir;
const {config}=await import('../src/config.ts');
assert.equal(config.dataDir,path.resolve(dataDir),'Persistence fixtures must use their temporary database');
const {TaskManager}=await import('../src/task-manager.ts');
const {VoiceSession}=await import('../src/session.ts');
const {demoProject}=await import('../src/project.ts');
const {initializeData,python,statePath,closeExecution}=await import('../src/execution.ts');
test.after(async()=>{await closeExecution();await rm(dataDir,{recursive:true,force:true});});
async function fixture(){
  const messages:ServerMessage[]=[];const manager=new TaskManager(false);
  const session=new VoiceSession({readyState:1,send:(raw:string)=>messages.push(JSON.parse(raw))} as unknown as WebSocket,manager,new Map([['playground',demoProject]]));
  await session.receive({type:'hello',protocolVersion:'1.0.0-beta.1',clientId:'test',projectId:'playground',context:{region:'华东'},mode:'demo',actions:[]});
  await session.receive({type:'session.wake',sessionId:'session'});
  const starts=()=>messages.filter((m):m is Extract<ServerMessage,{type:'speech.start'}>=>m.type==='speech.start').map(m=>m.speech);
  const finish=(speech:Speech)=>session.receive({type:'speech.finished',speechId:speech.speechId});
  await finish(starts()[0]);messages.length=0;
  return {session,manager,messages,starts,finish,core:session as any};
}
test('spoken farewell drains before exit, while task completion stays visible and quiet',async()=>{
  const f=await fixture();try{
    const task=f.core.createTask('后台任务');
    await f.session.receive({type:'input.text',sessionId:'session',text:'好的没事，你可以回去了'});
    const goodbye=f.starts().at(-1)!;assert.equal(goodbye.text,'好，我先退下啦。');
    assert.equal(f.messages.some(m=>m.type==='session.idle'),false);
    f.manager.complete(task,f.manager.result(task,{summary:'后台任务已完成。'}));await delay(10);
    assert.equal(f.starts().length,1);assert.equal(task.delivery.status,'skipped');
    await f.finish(goodbye);assert.equal(f.messages.filter(m=>m.type==='session.idle').length,1);
    assert.equal(f.messages.some(m=>m.type==='error'),false);assert.equal(f.core.active,false);
  }finally{f.session.dispose();}
});

test('older page snapshots cannot roll back the server and a rejected action returns the browser current state',async()=>{
  const f=await fixture();try{
    const actions=[{name:'set_view',description:'切换视图',parameters:{type:'object'}}];
    await f.session.receive({type:'context.update',context:{view:'latest'},contextVersion:3});
    await f.session.receive({type:'actions.update',actions,contextVersion:3});
    await f.session.receive({type:'actions.update',actions:[],contextVersion:1});
    await f.session.receive({type:'context.update',context:{view:'old'},contextVersion:2});
    assert.equal(f.core.observePage().version,3);assert.equal(f.core.observePage().context.view,'latest');
    const action=f.core.action('set_view',{});const rejected=assert.rejects(action,/上下文已改变/);
    await delay(0);const request=f.messages.find((m):m is Extract<ServerMessage,{type:'action.request'}>=>m.type==='action.request')!;
    await f.session.receive({type:'action.result',callId:request.callId,error:'页面上下文已改变',context:{view:'browser-new'},contextVersion:4});
    await rejected;assert.equal(f.core.observePage().version,4);assert.equal(f.core.observePage().context.view,'browser-new');
  }finally{f.session.dispose();}
});

test('input immediately following wake waits for Skill loading and the real voice connection',async()=>{
  const server=new WebSocketServer({port:0,host:'127.0.0.1'});await new Promise<void>(r=>server.once('listening',r));
  const original={url:config.qwenUrl,key:config.qwenKey};config.qwenUrl=`ws://127.0.0.1:${(server.address() as any).port}`;config.qwenKey='fixture';
  const inputs:string[]=[];
  server.on('connection',socket=>socket.on('message',raw=>{
    const e=JSON.parse(raw.toString());
    if(e.type==='session.update')socket.send(JSON.stringify({type:'session.updated',session:e.session}));
    if(e.type==='conversation.item.create'&&e.item.role==='user')inputs.push(e.item.content[0].text);
    if(e.type==='response.create'){socket.send(JSON.stringify({type:'response.created',response:{id:'first'}}));socket.send(JSON.stringify({type:'response.done',response:{id:'first',status:'completed',output:[]}}));}
  }));
  const session=new VoiceSession({readyState:1,send:()=>{}} as unknown as WebSocket,new TaskManager(false),new Map([['fresh',{id:'fresh',skills:[]}]]));
  try{
    await session.receive({type:'hello',protocolVersion:'1.0.0-beta.1',clientId:'client',projectId:'fresh',context:{},actions:[],mode:'live'});
    const wake=session.receive({type:'session.wake',sessionId:'fresh-session'});
    const input=session.receive({type:'input.text',sessionId:'fresh-session',text:'第一条指令不能丢失'});
    await Promise.all([wake,input]);
    for(let i=0;i<100&&!inputs.length;i++)await delay(5);
    assert.deepEqual(inputs,['第一条指令不能丢失']);
  }finally{session.dispose();for(const socket of server.clients)socket.terminate();await new Promise<void>(r=>server.close(()=>r()));config.qwenUrl=original.url;config.qwenKey=original.key;}
});

test('a whole native multi-sentence chat response drains before ready task results; no stale progress interrupts chatting',async t=>{
  const f=await fixture();
  try{
    t.mock.timers.enable({apis:['setTimeout','Date']});
    const task=f.core.createTask('文档整理');f.manager.update(task,'running','正在核对资料');
    // Native Qwen produces one speech ID for the entire response, regardless of punctuation.
    const speech={speechId:'native-chat',deliveryId:'chat-delivery',sentenceIndex:0,sentenceCount:1,sessionId:'session',kind:'message' as const,provider:'live' as const,text:'第一句话。第二句话。'};
    f.core.deliveries.set(speech.deliveryId,{...makeDelivery('session','message',speech.text),deliveryId:speech.deliveryId,sentenceCount:1});
    f.core.startSpeech(speech);f.core.currentGenerated=true;
    t.mock.timers.tick(13000);
    assert.equal(f.starts().length,1);assert.equal(f.core.speechQueue.some((s:Speech)=>s.kind==='waiting'),false);
    f.manager.complete(task,f.manager.result(task,{summary:'文档已经整理完成。'}));
    await new Promise<void>(resolve=>setImmediate(resolve));
    assert.equal(f.starts().length,1);assert.equal(task.delivery?.status,'queued');
    await f.session.receive({type:'speech.finished',speechId:'unrelated-old-receipt'});assert.equal(f.starts().length,1);
    await f.finish(speech);assert.equal(f.starts().length,2);assert.equal(f.starts()[1].taskId,task.info.taskId);
  }finally{t.mock.timers.reset();f.session.dispose();}
});
test('barge-in cancels a pending farewell and late playback cannot close the continued session; click exits immediately',async()=>{
  const f=await fixture();try{
    await f.core.liveTool('end_conversation',{});const goodbye=f.starts()[0];
    await f.session.receive({type:'input.text',sessionId:'session',text:'等一下'});
    await f.finish(goodbye);assert.equal(f.core.active,true);assert.equal(f.core.closingDeliveryId,undefined);
    assert.equal(f.messages.some(m=>m.type==='session.idle'),false);
    await f.session.receive({type:'session.end',reason:'manual'});assert.equal(f.core.active,false);
    assert.equal(f.messages.some(m=>m.type==='error'),false);
  }finally{f.session.dispose();}
});
test('a goodbye already generated by the voice model is delivered once instead of adding a second goodbye',async()=>{
  const f=await fixture();try{
    f.core.enqueueSpeech('message','好的，拜拜。');const goodbye=f.starts()[0];
    await f.core.liveTool('end_conversation',{});assert.equal(f.starts().length,1);
    await f.finish(goodbye);assert.equal(f.core.active,false);
  }finally{f.session.dispose();}
});

test('a dismissal without a model tool call closes at its audio drain, or immediately when ASR arrives after drain',async()=>{
  for(const late of [false,true]){
    const f=await fixture();try{
      f.core.enqueueSpeech('message','好的，再见！');const goodbye=f.starts()[0];
      if(late)await f.finish(goodbye);
      f.core.beginFarewell(goodbye.speechId);
      assert.equal(f.starts().length,1,'Never generate a second goodbye');
      if(!late){assert.equal(f.core.active,true);await f.finish(goodbye);}
      assert.equal(f.core.active,false);assert.equal(f.messages.filter(m=>m.type==='session.idle').length,1);
    }finally{f.session.dispose();}
  }
});
test('tentative local noise releases after 1.2s; valid long speech has no fixed cutoff or stale release',async()=>{
  const f=await fixture();
  try{
    await f.session.receive({type:'input.started',turnId:'noise'});await f.session.receive({type:'input.ended',turnId:'noise'});
    const task=f.core.createTask('完成的查询');f.manager.complete(task,f.manager.result(task,{summary:'结果已经就绪。'}));await delay(20);
    assert.equal(f.starts().length,0);await delay(1250);assert.equal(f.starts().length,1);
    let released=0;const gate=new InputGate(()=>released++,20);
    gate.startLocal('first');gate.endLocal('first');gate.startCloud('long');await delay(35);assert.equal(gate.blocked,true);
    gate.endCloud('old');gate.finish('old');assert.equal(gate.cloud,'long');
    gate.endCloud('long');assert.equal(gate.blocked,true);gate.finish('long');assert.equal(gate.blocked,false);gate.reset();
  }finally{f.session.dispose();}
});
test('waiting A finishes actual playback before result; B is skipped; old receipts cannot deliver new speech',async()=>{
  const f=await fixture();
  try{
    const task=f.core.createTask('查询');f.core.enqueueSpeech('waiting','正在查询，请稍等一下。查到后我会告诉你。',task.info.taskId);
    const a=f.starts()[0];f.manager.complete(task,f.manager.result(task,{summary:'温度是二十六度。天气晴朗。'}));await delay(15);
    assert.equal(f.starts().length,1,'Punctuation/generated alone cannot finish A');
    await f.finish(a);assert.equal(f.starts().length,2);assert.equal(f.starts()[1].kind,'result');
    const first=f.starts()[1];await f.finish(a);assert.equal(f.starts().length,2);
    assert.notEqual(task.delivery.status,'delivered');
    await f.session.receive({type:'speech.playing',speechId:first.speechId});assert.equal(task.delivery.status,'playing');
    await f.finish(first);const second=f.starts()[2];assert.equal(second.deliveryId,first.deliveryId);assert.equal(second.sentenceIndex,1);
    await f.finish(second);assert.equal(task.delivery.status,'delivered');
    assert.equal(f.starts().some(s=>s.text==='查到后我会告诉你。'),false);
  }finally{f.session.dispose();}
});
test('waiting uses a one-second grace and at most one supplement after twelve seconds and eight seconds of silence',async t=>{
  const f=await fixture();t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()});
  try{
    const task=f.core.createTask('长期分析');f.manager.update(task,'running','正在计算');
    t.mock.timers.tick(999);assert.equal(f.starts().length,0);
    t.mock.timers.tick(1);assert.equal(f.starts().length,1);
    t.mock.timers.tick(7000);await f.finish(f.starts()[0]);
    t.mock.timers.tick(4000);assert.equal(f.starts().length,1,'12s elapsed, but last sentence only ended four seconds ago');
    t.mock.timers.tick(4000);assert.equal(f.starts().length,2);
    await f.finish(f.starts()[1]);t.mock.timers.tick(60000);assert.equal(f.starts().length,2);
  }finally{f.session.dispose();t.mock.timers.reset();}
});
test('formal results keep their group; stopping queued B cannot stop A; replay does not emit a business result',async()=>{
  const f=await fixture();
  try{
    const a=f.core.createTask('A'),b=f.core.createTask('B');
    f.manager.complete(a,f.manager.result(a,{summary:'第一句。第二句。'}));await delay(10);
    f.manager.complete(b,f.manager.result(b,{summary:'另一条结果。'}));await delay(10);
    await f.session.receive({type:'delivery.stop',taskId:b.info.taskId});assert.equal(f.core.current.taskId,a.info.taskId);assert.equal(b.delivery.status,'skipped');
    await f.finish(f.starts()[0]);assert.equal(f.starts()[1].taskId,a.info.taskId);await f.finish(f.starts()[1]);
    const count=f.messages.filter(m=>m.type==='task.result').length;
    await f.session.receive({type:'result.replay',taskId:b.info.taskId});assert.equal(f.starts().at(-1)?.taskId,b.info.taskId);
    assert.equal(f.messages.filter(m=>m.type==='task.result').length,count);
    await assert.rejects(f.session.receive({type:'result.replay',taskId:'missing'}),/不存在/);
  }finally{f.session.dispose();}
});
test('duplicate local/cloud interruptions requeue once; excerpt replaces only its old queued summary',async()=>{
  const f=await fixture();
  try{
    const a=f.core.createTask('天气');f.manager.complete(a,f.manager.result(a,{summary:'温度二十六度。天气晴朗。'}));await delay(10);
    await f.session.receive({type:'input.started',turnId:'user'});f.core.cancelCurrent(true);
    assert.equal(f.core.speechQueue.length,2);
    const out=await f.core.liveTool('read_result',{taskId:a.info.taskId});assert.equal(out.output.taskId,a.info.taskId);assert.equal(f.core.speechQueue.length,0);
    assert.equal(a.delivery.status,'skipped');
  }finally{f.session.dispose();}
});
test('direct queries complete their clarification task, while explicit new requests keep the pending question',async()=>{
  await initializeData();const f=await fixture();
  try{
    const question=await f.core.liveTool('ask_user',{title:'查询地区指标',request:'地区和指标需要补充',question:'哪个地区？'});
    const id=question.output.taskId;
    const independent=await f.core.liveTool('project__sales_summary',{region:'华南',__newTask:true});
    assert.notEqual(independent.output.taskId,id);assert.equal(f.core.pendingClarification,id);
    const resumed=await f.core.liveTool('project__sales_summary',{region:'华北',__taskId:id});assert.equal(resumed.output.taskId,id);
    for(let i=0;i<100&&!f.manager.tasks.get(id)?.result;i++)await delay(10);
    assert.equal(f.manager.tasks.get(id)?.info.status,'succeeded');assert.equal(f.core.pendingClarification,undefined);
    assert.equal(f.manager.tasks.size,2);
  }finally{f.session.dispose();}
});
test('two task questions keep one active answer target and advance after it is resolved',async()=>{
  const f=await fixture();try{
    const a=f.core.createTask('A'),b=f.core.createTask('B');
    f.manager.update(a,'collecting','等待信息','A 的地区？');f.manager.update(b,'collecting','等待信息','B 的地区？');
    assert.equal(f.core.pendingClarification,a.info.taskId);assert.equal(f.starts().length,1);
    assert.equal(f.core.speechQueue.some((s:Speech)=>s.taskId===b.info.taskId),false);
    await f.finish(f.starts()[0]);f.manager.update(a,'running','已补齐');
    assert.equal(f.core.pendingClarification,b.info.taskId);assert.equal(f.starts().at(-1)?.taskId,b.info.taskId);
  }finally{f.session.dispose();}
});
test('fast completion skips acknowledgement and initial result/delivery restore atomically without automatic replay',async()=>{
  await initializeData();const manager=new TaskManager(true);
  const task=manager.create({projectId:'playground',clientId:'persist',sessionId:'old',title:'保存结果',prompt:'测试',context:{},order:1});
  task.prepareDelivery=result=>makeDelivery('old','result',result.summary,result.taskId);
  manager.complete(task,manager.result(task,{summary:'已保存。'}));await manager.flush();
  const stored=await python<any[]>({command:'load',path:statePath,projectId:'playground',clientId:'persist'});
  assert.equal(stored[0].result.summary,'已保存。');assert.equal(stored[0].delivery.status,'queued');
  const interrupted=manager.create({projectId:'playground',clientId:'persist',sessionId:'old',title:'重启中断任务',prompt:'测试',context:{},order:2});manager.update(interrupted,'running');await manager.flush();
  await initializeData();const restored=await new TaskManager(true).restore('playground','persist');
  assert.equal(restored[0].delivery?.status,'interrupted');assert.equal(restored[0].info.status,'succeeded');
  assert.equal(restored.find(t=>t.info.taskId===interrupted.info.taskId)?.result?.status,'interrupted','Interrupted work is visible with a retry action, without rerunning it');
  const f=await fixture();try{
    const fast=f.core.createTask('快速任务');f.manager.enqueue(fast,async()=>f.manager.result(fast,{summary:'已经完成。'}));await delay(1050);
    assert.deepEqual(f.starts().map(s=>s.kind),['result']);
  }finally{f.session.dispose();}
});
