type Recognition = {
  lang:string; continuous:boolean; interimResults:boolean;
  onresult:((event:{resultIndex:number;results:ArrayLike<{isFinal:boolean;0?:{transcript:string}}>})=>void)|null;
  onerror:((event:{error:string})=>void)|null; onend:(()=>void)|null;
  start():void; abort():void;
};

/** Every callback is guarded by lifetime; late browser events cannot submit after close. */
export function startBrowserRecognition(onText:(text:string)=>void,onInterim:(text:string)=>void,onError:(message:string)=>void) {
  const speechWindow=window as typeof window & {SpeechRecognition?:new()=>Recognition;webkitSpeechRecognition?:new()=>Recognition};
  const Constructor=speechWindow.SpeechRecognition??speechWindow.webkitSpeechRecognition;
  if(!Constructor)throw new Error('当前浏览器不支持语音识别，请点击键盘使用文字问数。');
  let active=true;let timer:ReturnType<typeof setTimeout>|undefined;
  const recognition=new Constructor();
  recognition.lang='zh-CN';recognition.continuous=true;recognition.interimResults=true;
  const stop=()=>{active=false;clearTimeout(timer);recognition.onresult=null;recognition.onerror=null;recognition.onend=null;recognition.abort();};
  recognition.onresult=event=>{
    if(!active)return;
    let final='';let interim='';
    for(let i=event.resultIndex;i<event.results.length;i++){
      const result=event.results[i];const text=result?.[0]?.transcript??'';
      if(result.isFinal)final+=text;else interim+=text;
    }
    if(interim.trim()||final.trim())onInterim(interim.trim()||final.trim());
    if(final.trim())onText(final.trim());
  };
  recognition.onerror=event=>{
    if(!active||event.error==='aborted')return;
    if(event.error==='no-speech')return;
    stop();
    onError(event.error==='not-allowed'||event.error==='service-not-allowed'?'麦克风权限未获允许，请授权后重试。':event.error==='audio-capture'?'未找到可用麦克风。':'浏览器语音服务不可用，请重试或使用文字问数。');
  };
  recognition.onend=()=>{if(active)timer=setTimeout(()=>{if(active)try{recognition.start();}catch{stop();onError('语音识别已停止，请重新开启麦克风。');}},400);};
  try{recognition.start();}catch(error){stop();throw error;}
  return stop;
}
