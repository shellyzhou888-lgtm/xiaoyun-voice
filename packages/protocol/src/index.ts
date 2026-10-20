export type JsonObject = Record<string, unknown>;
export const PROTOCOL_VERSION = '1.0.0-beta.1';
export type DeliveryStatus = 'queued'|'generating'|'playing'|'delivered'|'interrupted'|'skipped'|'failed';
export interface TaskSource { title:string; url:string; fetchedAt:string; publishedAt?:string; updatedAt?:string }
export interface Delivery {
  deliveryId:string; taskId?:string; sessionId:string; kind:Speech['kind']; status:DeliveryStatus;
  text:string; sentenceIndex:number; sentenceCount:number; createdAt:number; updatedAt:number;
  reason?:string; speechId?:string;
}
export interface Caption {
  deliveryId:string; taskId?:string; kind:Speech['kind']; text:string; status:DeliveryStatus;
}
export type VisualState = 'armed' | 'mic_off' | 'waking' | 'listening' | 'thinking' | 'working' | 'speaking' | 'happy' | 'error';
export type TaskStatus = 'collecting' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export type RuntimeMode = 'demo' | 'live';
export interface ActionDescriptor { name: string; description: string; parameters: JsonObject }
export interface VoiceAction extends ActionDescriptor { execute(args: JsonObject): unknown | Promise<unknown> }
export interface TaskResult {
  taskId: string; sessionId: string; projectId: string; status: TaskStatus;
  title: string; summary: string; markdown?: string; data?: unknown;
  artifacts?: Array<{type: 'table' | 'markdown'; title?: string; data?: unknown; markdown?: string}>;
  contextAtStart: JsonObject; requestOrder: number;
  sources?:TaskSource[];
}
export interface TaskInfo {
  taskId: string; sessionId: string; title: string; status: TaskStatus;
  requestOrder: number; createdAt: number; updatedAt: number;
  progress?: string; question?: string; contextAtStart: JsonObject;
}
export interface Speech {
  speechId: string; sessionId: string; taskId?: string;
  deliveryId:string; sentenceIndex:number; sentenceCount:number;
  kind: 'greeting' | 'question' | 'result' | 'message' | 'waiting'; text: string; provider: RuntimeMode;
}
export interface ResultCard {
  taskId: string; sessionId: string; title: string; transcript: string;
  markdown?: string; pinned: boolean; speaking: boolean; status: TaskStatus;
  artifacts?: TaskResult['artifacts'];
  result?:TaskResult; delivery?:Delivery; displayedAt?:number;
}
export type ClientMessage =
  | {type:'hello'; protocolVersion:string; projectId:string; clientId:string; context:JsonObject; contextVersion?:number; actions:ActionDescriptor[]; mode?:RuntimeMode; autoEndSession?:boolean}
  | {type:'session.wake'; sessionId:string}
  | {type:'session.end'; reason:'manual'|'timeout'|'complete'}
  | {type:'context.update'; context:JsonObject; contextVersion?:number}
  | {type:'actions.update'; actions:ActionDescriptor[]; contextVersion?:number}
  | {type:'input.text'; text:string; sessionId:string}
  | {type:'input.started'; turnId:string}
  | {type:'input.ended'; turnId:string}
  | {type:'speech.playing'; speechId:string}
  | {type:'speech.finished'; speechId:string}
  | {type:'speech.interrupt'; speechId?:string}
  | {type:'action.result'; callId:string; result?:unknown; error?:string; context?:JsonObject; contextVersion?:number}
  | {type:'task.cancel'; taskId:string}
  | {type:'task.retry'; taskId:string}
  | {type:'result.replay'; taskId:string}
  | {type:'result.select'; taskId?:string}
  | {type:'result.read'; taskId:string}
  | {type:'delivery.stop'; taskId:string; deliveryId?:string}
  | {type:'delivery.retry'; deliveryId:string}
  | {type:'demo.release'};
export type ServerMessage =
  | {type:'ready'; protocolVersion:string; mode:RuntimeMode; voiceReady:boolean; agentReady:boolean; greetingUrl?:string}
  | {type:'session.started'; sessionId:string}
  | {type:'session.idle'; sessionId:string; reason:string}
  | {type:'state'; state:VisualState; message?:string}
  | {type:'task.update'; task:TaskInfo}
  | {type:'task.result'; result:TaskResult}
  | {type:'result.detail'; result:TaskResult}
  | {type:'delivery.update'; delivery:Delivery}
  | {type:'speech.start'; speech:Speech}
  | {type:'speech.text'; speechId:string; text:string; append?:boolean}
  | {type:'speech.audio'; speechId:string; audio:string}
  | {type:'speech.generated'; speechId:string}
  | {type:'speech.cancelled'; speechId:string}
  | {type:'action.request'; callId:string; name:string; args:JsonObject; taskId?:string; expectedContextVersion?:number; sessionId?:string}
  | {type:'input.started'; turnId?:string} | {type:'input.ended'; turnId?:string} | {type:'input.processed'; turnId?:string}
  | {type:'diagnostic'; name:string; at:number; turnId?:string; taskId?:string; deliveryId?:string; speechId?:string; detail?:string}
  | {type:'card.control'; action:'pin'|'close'|'clear'; taskId?:string}
  | {type:'error'; message:string; taskId?:string; deliveryId?:string; code?:string}
  | {type:'metrics'; name:string; value:number; taskId?:string};
export interface VoiceEvent { type:string; [key:string]:unknown }
export interface VoiceUIOptions {
  theme?:'default'|'power-earth';
  baseFontSize?:number;
  position?:{right?:number;bottom?:number};
  shortResultMs?:number; longResultMs?:number;
}
export interface VoiceAssistantOptions {
  /** Host-owned, cancellable text/ browser-speech pipeline. No Qwen or audio upload. */
  browserAdapter?: {
    submit(text:string,context:JsonObject,signal:AbortSignal):Promise<Pick<TaskResult,'summary'|'markdown'|'data'|'sources'>>;
  };
  container?:HTMLElement|string; backendUrl?:string; projectId:string; assetBaseUrl?:string;
  context?:JsonObject; actions?:VoiceAction[]; mode?:RuntimeMode;
  wakeWord?:string;
  /** Default false: stay awake until the user closes the session. */
  autoEndSession?:boolean;
  /** Only applies when autoEndSession is true. */
  waitForSpeechMs?:number;
  ui?:VoiceUIOptions;
  renderResult?:(result:TaskResult,container:HTMLElement)=>void|(()=>void);
  onTaskResult?:(result:TaskResult)=>void;
  onEvent?:(event:VoiceEvent)=>void;
}
export interface VoiceAssistant {
  updateContext(context:JsonObject):void; setActions(actions:VoiceAction[]):void;
  wake():Promise<void>; endSession():void; setMicEnabled(enabled:boolean):Promise<void>;
  submitText(text:string):Promise<void>; destroy():void;
  replayResult(taskId:string):Promise<void>;
  stopDelivery(taskId:string):void;
  selectResult(taskId?:string):void;
  retryTask(taskId:string):void;
  retryDelivery(deliveryId:string):Promise<void>;
}
export const TERMINAL_TASK_STATUSES:TaskStatus[] = ['succeeded','failed','cancelled','interrupted'];
