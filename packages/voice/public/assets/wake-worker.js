/* Local-only sherpa-onnx KWS worker. See kws/SOURCES.md for model/runtime provenance. */
let kws = null;
let stream = null;
let initializing = false;
let failed = false;
let activePhrase = '';
let samples = new Float32Array(1600);
let lastWakeAt = -Infinity;

function reportError(error) {
  if (failed) return;
  failed = true;
  self.postMessage({type:'error',message:`本地唤醒初始化或检测失败：${error?.message || String(error)}`});
}
self.addEventListener('unhandledrejection',event => {
  event.preventDefault();
  reportError(event.reason);
});

async function initialize({baseUrl,phrase = '你好小云'}) {
  if (initializing || kws) return;
  initializing = true;
  const base = new URL(baseUrl);
  const response = await fetch(new URL('keywords.json',base));
  if (!response.ok) throw new Error(`无法读取本地关键词配置 (${response.status})`);
  const settings = await response.json();
  const phonemes = settings.phrases?.[phrase];
  if (!phonemes) throw new Error(`未配置唤醒词「${phrase}」，请运行 setup-wake-assets.py --phrase 添加`);
  activePhrase = phrase;
  const keywordLine = `${phonemes} @${phrase.replace(/\s/g,'_')}\n`;
  self.Module = {
    locateFile:name => new URL(name,base).href,
    print:() => {},
    printErr:message => console.warn('[小云本地唤醒]',message),
    onAbort:reason => reportError(new Error(`WASM ${reason}`)),
    onRuntimeInitialized() {
      try {
        kws = createKws(self.Module,{
          featConfig:{samplingRate:16000,featureDim:80},
          modelConfig:{
            transducer:{encoder:'./encoder.onnx',decoder:'./decoder.onnx',joiner:'./joiner.onnx'},
            tokens:'./tokens.txt',provider:'cpu',modelType:'zipformer2',
            numThreads:1,debug:0,modelingUnit:'cjkchar',bpeVocab:'',
          },
          maxActivePaths:4,numTrailingBlanks:1,
          keywordsScore:settings.score ?? 1.5,
          keywordsThreshold:settings.threshold ?? 0.25,
          keywords:'',keywordsBuf:keywordLine,
          keywordsBufSize:new TextEncoder().encode(keywordLine).length,
        });
        if (!kws.handle) throw new Error('无法创建 KeywordSpotter');
        stream = kws.createStream();
        if (!stream.handle) throw new Error('无法创建音频检测流');
        self.postMessage({type:'ready'});
      } catch(error) { reportError(error); }
    },
  };
  importScripts(new URL('sherpa-onnx-kws.js',base).href);
  importScripts(new URL('sherpa-onnx-wasm-kws-main.js',base).href);
}

self.onmessage = ({data}) => {
  if (failed) return;
  if (data.type === 'init') {
    initialize(data).catch(reportError);
    return;
  }
  if (!kws || !stream) return;
  try {
    if (data.type === 'reset') {
      kws.reset(stream);
      return;
    }
    if (data.type !== 'audio') return;
    const pcm = new Int16Array(data.pcm);
    if (samples.length !== pcm.length) samples = new Float32Array(pcm.length);
    for (let i=0;i<pcm.length;i++) samples[i]=pcm[i]/32768;
    stream.acceptWaveform(16000,samples);
    while(kws.isReady(stream)) {
      kws.decode(stream);
      const result = kws.getResult(stream);
      if(result.keyword) {
        kws.reset(stream);
        const now=performance.now();
        if(now-lastWakeAt>1200) {
          lastWakeAt=now;
          self.postMessage({type:'wake',keyword:activePhrase});
        }
      }
    }
  } catch(error) { reportError(error); }
};
