import type {Caption,ResultCard,RuntimeMode,TaskInfo,VisualState,VoiceAssistantOptions} from '@xiaoyun/protocol';
export interface WidgetSnapshot {
  visualState:VisualState; micEnabled:boolean; sessionActive:boolean; connected:boolean;
  mode:RuntimeMode; statusText?:string; cards:ResultCard[]; tasks:TaskInfo[];
  caption?:Caption; pendingResultCount:number;
}
export interface WidgetHandlers {
  onToggleSession():void; onToggleMic():void; onSubmitText(text:string):void;
  onPin(taskId:string):void; onClose(taskId:string):void; onCancelTask(taskId:string):void;
  onReplay(taskId:string):void; onStopDelivery(taskId:string):void; onSelectResult(taskId?:string):void;
  onReadingChange(taskId:string,reading:boolean):void; onAcceptResults():void; onRetryTask(taskId:string):void;
  onRetryDelivery(deliveryId:string):void;
}
export type WidgetOptions = Pick<VoiceAssistantOptions,'ui'|'renderResult'>;
export interface WidgetView {
  render(snapshot:WidgetSnapshot):void;
  setAudioLevel(level:number):void;
  destroy():void;
}
