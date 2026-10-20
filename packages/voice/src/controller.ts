import Ajv from 'ajv';
import type {ActionDescriptor,Delivery,JsonObject,ResultCard,ServerMessage,Speech,TaskInfo,TaskResult,VoiceAction,VoiceAssistant,VoiceAssistantOptions,VoiceEvent,VisualState} from '@xiaoyun/protocol';
import {PROTOCOL_VERSION,TERMINAL_TASK_STATUSES} from '@xiaoyun/protocol';
import {AudioEngine} from './audio';
import {VoiceTransport} from './transport';
import {WakeWordDetector} from './wake-word';
import {startBrowserRecognition} from './browser-recognition';
import {createWidgetView} from './ui';
import type {WidgetSnapshot,WidgetView} from './ui-types';

const terminal=(task:TaskInfo)=>TERMINAL_TASK_STATUSES.includes(task.status);
export class VoiceController implements VoiceAssistant {
  private stopRecognition?:()=>void;
  private browserRequest?:AbortController;
  private browserTask?:TaskInfo;
  private host:HTMLElement;
  private view:WidgetView;
  private transport:VoiceTransport;
  private audio:AudioEngine;
  private wakeWord:WakeWordDetector;
  private context:JsonObject;
  private contextVersion=0;
  private actions:VoiceAction[]=[];
  private validators=new Map<string,ReturnType<Ajv['compile']>>();
  private ajv=new Ajv({strict:false,allErrors:false});
  private actionResults=new Map<string,{result?:unknown;error?:string}>();
  private tasks=new Map<string,TaskInfo>();
  private taskResults=new Map<string,TaskResult>();
  private speech?:Speech;
  private discardedSpeech=new Set<string>();
  private sessionId='';
  private firstTaskSeen=false;
  private awaitingTaskId?:string;
  private waitingTimer?:ReturnType<typeof setTimeout>;
  private transitionTimer?:ReturnType<typeof setTimeout>;
  private localSpeaking=false;
  private loudFrames=0;
  private quietFrames=0;
  private inputProcessing=false;
  private lastInputEnded=0;
  private lastVoicedAt=0;private localInputClock=false;
  private inputEndSource='text';
  private speechStartedAt=0;
  private deliveredState?:'happy'|'error';
  private destroyed=false;
  private micRequest?:Promise<void>;
  private wakeRequest?:Promise<void>;
  private sessionRequest?:Promise<void>;
  private lifecycleGeneration=0;
  private micGeneration=0;
  private preconnectionAudio:ArrayBuffer[]=[];
  private hasConnected=false;
  private captionTimer?:ReturnType<typeof setTimeout>;
  private captionPrefix='';private sentenceText='';
  private pendingCards:ResultCard[]=[];private reading=new Set<string>();
  private readingFrame=0;
  private localTurnId='';private cloudTurnId?:string;
  private deliveries=new Map<string,Delivery>();
  private closedDeliveries=new Map<string,string>();private playingDelivery?:string;
  private snapshot:WidgetSnapshot={visualState:'mic_off',micEnabled:false,sessionActive:false,connected:false,mode:'demo',cards:[],tasks:[],pendingResultCount:0};

  constructor(private options:VoiceAssistantOptions) {
    this.context=structuredClone(options.context??{});
    const target=typeof options.container==='string'?document.querySelector(options.container):options.container??document.body;
    if(!(target instanceof HTMLElement))throw new Error('小云挂载容器不存在');
    if(!customElements.get('xiaoyun-voice'))customElements.define('xiaoyun-voice',class extends HTMLElement{});
    this.host=document.createElement('xiaoyun-voice');target.append(this.host);
    const shadow=this.host.attachShadow({mode:'open'});
    this.view=createWidgetView(shadow,{
      onToggleSession:()=>this.snapshot.sessionActive?this.endSession():void this.wake().catch(error=>this.report(error)),
      onToggleMic:()=>void this.setMicEnabled(!this.snapshot.micEnabled).catch(error=>this.report(error)),
      onSubmitText:text=>void this.submitText(text).catch(error=>this.report(error)),
      onPin:id=>this.pinCard(id),onClose:id=>this.closeCard(id),
      onCancelTask:id=>{if(this.options.browserAdapter&&this.browserTask?.taskId===id)this.cancelBrowserRequest();else this.transport.send({type:'task.cancel',taskId:id});},
      onReplay:id=>void this.replayResult(id).catch(error=>this.report(error)),
      onStopDelivery:id=>this.stopDelivery(id),onSelectResult:id=>this.selectResult(id),
      onReadingChange:(id,value)=>{
        if(value)this.reading.add(id);else this.reading.delete(id);
        cancelAnimationFrame(this.readingFrame);this.readingFrame=requestAnimationFrame(()=>{if(!this.reading.size&&!this.destroyed)this.acceptResults();});
      },
      onAcceptResults:()=>this.acceptResults(),onRetryTask:id=>this.retryTask(id),
      onRetryDelivery:id=>void this.retryDelivery(id).catch(error=>this.report(error)),
    },{ui:options.ui,renderResult:options.renderResult});
    const assetRoot=options.assetBaseUrl??new URL('/sdk/assets/',options.backendUrl??'http://127.0.0.1:8765').href;
    const assets=new URL(assetRoot.endsWith('/')?assetRoot:assetRoot+'/',location.href);
    this.audio=new AudioEngine(assets,{
      onPCM:(pcm,rms)=>this.onPCM(pcm,rms),
      onLevel:level=>this.view.setAudioLevel(level),
      onDrained:id=>this.onPlaybackFinished(id),
      onStarted:id=>this.onPlaybackStarted(id),
    });
    this.wakeWord=new WakeWordDetector(assets,()=>{
      if(this.snapshot.micEnabled&&!this.snapshot.sessionActive)void this.startSession(false).catch(error=>this.report(error));
    },(status,error)=>{
      this.emit({type:error?'wakeword.error':'wakeword.ready',message:status});
      if(error){this.snapshot.statusText=status+'；仍可点击或输入文字';this.render();}
    },options.wakeWord);
    this.transport=new VoiceTransport(options.backendUrl??'http://127.0.0.1:8765',message=>this.onMessage(message),connected=>{
      this.snapshot.connected=connected;
      if(!connected)this.snapshot.statusText='正在连接本地服务';
      else {for(const pcm of this.preconnectionAudio)this.transport.audio(pcm);this.preconnectionAudio=[];}
      this.render();this.emit({type:'connection',connected});
    });
    this.setActions(options.actions??[]);
    this.loadPins();
    if(options.browserAdapter){this.snapshot.connected=true;this.snapshot.mode='live';}
    else this.transport.connect({type:'hello',protocolVersion:PROTOCOL_VERSION,clientId:this.clientId(),projectId:options.projectId,context:this.context,contextVersion:this.contextVersion,actions:this.descriptors(),mode:options.mode,autoEndSession:options.autoEndSession??false});
    this.render();
  }
  private emit(event:VoiceEvent) {
    if(this.destroyed)return;
    try {this.options.onEvent?.({at:Date.now(),...event});} catch(error){console.error('小云 onEvent 回调异常',error);}
  }
  private render(){if(!this.destroyed){
    if(!this.reading.size){const keep=new Set(this.snapshot.cards.filter(card=>!card.pinned).slice(-3).map(card=>card.taskId));this.snapshot.cards=this.snapshot.cards.filter(card=>card.pinned||keep.has(card.taskId));}
    this.snapshot.pendingResultCount=this.pendingCards.length;
    this.snapshot.tasks=[...this.tasks.values()];this.view.render({...this.snapshot,cards:[...this.snapshot.cards],tasks:[...this.snapshot.tasks]});
  }}
  private acceptResults(){
    if(!this.pendingCards.length)return;
    const ids=new Set(this.pendingCards.map(c=>c.taskId));
    this.snapshot.cards=[...this.snapshot.cards.filter(c=>!ids.has(c.taskId)),...this.pendingCards];this.pendingCards=[];
    // Explicit acceptance may replace a read card; the view cleans up its reading subscription.
    const keep=new Set(this.snapshot.cards.filter(c=>!c.pinned).slice(-3).map(c=>c.taskId));
    this.snapshot.cards=this.snapshot.cards.filter(c=>c.pinned||keep.has(c.taskId));this.render();
  }
  async replayResult(taskId:string){
    if(!this.snapshot.sessionActive)await this.startSession(true);
    if(this.options.browserAdapter){const result=this.taskResults.get(taskId);if(result)this.speakBrowserResult(result);return;}
    this.transport.send({type:'result.replay',taskId});
  }
  async retryDelivery(deliveryId:string){if(!this.snapshot.sessionActive)await this.startSession(true);this.transport.send({type:'delivery.retry',deliveryId});}
  stopDelivery(taskId:string){
    if(this.speech?.taskId===taskId){this.discardedSpeech.add(this.speech.speechId);this.audio.stop();this.speech=undefined;this.playingDelivery=undefined;this.clearCaption();[...this.snapshot.cards,...this.pendingCards].forEach(c=>c.speaking=false);this.reconcile();}
    this.transport.send({type:'delivery.stop',taskId});
  }
  selectResult(taskId?:string){this.transport.send({type:'result.select',taskId});}
  retryTask(taskId:string){if(this.options.browserAdapter){const task=this.tasks.get(taskId);if(task)void this.submitText(task.title);return;}void this.startSession(true).then(()=>this.transport.send({type:'task.retry',taskId})).catch(error=>this.report(error));}
  private descriptors():ActionDescriptor[]{return this.actions.map(({name,description,parameters})=>({name,description,parameters}));}
  updateContext(context:JsonObject){this.contextVersion++;this.context=structuredClone(context);this.transport.updateHello(this.context,this.descriptors(),this.contextVersion);this.transport.send({type:'context.update',context:this.context,contextVersion:this.contextVersion});}
  setActions(actions:VoiceAction[]){
    const names=new Set<string>();const validators=new Map<string,ReturnType<Ajv['compile']>>();
    for(const action of actions){if(names.has(action.name))throw new Error(`重复的页面动作：${action.name}`);names.add(action.name);validators.set(action.name,this.ajv.compile(action.parameters));}
    this.actions=[...actions];this.validators=validators;
    this.contextVersion++;this.transport?.updateHello(this.context,this.descriptors(),this.contextVersion);
    this.transport?.send({type:'actions.update',actions:this.descriptors(),contextVersion:this.contextVersion});
  }
  async wake(){
    if(this.wakeRequest)return this.wakeRequest;
    this.wakeRequest=(async()=>{await this.setMicEnabled(true);if(this.snapshot.micEnabled&&!this.destroyed)await this.startSession(false);})();
    try{await this.wakeRequest;}finally{this.wakeRequest=undefined;}
  }
  async setMicEnabled(enabled:boolean){
    if(this.destroyed)return;
    if(this.options.browserAdapter){
      if(!enabled){this.stopRecognition?.();this.stopRecognition=undefined;this.snapshot.micEnabled=false;this.endSession();return;}
      if(this.snapshot.micEnabled)return;
      this.stopRecognition=startBrowserRecognition(text=>void this.submitText(text).catch(error=>this.report(error)),text=>{
        this.cancelBrowserRequest();this.interrupt();this.setState('listening');this.emit({type:'input.transcript',text});
      },message=>{this.snapshot.micEnabled=false;this.stopRecognition=undefined;this.report(new Error(message));});
      this.snapshot.micEnabled=true;this.setState('listening');return;
    }
    if(!enabled){this.micGeneration++;this.endSession();this.snapshot.micEnabled=false;this.audio.disableMicrophone();this.wakeWord.destroy();this.setState('mic_off');return;}
    if(this.snapshot.micEnabled)return;
    if(!this.micRequest)this.micRequest=(async()=>{
      const generation=this.micGeneration;
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('麦克风需要 HTTPS 或 localhost 页面');
      await this.audio.enableMicrophone();
      if(this.destroyed||generation!==this.micGeneration)return;
      this.snapshot.micEnabled=true;this.setState('armed');
      void this.wakeWord.prepare().catch(()=>{});
    })();
    try{await this.micRequest;}finally{this.micRequest=undefined;}
  }
  private async startSession(textOnly:boolean){
    if(this.destroyed||this.snapshot.sessionActive)return;
    if(this.options.browserAdapter){this.sessionId=crypto.randomUUID();this.snapshot.sessionActive=true;this.firstTaskSeen=false;this.setState('listening');return;}
    if(this.sessionRequest)return this.sessionRequest;
    const generation=this.lifecycleGeneration;
    this.sessionRequest=(async()=>{
    await this.audio.preparePlayback();
    if(this.destroyed||generation!==this.lifecycleGeneration||this.snapshot.sessionActive)return;
    this.sessionId=crypto.randomUUID();this.firstTaskSeen=false;this.snapshot.sessionActive=true;
    this.inputProcessing=false;this.localSpeaking=false;this.loudFrames=0;this.quietFrames=0;
    this.wakeWord.reset();this.clearWait();
    this.setState(textOnly?'listening':'waking');
    this.transport.send({type:'session.wake',sessionId:this.sessionId});
    this.emit({type:'session.wake',sessionId:this.sessionId,textOnly});
    })();
    try{await this.sessionRequest;}finally{this.sessionRequest=undefined;}
  }
  endSession(){this.stopSession('manual');}
  private stopSession(reason:'manual'|'timeout'|'complete',notify=true){
    if(this.options.browserAdapter){this.cancelBrowserRequest();this.stopRecognition?.();this.stopRecognition=undefined;this.snapshot.micEnabled=false;}
    this.lifecycleGeneration++;
    this.clearWait();clearTimeout(this.transitionTimer);
    this.playingDelivery=undefined;
    if(notify||this.snapshot.caption?.status!=='delivered')this.clearCaption();this.cloudTurnId=undefined;
    if(this.speech)this.discardedSpeech.add(this.speech.speechId);
    this.speech=undefined;this.audio.stop();this.snapshot.sessionActive=false;this.inputProcessing=false;
    this.localSpeaking=false;this.preconnectionAudio=[];
    for(const card of this.snapshot.cards)card.speaking=false;
    this.persistPins();
    if(notify)this.transport.send({type:'session.end',reason});
    const feedback=reason==='complete'?this.deliveredState:undefined;this.deliveredState=undefined;
    this.wakeWord.reset();this.setState(feedback??(this.snapshot.micEnabled?'armed':'mic_off'));
    if(feedback)this.transitionTimer=setTimeout(()=>this.reconcile(),700);
    this.emit({type:'session.end',reason,sessionId:this.sessionId});
  }
  async submitText(text:string){
    text=text.trim();if(!text||this.destroyed)return;
    if(this.options.browserAdapter){await this.submitBrowserText(text);return;}
    const active=this.snapshot.sessionActive;
    if(!active)await this.startSession(true);
    if(this.destroyed||!this.snapshot.sessionActive)return;
    if(this.speech)this.interrupt();
    this.clearWait();this.inputProcessing=true;this.lastInputEnded=performance.now();
    this.localInputClock=false;this.inputEndSource='text';
    if(this.snapshot.caption?.kind==='question')this.awaitingTaskId=undefined;
    this.clearCaption();
    this.setState('thinking');this.transport.send({type:'input.text',text,sessionId:this.sessionId});
    this.emit({type:'input.text',text,sessionId:this.sessionId});
  }
  private cancelBrowserRequest(){
    this.browserRequest?.abort();this.browserRequest=undefined;this.inputProcessing=false;
    if(this.browserTask){this.onTask({...this.browserTask,status:'cancelled',updatedAt:Date.now()});this.browserTask=undefined;}
  }
  private async submitBrowserText(text:string){
    if(text.length>300){this.report(new Error('问题请保持在300字以内。'));return;}
    this.cancelBrowserRequest();
    const request=new AbortController();this.browserRequest=request;
    this.interrupt();await this.startSession(true);
    if(request.signal.aborted||this.destroyed)return;
    const task:TaskInfo={taskId:crypto.randomUUID(),sessionId:this.sessionId,title:text,status:'running',requestOrder:Date.now(),createdAt:Date.now(),updatedAt:Date.now(),contextAtStart:structuredClone(this.context)};
    this.browserTask=task;this.inputProcessing=true;this.onTask(task);this.emit({type:'input.text',text});
    try{
      const value=await this.options.browserAdapter!.submit(text,task.contextAtStart!,request.signal);
      if(request.signal.aborted||this.destroyed)return;
      const result:TaskResult={...value,taskId:task.taskId,sessionId:task.sessionId,projectId:this.options.projectId,status:'succeeded',title:text,requestOrder:task.requestOrder,contextAtStart:task.contextAtStart!};
      this.onTask({...task,status:'succeeded',updatedAt:Date.now()});this.onResult(result);
      if(this.snapshot.micEnabled)this.speakBrowserResult(result);
    }catch(error){
      if(request.signal.aborted||this.destroyed)return;
      const message=error instanceof Error?error.message:'问数服务暂不可用，请重试。';
      this.onTask({...task,status:'failed',updatedAt:Date.now()});
      this.onResult({taskId:task.taskId,sessionId:task.sessionId,projectId:this.options.projectId,status:'failed',title:text,summary:message,requestOrder:task.requestOrder,contextAtStart:task.contextAtStart!});
    }finally{
      if(this.browserRequest===request){this.browserRequest=undefined;this.browserTask=undefined;this.inputProcessing=false;this.reconcile();}
    }
  }
  private speakBrowserResult(result:TaskResult){
    this.interrupt();
    this.onSpeechStart({speechId:crypto.randomUUID(),deliveryId:crypto.randomUUID(),sessionId:this.sessionId,taskId:result.taskId,kind:'result',text:result.summary,provider:'demo',sentenceIndex:0,sentenceCount:1});
  }
  private onPCM(pcm:ArrayBuffer,rms:number){
    if(!this.snapshot.micEnabled)return;
    if(!this.snapshot.sessionActive){this.wakeWord.feed(pcm);return;}
    if(this.snapshot.mode==='live'){
      if(this.snapshot.connected)this.transport.audio(pcm);
      else {this.preconnectionAudio.push(pcm);if(this.preconnectionAudio.length>100)this.preconnectionAudio.shift();}
    }
    // Local onset only shortens barge-in / cancels the wait timer. Qwen decides semantic turns.
    if(rms>0.025){this.loudFrames++;this.quietFrames=0;this.lastVoicedAt=performance.now();}else{this.quietFrames++;this.loudFrames=0;}
    if(!this.localSpeaking&&this.loudFrames>=2){
      this.localSpeaking=true;this.localInputClock=true;this.clearWait();this.inputProcessing=true;this.interrupt();
      this.localTurnId=crypto.randomUUID();this.transport.send({type:'input.started',turnId:this.localTurnId});this.setState('listening');
    }
    if(this.localSpeaking&&this.quietFrames>=5){this.localSpeaking=false;this.lastInputEnded=this.lastVoicedAt;this.inputEndSource='local_pcm';this.transport.send({type:'input.ended',turnId:this.localTurnId});this.emit({type:'input.audio_ended',turnId:this.localTurnId,at:Date.now()-(performance.now()-this.lastVoicedAt),resolutionMs:100});}
    if(!this.speech)this.view.setAudioLevel(rms);
  }
  private interrupt(){
    this.clearWait();
    this.clearCaption();this.playingDelivery=undefined;
    if(this.speech){
      const id=this.speech.speechId;this.discardedSpeech.add(id);
      this.transport.send({type:'speech.interrupt',speechId:id});
      for(const card of this.snapshot.cards)card.speaking=false;
      this.speech=undefined;
    }
    this.audio.stop();this.render();
  }
  private clearCaption(){clearTimeout(this.captionTimer);this.snapshot.caption=undefined;}
  private retainCaption(){
    clearTimeout(this.captionTimer);
    const caption=this.snapshot.caption;
    if(!caption||caption.kind==='question')return;
    this.captionTimer=setTimeout(()=>{if(this.snapshot.caption?.deliveryId===caption.deliveryId){this.snapshot.caption=undefined;this.render();}},10000);
  }
  private onMessage(message:ServerMessage){
    if(this.destroyed)return;
    if(message.type!=='speech.audio')this.emit({...message});
    switch(message.type){
      case 'ready':
        if(this.hasConnected&&this.snapshot.sessionActive)this.transport.send({type:'session.wake',sessionId:this.sessionId});
        this.hasConnected=true;
        this.snapshot.mode=message.mode;
        this.snapshot.statusText=undefined;this.render();break;
      case 'session.started':break;
      case 'session.idle':
        if(message.sessionId!==this.sessionId)break;
        if(!this.localSpeaking&&!this.inputProcessing&&!this.speech)this.stopSession(message.reason==='complete'?'complete':message.reason==='timeout'?'timeout':'manual',false);break;
      case 'state':
        if(this.snapshot.sessionActive&&!this.speech){this.setState(message.state,message.message);}break;
      case 'task.update':this.onTask(message.task);break;
      case 'task.result':this.onResult(message.result);break;
      case 'result.detail':this.taskResults.set(message.result.taskId,message.result);break;
      case 'delivery.update':this.onDelivery(message.delivery);break;
      case 'input.started':
        this.cloudTurnId=message.turnId;
        if(this.snapshot.caption?.kind==='question')this.snapshot.caption=undefined;
        this.clearWait();this.inputProcessing=true;this.interrupt();if(this.snapshot.sessionActive)this.setState('listening');break;
      case 'input.ended':if(!this.localInputClock){this.lastInputEnded=performance.now();this.inputEndSource='cloud_vad';}else{this.lastInputEnded=this.lastVoicedAt;this.inputEndSource='local_pcm';}this.localSpeaking=false;break;
      case 'input.processed':if(!message.turnId||!this.cloudTurnId||this.cloudTurnId===message.turnId){this.cloudTurnId=undefined;this.inputProcessing=false;this.localInputClock=false;this.reconcile();}break;
      case 'speech.start':this.onSpeechStart(message.speech);break;
      case 'speech.text':
        if(this.acceptSpeech(message.speechId)){
          this.updateCaption(message.text,Boolean(message.append));
        }break;
      case 'speech.audio':
        if(this.acceptSpeech(message.speechId))this.audio.enqueue(message.speechId,message.audio);break;
      case 'speech.generated':
        if(this.acceptSpeech(message.speechId)&&this.speech!.provider==='live')this.audio.finish(message.speechId);break;
      case 'speech.cancelled':
        this.discardedSpeech.add(message.speechId);
        if(this.speech?.speechId===message.speechId){this.audio.stop();this.speech=undefined;this.playingDelivery=undefined;if(this.snapshot.caption?.status!=='failed')this.clearCaption();[...this.snapshot.cards,...this.pendingCards].forEach(c=>c.speaking=false);this.reconcile();}break;
      case 'action.request':void this.executeAction(message);break;
      case 'card.control':
        if(message.action==='clear'){
          for(const card of [...this.snapshot.cards,...this.pendingCards]){const delivery=this.deliveries.get(card.taskId);if(delivery)this.closedDeliveries.set(card.taskId,delivery.deliveryId);}
          this.snapshot.cards=[];this.pendingCards=[];this.reading.clear();this.persistPins();this.render();
        }
        else {const id=message.taskId??this.snapshot.cards.at(-1)?.taskId;if(id)message.action==='pin'?this.pinCard(id,true):this.closeCard(id);}break;
      case 'error':this.report(new Error(message.message));break;
    }
  }
  private onTask(task:TaskInfo){
    const isNew=!this.tasks.has(task.taskId);
    if(isNew&&task.sessionId===this.sessionId&&!this.firstTaskSeen){
      this.firstTaskSeen=true;
      if(!this.reading.size)this.snapshot.cards=this.snapshot.cards.filter(c=>c.pinned||c.sessionId===this.sessionId);
    }
    this.tasks.set(task.taskId,task);
    if(this.awaitingTaskId===task.taskId&&task.status!=='collecting'){this.awaitingTaskId=undefined;if(this.snapshot.caption?.kind==='question')this.snapshot.caption=undefined;}
    const card=this.snapshot.cards.find(c=>c.taskId===task.taskId);
    if(card){card.status=task.status;card.title=task.title;}
    this.reconcile();
  }
  private onResult(result:TaskResult){
    let card=[...this.snapshot.cards,...this.pendingCards].find(c=>c.taskId===result.taskId);
    if(!card){
      card={taskId:result.taskId,sessionId:result.sessionId,title:result.title,transcript:result.summary,pinned:false,speaking:false,status:result.status,displayedAt:Date.now()};
      if(this.reading.size)this.pendingCards.push(card);else this.snapshot.cards.push(card);
    }
    Object.assign(card,{result,title:result.title,markdown:result.markdown,artifacts:result.artifacts,status:result.status});
    const delivery=this.deliveries.get(result.taskId);if(delivery)card.delivery=delivery;
    const firstResult=!this.taskResults.has(result.taskId);this.taskResults.set(result.taskId,result);
    if(firstResult){
      try{this.options.onTaskResult?.(result);}catch(error){this.emit({type:'host.error',message:String(error)});}
    }
    this.persistPins();this.render();
  }
  private acceptSpeech(id:string){return this.snapshot.sessionActive&&this.speech?.speechId===id&&!this.discardedSpeech.has(id);}
  private speechCard(){return [...this.snapshot.cards,...this.pendingCards].find(c=>c.taskId===this.speech?.taskId);}
  private onDelivery(delivery:Delivery){
    if(this.playingDelivery===delivery.deliveryId&&['delivered','interrupted','skipped','failed'].includes(delivery.status))this.playingDelivery=undefined;
    if(delivery.kind!=='result'&&delivery.status==='failed'&&(!this.snapshot.caption||this.snapshot.caption.deliveryId===delivery.deliveryId))this.snapshot.caption={deliveryId:delivery.deliveryId,taskId:delivery.taskId,kind:delivery.kind,text:delivery.text||'这次语音回应没有完成。',status:'failed'};
    if(delivery.taskId&&delivery.kind==='result'){
      this.deliveries.set(delivery.taskId,delivery);
      const card=[...this.snapshot.cards,...this.pendingCards].find(c=>c.taskId===delivery.taskId);
      if(card){card.delivery=delivery;if(['delivered','skipped','interrupted','failed'].includes(delivery.status))card.speaking=false;}
    }
    if(this.snapshot.caption?.deliveryId===delivery.deliveryId){
      // Playback callbacks own speaking state. A queued/generating task is never a speaker.
      if(delivery.status==='failed')this.snapshot.caption={...this.snapshot.caption,status:'failed'};
      if(['skipped','interrupted'].includes(delivery.status))this.clearCaption();
    }
    this.persistPins();this.reconcile();
  }
  private updateCaption(text:string,append=false){
    this.sentenceText=append?this.sentenceText+text:text;
    if(this.snapshot.caption)this.snapshot.caption={...this.snapshot.caption,text:this.captionPrefix+this.sentenceText};
    this.render();
  }
  private onSpeechStart(speech:Speech){
    if(!this.snapshot.sessionActive||speech.sessionId!==this.sessionId){this.transport.send({type:'speech.interrupt',speechId:speech.speechId});return;}
    this.clearWait();clearTimeout(this.captionTimer);this.speech=speech;this.speechStartedAt=performance.now();
    if(speech.kind==='question')this.awaitingTaskId=speech.taskId;
    const closed=speech.taskId&&this.closedDeliveries.get(speech.taskId)===speech.deliveryId;
    if(speech.kind==='result'&&speech.taskId&&!this.speechCard()&&!closed){
      const result=this.taskResults.get(speech.taskId);
      if(result){const card:ResultCard={taskId:result.taskId,sessionId:result.sessionId,title:result.title,transcript:'',markdown:result.markdown,result,artifacts:result.artifacts,status:result.status,pinned:false,speaking:true,displayedAt:Date.now(),delivery:this.deliveries.get(result.taskId)};
        if(this.reading.size)this.pendingCards.push(card);else this.snapshot.cards.push(card);
      }
    }
    const continuing=this.snapshot.caption?.deliveryId===speech.deliveryId&&speech.sentenceIndex>0;
    this.captionPrefix=continuing?this.snapshot.caption!.text:'';this.sentenceText='';
    if(!continuing){this.playingDelivery=undefined;[...this.snapshot.cards,...this.pendingCards].forEach(c=>c.speaking=false);}
    this.snapshot.caption={deliveryId:speech.deliveryId,taskId:speech.taskId,kind:speech.kind,text:this.captionPrefix,status:continuing?'playing':'generating'};
    this.setState(continuing?'speaking':'thinking');
    if(speech.provider==='demo')this.audio.playDemo(speech.speechId,speech.text,text=>{if(this.acceptSpeech(speech.speechId))this.updateCaption(text);});
    else {this.audio.start(speech.speechId);void this.audio.preparePlayback().catch(error=>this.report(error));}
  }
  private onPlaybackStarted(id:string){
    if(!this.acceptSpeech(id))return;
    this.playingDelivery=this.speech!.deliveryId;
    if(this.snapshot.caption?.deliveryId===this.playingDelivery)this.snapshot.caption={...this.snapshot.caption,status:'playing'};
    const card=this.speechCard();if(card&&this.speech?.kind==='result')card.speaking=true;
    this.setState('speaking');
    this.transport.send({type:'speech.playing',speechId:id});
    this.emit({type:'playback.started',speechId:id,taskId:this.speech?.taskId,deliveryId:this.speech?.deliveryId});
    if(this.lastInputEnded)this.emit({type:'metrics',name:'end_to_speech_ms',value:performance.now()-this.lastInputEnded,taskId:this.speech?.taskId,inputEndSource:this.inputEndSource});
  }
  private onPlaybackFinished(id:string){
    if(!this.acceptSpeech(id))return;
    const speech=this.speech!;this.speech=undefined;this.audio.stop();
    if(speech.sentenceIndex+1>=speech.sentenceCount){
      this.playingDelivery=undefined;
      [...this.snapshot.cards,...this.pendingCards].forEach(c=>c.speaking=false);
      if(this.snapshot.caption?.deliveryId===speech.deliveryId){this.snapshot.caption={...this.snapshot.caption,status:'delivered'};this.retainCaption();}
    }
    if(speech.kind==='result')this.deliveredState=this.tasks.get(speech.taskId??'')?.status==='failed'?'error':'happy';
    this.persistPins();
    this.transport.send({type:'speech.finished',speechId:id});
    this.emit({type:'playback.finished',speechId:id,taskId:speech.taskId,duration:performance.now()-this.speechStartedAt});
    if(speech.kind==='greeting'||speech.kind==='question'||this.awaitingTaskId)this.startWait();
    this.reconcile();
  }
  private hasRunning(){return [...this.tasks.values()].some(t=>t.status==='queued'||t.status==='running');}
  private startWait(){
    this.clearWait();if(!this.options.autoEndSession||!this.snapshot.sessionActive||this.localSpeaking||this.inputProcessing||this.hasRunning())return;
    this.waitingTimer=setTimeout(()=>{if(!this.speech&&!this.localSpeaking&&!this.inputProcessing&&!this.hasRunning())this.stopSession('timeout');},this.options.waitForSpeechMs??5000);
  }
  private clearWait(){clearTimeout(this.waitingTimer);this.waitingTimer=undefined;}
  private reconcile(){
    if(!this.snapshot.sessionActive){this.setState(this.snapshot.micEnabled?'armed':'mic_off');return;}
    if(this.playingDelivery){this.setState('speaking');return;}
    if(this.speech){this.setState('thinking');return;}
    if(this.hasRunning()){this.clearWait();this.setState('working');return;}
    if(this.inputProcessing){this.setState('thinking');return;}
    this.setState('listening');
    if(this.awaitingTaskId&&!this.waitingTimer)this.startWait();
  }
  private async executeAction(message:Extract<ServerMessage,{type:'action.request'}>){
    const cached=this.actionResults.get(message.callId);
    if(cached){this.transport.send({type:'action.result',callId:message.callId,...cached,context:this.context,contextVersion:this.contextVersion});return;}
    let answer:{result?:unknown;error?:string};
    try{
      if(message.sessionId&&(message.sessionId!==this.sessionId||!this.snapshot.sessionActive))throw new Error('页面动作所属语音会话已结束');
      if(message.expectedContextVersion!==undefined&&message.expectedContextVersion!==this.contextVersion)throw new Error('页面上下文已改变，请重新读取页面状态');
      const action=this.actions.find(a=>a.name===message.name);
      if(!action)throw new Error(`页面未注册动作：${message.name}`);
      if(!this.validators.get(action.name)?.(message.args))throw new Error(`动作参数不符合约定：${message.name}`);
      const result=await action.execute(message.args);answer={result:result??null};
      if(this.lastInputEnded)this.emit({type:'metrics',name:'end_to_action_ms',value:performance.now()-this.lastInputEnded,taskId:message.taskId,inputEndSource:this.inputEndSource});
    }catch(error){answer={error:error instanceof Error?error.message:String(error)};}
    this.actionResults.set(message.callId,answer);this.transport.send({type:'action.result',callId:message.callId,...answer,context:this.context,contextVersion:this.contextVersion});
    this.emit({type:'action.executed',name:message.name,...answer});
  }
  private pinCard(id:string,value?:boolean){const card=[...this.snapshot.cards,...this.pendingCards].find(c=>c.taskId===id);if(card){card.pinned=value??!card.pinned;this.persistPins();this.render();}}
  private closeCard(id:string){
    const delivery=this.deliveries.get(id);if(delivery)this.closedDeliveries.set(id,delivery.deliveryId);
    this.reading.delete(id);this.pendingCards=this.pendingCards.filter(c=>c.taskId!==id);this.snapshot.cards=this.snapshot.cards.filter(c=>c.taskId!==id);this.persistPins();this.render();
  }
  private get storageKey(){return `xiaoyun:${this.options.projectId}:pins`;}
  private clientId(){const key=`xiaoyun:${this.options.projectId}:client`;try{let id=sessionStorage.getItem(key);if(!id){id=crypto.randomUUID();sessionStorage.setItem(key,id);}return id;}catch{return crypto.randomUUID();}}
  private loadPins(){try{const pins=JSON.parse(localStorage.getItem(this.storageKey)??'[]');if(Array.isArray(pins))this.snapshot.cards=pins.filter(p=>p&&typeof p.taskId==='string'&&p.pinned).map(p=>({...p,speaking:false}));}catch{/* Browser storage may be disabled. The session still works. */}}
  private persistPins(){try{localStorage.setItem(this.storageKey,JSON.stringify([...this.snapshot.cards,...this.pendingCards].filter(c=>c.pinned)));}catch{this.emit({type:'storage.error',message:'此浏览器无法保存固定卡片'});}}
  private setState(state:VisualState,message?:string){this.snapshot.visualState=state;this.snapshot.statusText=message;this.render();}
  private report(error:unknown){const message=error instanceof Error?error.message:String(error);this.emit({type:'error',message});this.setState('error',message);clearTimeout(this.transitionTimer);this.transitionTimer=setTimeout(()=>this.reconcile(),900);}
  destroy(){if(this.destroyed)return;this.cancelBrowserRequest();this.stopRecognition?.();this.lifecycleGeneration++;this.micGeneration++;this.clearWait();clearTimeout(this.transitionTimer);clearTimeout(this.captionTimer);cancelAnimationFrame(this.readingFrame);this.transport.destroy();this.audio.destroy();this.wakeWord.destroy();this.destroyed=true;this.view.destroy();this.host.remove();}
}
