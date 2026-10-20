import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {WebSocketServer} from 'ws';
import {QwenGateway} from '../src/qwen.ts';
import {isDismissalCommand} from '../src/conversation-control.ts';

test('explicit dismissal binds a spoken-only response once, including late ASR; old turns, narration and noncommands cannot close',()=>{
  for(const text of ['嗯，好的，你退下吧。','好的没事，你可以回去了','好了没事了','小云，结束对话','再见'])assert.equal(isDismissalCommand(text),true,text);
  for(const text of ['好的谢谢','不要退下','如果我说退下吧会怎么样','请解释“再见”的含义','你退下吧是什么意思？','好了，你退下吧，然后继续查天气'])assert.equal(isDismissalCommand(text),false,text);
  for(const late of [false,true]){
    const events:string[]=[];
    const gateway=new QwenGateway('dismissal',{started:()=>{},text:()=>{},audio:()=>{},generated:id=>events.push(`generated:${id}`),cancelled:()=>{},inputStarted:()=>{},inputEnded:()=>{},inputProcessed:()=>{},tool:async()=>({output:{}}),farewell:id=>events.push(`farewell:${id}`),error:m=>assert.fail(m),idle:()=>{},canGenerate:()=>true});
    const event=(value:any)=>(gateway as any).event(value);
    const transcript={type:'conversation.item.input_audio_transcription.completed',item_id:'bye',transcript:'嗯，好的，你退下吧。'};
    try{
      event({type:'input_audio_buffer.speech_started',item_id:'bye'});
      if(!late)event(transcript);
      event({type:'response.created',response:{id:'reply'}});
      event({type:'response.audio.delta',response_id:'reply',delta:'AAA='});
      event({type:'response.done',response:{id:'reply',status:'completed',output:[]}});
      if(late)event(transcript);event(transcript);
      assert.equal(events.length,2);assert.ok(events[0].startsWith('generated:'));assert.equal(events[1],events[0].replace('generated:','farewell:'));
      event({type:'input_audio_buffer.speech_started',item_id:'new'});event(transcript);
      event({type:'response.created',response:{id:'new-reply'}});event({type:'response.audio.delta',response_id:'new-reply',delta:'AAA='});event({type:'response.done',response:{id:'new-reply',status:'completed',output:[]}});
      assert.equal(events.filter(e=>e.startsWith('farewell:')).length,1,'Late ASR from the goodbye cannot close the next turn');
      event({type:'input_audio_buffer.speech_started',item_id:'cancelled-bye'});gateway.interrupt();
      event({type:'conversation.item.input_audio_transcription.completed',item_id:'cancelled-bye',transcript:'你退下吧'});
      event({type:'response.created',response:{id:'cancelled-bye'}});event({type:'response.audio.delta',response_id:'cancelled-bye',delta:'AAA='});event({type:'response.done',response:{id:'cancelled-bye',status:'completed',output:[]}});
      assert.equal(events.filter(e=>e.startsWith('farewell:')).length,1,'An interruption also invalidates late ASR before the next cloud turn starts');
      gateway.userText('你退下吧');gateway.interrupt();
      event({type:'response.created',response:{id:'interrupted-reply'}});event({type:'response.audio.delta',response_id:'interrupted-reply',delta:'AAA='});event({type:'response.done',response:{id:'interrupted-reply',status:'completed',output:[]}});
      assert.equal(events.filter(e=>e.startsWith('farewell:')).length,1,'User interruption clears pending fallback');
      gateway.userText('再见');gateway.speak({speechId:'narration',deliveryId:'d',sentenceIndex:0,sentenceCount:1,sessionId:'dismissal',kind:'result',provider:'live',text:'报告中提到了再见。'});
      event({type:'response.created',response:{id:'narration'}});event({type:'response.audio.delta',response_id:'narration',delta:'AAA='});event({type:'response.done',response:{id:'narration',status:'completed',output:[]}});
      assert.equal(events.filter(e=>e.startsWith('farewell:')).length,1);
    }finally{gateway.close();}
  }
});
import {config} from '../src/config.ts';

test('multiple page steps delegate once to Pi and reuse a same-response task submission; a single button stays direct',async()=>{
  const calls:Array<{name:string;args:any}>=[];
  const gateway=new QwenGateway('page-routing',{started:()=>{},text:()=>{},audio:()=>{},generated:()=>{},cancelled:()=>{},inputStarted:()=>{},inputEnded:()=>{},inputProcessed:()=>{},idle:()=>{},canGenerate:()=>true,error:m=>assert.fail(m),tool:async(name,args)=>{calls.push({name,args});return {output:{taskId:'plan',status:'accepted'},suppressReply:true};}});
  gateway.setContext({},['choose_room','open_schedule'].map(name=>({name,description:name,parameters:{type:'object'}})),[]);
  const call=(name:string,id:string,args:unknown)=>({name,call_id:id,arguments:JSON.stringify(args)});
  const response=(id:string,items:any[])=>({id,turn:0,allowedTools:new Set(['start_task','choose_room','open_schedule']),calls:items});
  try{
    await (gateway as any).executeCalls(response('one',[call('choose_room','one',{room:'A'})]));
    assert.deepEqual(calls.map(c=>c.name),['choose_room']);calls.length=0;
    await (gateway as any).executeCalls(response('steps',[call('choose_room','first',{room:'B'}),call('open_schedule','second',{})]));
    assert.deepEqual(calls.map(c=>c.name),['start_task']);assert.match(calls[0].args.request,/choose_room.*open_schedule/);calls.length=0;
    (gateway as any).newUserTurn();
    await (gateway as any).executeCalls({...response('reuse',[call('choose_room','third',{room:'C'}),call('open_schedule','fourth',{}),call('start_task','plan',{title:'会议准备',request:'读取会议日程'})]),turn:1});
    assert.deepEqual(calls.map(c=>c.name),['start_task']);assert.match(calls[0].args.request,/读取会议日程/);assert.match(calls[0].args.request,/choose_room.*open_schedule/);
  }finally{gateway.close();}
});

test('Qwen refreshes the configured local date across midnight for text and voice turns',async t=>{
  const server=new WebSocketServer({port:0,host:'127.0.0.1'});
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const original={url:config.qwenUrl,key:config.qwenKey,timeZone:config.timeZone};
  config.qwenUrl=`ws://127.0.0.1:${(server.address() as {port:number}).port}`;
  config.qwenKey='local-protocol-test';config.timeZone='Asia/Shanghai';
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-09-10T15:59:59Z')});
  let peer:any;let generated=0;let instructions='';const prompts:string[]=[];const updates:string[]=[];
  server.on('connection',socket=>{peer=socket;socket.on('message',raw=>{
    const message=JSON.parse(raw.toString());
    if(message.type==='session.update'){
      instructions=message.session.instructions;updates.push(instructions);
      socket.send(JSON.stringify({type:'session.updated',session:message.session}));
    }
    if(message.type==='response.create'){
      prompts.push(instructions);const id=`date-${prompts.length}`;
      socket.send(JSON.stringify({type:'response.created',response:{id}}));
      socket.send(JSON.stringify({type:'response.audio.delta',response_id:id,delta:'AAA='}));
      socket.send(JSON.stringify({type:'response.done',response:{id,status:'completed',output:[]}}));
    }
  });});
  const gateway=new QwenGateway('date',{started:()=>{},text:()=>{},audio:()=>{},generated:()=>{generated++;},cancelled:()=>{},inputStarted:()=>{},inputEnded:()=>{},inputProcessed:()=>{},tool:async()=>({output:{}}),error:message=>assert.fail(message),idle:()=>{},canGenerate:()=>true});
  const until=async(check:()=>boolean)=>{for(let i=0;i<100&&!check();i++)await delay(10);assert.ok(check());};
  try{
    // Old page data must coexist with a fresh authoritative clock in the system prompt.
    gateway.setContext({date:'2020-01-01'},[],[]);
    await gateway.connect();gateway.userText('今天几号，星期几？');await until(()=>generated===1);
    assert.match(prompts[0],/2026年9月10日星期四/);assert.match(prompts[0],/23:59:59/);
    t.mock.timers.setTime(Date.parse('2026-09-10T16:00:01Z'));
    gateway.userText('再确认一下今天几号？');await until(()=>generated===2);
    assert.match(prompts[1],/2026年9月11日星期五/);assert.match(prompts[1],/00:00:01/);
    assert.match(prompts[1],/Asia\/Shanghai/);assert.doesNotMatch(prompts[1],/2026年9月10日/);
    t.mock.timers.setTime(Date.parse('2026-09-11T16:00:01Z'));
    const count=updates.length;
    peer.send(JSON.stringify({type:'input_audio_buffer.speech_started',item_id:'after-midnight'}));
    await until(()=>updates.length>count);
    assert.match(updates.at(-1)!,/2026年9月12日星期六/);
  }finally{
    gateway.close();for(const socket of server.clients)socket.terminate();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    config.qwenUrl=original.url;config.qwenKey=original.key;config.timeZone=original.timeZone;t.mock.timers.reset();
  }
});

test('closing from a tool callback never rearms the response watchdog or produces a delayed failure',async t=>{
  const errors:string[]=[];let processed=0;let gateway:QwenGateway;
  gateway=new QwenGateway('closing',{started:()=>{},text:()=>{},audio:()=>{},generated:()=>{},cancelled:()=>{},inputStarted:()=>{},inputEnded:()=>{},inputProcessed:()=>processed++,idle:()=>{},canGenerate:()=>true,error:m=>errors.push(m),tool:async()=>{gateway.close();return {output:{ended:true},endSession:true};}});
  t.mock.timers.enable({apis:['setTimeout']});
  try{
    await (gateway as any).executeCalls({id:'end-response',turn:0,allowedTools:new Set(['end_conversation']),calls:[{name:'end_conversation',call_id:'end',arguments:'{}'}]});
    t.mock.timers.tick(16000);assert.deepEqual(errors,[]);assert.equal(processed,0);assert.equal(gateway.busy,false);
  }finally{gateway.close();t.mock.timers.reset();}
});

test('old cloud item endings retain their own turn id; empty narration fails instead of hanging',()=>{
  const events:string[]=[];const gateway=new QwenGateway('fixture',{started:()=>{},text:()=>{},audio:()=>{},generated:()=>events.push('generated'),cancelled:()=>{},inputStarted:id=>events.push(`start:${id}`),inputEnded:id=>events.push(`end:${id}`),inputProcessed:id=>events.push(`processed:${id}`),tool:async()=>({output:{}}),error:(message,_fatal,id)=>events.push(`error:${id}:${message}`),idle:()=>{},canGenerate:()=>true});
  const event=(value:any)=>(gateway as any).event(value);
  try{
    event({type:'input_audio_buffer.speech_started',item_id:'old'});event({type:'input_audio_buffer.speech_started',item_id:'new'});
    event({type:'input_audio_buffer.speech_stopped',item_id:'old',reason:'turn_invalid'});
    assert.deepEqual(events,['start:cloud_1','start:cloud_2','end:cloud_1']);
    gateway.speak({speechId:'empty',deliveryId:'delivery',sentenceIndex:0,sentenceCount:1,sessionId:'fixture',kind:'result',provider:'live',text:'结果。'});
    event({type:'response.created',response:{id:'empty-response'}});event({type:'response.done',response:{id:'empty-response',status:'completed',output:[]}});
    assert.equal(events.includes('generated'),false);assert.ok(events.some(e=>e.startsWith('error:empty:')));
  }finally{gateway.close();}
});

test('Qwen transport serializes generation behind playback and ignores late response audio',async()=>{
  const server=new WebSocketServer({port:0,host:'127.0.0.1'});
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address();assert.equal(typeof address,'object');
  const original={url:config.qwenUrl,key:config.qwenKey};config.qwenUrl=`ws://127.0.0.1:${(address as {port:number}).port}`;config.qwenKey='local-protocol-test';
  let creates=0;let canGenerate=true;const generated:string[]=[];const audio:string[]=[];let initial:any;const updates:any[]=[];const prompts:string[]=[];
  server.on('connection',socket=>socket.on('message',raw=>{
    const message=JSON.parse(raw.toString());
    if(message.type==='conversation.item.create'&&message.item.role==='user')prompts.push(message.item.content[0].text);
    if(message.type==='session.update'){initial||=message.session;updates.push(message.session);socket.send(JSON.stringify({type:'session.updated',session:message.session}));}
    if(message.type==='response.create'){
      const number=++creates;const id=`response-${number}`;
      socket.send(JSON.stringify({type:'response.created',response:{id}}));
      if(number===2)socket.send(JSON.stringify({type:'response.audio.delta',response_id:'response-1',delta:'late-audio'}));
      socket.send(JSON.stringify({type:'response.audio_transcript.delta',response_id:id,delta:`结果${number}`}));
      socket.send(JSON.stringify({type:'response.audio.delta',response_id:id,delta:`audio-${number}`}));
      socket.send(JSON.stringify({type:'response.done',response:{id,status:'completed',output:[]}}));
    }
  }));
  const gateway=new QwenGateway('session',{started:()=>{},text:()=>{},audio:(_id,chunk)=>audio.push(chunk),generated:id=>{generated.push(id);canGenerate=false;},cancelled:()=>{},inputStarted:()=>{},inputEnded:()=>{},inputProcessed:()=>{},tool:async()=>({output:{}}),error:message=>assert.fail(message),idle:()=>{},canGenerate:()=>canGenerate});
  const until=async(check:()=>boolean)=>{for(let i=0;i<100&&!check();i++)await delay(10);assert.ok(check());};
  try{
    gateway.setContext({region:'华东'},[{name:'set_region',description:'切换地区',parameters:{type:'object'}}],[]);
    gateway.speak({deliveryId:'delivery',sentenceIndex:0,sentenceCount:1,speechId:'speech-1',sessionId:'session',kind:'result',provider:'live',text:'第一条'});
    await gateway.connect();
    assert.equal(initial.input_audio_format,'pcm');assert.equal(initial.output_audio_format,'pcm');assert.equal(initial.turn_detection.type,'smart_turn');assert.ok(initial.tools.every((tool:any)=>tool.type==='function'&&tool.function?.name));
    await until(()=>generated.length===1);assert.equal(prompts[0],'第一条','Narration queued before connection must retain its prompt');
    assert.ok(updates.some(session=>session.instructions.includes('本次唯一播报文本："第一条"')),'Narration must bind the actual text, not refer ambiguously to the latest user message');
    gateway.speak({deliveryId:'delivery',sentenceIndex:0,sentenceCount:1,speechId:'speech-2',sessionId:'session',kind:'result',provider:'live',text:'第二条'});await delay(30);assert.equal(creates,1);
    canGenerate=true;gateway.playbackFinished();await until(()=>generated.length===2);
    assert.deepEqual(generated,['speech-1','speech-2']);assert.deepEqual(audio,['audio-1','audio-2']);
    assert.ok(updates.some(session=>session.tools.length===0),'Pure narration disables tool calling');
  }finally{
    gateway.close();for(const socket of server.clients)socket.terminate();await new Promise<void>(resolve=>server.close(()=>resolve()));config.qwenUrl=original.url;config.qwenKey=original.key;
  }
});

test('accepting a task disables repeated starts in continuations and new input restores them',async()=>{
  const server=new WebSocketServer({port:0,host:'127.0.0.1'});await new Promise<void>(resolve=>server.once('listening',resolve));
  const original={url:config.qwenUrl,key:config.qwenKey};config.qwenUrl=`ws://127.0.0.1:${(server.address() as {port:number}).port}`;config.qwenKey='local-protocol-test';
  let creates=0;let generated=0;let currentTools:string[]=[];const toolsAtCreate:string[][]=[];
  server.on('connection',socket=>socket.on('message',raw=>{
    const message=JSON.parse(raw.toString());
    if(message.type==='session.update'){currentTools=message.session.tools.map((tool:any)=>tool.function.name);socket.send(JSON.stringify({type:'session.updated',session:message.session}));}
    if(message.type==='response.create'){
      const n=++creates;const id=`r${n}`;toolsAtCreate.push([...currentTools]);socket.send(JSON.stringify({type:'response.created',response:{id}}));
      const output=n===1?[{type:'function_call',name:'start_task',call_id:'call1',arguments:'{"request":"分析","title":"分析"}'}]:[];
      if(n>1){socket.send(JSON.stringify({type:'response.audio_transcript.delta',response_id:id,delta:'已受理。'}));socket.send(JSON.stringify({type:'response.audio.delta',response_id:id,delta:'AA=='}));}
      socket.send(JSON.stringify({type:'response.done',response:{id,status:'completed',output}}));
    }
  }));
  const gateway=new QwenGateway('test',{started:()=>{},text:()=>{},audio:()=>{},generated:()=>{generated++;},cancelled:()=>{},inputStarted:()=>{},inputEnded:()=>{},inputProcessed:()=>{},tool:async()=>({output:{taskId:'accepted-task'}}),error:message=>assert.fail(message),idle:()=>{},canGenerate:()=>true});
  const until=async(check:()=>boolean)=>{for(let i=0;i<100&&!check();i++)await delay(10);assert.ok(check());};
  try{
    await gateway.connect();gateway.userText('分析');await until(()=>creates===1&&!gateway.busy);await delay(30);assert.equal(generated,0);assert.equal(creates,1);
    assert.ok(toolsAtCreate[0].includes('start_task'));
    gateway.userText('另一个任务');await until(()=>generated===1);assert.ok(toolsAtCreate[1].includes('start_task'));
  }finally{gateway.close();for(const socket of server.clients)socket.terminate();await new Promise<void>(resolve=>server.close(()=>resolve()));config.qwenUrl=original.url;config.qwenKey=original.key;}
});

test('listening restores tools after task narration and clarification before the next speech-start event',async()=>{
  const server=new WebSocketServer({port:0,host:'127.0.0.1'});await new Promise<void>(resolve=>server.once('listening',resolve));
  const original={url:config.qwenUrl,key:config.qwenKey};config.qwenUrl=`ws://127.0.0.1:${(server.address() as {port:number}).port}`;config.qwenKey='fixture';
  let current:any;let creates=0;let generated=0;const atCreate:any[]=[];const sentCalls:string[]=[];
  server.on('connection',socket=>socket.on('message',raw=>{
    const message=JSON.parse(raw.toString());
    if(message.type==='session.update'){current=message.session;socket.send(JSON.stringify({type:'session.updated',session:current}));}
    if(message.type==='response.create'){
      const id=`restore-${++creates}`;atCreate.push(current);socket.send(JSON.stringify({type:'response.created',response:{id}}));
      const name=creates===1?'start_task':creates===3?'ask_user':undefined;
      if(!name){socket.send(JSON.stringify({type:'response.audio_transcript.delta',response_id:id,delta:'本轮声音。'}));socket.send(JSON.stringify({type:'response.audio.delta',response_id:id,delta:'AAA='}));}
      socket.send(JSON.stringify({type:'response.done',response:{id,status:'completed',output:name?[{type:'function_call',name,call_id:id,arguments:'{}'}]:[]}}));
    }
  }));
  const gateway=new QwenGateway('restore',{started:()=>{},text:()=>{},audio:()=>{},generated:()=>generated++,cancelled:()=>{},inputStarted:()=>{},inputEnded:()=>{},inputProcessed:()=>{},error:m=>assert.fail(m),idle:()=>{},canGenerate:()=>true,tool:async name=>{sentCalls.push(name);return name==='ask_user'?{output:{question:'哪一种？'},kind:'question'}:{output:{taskId:'task'}};}});
  const until=async(check:()=>boolean)=>{for(let i=0;i<100&&!check();i++)await delay(5);assert.ok(check());};
  const tools=()=>current?.tools.map((t:any)=>t.function.name)||[];
  try{
    gateway.setContext({view:'first'},[{name:'set_view',description:'改变当前显示',parameters:{type:'object'}}],[]);
    await gateway.connect();gateway.userText('执行复杂任务');await until(()=>!gateway.busy&&creates===1);
    gateway.speak({speechId:'result',deliveryId:'result',sentenceIndex:0,sentenceCount:1,sessionId:'restore',kind:'result',provider:'live',text:'任务已完成。'});
    await until(()=>generated===1&&!gateway.busy);await delay(20);
    assert.deepEqual(atCreate[1].tools,[],'The narration response itself cannot call tools');
    assert.ok(tools().includes('set_view'),'Listening must already expose page actions before new voice input is detected');
    assert.ok(tools().includes('start_task'));assert.doesNotMatch(current.instructions,/本轮目标已受理/);
    gateway.userText('另一个信息不全的任务');await until(()=>generated===2&&!gateway.busy);await delay(20);
    assert.deepEqual(atCreate[3].tools,[],'Only the clarification reply is speech-only');
    assert.ok(tools().includes('resume_task'),'The answer must not enter a session still configured as speech-only');
    assert.ok(tools().includes('set_view'));assert.equal(creates,4);assert.deepEqual(sentCalls,['start_task','ask_user']);
  }finally{gateway.close();for(const socket of server.clients)socket.terminate();await new Promise<void>(resolve=>server.close(()=>resolve()));config.qwenUrl=original.url;config.qwenKey=original.key;}
});

test('duplicate interruption sends one cancel and consumes only its matching no-active-response race',async()=>{
  const server=new WebSocketServer({port:0,host:'127.0.0.1'});await new Promise<void>(resolve=>server.once('listening',resolve));
  const original={url:config.qwenUrl,key:config.qwenKey};config.qwenUrl=`ws://127.0.0.1:${(server.address() as {port:number}).port}`;config.qwenKey='local-protocol-test';
  let creates=0;let cancellations=0;let started=0;let generated=0;let peer:any;const errors:string[]=[];
  server.on('connection',socket=>{peer=socket;socket.on('message',raw=>{
    const message=JSON.parse(raw.toString());
    if(message.type==='session.update')socket.send(JSON.stringify({type:'session.updated',session:message.session}));
    if(message.type==='response.create'){
      const n=++creates;const id=`barge-${n}`;
      socket.send(JSON.stringify({type:'response.created',response:{id}}));
      socket.send(JSON.stringify({type:'response.audio_transcript.delta',response_id:id,delta:n===1?'旧播报':'新回应'}));
      socket.send(JSON.stringify({type:'response.audio.delta',response_id:id,delta:'AAA='}));
      if(n>1)socket.send(JSON.stringify({type:'response.done',response:{id,status:'completed',output:[]}}));
    }
    if(message.type==='response.cancel'){
      cancellations++;socket.send(JSON.stringify({type:'response.done',response:{id:'barge-1',status:'cancelled',output:[]}}));
      socket.send(JSON.stringify({type:'error',error:{message:'Conversation has no active response'}}));
    }
  });});
  const gateway=new QwenGateway('barge',{started:()=>{started++;},text:()=>{},audio:()=>{},generated:()=>{generated++;},cancelled:()=>{},inputStarted:()=>{},inputEnded:()=>{},inputProcessed:()=>{},tool:async()=>({output:{}}),error:message=>errors.push(message),idle:()=>{},canGenerate:()=>true});
  const until=async(check:()=>boolean)=>{for(let i=0;i<100&&!check();i++)await delay(10);assert.ok(check());};
  try{
    await gateway.connect();gateway.userText('第一条');await until(()=>started===1);
    gateway.interrupt();gateway.interrupt();gateway.userText('第二条');await until(()=>generated===1);
    assert.equal(cancellations,1);assert.deepEqual(errors,[]);
    peer.send(JSON.stringify({type:'error',error:{message:'Conversation has no active response'}}));await until(()=>errors.length===1);
  }finally{gateway.close();for(const socket of server.clients)socket.terminate();await new Promise<void>(resolve=>server.close(()=>resolve()));config.qwenUrl=original.url;config.qwenKey=original.key;}
});

test('resuming a clarification accepts the request once; explicit parallel tasks and later input still work',async()=>{
  const server=new WebSocketServer({port:0,host:'127.0.0.1'});await new Promise<void>(resolve=>server.once('listening',resolve));
  const original={url:config.qwenUrl,key:config.qwenKey};config.qwenUrl=`ws://127.0.0.1:${(server.address() as {port:number}).port}`;config.qwenKey='local-protocol-test';
  let creates=0;let generated=0;let currentTools:string[]=[];const toolsAtCreate:string[][]=[];
  const executed:Array<{name:string;args:any}>=[];const returned:any[]=[];
  const call=(name:string,id:string,args:unknown)=>({type:'function_call',name,call_id:id,arguments:JSON.stringify(args)});
  server.on('connection',socket=>socket.on('message',raw=>{
    const message=JSON.parse(raw.toString());
    if(message.type==='session.update'){currentTools=message.session.tools.map((tool:any)=>tool.function.name);socket.send(JSON.stringify({type:'session.updated',session:message.session}));}
    if(message.type==='conversation.item.create'&&message.item.type==='function_call_output')returned.push(JSON.parse(message.item.output));
    if(message.type==='response.create'){
      const n=++creates;const id=`resume-${n}`;toolsAtCreate.push([...currentTools]);socket.send(JSON.stringify({type:'response.created',response:{id}}));
      // The model resumes the Wuhan task, then tries to start the same search in its continuation.
      const output=n===1?[call('resume_task','resume',{taskId:'wuhan',answer:'是的，查询武汉今天的天气。'})]
        :n===2?[
          call('start_task','new-1',{title:'利润分析',request:'分析利润'}),
          call('start_task','new-2',{title:'北京天气',request:'查询北京天气',newTask:true}),
        ]:[];
      if(!output.length)socket.send(JSON.stringify({type:'response.audio_transcript.delta',response_id:id,delta:'已受理。'}));
      socket.send(JSON.stringify({type:'response.done',response:{id,status:'completed',output}}));
    }
  }));
  const gateway=new QwenGateway('resume',{started:()=>{},text:()=>{},audio:()=>{},generated:()=>{generated++;},cancelled:()=>{},inputStarted:()=>{},inputEnded:()=>{},inputProcessed:()=>{},
    tool:async(name,args)=>{executed.push({name,args});return {output:{taskId:args.taskId||`new-${executed.length}`,status:'accepted'}};},error:message=>assert.fail(message),idle:()=>{},canGenerate:()=>true});
  const until=async(check:()=>boolean)=>{for(let i=0;i<100&&!check();i++)await delay(10);assert.ok(check());};
  try{
    await gateway.connect();gateway.userText('是的，查询武汉今天的天气。');await until(()=>returned.length===1&&!gateway.busy);await delay(30);assert.equal(creates,1);assert.equal(generated,0);
    assert.deepEqual(executed.map(c=>c.name),['resume_task'],'The continuation must reuse the accepted Wuhan task, not start another worker');
    assert.equal(returned[0].taskId,'wuhan');assert.equal(returned[0].status,'accepted');
    gateway.userText('再分析利润，另外查询北京天气');await until(()=>returned.length===3&&!gateway.busy);assert.equal(creates,2);
    assert.deepEqual(executed.map(c=>c.name),['resume_task','start_task','start_task']);
    assert.ok(toolsAtCreate[1].includes('start_task'));
  }finally{gateway.close();for(const socket of server.clients)socket.terminate();await new Promise<void>(resolve=>server.close(()=>resolve()));config.qwenUrl=original.url;config.qwenKey=original.key;}
});
