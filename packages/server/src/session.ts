import {randomUUID} from 'node:crypto';
import type WebSocket from 'ws';
import {PROTOCOL_VERSION,type ActionDescriptor,type ClientMessage,type Delivery,type JsonObject,type RuntimeMode,type ServerMessage,type Speech,type TaskResult,type VisualState} from '../../protocol/src/index.ts';
import {config,health} from './config.ts';
import {querySql,runPython} from './execution.ts';
import {Harness} from './harness.ts';
import {getGreeting,saveGreeting} from './greeting.ts';
import {getVoiceDirectTools,runProjectTool,type ProjectDefinition} from './project.ts';
import {deliverySentences,InputGate,makeDelivery} from './delivery.ts';
import {QwenGateway,type ToolOutcome} from './qwen.ts';
import {CompletionBatch,TaskManager,type RuntimeTask} from './task-manager.ts';
import {recordVoiceEvent} from './voice-log.ts';
import {projectSkills} from './skills.ts';
import {PageActionLane,type PageSnapshot} from './page-actions.ts';
import {isDismissalCommand} from './conversation-control.ts';

const spokenText=(text:string)=>text.replace(/[\s\p{P}\p{S}]/gu,'');
const done=(task:RuntimeTask)=>['succeeded','failed','cancelled','interrupted'].includes(task.info.status);
const wait=(ms:number,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{
  const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
  const abort=()=>{clearTimeout(timer);reject(new Error('任务已取消'));};
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
});

export class VoiceSession {
  private originalQuestion='';
  private clientId='';private projectId='';private project?:ProjectDefinition;
  private context:JsonObject={};private actions:ActionDescriptor[]=[];private mode:RuntimeMode='demo';
  private autoEndSession=false;
  private contextVersion=0;
  private pageSession=new AbortController();
  private pageLane=new PageActionLane(()=>this.observePage(),(name,args,version,taskId)=>this.invokeAction(name,args,version,taskId));
  private sessionId='';private active=false;private order=0;private accepting=false;private userSpeaking=false;
  private tasks=new Map<string,RuntimeTask>();private pendingClarification?:string;
  private speechQueue:Speech[]=[];private current?:Speech;private currentText='';private currentGenerated=false;
  private closingDeliveryId?:string;
  private pendingActions=new Map<string,{resolve:(v:unknown)=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout;sessionId:string}>();
  private emittedResults=new Set<string>();private releaseResolvers:Array<()=>void>=[];
  private qwen?:QwenGateway;private inputAt=0;private liveConnecting?:Promise<void>;
  private cachedGreeting?:Awaited<ReturnType<typeof getGreeting>>;private greetingChunks:string[]=[];
  private pageActionTasks=new Set<string>();
  private harness:Harness;
  private deliveries=new Map<string,Delivery>();
  private audioSent=new Set<string>();
  private selectedResult?:string;private lastSpokenResult?:string;
  private inputGate=new InputGate(()=>{this.accepting=this.inputGate.blocked;this.userSpeaking=Boolean(this.inputGate.local||this.inputGate.cloud);if(!this.accepting)this.send({type:'input.processed'});this.diagnostic('input.released');this.pumpSpeech();this.maybeIdle();});
  private waits=new Map<string,{at:number;count:number;endedAt:number;timer?:NodeJS.Timeout}>();
  private waitPhrase=0;
  private lastBlock='';
  private fixedAudio=new Map<string,{text:string;audio:string}>();private currentChunks:string[]=[];
  private completions=new CompletionBatch<TaskResult>(results=>{
    for(const result of results){
      const delivery=this.tasks.get(result.taskId)?.delivery;
      if(delivery?.status==='queued'&&this.active)this.enqueueDelivery(delivery);
    }
    this.pumpSpeech();this.maybeIdle();
  });
  constructor(private ws:WebSocket,private manager:TaskManager,private projects:Map<string,ProjectDefinition>){
    this.harness=new Harness(manager,(task,question)=>{if(this.active&&task.info.sessionId===this.sessionId)this.enqueueSpeech('question',question,task.info.taskId);},undefined,{observe:()=>this.observePage(),execute:(name,args,version,taskId,signal)=>{const task=this.requireTask(taskId);if(task.info.sessionId!==this.sessionId)throw new Error('任务所属页面会话已经改变');return this.pageLane.execute(name,args,version,taskId,AbortSignal.any([signal,this.pageSession.signal]));}});
  }
  send(message:ServerMessage){if(this.ws.readyState===1)this.ws.send(JSON.stringify(message));}
  private diagnostic(name:string,values:Partial<Extract<ServerMessage,{type:'diagnostic'}>>={}){
    const event={type:'diagnostic' as const,name,at:Date.now(),...values};this.send(event);recordVoiceEvent(this.sessionId,'send',event);
  }
  private state(state:VisualState,message?:string){this.send({type:'state',state,message});}
  async receive(message:ClientMessage){
    switch(message.type){
      case 'hello':{
        if(message.protocolVersion!==PROTOCOL_VERSION){this.send({type:'error',code:'protocol_mismatch',message:`组件与后台协议不一致，请同步更新为 ${PROTOCOL_VERSION}。`});return;}
        this.projectId=message.projectId;this.clientId=message.clientId;this.project=this.projects.get(this.projectId);
        if(!this.project){this.send({type:'error',message:`后台未注册项目 ${this.projectId}，请配置 PROJECT_MODULE。`});return;}
        this.context=message.context;this.contextVersion=message.contextVersion??0;this.actions=message.actions;this.mode=message.mode||health().mode as RuntimeMode;
        this.validateActions(this.actions);
        this.autoEndSession=message.autoEndSession===true;
        this.send({type:'ready',protocolVersion:PROTOCOL_VERSION,mode:this.mode,voiceReady:Boolean(config.qwenKey),agentReady:Boolean(config.deepseekKey)});
        for(const task of await this.manager.restore(this.projectId,this.clientId)){
          this.attach(task);this.order=Math.max(this.order,task.info.requestOrder);this.send({type:'task.update',task:task.info});
          if(task.result){this.send({type:'task.result',result:task.result});this.emittedResults.add(task.info.taskId);}
          if(task.delivery){this.deliveries.set(task.delivery.deliveryId,task.delivery);this.send({type:'delivery.update',delivery:task.delivery});}
        }
        break;
      }
      case 'session.wake':await this.wake(message.sessionId);break;
      case 'session.end':this.end(message.reason);break;
      case 'context.update':if(message.contextVersion!==undefined&&message.contextVersion<this.contextVersion)break;this.context=message.context;this.contextVersion=message.contextVersion??this.contextVersion+1;this.syncContext();break;
      case 'actions.update':if(message.contextVersion!==undefined&&message.contextVersion<this.contextVersion)break;this.validateActions(message.actions);this.actions=message.actions;this.contextVersion=message.contextVersion??this.contextVersion+1;this.syncContext();break;
      case 'input.text':
        if(!this.active||message.sessionId!==this.sessionId)return;
        this.originalQuestion=message.text;
        this.discardQueuedWaiting('用户继续对话');this.speechQueue=this.speechQueue.filter(s=>s.kind!=='greeting');this.interrupt();this.userSpeaking=false;this.accepting=true;this.inputAt=Date.now();this.state('thinking');
        this.inputGate.reset();this.diagnostic('input.ended',{detail:'text'});
        if(this.handleResultCommand(message.text)){this.accepting=false;this.pumpSpeech();this.maybeIdle();break;}
        if(this.mode==='demo'){
          try{await this.demoInput(message.text);}finally{this.accepting=false;this.send({type:'input.processed'});this.pumpSpeech();this.maybeIdle();}
        }else{await this.liveConnecting;this.qwen?.userText(message.text);}
        break;
      case 'input.started':if(this.active){this.discardQueuedWaiting('用户开始讲话');this.inputGate.startLocal(message.turnId);this.userSpeaking=true;this.accepting=true;this.interrupt();this.diagnostic('input.local_started',{turnId:message.turnId});this.state('listening');}break;
      case 'input.ended':this.inputGate.endLocal(message.turnId);this.userSpeaking=Boolean(this.inputGate.cloud);this.diagnostic('input.local_ended',{turnId:message.turnId});break;
      case 'speech.playing':if(this.current?.speechId===message.speechId){this.setDelivery(this.current.deliveryId,'playing');this.diagnostic('playback.started',{speechId:message.speechId,deliveryId:this.current.deliveryId,taskId:this.current.taskId});}break;
      case 'speech.finished':this.speechFinished(message.speechId);break;
      case 'speech.interrupt':if(!message.speechId||message.speechId===this.current?.speechId)this.interrupt();break;
      case 'action.result':{
        const pending=this.pendingActions.get(message.callId);if(!pending)return;this.pendingActions.delete(message.callId);clearTimeout(pending.timer);
        if(pending.sessionId!==this.sessionId){pending.reject(new Error('页面操作所属会话已结束'));return;}
        if(message.context&&message.contextVersion!==undefined&&message.contextVersion>=this.contextVersion){this.context=message.context;this.contextVersion=message.contextVersion;this.syncContext();}
        if(message.error)pending.reject(new Error(message.error));else pending.resolve(message.result);break;
      }
      case 'task.cancel':{const task=this.requireTask(message.taskId);this.manager.cancel(task);this.harness.release(task.info.taskId);break;}
      case 'task.retry':this.retryTask(message.taskId);break;
      case 'result.replay':this.replayResult(message.taskId);break;
      case 'result.select':if(message.taskId)this.requireTask(message.taskId);this.selectedResult=message.taskId;this.syncContext();break;
      case 'result.read':{const result=this.requireTask(message.taskId).result;if(!result)throw new Error('这个任务还没有结果');this.send({type:'result.detail',result});break;}
      case 'delivery.stop':this.stopDelivery(message.taskId,message.deliveryId);break;
      case 'delivery.retry':{
        const previous=this.deliveries.get(message.deliveryId);if(!previous)throw new Error('这条播报记录不存在');
        if(previous.text.trim())this.enqueueSpeech(previous.kind,previous.text,previous.taskId);
        else {this.setDelivery(previous.deliveryId,'skipped','重新尝试语音回应');this.accepting=true;this.qwen?.retryResponse();}
        break;
      }
      case 'demo.release':this.release();break;
    }
  }
  appendAudio(audio:Buffer){if(this.active&&this.mode==='live')this.qwen?.append(audio);}
  private attach(task:RuntimeTask){
    this.tasks.set(task.info.taskId,task);
    task.prepareDelivery=result=>{
      const delivery=makeDelivery(this.sessionId||result.sessionId,'result',result.summary,result.taskId);
      if(!this.active||this.closingDeliveryId||result.status==='cancelled'){delivery.status='skipped';delivery.reason='静默展示';}
      this.deliveries.set(delivery.deliveryId,delivery);return delivery;
    };
    task.onUpdate=t=>{
      if(t.info.status!=='collecting'&&this.pendingClarification===t.info.taskId)this.pendingClarification=undefined;
      this.send({type:'task.update',task:t.info});this.syncContext();
      this.advanceClarification();
      if(['queued','running'].includes(t.info.status))this.scheduleWaiting(t);
      else {const entry=this.waits.get(t.info.taskId);if(entry)clearTimeout(entry.timer);this.waits.delete(t.info.taskId);}
    };
    task.onResult=t=>{
      const result=t.result!;if(this.emittedResults.has(result.taskId))return;
      this.emittedResults.add(result.taskId);this.send({type:'task.result',result});
      if(t.delivery)this.send({type:'delivery.update',delivery:t.delivery});
      this.diagnostic('task.completed',{taskId:result.taskId,deliveryId:t.delivery?.deliveryId});
      this.yieldWaiting(result.taskId);this.harness.release(result.taskId);
      this.send({type:'metrics',name:'task_duration_ms',value:Date.now()-t.info.createdAt,taskId:result.taskId});
      this.completions.add(result);
    };
  }
  private createTask(title:string,prompt=title){
    const task=this.manager.create({projectId:this.projectId,clientId:this.clientId,sessionId:this.sessionId,title,prompt,context:this.context,order:++this.order});
    this.attach(task);this.send({type:'task.update',task:task.info});return task;
  }
  private async wake(sessionId:string){
    if(!this.project){this.send({type:'error',message:'请先发送有效的 hello 项目配置。'});return;}
    if(this.active&&this.sessionId===sessionId)return;
    if(this.active)this.end('manual');
    this.pageSession=new AbortController();
    this.sessionId=sessionId;this.active=true;this.userSpeaking=false;this.accepting=false;
    this.inputGate.reset();
    this.send({type:'session.started',sessionId});this.state('waking');
    if(!this.pendingClarification||this.tasks.get(this.pendingClarification)?.info.status!=='collecting')this.pendingClarification=[...this.tasks.values()].find(t=>t.info.status==='collecting'&&t.info.question)?.info.taskId;
    if(this.mode==='live'){
      if(!config.qwenKey){this.send({type:'error',message:'真实模式需要后台 DASHSCOPE_API_KEY，请先配置密钥或选择演示模式。'});this.end('manual');return;}
      const gateway=new QwenGateway(sessionId,{
        started:speech=>{
          if(!this.active||speech.sessionId!==this.sessionId||this.qwen!==gateway)return;
          if(this.current&&this.current.speechId!==speech.speechId){gateway.interrupt();return;}
          if(!this.current){
            const delivery={...makeDelivery(this.sessionId,speech.kind,speech.text,speech.taskId),deliveryId:speech.deliveryId};this.deliveries.set(delivery.deliveryId,delivery);
            this.startSpeech(speech);
          }
          this.state('speaking');
        },
        text:(speechId,text)=>{if(this.current?.speechId!==speechId)return;this.currentText+=text;this.send({type:'speech.text',speechId,text,append:true});},
        audio:(speechId,audio)=>{if(this.current?.speechId===speechId){this.sendAudio(speechId,audio);if(this.current.kind==='greeting')this.greetingChunks.push(audio);}},
        generated:speechId=>{
          if(this.current?.speechId!==speechId)return;
          recordVoiceEvent(this.sessionId,'send',{type:'speech.output',speechId,deliveryId:this.current.deliveryId,taskId:this.current.taskId,kind:this.current.kind,expectedText:this.current.text,text:this.currentText});
          this.currentGenerated=true;this.send({type:'speech.generated',speechId});
          if(this.current.kind==='waiting'&&this.currentChunks.length&&spokenText(this.currentText)===spokenText(this.current.text))this.fixedAudio.set(this.cacheKey(this.current.text),{text:this.currentText||this.current.text,audio:Buffer.concat(this.currentChunks.map(s=>Buffer.from(s,'base64'))).toString('base64')});
          if(this.current.kind==='greeting')void saveGreeting(this.greetingChunks,this.currentText).catch(error=>console.error('Greeting cache:',error.message));
        },
        cancelled:speechId=>{if(this.current?.speechId===speechId)this.cancelCurrent(true);},
        farewell:speechId=>{if(this.active&&this.qwen===gateway)this.beginFarewell(speechId);},
        inputStarted:turnId=>{if(!this.active||this.qwen!==gateway)return;this.discardQueuedWaiting('用户开始讲话');this.cancelFarewell();this.inputGate.startCloud(turnId);this.userSpeaking=true;this.accepting=true;this.inputAt=Date.now();this.cancelCurrent(true);this.send({type:'input.started',turnId});this.diagnostic('input.cloud_started',{turnId});this.state('listening');},
        inputEnded:turnId=>{if(this.inputGate.cloud!==turnId)return;this.inputGate.endCloud(turnId);this.userSpeaking=false;this.inputAt=Date.now();this.send({type:'input.ended',turnId});this.diagnostic('input.ended',{turnId});this.state('thinking');},
        processing:turnId=>{if(!this.active||this.qwen!==gateway)return;this.inputGate.process(turnId);this.accepting=true;this.diagnostic('input.processing',{turnId});},
        inputProcessed:turnId=>{if(!this.active||this.qwen!==gateway)return;this.inputGate.finish(turnId);this.accepting=this.inputGate.blocked;if(!this.accepting)this.send({type:'input.processed',turnId});},
        tool:(name,args)=>this.liveTool(name,args),error:(message,fatal,speechId)=>{
          if(!this.active||this.qwen!==gateway||this.sessionId!==sessionId)return;
          if(this.closingDeliveryId){this.diagnostic('farewell.unavailable',{detail:message,deliveryId:this.closingDeliveryId});this.end('farewell');return;}
          if(speechId&&this.current&&this.current.speechId!==speechId){this.diagnostic('speech.late_error',{speechId,detail:message});return;}
          const current=this.current;
          if(current){this.setDelivery(current.deliveryId,'failed',message);this.cancelCurrent(false,'failed');}
          else if(!fatal){const delivery=makeDelivery(this.sessionId,'message','');this.deliveries.set(delivery.deliveryId,delivery);this.setDelivery(delivery.deliveryId,'failed',message);}
          this.send({type:'error',message,taskId:current?.taskId,deliveryId:current?.deliveryId,code:'speech_failed'});
          this.inputGate.reset();this.accepting=false;this.userSpeaking=false;
          if(fatal){gateway.close();this.qwen=undefined;this.end('connection_error');}else{this.pumpSpeech();this.maybeIdle();}
        },
        trace:(direction,event)=>{
          if(direction==='receive'&&event.type==='input_audio_buffer.speech_started')this.originalQuestion='';
          if(direction==='receive'&&event.type==='conversation.item.input_audio_transcription.completed'&&typeof event.transcript==='string')this.originalQuestion=event.transcript;
          recordVoiceEvent(sessionId,direction,event);
        },
        idle:()=>{this.pumpSpeech();this.maybeIdle();},canGenerate:()=>this.active&&(!this.current||!this.currentGenerated),
      });
      this.qwen=gateway;this.syncContext();
      // Publish the connection promise before yielding so immediate input waits for skills too.
      this.liveConnecting=(async()=>{
        const skills=await projectSkills(this.project!);
        if(!this.active||this.sessionId!==sessionId||this.qwen!==gateway){gateway.close();return;}
        gateway.setProject(this.project!.description||'',skills.summaries());
        await gateway.connect();
      })();
      try{
        this.cachedGreeting=await getGreeting();this.greetingChunks=[];
        if(this.cachedGreeting&&this.active&&this.sessionId===sessionId&&!this.accepting)this.enqueueSpeech('greeting',this.cachedGreeting.text);
        await this.liveConnecting;
        if(!this.cachedGreeting&&this.active&&this.sessionId===sessionId&&!this.accepting)this.enqueueSpeech('greeting','在的。');
      }
      catch(error){if(this.active&&this.sessionId===sessionId){this.send({type:'error',message:error instanceof Error?error.message:String(error)});this.end('manual');}}
    }else this.enqueueSpeech('greeting','在的。');
  }
  private end(reason:string){
    this.pageSession.abort(new Error('页面会话已关闭，剩余页面动作未执行'));
    this.active=false;this.closingDeliveryId=undefined;this.accepting=false;this.userSpeaking=false;this.inputGate.reset();
    for(const speech of this.speechQueue)this.setDelivery(speech.deliveryId,'interrupted','会话已结束');
    this.speechQueue=[];this.cancelCurrent(false);this.qwen?.close();this.qwen=undefined;
    for(const entry of this.waits.values())clearTimeout(entry.timer);this.waits.clear();
    // In-flight page functions keep the action lane until their actual receipt or timeout.
    this.send({type:'input.processed'});this.send({type:'session.idle',sessionId:this.sessionId,reason});this.state('armed');
  }
  private beginFarewell(speechId?:string){
    if(!this.active||this.closingDeliveryId)return;
    if(speechId){
      // Transcription may arrive after audio drains. Never create another goodbye in that case.
      const delivery=[...this.deliveries.values()].find(value=>value.speechId===speechId);
      if(delivery?.status==='delivered'){this.end('farewell');return;}
      if(this.current?.speechId!==speechId||!this.currentGenerated)return;
    }
    // A model may already have spoken its goodbye alongside the end tool. Keep that audio once.
    const existing=this.current?.kind==='message'&&this.currentGenerated&&this.audioSent.has(this.current.speechId)?this.current:undefined;
    const goodbye=existing?this.deliveries.get(existing.deliveryId)!:makeDelivery(this.sessionId,'message','好，我先退下啦。');
    this.closingDeliveryId=goodbye.deliveryId;
    for(const speech of this.speechQueue)this.setDelivery(speech.deliveryId,'skipped','正在告别');
    this.speechQueue=[];
    for(const entry of this.waits.values())clearTimeout(entry.timer);this.waits.clear();
    if(!existing){this.cancelCurrent(false,'skipped');this.enqueueDelivery(goodbye);}
    this.diagnostic('session.closing',{deliveryId:goodbye.deliveryId});
  }
  private cancelFarewell(){
    const id=this.closingDeliveryId;if(!id)return;
    this.closingDeliveryId=undefined;this.speechQueue=this.speechQueue.filter(s=>s.deliveryId!==id);
    this.setDelivery(id,'interrupted','用户继续对话');this.diagnostic('session.closing_cancelled',{deliveryId:id});
  }
  private enqueueSpeech(kind:Speech['kind'],text:string,taskId?:string){
    if(!this.active)return;
    if(kind==='question'&&taskId){
      const pending=this.pendingClarification?this.tasks.get(this.pendingClarification):undefined;
      if(pending?.info.status==='collecting'&&pending.info.taskId!==taskId)return;
      if(this.current?.kind==='question'&&this.current.taskId===taskId&&this.deliveries.get(this.current.deliveryId)?.text===text||this.speechQueue.some(s=>s.kind==='question'&&s.taskId===taskId&&this.deliveries.get(s.deliveryId)?.text===text))return;
      this.pendingClarification=taskId;this.syncContext();
    }
    this.enqueueDelivery(makeDelivery(this.sessionId,kind,text,taskId));
  }
  private advanceClarification(){
    if(!this.active||this.closingDeliveryId||this.pendingClarification)return;
    const next=[...this.tasks.values()].find(t=>t.info.status==='collecting'&&t.info.question);
    if(next)this.enqueueSpeech('question',next.info.question!,next.info.taskId);
  }
  private enqueueDelivery(delivery:Delivery){
    if(this.closingDeliveryId&&delivery.deliveryId!==this.closingDeliveryId){this.deliveries.set(delivery.deliveryId,delivery);this.setDelivery(delivery.deliveryId,'skipped','正在告别');return;}
    if(this.current?.deliveryId===delivery.deliveryId||this.speechQueue.some(s=>s.deliveryId===delivery.deliveryId))return;
    this.deliveries.set(delivery.deliveryId,delivery);this.setDelivery(delivery.deliveryId,'queued');
    this.speechQueue.push(...deliverySentences(delivery,this.mode));this.diagnostic('speech.queued',{taskId:delivery.taskId,deliveryId:delivery.deliveryId});this.pumpSpeech();
  }
  private setDelivery(id:string,status:Delivery['status'],reason?:string){
    const old=this.deliveries.get(id);if(!old)return;
    const delivery={...old,status,reason,updatedAt:Date.now()};this.deliveries.set(id,delivery);
    const task=delivery.kind==='result'&&delivery.taskId?this.tasks.get(delivery.taskId):undefined;
    if(task?.result)this.manager.setDelivery(task,delivery);
    this.send({type:'delivery.update',delivery});this.syncContext();
  }
  private startSpeech(speech:Speech){
    this.current=speech;this.currentText='';this.currentGenerated=false;this.currentChunks=[];
    const delivery=this.deliveries.get(speech.deliveryId)!;
    this.deliveries.set(speech.deliveryId,{...delivery,speechId:speech.speechId,sentenceIndex:speech.sentenceIndex});
    this.setDelivery(speech.deliveryId,'generating');
    this.send({type:'speech.start',speech:{...speech,text:this.mode==='demo'?speech.text:''}});this.state('speaking');
  }
  private cacheKey(text:string){return `${config.qwenModel}/${config.qwenVoice}/${text}`;}
  private sendAudio(speechId:string,audio:string){
    if(this.current?.speechId!==speechId)return;
    if(!this.audioSent.has(speechId)){this.audioSent.add(speechId);this.diagnostic('speech.first_audio',{speechId,deliveryId:this.current.deliveryId,taskId:this.current.taskId});}
    this.currentChunks.push(audio);this.send({type:'speech.audio',speechId,audio});
  }
  private pumpSpeech(){
    if(!this.speechQueue.length){this.lastBlock='';return;}
    const blocked=!this.active?'session_closed':this.current?`playing:${this.current.speechId}`:this.inputGate.cloud?'cloud_speech':this.inputGate.local?'local_sound':this.accepting?'input_processing':this.userSpeaking?'user_speaking':this.qwen?.busy?'model_processing':'';
    if(blocked){if(blocked!==this.lastBlock){this.lastBlock=blocked;this.diagnostic('speech.blocked',{detail:blocked,taskId:this.speechQueue[0].taskId,deliveryId:this.speechQueue[0].deliveryId});}return;}
    this.lastBlock='';
    const speech=this.speechQueue.shift()!;this.startSpeech(speech);
    if(this.mode==='demo'){
      this.audioSent.add(speech.speechId);
      this.currentText=speech.text;this.send({type:'speech.text',speechId:speech.speechId,text:speech.text});
      this.currentGenerated=true;this.send({type:'speech.generated',speechId:speech.speechId});
    }else if(speech.kind==='greeting'&&this.cachedGreeting){
      this.currentText=this.cachedGreeting.text;this.send({type:'speech.text',speechId:speech.speechId,text:this.currentText});
      this.sendAudio(speech.speechId,this.cachedGreeting.audio);this.currentGenerated=true;this.send({type:'speech.generated',speechId:speech.speechId});
    }else if(speech.kind==='waiting'&&this.fixedAudio.has(this.cacheKey(speech.text))){
      const cached=this.fixedAudio.get(this.cacheKey(speech.text))!;this.currentText=cached.text;
      this.send({type:'speech.text',speechId:speech.speechId,text:cached.text});this.sendAudio(speech.speechId,cached.audio);
      this.currentGenerated=true;this.send({type:'speech.generated',speechId:speech.speechId});
    }else this.qwen?.speak(speech);
  }
  private speechFinished(speechId:string){
    if(!this.current||this.current.speechId!==speechId)return;
    if(!this.currentGenerated)return;
    const speech=this.current;this.current=undefined;this.currentGenerated=false;this.audioSent.delete(speechId);
    this.diagnostic('playback.finished',{speechId,taskId:speech.taskId,deliveryId:speech.deliveryId});
    const remaining=this.speechQueue.some(s=>s.deliveryId===speech.deliveryId);
    if(!remaining){this.setDelivery(speech.deliveryId,speech.kind==='waiting'&&speech.sentenceIndex+1<speech.sentenceCount?'skipped':'delivered');if(speech.kind==='result')this.lastSpokenResult=speech.taskId;}
    if(!remaining&&speech.deliveryId===this.closingDeliveryId){this.end('farewell');return;}
    if(speech.kind==='waiting'&&speech.taskId){const entry=this.waits.get(speech.taskId);if(entry)entry.endedAt=Date.now();}
    if(speech.kind==='greeting'||speech.kind==='question')this.state('listening');
    this.qwen?.playbackFinished();this.pumpSpeech();
    if(speech.kind!=='greeting'&&speech.kind!=='question')this.maybeIdle();
  }
  private cancelCurrent(requeue:boolean,status:Delivery['status']='interrupted'){
    if(!this.current)return;
    const speech=this.current;this.send({type:'speech.cancelled',speechId:speech.speechId});this.current=undefined;this.currentGenerated=false;this.audioSent.delete(speech.speechId);
    this.speechQueue=this.speechQueue.filter(s=>s.deliveryId!==speech.deliveryId);
    const delivery=this.deliveries.get(speech.deliveryId)!;
    if(!delivery.text)delivery.text=this.currentText;
    this.setDelivery(speech.deliveryId,status,status==='failed'?delivery.reason:status==='interrupted'?'用户中断':'播报停止');
    this.diagnostic('speech.cancelled',{speechId:speech.speechId,deliveryId:speech.deliveryId,taskId:speech.taskId,detail:status});
    if(requeue&&speech.kind==='result'&&this.active&&delivery.text){this.speechQueue.push(...deliverySentences(delivery,this.mode));this.setDelivery(delivery.deliveryId,'queued');}
  }
  private interrupt(){this.cancelFarewell();this.qwen?.interrupt();this.cancelCurrent(true);}
  private maybeIdle(){
    if(!this.active||this.current||this.speechQueue.length||this.completions.pendingCount||this.accepting||this.userSpeaking||this.qwen?.busy)return;
    const pending=[...this.tasks.values()].filter(t=>!done(t));
    if(pending.length){this.state(pending.every(t=>t.info.status==='collecting')?'listening':'working');return;}
    if(this.autoEndSession)this.end('complete');
    else this.state('listening');
  }
  private directDescriptors():ActionDescriptor[]{
    return (this.project?getVoiceDirectTools(this.project):[]).map(tool=>{
      const properties=(tool.parameters.properties||{}) as JsonObject;
      if('__taskId' in properties||'__newTask' in properties)throw new Error('项目工具参数 __taskId/__newTask 为语音任务路由保留');
      return {...tool,description:tool.description+' 当前追问补齐后默认完成原任务；明确的新请求设 __newTask=true，或 __taskId 指定原任务。',parameters:{...tool.parameters,properties:{...properties,__taskId:{type:'string'},__newTask:{type:'boolean'}}}};
    });
  }
  private syncContext(){this.qwen?.setContext(this.context,[...this.actions,...this.directDescriptors()],{awaitingTaskId:this.pendingClarification,selectedResult:this.selectedResult,lastSpokenResult:this.lastSpokenResult,recent:[...this.tasks.values()].slice(-12).map(t=>({taskId:t.info.taskId,title:t.info.title,request:t.prompt,status:t.info.status,question:t.info.question,summary:t.result?.summary,delivery:t.delivery?.status}))});}
  private validateActions(actions:ActionDescriptor[]){
    const names=new Set<string>();const direct=new Set(this.project?getVoiceDirectTools(this.project).map(t=>t.name):[]);
    const reserved=new Set(['start_task','resume_task','complete_task','ask_user','cancel_task','control_card','end_conversation','read_result','replay_result','stop_delivery']);
    for(const action of actions){if(names.has(action.name)||direct.has(action.name)||reserved.has(action.name)||action.name.startsWith('project__'))throw new Error(`动作名称冲突：${action.name}`);names.add(action.name);}
  }
  private requireTask(id:string){const task=this.tasks.get(id);if(!task)throw new Error('任务不存在，请使用当前项目的任务编号');return task;}
  private focusResult(){return (this.selectedResult&&this.tasks.get(this.selectedResult)?.result?this.selectedResult:undefined)||this.lastSpokenResult||[...this.tasks.values()].filter(t=>t.result).sort((a,b)=>a.info.updatedAt-b.info.updatedAt).at(-1)?.info.taskId;}
  private replayResult(taskId:string){
    const task=this.requireTask(taskId);if(!task.result)throw new Error('这个任务还没有结果');
    if(!this.active)throw new Error('请先唤醒小云再重播');
    const existing=this.speechQueue.find(s=>s.taskId===taskId&&s.kind==='result');
    if(existing||this.current?.taskId===taskId&&this.current.kind==='result')return;
    this.enqueueSpeech('result',task.result.summary,taskId);
  }
  private stopDelivery(taskId:string,deliveryId?:string){
    this.requireTask(taskId);
    const matches=(s:Speech)=>s.taskId===taskId&&(!deliveryId||s.deliveryId===deliveryId);
    for(const s of this.speechQueue.filter(matches))this.setDelivery(s.deliveryId,'skipped','用户要求停止播报');
    this.speechQueue=this.speechQueue.filter(s=>!matches(s));
    if(this.current&&matches(this.current)){
      this.cancelCurrent(false,'skipped');this.qwen?.interrupt();
    }
    this.pumpSpeech();this.maybeIdle();
  }
  private retryTask(taskId:string){
    const previous=this.requireTask(taskId);
    if(!['failed','cancelled','interrupted'].includes(previous.info.status))throw new Error('这个任务不需要重试');
    const task=this.createTask(previous.info.title,previous.prompt);
    task.info.contextAtStart=structuredClone(previous.info.contextAtStart);
    if(this.mode==='live')this.manager.enqueue(task,()=>this.harness.run(task,this.project!));
    else this.manager.enqueue(task,async()=>{await wait(700,task.abort.signal);return this.manager.result(task,{summary:'这次演示重试已经完成。'});});
  }
  private handleResultCommand(text:string){
    const id=this.focusResult();
    if(/^(?:小云[，,\s]*)?(?:再念(?:一下|一遍)?|再说一遍|你怎么不(?:帮我)?念|为什么不念)[。！？?！\s]*$/.test(text)){
      if(id)this.replayResult(id);else this.enqueueSpeech('question','你想让我重播哪一条结果？');return true;
    }
    if(/不用念了|不用读了|停止播报/.test(text)){
      const target=this.current?.taskId||id;if(target)this.stopDelivery(target);
      this.enqueueSpeech('message','好的，结果留在卡片里。');return true;
    }
    return false;
  }
  private scheduleWaiting(task:RuntimeTask){
    if(!this.active||this.closingDeliveryId||task.info.sessionId!==this.sessionId||this.waits.has(task.info.taskId))return;
    const entry={at:Date.now(),count:0,endedAt:0,timer:undefined as NodeJS.Timeout|undefined};this.waits.set(task.info.taskId,entry);
    this.diagnostic('task.accepted',{taskId:task.info.taskId});
    const tick=()=>{
      if(!this.active||done(task)||task.info.status==='collecting')return;
      const elapsed=Date.now()-entry.at;
      const busyWaiting=this.current?.kind==='waiting'||this.speechQueue.some(s=>s.kind==='waiting');
      const conversing=this.pendingClarification||this.userSpeaking||this.accepting||this.current&&this.current.kind!=='waiting'||this.speechQueue.some(s=>s.kind!=='waiting');
      if(conversing){entry.count++;}
      else if(entry.count===0){
        const bank=['我来处理这个任务。','我来确认一下。','我先看看相关信息。'];
        const phrase=task.prompt.startsWith('测试等待句接话')?'正在查询，请稍等一下。查到以后我会告诉你。':bank[this.waitPhrase++%bank.length];
        entry.count++;this.enqueueSpeech('waiting',phrase,task.info.taskId);
      }else if(elapsed>=12000&&!busyWaiting&&(!entry.endedAt||Date.now()-entry.endedAt>=8000)){
        const phase=task.info.progress||'';
        const choices=/排队|等待执行/.test(phase)?['任务还在排队。','还在等待执行。']:/查询|检索|网页|资料/.test(phase)?['还在核对资料。','我再核对一下。']:/计算/.test(phase)?['还在计算这部分数据。','计算还在继续。']:['这部分还在处理。','任务还需要一点时间。'];
        const phrase=choices[this.waitPhrase++%choices.length];
        entry.count++;this.enqueueSpeech('waiting',phrase,task.info.taskId);
      }
      if(entry.count<2){entry.timer=setTimeout(tick,Math.max(250,12000-(Date.now()-entry.at),entry.endedAt?8000-(Date.now()-entry.endedAt):0));entry.timer.unref?.();}
    };
    entry.timer=setTimeout(tick,1000);entry.timer.unref?.();
  }
  private discardQueuedWaiting(reason:string){
    const removed=this.speechQueue.filter(s=>s.kind==='waiting');
    this.speechQueue=this.speechQueue.filter(s=>s.kind!=='waiting');
    for(const speech of removed)if(speech.deliveryId!==this.current?.deliveryId)this.setDelivery(speech.deliveryId,'skipped',reason);
  }
  private yieldWaiting(_taskId:string){
    this.discardQueuedWaiting('结果已就绪');
    if(this.current?.kind==='waiting'&&!this.audioSent.has(this.current.speechId)){
      this.cancelCurrent(false,'skipped');this.qwen?.interrupt();
    }
  }
  private observePage():PageSnapshot {
    if(this.ws.readyState!==1)throw new Error('网页连接已经断开');
    return {context:structuredClone(this.context),version:this.contextVersion,actions:this.actions};
  }
  private async action(name:string,args:JsonObject,taskId?:string):Promise<unknown>{
    const task=taskId?this.tasks.get(taskId):undefined;
    return (await this.pageLane.execute(name,args,this.contextVersion,taskId,task?AbortSignal.any([task.abort.signal,this.pageSession.signal]):this.pageSession.signal)).result;
  }
  private invokeAction(name:string,args:JsonObject,version:number,taskId?:string):Promise<unknown>{
    if(!this.active||this.closingDeliveryId||this.ws.readyState!==1)return Promise.reject(new Error('页面会话已关闭，无法继续执行页面动作'));
    const callId=randomUUID();const sessionId=this.sessionId;
    this.diagnostic('page.action_requested',{taskId,detail:name});
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pendingActions.delete(callId);reject(new Error(`页面动作 ${name} 超时；动作可能已执行，请先观察页面，不要盲目重试`));},10000);
      this.pendingActions.set(callId,{resolve,reject,timer,sessionId});this.send({type:'action.request',callId,name,args,taskId,expectedContextVersion:version,sessionId});
    });
  }
  private async liveTool(name:string,args:JsonObject):Promise<ToolOutcome>{
    if(!this.active)return {output:{error:'会话已结束'}};
    if(name==='read_result'){
      const task=this.requireTask(String(args.taskId));if(!task.result)throw new Error('结果还未完成');
      this.stopDelivery(task.info.taskId);
      this.selectedResult=task.info.taskId;return {output:task.result,kind:'result',taskId:task.info.taskId};
    }
    if(name==='replay_result'){this.replayResult(String(args.taskId));return {output:{queued:true},suppressReply:true};}
    if(name==='stop_delivery'){this.stopDelivery(String(args.taskId));return {output:{stopped:true},suppressReply:true};}
    if(name.startsWith('project__')){
      const originalQuestion=this.originalQuestion;
      const tool=getVoiceDirectTools(this.project!).find(t=>t.name===name);if(!tool)throw new Error('项目没有开放这个直达工具');
      const {__taskId,__newTask,...businessArgs}=args;
      const pending=!__newTask&&this.pendingClarification?this.tasks.get(this.pendingClarification):undefined;
      const task=__taskId?this.requireTask(String(__taskId)):pending?.info.status==='collecting'?pending:this.createTask(originalQuestion.slice(0,60)||tool.description.slice(0,32),`${name.slice(9)} ${JSON.stringify(businessArgs)}`);
      if(task.info.status!=='collecting')return {output:{taskId:task.info.taskId,status:task.info.status},suppressReply:true};
      if(this.pendingClarification===task.info.taskId)this.pendingClarification=undefined;task.info.sessionId=this.sessionId;
      this.manager.runDirect(task,async()=>this.manager.result(task,await runProjectTool(this.project!,name.slice(9),businessArgs,{signal:task.abort.signal,taskId:task.info.taskId,contextAtStart:task.info.contextAtStart,originalQuestion})));
      return {output:{taskId:task.info.taskId,status:'accepted'},suppressReply:true};
    }
    if(name==='start_task'){
      const pending=!args.newTask&&this.pendingClarification?this.tasks.get(this.pendingClarification):undefined;
      let task=args.taskId?this.tasks.get(String(args.taskId)):pending?.info.status==='collecting'?pending:undefined;
      if(args.taskId&&!task)throw new Error('任务不存在，请使用当前任务列表中的 taskId');
      if(!task)task=this.createTask(String(args.title||args.request),String(args.request));
      if(task.info.status!=='collecting')return {output:{taskId:task.info.taskId,status:task.info.status}};
      task.prompt=String(args.request);task.info.title=String(args.title||task.info.title);task.info.sessionId=this.sessionId;
      if(this.pendingClarification===task.info.taskId)this.pendingClarification=undefined;
      this.pageActionTasks.delete(task.info.taskId);
      this.manager.enqueue(task,()=>this.harness.run(task,this.project!));return {output:{taskId:task.info.taskId,status:'accepted'},kind:'message'};
    }
    if(name==='resume_task'){
      const task=this.tasks.get(String(args.taskId));if(!task||task.info.status!=='collecting')throw new Error('任务不存在或当前不需要补充信息');
      task.info.sessionId=this.sessionId;if(this.pendingClarification===task.info.taskId)this.pendingClarification=undefined;
      this.manager.enqueue(task,()=>this.harness.run(task,this.project!,String(args.answer)));return {output:{taskId:task.info.taskId,status:'accepted'},kind:'message'};
    }
    if(name==='complete_task'){
      const task=this.tasks.get(String(args.taskId));if(!task||task.info.status!=='collecting')throw new Error('只能结束正在等待页面操作的澄清任务');
      this.pendingClarification=undefined;task.info.sessionId=this.sessionId;
      this.manager.complete(task,this.manager.result(task,{summary:String(args.summary)}));
      return {output:{completed:true,taskId:task.info.taskId},suppressReply:true};
    }
    if(name==='ask_user'){
      const pending=!args.newTask&&this.pendingClarification?this.tasks.get(this.pendingClarification):undefined;
      let task=args.taskId?this.tasks.get(String(args.taskId)):pending?.info.status==='collecting'?pending:undefined;
      if(args.taskId&&!task)throw new Error('任务不存在，请使用当前任务列表中的 taskId');
      if(!task){
        if(!String(args.request||'').trim()||!String(args.title||'').trim())throw new Error('追问前必须提供原始需求 request 和任务标题 title，避免后台丢失任务内容');
        task=this.createTask(String(args.title),String(args.request));
      }else{
        if(task.info.status!=='collecting')throw new Error('这个任务已经在执行或结束，不能重新作为澄清任务');
        if(args.request)task.prompt=String(args.request);if(args.title)task.info.title=String(args.title);
      }
      task.info.sessionId=this.sessionId;
      this.manager.update(task,'collecting','等待补充信息',String(args.question));
      this.enqueueSpeech('question',String(args.question),task.info.taskId);
      return {output:{taskId:task.info.taskId,request:task.prompt,question:args.question},kind:'question',taskId:task.info.taskId,suppressReply:true};
    }
    if(name==='cancel_task'){const task=this.tasks.get(String(args.taskId));if(!task)throw new Error('任务不存在');this.manager.cancel(task);return {output:{cancelled:true}};}
    if(name==='control_card'){this.send({type:'card.control',action:args.action as 'pin'|'close'|'clear',taskId:args.taskId?String(args.taskId):undefined});return {output:{updated:true}};}
    if(name==='end_conversation'){this.beginFarewell();return {output:{closing:true},endSession:true,suppressReply:true};}
    const result=await this.action(name,args);this.send({type:'metrics',name:'page_action_ms',value:Date.now()-this.inputAt});
    const task=this.pendingClarification?this.tasks.get(this.pendingClarification):undefined;
    if(task?.info.status==='collecting'&&!task.conversation?.length){this.pendingClarification=undefined;this.manager.complete(task,this.manager.result(task,{summary:'页面已经按要求更新。'}));return {output:result,suppressReply:true};}
    return {output:result};
  }
  private release(){const waiting=this.releaseResolvers.splice(0);for(const resolve of waiting)resolve();}
  private async profit(task:RuntimeTask,region:string):Promise<TaskResult>{
    this.manager.update(task,'running','SQLite 正在汇总年度收入和成本');
    const query=await querySql('SELECT year, ROUND(SUM(revenue),2) revenue, ROUND(SUM(cost),2) cost, ROUND(SUM(revenue-cost),2) profit FROM sales WHERE region=? GROUP BY year ORDER BY year',[region],task.abort.signal);
    this.manager.update(task,'running','Python 正在计算利润同比');
    const computed=await runPython('previous = data[0]["profit"]\ncurrent = data[1]["profit"]\nround((current - previous) / previous * 100, 2)',{data:query.rows},task.abort.signal);
    const change=Number(computed.result);
    const markdown=`### ${region}利润同比\n\n| 年份 | 收入（元） | 成本（元） | 利润（元） |\n| --- | ---: | ---: | ---: |\n${query.rows.map(r=>`| ${r.year} | ${Number(r.revenue).toLocaleString('zh-CN')} | ${Number(r.cost).toLocaleString('zh-CN')} | ${Number(r.profit).toLocaleString('zh-CN')} |`).join('\n')}\n\n**2026 年利润同比${change>=0?'增长':'下降'} ${Math.abs(change)}%。**\n\n> 来源：本机 SQLite 示例数据；同比由受限 Python 实际计算。`;
    return this.manager.result(task,{summary:`${region}地区 2026 年利润同比${change>=0?'增长':'下降'}百分之${Math.abs(change)}。我把收入、成本和利润的对比表放在气泡中了。`,markdown,data:{kind:'profit_comparison',region,rows:query.rows,changePercent:change}});
  }
  private async demoInput(raw:string){
    const text=raw.trim();
    if(text==='测试后台聊天'){
      for(const [title,ms] of [['演示：慢任务',3500],['演示：快任务',1800]] as const){
        const task=this.createTask(title);this.manager.enqueue(task,async()=>{await wait(ms,task.abort.signal);return this.manager.result(task,{summary:`${title}已经完成。`,markdown:'这是可控调度演示结果，不代表真实模型查询。'});});
      }
      this.enqueueSpeech('message','后台现在有两个独立任务在执行，我们仍然可以继续聊天。等我把这段话完整说完，再依次汇报已经完成的任务。');return;
    }

    if(/测试等待句接话/.test(text)){
      const task=this.createTask('句末接话测试',text);const ms=Math.min(30000,Number(text.match(/\d+/)?.[0]||1800));
      this.manager.enqueue(task,async()=>{await wait(ms,task.abort.signal);return this.manager.result(task,{summary:'查询已经完成。这段结果在上一句实际播完以后开始。',markdown:'### 句末交付\n\n结果就绪后，只保留正在播放的等待句，剩余等待内容撤销。'});});return;
    }
    if(/测试四个结果/.test(text)){
      for(let i=1;i<=4;i++){const task=this.createTask(`阅读保护测试 ${i}`);this.manager.enqueue(task,async()=>{await wait(i===4?6000:i*300,task.abort.signal);return this.manager.result(task,{summary:`这是第${i}条结果，展开旧卡时新结果会暂存。`,markdown:`### 结果 ${i}\n\n阅读期间卡片不会被挤走。\n\n| 项目 | 数值 |\n| --- | ---: |\n| 示例 | ${i} |`});});}return;
    }
    if(/销售汇总/.test(text)){await this.liveTool('project__sales_summary',{region:text.match(/华东|华南|华北|西部/)?.[0]||'华东'});return;}
    if(isDismissalCommand(text)){this.beginFarewell();return;}
    if(/释放同时|释放同批|放行任务/.test(text)){this.release();return;}
    if(/取消.*分析|取消任务/.test(text)){
      const task=[...this.tasks.values()].reverse().find(t=>!done(t)&&/分析|数据|慢/.test(t.info.title));if(task)this.manager.cancel(task);
      this.enqueueSpeech('message',task?'已取消分析任务。':'当前没有正在运行的分析任务。');return;
    }
    if(/关闭.*卡|关掉.*卡|清空.*结果|固定.*表|留着.*表|固定.*卡/.test(text)){
      const target=[...this.tasks.values()].reverse().find(t=>t.result&&(!/天气/.test(text)||/天气/.test(t.info.title)));
      const action=/清空/.test(text)?'clear':/固定|留着/.test(text)?'pin':'close';
      this.send({type:'card.control',action,taskId:target?.info.taskId});this.enqueueSpeech('message',action==='pin'?'已经固定这张结果卡。':action==='clear'?'已经清空结果卡。':'已经关闭这张结果卡。');return;
    }
    if(/测试快慢任务/.test(text)){
      const slow=this.createTask('慢任务 · 数据分析');const fast=this.createTask('快任务 · 天气');
      this.manager.enqueue(slow,async()=>{await wait(5500,slow.abort.signal);return this.manager.result(slow,{summary:'数据分析已经完成。这是先提问、后完成的慢任务。',markdown:'### 慢任务完成\n\n这条任务先被提出，耗时约 5.5 秒。'});});
      this.manager.enqueue(fast,async()=>{await wait(900,fast.abort.signal);return this.manager.result(fast,{summary:'天气测试已完成。这是后提问、先完成的快任务。',markdown:'### 快任务完成\n\n这条任务后被提出，耗时约 0.9 秒。\n\n> 调度演示，不是真实天气。'});});return;
    }
    if(/测试同时完成/.test(text)){
      const one=this.createTask('同时任务 A · 先提问');const two=this.createTask('同时任务 B · 后提问');
      const barrier=new Promise<void>(resolve=>this.releaseResolvers.push(resolve));
      for(const [task,label]of [[one,'A'],[two,'B']] as const)this.manager.enqueue(task,async()=>{
        await Promise.race([barrier,new Promise<never>((_r,reject)=>task.abort.signal.addEventListener('abort',()=>reject(new Error('已取消')),{once:true}))]);
        return this.manager.result(task,{summary:`任务 ${label} 已完成。两个任务同时返回时，按 A 然后 B 的提问顺序播报。`,markdown:`### 同时任务 ${label}\n\n由「释放同时任务」统一放行。`});
      });
      this.enqueueSpeech('message','两个任务已经就绪。点击释放同时任务后，它们会在同一批完成。');return;
    }
    if(/天气/.test(text)){
      const task=this.createTask('北京天气 · 演示数据');this.manager.enqueue(task,async()=>{await wait(850,task.abort.signal);return this.manager.result(task,{summary:'这是一条演示天气：北京晴，二十六摄氏度。真实天气需要在真实模式下联网查询。',markdown:'### 北京天气\n\n| 天气 | 温度 |\n| --- | ---: |\n| 晴 | 26°C |\n\n> 固定演示数据，不代表当前实际天气。',data:{kind:'demo_weather',city:'北京',demo:true}});});return;
    }
    const region=text.match(/华东|华南|华北|西部/)?.[0];
    if(/分析.*利润|利润同比/.test(text)){
      const task=this.createTask(`${region||'华东'}利润同比分析`,text);this.manager.enqueue(task,()=>this.profit(task,region||'华东'));return;
    }
    const collecting=this.pendingClarification?this.tasks.get(this.pendingClarification):undefined;
    if(collecting&&collecting.info.status==='collecting'&&!/切换|切到|放大|筛选/.test(text)){
      collecting.info.sessionId=this.sessionId;collecting.slots||={};
      if(region)collecting.slots.region=region;
      if(/利润/.test(text))collecting.slots.metric='profit';else if(/销售额|收入|营收/.test(text))collecting.slots.metric='revenue';
      await this.clarifySales(collecting);return;
    }
    if(/查看销售数据|查看.*数据|看.*数据/.test(text)){
      const task=this.createTask('查看地区销售数据',text);task.slots={};if(region)task.slots.region=region;
      if(/利润/.test(text))task.slots.metric='profit';else if(/销售额|收入|营收/.test(text))task.slots.metric='revenue';
      await this.clarifySales(task);return;
    }
    const calls:Array<[string,JsonObject]>=[];
    if(region)calls.push(['set_region',{region}]);
    if(/去年|2025/.test(text))calls.push(['set_period',{year:2025}]);else if(/今年|2026/.test(text))calls.push(['set_period',{year:2026}]);
    if(/利润/.test(text))calls.push(['set_metric',{metric:'profit'}]);else if(/销售额|营收/.test(text))calls.push(['set_metric',{metric:'revenue'}]);
    if(/地区分析|地区对比/.test(text))calls.push(['navigate',{view:'regions'}]);else if(/总览|概览/.test(text))calls.push(['navigate',{view:'overview'}]);
    if(/放大/.test(text))calls.push(['focus_chart',{chartId:/对比/.test(text)?'comparison':'trend'}]);
    if(calls.length){
      const task=this.createTask('页面操作',text);this.manager.update(task,'running','正在更新页面');
      try{for(const[name,args]of calls)await this.action(name,args,task.info.taskId);this.manager.complete(task,this.manager.result(task,{summary:'已经按你的要求更新页面。'}));this.send({type:'metrics',name:'page_action_ms',value:Date.now()-this.inputAt,taskId:task.info.taskId});}
      catch(error){this.manager.complete(task,this.manager.result(task,{status:'failed',summary:error instanceof Error?error.message:String(error)}));}return;
    }
    this.enqueueSpeech('question','当前是演示模式。你可以说“查看销售数据”“分析华东利润同比”“查北京天气”，或使用测试面板里的话术。');
  }
  private async clarifySales(task:RuntimeTask){
    if(!task.slots?.region){this.manager.update(task,'collecting','等待地区','你想查看哪个地区？');this.enqueueSpeech('question','你想查看哪个地区？',task.info.taskId);return;}
    if(!task.slots.metric){this.manager.update(task,'collecting','等待指标','要看销售额还是利润？');this.enqueueSpeech('question','要看销售额还是利润？',task.info.taskId);return;}
    this.pendingClarification=undefined;const region=task.slots.region;const metric=task.slots.metric;
    this.manager.enqueue(task,async()=>{
      const rows=await querySql('SELECT region, year, ROUND(SUM(revenue),2) revenue, ROUND(SUM(revenue-cost),2) profit FROM sales WHERE region=? AND year=2026 GROUP BY region,year',[region],task.abort.signal);
      const apply=this.active&&task.info.sessionId===this.sessionId&&JSON.stringify(this.context)===JSON.stringify(task.info.contextAtStart);
      let pageUpdated=false;
      if(apply){
        if(this.actions.some(a=>a.name==='set_region')){await this.action('set_region',{region},task.info.taskId);pageUpdated=true;}
        if(this.actions.some(a=>a.name==='set_metric')){await this.action('set_metric',{metric},task.info.taskId);pageUpdated=true;}
      }
      const value=Number(rows.rows[0]?.[metric]||0);return this.manager.result(task,{summary:`${region}地区 2026 年的${metric==='profit'?'利润':'销售额'}是${(value/10000).toFixed(1)}万元。${pageUpdated?'页面已经更新，':''}明细放在气泡中了。`,markdown:`### ${region} · ${metric==='profit'?'利润':'销售额'}\n\n**${value.toLocaleString('zh-CN')} 元**\n\n统计期间：2026 年；来源：本机 SQLite 示例数据。`,data:{kind:'sales_summary',region,metric,year:2026,rows:rows.rows}});
    });
  }
  dispose(){this.end('manual');for(const pending of this.pendingActions.values()){clearTimeout(pending.timer);pending.reject(new Error('网页连接已断开'));}this.pendingActions.clear();for(const task of this.tasks.values()){task.onUpdate=undefined;task.onResult=undefined;task.prepareDelivery=undefined;}this.release();}
}
