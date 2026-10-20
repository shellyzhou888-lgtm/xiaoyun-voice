import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SkillLibrary} from '../src/skills.ts';
import {PageActionLane,type PageSnapshot} from '../src/page-actions.ts';
import {Harness} from '../src/harness.ts';
import {TaskManager} from '../src/task-manager.ts';
import {createAssistantMessageEventStream,type AssistantMessage} from '@earendil-works/pi-ai';
import type {StreamFn} from '@earendil-works/pi-agent-core';

test('registered skills load metadata lazily and confine references including junctions to their own folder',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'xy-skills-'));const skill=path.join(root,'business');
  try{
    await mkdir(skill);await mkdir(path.join(root,'outside'));
    await writeFile(path.join(skill,'SKILL.md'),'---\nname: business\ndescription: >-\n  按流程处理业务\n---\n内部流程只按需读取。');
    await writeFile(path.join(skill,'schema.sql'),'SELECT 42 AS answer;');await writeFile(path.join(root,'outside','secret.md'),'not a skill');
    await symlink(path.join(root,'outside'),path.join(skill,'link'),'junction');
    const library=await SkillLibrary.load([skill]);assert.deepEqual(library.summaries(),[{name:'business',description:'按流程处理业务'}]);
    assert.match((await library.read('business')).text,/内部流程/);assert.match((await library.read('business','schema.sql')).text,/42/);
    await assert.rejects(library.read('business','../outside/secret.md'),/只能读取/);
    await assert.rejects(library.read('business','link/secret.md'),/只能读取/);
    await assert.rejects(library.read('other'),/没有注册/);
    await assert.rejects(SkillLibrary.load([skill,skill]),/名称重复/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('one page action lane serializes task actions, rejects stale observations and skips cancelled queued work',async()=>{
  let version=0;let release!:()=>void;const calls:string[]=[];
  const actions=[{name:'switch_view',description:'切换视图',parameters:{type:'object',properties:{view:{type:'string'}},required:['view']}}];
  const lane=new PageActionLane(()=>({context:{},version,actions}),async(_name,args)=>{calls.push(String(args.view));await new Promise<void>(r=>release=r);version++;return {view:args.view};});
  const first=lane.execute('switch_view',{view:'first'},0);await Promise.resolve();
  const cancelled=new AbortController();const second=lane.execute('switch_view',{view:'cancelled'},0,'second',cancelled.signal);
  const stale=lane.execute('switch_view',{view:'stale'},0);cancelled.abort();
  const secondRejected=assert.rejects(second);const staleRejected=assert.rejects(stale,/上下文已改变/);
  assert.deepEqual(calls,['first']);release();assert.equal((await first).page.version,1);
  await Promise.all([secondRejected,staleRejected]);assert.deepEqual(calls,['first']);
  await assert.rejects(lane.execute('switch_view',{},1),/参数不正确/);
  const valid=lane.execute('switch_view',{view:'new'},1);await Promise.resolve();release();await valid;assert.deepEqual(calls,['first','new']);
});

test('Pi reads business skill and references, resumes clarification, then observes and performs dependent page actions',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'xy-skill-harness-'));
  try{
    await writeFile(path.join(root,'SKILL.md'),'---\nname: meeting\ndescription: 配置会议页面\n---\n先选择房间再打开日程。详情见 fields.md。');
    await writeFile(path.join(root,'fields.md'),'会议字段：room、view。');
    const manager=new TaskManager(false);const task=manager.create({projectId:'meeting',clientId:'client',sessionId:'session',title:'会议准备',prompt:'配置会议页面',context:{},order:1});
    let page:PageSnapshot={version:0,context:{},actions:[{name:'set_room',description:'选择房间',parameters:{type:'object'}},{name:'open_schedule',description:'打开日程',parameters:{type:'object'}}]};
    const steps:string[]=[];let round=0;
    const lane=new PageActionLane(()=>page,async(name,args)=>{steps.push(name);page={...page,version:page.version+1,context:{...page.context,...args}};return {applied:name};});
    const stream:StreamFn=(model,context)=>{
      assert.doesNotMatch(context.systemPrompt||'',/先选择房间再打开日程/,'Skill body should not be preloaded into every system prompt');
      const toolMessages=context.messages.filter(m=>m.role==='toolResult');
      const names=['read_skill','read_skill','request_clarification','observe_page','execute_page_action','execute_page_action','deliver_result'];
      const args=[{name:'meeting'},{name:'meeting',reference:'fields.md'},{question:'哪个会议室？'},{},{name:'set_room',args:{room:'A'},expectedVersion:0},{name:'open_schedule',args:{view:'schedule'},expectedVersion:1},{summary:'A会议室日程已打开。'}];
      if(round===3)assert.ok(JSON.stringify(toolMessages).includes('会议字段'),'Skill reference remains in resumed conversation');
      if(round===5)assert.ok(JSON.stringify(toolMessages).includes('set_room'),'Later action has the previous execution receipt');
      const events=createAssistantMessageEventStream();const number=round++;
      const message:AssistantMessage={role:'assistant',content:[{type:'toolCall',id:`step-${number}`,name:names[number],arguments:args[number]}],api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),stopReason:'toolUse',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
      queueMicrotask(()=>{events.push({type:'done',reason:'toolUse',message});events.end(message);});return events;
    };
    const harness=new Harness(manager,()=>{},stream,{observe:()=>page,execute:(name,args,version,id,signal)=>lane.execute(name,args,version,id,signal)});
    const project={id:'meeting',skills:[root]};
    assert.equal(await harness.run(task,project),undefined);assert.equal(task.info.status,'collecting');
    const result=await harness.run(task,project,'A会议室');assert.equal(result?.summary,'A会议室日程已打开。');
    assert.deepEqual(steps,['set_room','open_schedule']);assert.equal(page.version,2);
  }finally{await rm(root,{recursive:true,force:true});}
});
