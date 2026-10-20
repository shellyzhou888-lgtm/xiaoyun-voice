import {appendFile} from 'node:fs/promises';
import path from 'node:path';
import {config} from './config.ts';

let writes=Promise.resolve();

/** Keep task routing evidence locally, without PCM, model reasoning or connection headers. */
export function recordVoiceEvent(sessionId:string,direction:'send'|'receive',event:Record<string,unknown>){
  const value=event as any;
  let detail:Record<string,unknown>|undefined;
  if(value.type==='diagnostic'){
    detail={type:value.name,turnId:value.turnId,taskId:value.taskId,deliveryId:value.deliveryId,speechId:value.speechId,detail:value.detail};
  }else if(value.type==='speech.output'){
    detail={type:value.type,speechId:value.speechId,deliveryId:value.deliveryId,taskId:value.taskId,kind:value.kind,expectedText:value.expectedText,text:value.text};
  }else if(value.type==='session.update'||value.type==='session.updated'){
    detail={type:value.type,tools:(value.session?.tools||[]).map((tool:any)=>tool.function?.name||tool.name)};
  }else if(value.type==='response.done'){
    detail={type:value.type,responseId:value.response.id,status:value.response.status,calls:(value.response.output||[])
      .filter((item:any)=>item.type==='function_call').map((item:any)=>({callId:item.call_id,name:item.name,arguments:item.arguments}))};
  }else if(direction==='send'&&value.type==='conversation.item.create'&&value.item?.type==='function_call_output'){
    const output=JSON.parse(value.item.output);
    detail={type:'tool.returned',callId:value.item.call_id,taskId:output?.taskId,status:output?.status,question:output?.question,error:output?.error};
  }else if(value.type==='input_audio_buffer.speech_started'||value.type==='input_audio_buffer.speech_stopped'){
    detail={type:value.type,itemId:value.item_id,reason:value.reason};
  }else if(value.type==='conversation.item.input_audio_transcription.completed'){
    detail={type:value.type,itemId:value.item_id,text:value.transcript};
  }
  if(!detail)return;
  const now=new Date();
  const record=JSON.stringify({at:now.toISOString(),sessionId,direction,userTurn:value.userTurn,...detail})+'\n';
  // The daily file lives alongside task records; it is excluded from Git and release archives.
  writes=writes.then(()=>appendFile(path.join(config.dataDir,`voice-events-${now.toISOString().slice(0,10)}.jsonl`),record,'utf8'))
    .catch(error=>console.error('Voice event log:',error.message));
}
