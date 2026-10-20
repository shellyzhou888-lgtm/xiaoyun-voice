import type {VoiceAssistant,VoiceAssistantOptions} from '@xiaoyun/protocol';
import {VoiceController} from './controller';
export type {VoiceAction,VoiceAssistant,VoiceAssistantOptions,VoiceEvent,TaskResult,TaskInfo,JsonObject,ActionDescriptor} from '@xiaoyun/protocol';
export {PROTOCOL_VERSION} from '@xiaoyun/protocol';
export type {Delivery,DeliveryStatus,TaskSource,VoiceUIOptions} from '@xiaoyun/protocol';
export function createVoiceAssistant(options:VoiceAssistantOptions):VoiceAssistant {
  if(typeof window==='undefined')throw new Error('请在浏览器挂载阶段创建小云组件');
  return new VoiceController(options);
}
