import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {createAssistantMessageEventStream,type AssistantMessage,type Context} from '@earendil-works/pi-ai';
import type {StreamFn} from '@earendil-works/pi-agent-core';
import type {JsonObject} from '../../protocol/src/index.ts';

const dataDir=await mkdtemp(path.join(tmpdir(),'xiaoyun-harness-'));
process.env.DATA_DIR=dataDir;
const {Harness}=await import('../src/harness.ts');
const {config}=await import('../src/config.ts');
const {TaskManager}=await import('../src/task-manager.ts');
const {TaskToolRuntime,runReadOnly}=await import('../src/tool-runtime.ts');
const {extractPage}=await import('../src/page-extractor.ts');
const {defineProject,demoProject,getVoiceDirectTools,runProjectTool}=await import('../src/project.ts');
const {initializeData,querySql}=await import('../src/execution.ts');
test.after(()=>rm(dataDir,{recursive:true,force:true}));

type Call={name:string;arguments:JsonObject};
function fixture(next:(context:Context)=>Call[]):StreamFn {
  return (model,context)=>{
    const stream=createAssistantMessageEventStream();
    const message:AssistantMessage={role:'assistant',content:next(context).map((call,index)=>({type:'toolCall',id:`call-${context.messages.length}-${index}`,...call})),api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),stopReason:'toolUse',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
    queueMicrotask(()=>{stream.push({type:'done',reason:'toolUse',message});stream.end(message);});return stream;
  };
}
function task(manager:InstanceType<typeof TaskManager>,order=0){return manager.create({projectId:'fixture',clientId:'fixture',sessionId:'fixture',title:'查询',prompt:'测试查询',context:{region:'华东'},order});}
const delivered:Call={name:'deliver_result',arguments:{summary:'查询完成。'}};

test('Pi can finish a productive task beyond sixteen turns by default; only an explicit configured cap stops it',async()=>{
  const previous=config.agentMaxTurns;const manager=new TaskManager(false);
  const project=defineProject({id:'fixture',tools:[{name:'read_item',description:'读取条目',parameters:{type:'object',properties:{id:{type:'number'}}},readOnly:true,execute:async(args)=>({id:args.id})}]});
  const run=()=>{let round=0;return new Harness(manager,()=>{},fixture(()=>round++<18?[{name:'read_item',arguments:{id:round}}]:[delivered])).run(task(manager),project);};
  try{
    config.agentMaxTurns=0;assert.equal((await run())?.summary,'查询完成。');
    config.agentMaxTurns=2;await assert.rejects(run(),/后台配置的 2 轮/);
  }finally{config.agentMaxTurns=previous;}
});

test('Pi runs a read-only batch in parallel, a mixed batch sequentially, with four global read slots',async()=>{
  let active=0,peak=0;
  const execute=async()=>{active++;peak=Math.max(peak,active);await delay(15);active--;return {ok:true};};
  const project=defineProject({id:'fixture',tools:[{name:'read_item',description:'read',parameters:{type:'object',properties:{id:{type:'number'}}},readOnly:true,execute},{name:'sequence_item',description:'write',parameters:{type:'object'},execute}]});
  const run=async(calls:Call[])=>{
    const manager=new TaskManager(false);let round=0;
    return new Harness(manager,()=>{},fixture(()=>round++===0?calls:[delivered])).run(task(manager),project);
  };
  const reads=[1,2,3].map(id=>({name:'read_item',arguments:{id}}));
  await Promise.all([run(reads),run(reads),run(reads)]);
  assert.equal(peak,4);assert.equal(active,0);
  peak=0;
  await run([reads[0],{name:'sequence_item',arguments:{}},reads[1]]);
  assert.equal(peak,1);
});

test('successful reads survive clarification, repeated arguments share work, failures retry, and task end releases them',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-09-10T15:59:59Z')});
  const manager=new TaskManager(false);let calls=0,round=0;const prompts:string[]=[];
  const project=defineProject({id:'fixture',tools:[{name:'lookup',description:'read',parameters:{type:'object'},readOnly:true,execute:async()=>{calls++;return {value:3};}}]});
  const harness=new Harness(manager,()=>{},fixture(context=>{
    prompts.push(context.systemPrompt||'');
    return round++===0?[{name:'lookup',arguments:{a:1,b:2}},{name:'lookup',arguments:{b:2,a:1}},{name:'request_clarification',arguments:{question:'需要哪一年？'}}]:[{name:'lookup',arguments:{a:1,b:2}},delivered];
  }));
  const current=task(manager);
  assert.equal(await harness.run(current,project),undefined);assert.equal(calls,1);
  t.mock.timers.setTime(Date.parse('2026-09-10T16:00:01Z'));
  const result=await harness.run(current,project,'2026 年');assert.equal(result?.summary,'查询完成。');assert.equal(calls,1);
  assert.match(prompts[0],/2026年9月10日星期四/);
  assert.match(prompts[1],/2026年9月11日星期五/);
  assert.ok(prompts.every(prompt=>prompt.includes('时区：Asia/Shanghai')));
  await harness.run(task(manager,1),project);assert.equal(calls,2);
  const cache=new TaskToolRuntime(),signal=new AbortController().signal;let attempts=0;
  const flaky=()=>cache.read('flaky',{},signal,async()=>{if(++attempts===1)throw new Error('temporary');return 9;});
  await assert.rejects(flaky(),/temporary/);assert.equal(await flaky(),9);assert.equal(await flaky(),9);assert.equal(attempts,2);
  cache.release();assert.equal(await flaky(),9);assert.equal(attempts,3);
});

test('cancelled queued reads never execute or take a global slot',async()=>{
  const gates:Array<()=>void>=[];
  const active=Array.from({length:4},()=>runReadOnly(new AbortController().signal,()=>new Promise<void>(resolve=>gates.push(resolve))));
  await delay(0);const controller=new AbortController();let executed=false;
  const queued=runReadOnly(controller.signal,async()=>{executed=true;});
  controller.abort(new Error('cancelled'));await assert.rejects(queued,/cancelled/);
  gates.forEach(release=>release());await Promise.all(active);assert.equal(executed,false);
  assert.equal(await runReadOnly(new AbortController().signal,async()=>7),7);
});

test('sales voice-direct uses SQLite and the chart contract, validates arguments, and supports cancellation',async()=>{
  await initializeData();
  assert.equal(getVoiceDirectTools(demoProject)[0].name,'project__sales_summary');
  const ctx={signal:new AbortController().signal,taskId:'sales-direct',contextAtStart:{region:'华东'}};
  const result=await runProjectTool(demoProject,'sales_summary',{region:'华东'},ctx);
  const data=result.data as {kind:string;region:string;rows:Array<{year:number;profit:number}>;changePercent:number};
  const expected=await querySql('SELECT year, ROUND(SUM(revenue-cost),2) profit FROM sales WHERE region=? GROUP BY year ORDER BY year',['华东']);
  assert.equal(data.kind,'profit_comparison');assert.equal(data.region,'华东');
  assert.deepEqual(data.rows.map(({year,profit})=>({year,profit})),expected.rows);
  assert.ok(result.summary.length<=60);assert.match(result.markdown!,/\| 年份 \|/);
  await assert.rejects(runProjectTool(demoProject,'sales_summary',{region:'未知'},ctx),/参数/);
  await assert.rejects(runProjectTool(demoProject,'not_open',{},ctx),/未开放/);
  const controller=new AbortController();let started:()=>void=()=>{};
  const began=new Promise<void>(resolve=>started=resolve);
  const project=defineProject({id:'cancel',tools:[{name:'slow',description:'slow',parameters:{type:'object'},readOnly:true,voiceDirect:true,execute:async(_args,context)=>{started();await delay(1000,undefined,{signal:context.signal});return 1;},formatResult:()=>({summary:'完成。'})}]});
  const running=runProjectTool(project,'slow',{}, {...ctx,signal:controller.signal});
  await began;controller.abort();await assert.rejects(running,/abort/i);
  assert.throws(()=>defineProject({id:'duplicate',tools:[demoProject.tools[0],demoProject.tools[0]]}),/冲突/);
});

test('main-content extraction preserves Chinese entities and tables; explicit timestamps remain distinct from retrieval',()=>{
  const html='<title>十堰 &amp; 天气</title><meta property="article:published_time" content="2026-09-10T08:00:00+08:00"><script type="application/ld+json">{"@type":"NewsArticle","dateModified":"2026-09-10T09:00:00+08:00"}</script><nav>导航广告</nav><main><h1>今日天气</h1><p>多云&nbsp;&#x6E29;&#x5EA6; 26℃ &amp; 舒适</p><table><tr><th>口径</th><th>温度</th></tr><tr><td>实时</td><td>26℃</td></tr><tr><td>预报最高</td><td>29℃</td></tr></table><script>secret()</script><footer>页脚</footer></main>';
  const page=extractPage(html,'https://example.com/weather','2026-09-10T02:00:00Z');
  assert.equal(page.title,'十堰 & 天气');assert.match(page.text,/多云 温度 26℃ & 舒适/);assert.match(page.text,/\| 实时 \| 26℃ \|/);assert.doesNotMatch(page.text,/导航广告|secret|页脚/);
  assert.equal(page.source.publishedAt,'2026-09-10T08:00:00+08:00');assert.equal(page.source.updatedAt,'2026-09-10T09:00:00+08:00');assert.equal(page.source.fetchedAt,'2026-09-10T02:00:00Z');
  const missing=extractPage('<article><p>今天很凉快。</p><time datetime="2026-09-10">今天</time></article>','https://example.com');
  assert.equal(missing.source.publishedAt,undefined);assert.equal(missing.source.updatedAt,undefined);
});

test('Harness sources come from executed page reads, deduplicate URLs, and use fetched titles over search snippets',async()=>{
  const server=createServer((_req,response)=>{response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<title>实况页面</title><main><p>十堰当前 26℃。</p></main>');});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();assert.ok(address&&typeof address==='object');
  const url=`http://127.0.0.1:${address.port}/weather`;let round=0;
  try{
    const manager=new TaskManager(false),harness=new Harness(manager,()=>{},fixture(()=>round++===0?[{name:'fetch_page',arguments:{url}},{name:'fetch_page',arguments:{url}}]:[delivered]));
    const result=await harness.run(task(manager),{id:'fixture'});
    assert.equal(result?.sources?.length,1);assert.equal(result?.sources?.[0].title,'实况页面');assert.equal(result?.sources?.[0].updatedAt,undefined);
    const sources=new TaskToolRuntime();sources.record({title:'搜索摘要',url:`${url}#top`,fetchedAt:'2026-09-10T00:00:00Z'});sources.record(result!.sources![0],true);sources.record({title:'较旧搜索摘要',url,fetchedAt:'2026-09-10T00:00:00Z'});
    assert.equal(sources.getSources().length,1);assert.equal(sources.getSources()[0].title,'实况页面');
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
