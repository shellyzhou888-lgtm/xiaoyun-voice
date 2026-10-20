import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type WebSocket from 'ws';
import type {ServerMessage,ClientMessage} from '../../protocol/src/index.ts';
const testDataDir=await mkdtemp(path.join(tmpdir(),'xiaoyun-server-test-'));
process.env.DATA_DIR=testDataDir;
const {CompletionBatch,TaskManager}=await import('../src/task-manager.ts');
const {VoiceSession}=await import('../src/session.ts');
const {Harness}=await import('../src/harness.ts');
const {demoProject}=await import('../src/project.ts');
const {initializeData,querySql,runPython,closeExecution}=await import('../src/execution.ts');
test.after(async()=>{await closeExecution();await rm(testDataDir,{recursive:true,force:true});});

async function eventually(check:()=>boolean,timeout=3000){const end=Date.now()+timeout;while(!check()){if(Date.now()>end)assert.fail('Timed out waiting for expected state');await delay(10);}}

test('live clarification retains the original request when the answer is only a city',async()=>{
  const manager=new TaskManager(false);const socket={readyState:1,send:()=>{}} as unknown as WebSocket;
  const session=new VoiceSession(socket,manager,new Map([['playground',demoProject]]));
  const received:Array<{prompt:string;answer?:string}>=[];const originalRun=Harness.prototype.run;
  Harness.prototype.run=async(task,_project,answer)=>{received.push({prompt:task.prompt,answer});return manager.result(task,{summary:'查询完成'});};
  try{
    await session.receive({type:'hello',protocolVersion:'1.0.0-beta.1',clientId:'weather-context-test',projectId:'playground',context:{},mode:'demo',actions:[]});
    await session.receive({type:'session.wake',sessionId:'weather-context'});
    // Exercise the real live-tool handlers, without contacting a model or weather site.
    const tool=(name:string,args:any)=>(session as any).liveTool(name,args);
    await assert.rejects(tool('ask_user',{question:'哪个城市？'}),/原始需求/);
    assert.equal(manager.tasks.size,0);
    const question=await tool('ask_user',{title:'查询今日天气',request:'查询某城市今天的天气',question:'哪个城市？'});
    const taskId=question.output.taskId;
    await tool('resume_task',{taskId,answer:'武汉'});
    await eventually(()=>manager.tasks.get(taskId)?.info.status==='succeeded');
    assert.equal(manager.tasks.size,1);assert.equal(manager.tasks.get(taskId)?.info.title,'查询今日天气');
    assert.deepEqual(received,[{prompt:'查询某城市今天的天气',answer:'武汉'}]);
  }finally{Harness.prototype.run=originalRun;session.dispose();}
});

test('same-turn results use request order; different turns keep completion order',async()=>{
  const received:number[]=[];const batch=new CompletionBatch<{requestOrder:number}>(items=>received.push(...items.map(i=>i.requestOrder)));
  batch.add({requestOrder:2});batch.add({requestOrder:1});await delay(10);
  batch.add({requestOrder:4});await delay(10);batch.add({requestOrder:3});await delay(10);
  assert.deepEqual(received,[1,2,4,3]);
});

test('task scheduler starts only three workers and cancellation releases a slot',async()=>{
  const manager=new TaskManager(false,3);const gates:Array<()=>void>=[];let running=0;let peak=0;
  const tasks=Array.from({length:4},(_,order)=>manager.create({projectId:'demo',clientId:'test',sessionId:'test',title:String(order),prompt:'test',context:{},order}));
  for(const task of tasks)manager.enqueue(task,async()=>{running++;peak=Math.max(peak,running);try{await new Promise<void>((resolve,reject)=>{gates.push(resolve);task.abort.signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});});return manager.result(task,{summary:'done'});}finally{running--;}});
  assert.equal(tasks[3].info.status,'queued');manager.cancel(tasks[0]);await eventually(()=>tasks[3].info.status==='running');
  for(const release of gates)release();await eventually(()=>tasks.every(t=>['succeeded','cancelled'].includes(t.info.status)));
  assert.equal(peak,3);assert.equal(tasks[0].info.status,'cancelled');
});

test('SQL blocks writes/attach and Monty computes without host file access',async()=>{
  await initializeData();assert.equal((await querySql('SELECT COUNT(*) n FROM sales')).rows[0].n,288);
  await assert.rejects(querySql('DELETE FROM sales'),/authorized|readonly/i);
  await assert.rejects(querySql("ATTACH DATABASE ':memory:' AS other"),/authorized/i);
  try{
    assert.equal((await runPython('sum(row["profit"] for row in data)',{data:[{profit:4},{profit:7}]})).result,11);
    assert.deepEqual((await runPython('{"total": sum(data), "rows": [{"profit": 7}]}',{data:[4,7]})).result,{total:11,rows:[{profit:7}]});
    await assert.rejects(runPython('from pathlib import Path\nPath("C:/Windows/win.ini").read_text()',{}));
  }finally{await closeExecution();}
});

test('clarifications retain task id; default session stays awake across tasks until farewell',async()=>{
  const messages:ServerMessage[]=[];
  let session:InstanceType<typeof VoiceSession>;
  const socket={readyState:1,send:(raw:string)=>{const message=JSON.parse(raw) as ServerMessage;messages.push(message);if(message.type==='action.request')queueMicrotask(()=>void session.receive({type:'action.result',callId:message.callId,result:{ok:true}}));}} as unknown as WebSocket;
  session=new VoiceSession(socket,new TaskManager(false),new Map([['playground',demoProject]]));
  const send=(message:ClientMessage)=>session.receive(message);
  await send({type:'hello',protocolVersion:'1.0.0-beta.1',clientId:'test',projectId:'playground',context:{},mode:'demo',actions:['set_region','set_metric'].map(name=>({name,description:name,parameters:{type:'object'}}))});
  await send({type:'session.wake',sessionId:'session-1'});
  let speech=messages.find(m=>m.type==='speech.start');assert.equal(speech?.type,'speech.start');
  await send({type:'speech.finished',speechId:speech!.type==='speech.start'?speech!.speech.speechId:''});
  await send({type:'input.text',sessionId:'session-1',text:'查看销售数据'});
  let questions=messages.filter(m=>m.type==='speech.start'&&m.speech.kind==='question');assert.equal(questions.length,1);
  const first=questions[0] as Extract<ServerMessage,{type:'speech.start'}>;await send({type:'speech.finished',speechId:first.speech.speechId});
  await send({type:'input.text',sessionId:'session-1',text:'华东'});
  questions=messages.filter(m=>m.type==='speech.start'&&m.speech.kind==='question');assert.equal(questions.length,2);
  const second=questions[1] as Extract<ServerMessage,{type:'speech.start'}>;assert.equal(first.speech.taskId,second.speech.taskId);
  await send({type:'speech.finished',speechId:second.speech.speechId});await send({type:'input.text',sessionId:'session-1',text:'利润'});
  await eventually(()=>messages.some(m=>m.type==='speech.start'&&m.speech.kind==='result'));
  assert.equal(messages.filter(m=>m.type==='session.idle').length,0);
  const result=messages.find(m=>m.type==='task.result') as Extract<ServerMessage,{type:'task.result'}>;assert.equal(result.result.taskId,first.speech.taskId);
  const last=messages.filter(m=>m.type==='speech.start').at(-1) as Extract<ServerMessage,{type:'speech.start'}>;
  await send({type:'speech.finished',speechId:last.speech.speechId});assert.equal(messages.filter(m=>m.type==='session.idle').length,0);
  assert.ok(messages.some(m=>m.type==='state'&&m.state==='listening'));
  const completed=messages.filter(m=>m.type==='task.result').length;
  await send({type:'input.text',sessionId:'session-1',text:'切换到华南地区'});
  await eventually(()=>messages.filter(m=>m.type==='task.result').length===completed+1);
  assert.equal(messages.filter(m=>m.type==='session.started').length,1);
  await send({type:'input.text',sessionId:'session-1',text:'好了没有事情了，小云你退下吧'});
  assert.equal(messages.filter(m=>m.type==='session.idle').length,0);
  const goodbye=messages.filter((m):m is Extract<ServerMessage,{type:'speech.start'}>=>m.type==='speech.start').at(-1)!;
  await send({type:'speech.finished',speechId:goodbye.speech.speechId});
  assert.equal(messages.filter(m=>m.type==='session.idle').length,1);session.dispose();
});

test('automatic ending remains an explicit opt-in after playback',async()=>{
  const messages:ServerMessage[]=[];let session:InstanceType<typeof VoiceSession>;
  const socket={readyState:1,send:(raw:string)=>{const message=JSON.parse(raw) as ServerMessage;messages.push(message);if(message.type==='action.request')queueMicrotask(()=>void session.receive({type:'action.result',callId:message.callId,result:{ok:true}}));}} as unknown as WebSocket;
  session=new VoiceSession(socket,new TaskManager(false),new Map([['playground',demoProject]]));
  await session.receive({type:'hello',protocolVersion:'1.0.0-beta.1',clientId:'automatic',projectId:'playground',context:{},mode:'demo',autoEndSession:true,actions:[{name:'set_region',description:'region',parameters:{type:'object'}}]});
  await session.receive({type:'session.wake',sessionId:'automatic'});
  await session.receive({type:'input.text',sessionId:'automatic',text:'切换到华东地区'});
  await eventually(()=>messages.some(m=>m.type==='speech.start'&&m.speech.kind==='result'));
  assert.equal(messages.filter(m=>m.type==='session.idle').length,0);
  const speech=messages.filter(m=>m.type==='speech.start'&&m.speech.kind==='result').at(-1) as Extract<ServerMessage,{type:'speech.start'}>;
  await session.receive({type:'speech.finished',speechId:speech.speech.speechId});
  assert.equal(messages.filter(m=>m.type==='session.idle').length,1);session.dispose();
});

test('ending input leaves a running task alive and suppresses later speech',async()=>{
  const messages:ServerMessage[]=[];const socket={readyState:1,send:(raw:string)=>messages.push(JSON.parse(raw))} as unknown as WebSocket;
  const session=new VoiceSession(socket,new TaskManager(false),new Map([['playground',demoProject]]));
  await session.receive({type:'hello',protocolVersion:'1.0.0-beta.1',clientId:'test',projectId:'playground',context:{},mode:'demo',actions:[]});
  await session.receive({type:'session.wake',sessionId:'session-2'});
  await session.receive({type:'input.text',sessionId:'session-2',text:'查北京天气'});
  await session.receive({type:'session.end',reason:'manual'});const before=messages.filter(m=>m.type==='speech.start').length;
  await eventually(()=>messages.some(m=>m.type==='task.result'));
  await delay(20);assert.equal(messages.filter(m=>m.type==='speech.start').length,before);session.dispose();
});
