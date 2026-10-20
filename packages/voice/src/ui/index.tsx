import React,{useCallback,useLayoutEffect,useMemo,useRef,useState,type FormEvent,type CSSProperties} from 'react';
import {createRoot} from 'react-dom/client';
import {Streamdown,type Components} from 'streamdown';
import type {ResultCard,TaskInfo,TaskStatus,VisualState} from '@xiaoyun/protocol';
import type {WidgetHandlers,WidgetOptions,WidgetSnapshot,WidgetView} from '../ui-types';
import {CharacterView} from './character';
import {styles} from './styles';
import {powerEarthTheme} from './power-earth-theme';
import {useDock} from './use-dock';
import {BUBBLE_EXIT_MS,useCardHeight,useCardPresence,useCardLifetime} from './motion';

type IconName = 'close'|'pin'|'mic'|'mic-off'|'keyboard'|'send'|'spark'|'stop'|'replay'|'chevron';
function Icon({name}:{name:IconName}) {
  const paths:Record<IconName,React.ReactNode> = {
    close:<><path d="m6 6 12 12M18 6 6 18"/></>,
    pin:<><path d="m14 3 7 7-3 1-4 4-1 4-4-4-4-4 4-1 4-4zM9 15l-6 6"/></>,
    mic:<><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 10v2a6 6 0 0 0 12 0v-2M12 18v3M9 21h6"/></>,
    'mic-off':<><path d="m3 3 18 18M9 9v3a3 3 0 0 0 5 2M9 5a3 3 0 0 1 6 1v3M6 10v2a6 6 0 0 0 10 4M18 10v2M12 18v3M9 21h6"/></>,
    keyboard:<><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 9h.01M11 9h.01M15 9h2M7 12h.01M11 12h.01M15 12h2M8 15h8"/></>,
    send:<><path d="M12 19V5m-6 6 6-6 6 6"/></>,
    spark:<><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/></>,
    stop:<><rect x="6" y="6" width="12" height="12" rx="3"/></>,
    replay:<><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/><path d="m11 9 5 3-5 3z"/></>,
    chevron:<><path d="m6 9 6 6 6-6"/></>,
  };
  return <svg className="xy-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

const stateLabels:Record<VisualState,string> = {
  armed:'点击，或说「你好小云」',mic_off:'麦克风已关闭 · 点击开启',waking:'在的，你说',
  listening:'我在听…',thinking:'让我想一想',working:'正在帮你处理，可以继续说',speaking:'小云正在说话',happy:'好啦，已经完成',error:'遇到一点问题',
};
const taskLabels:Record<TaskStatus,string> = {collecting:'等待补充',queued:'正在排队',running:'正在处理',succeeded:'已完成',failed:'未完成',cancelled:'已取消',interrupted:'已中断'};
const markdownComponents:Components = {
  a:({node,...props}) => <a {...props} target="_blank" rel="noopener noreferrer"/>,
};
function Markdown({text,streaming=false}:{text:string;streaming?:boolean}) {
  return <Streamdown mode={streaming ? 'streaming':'static'} isAnimating={streaming}
    skipHtml controls={false} linkSafety={{enabled:false}} components={markdownComponents}
    tableMaxHeight={280} codeBlockMaxHeight={250}>{text}</Streamdown>;
}

function artifactTable(data:unknown):{columns:string[];rows:unknown[][]}|null {
  if(Array.isArray(data)) {
    const records=data.filter((row):row is Record<string,unknown> => row!==null && typeof row==='object' && !Array.isArray(row));
    const columns=[...new Set(records.flatMap(row => Object.keys(row)))];
    return {columns,rows:records.map(row => columns.map(column => row[column]))};
  }
  if(data && typeof data==='object' && 'columns' in data && 'rows' in data &&
    Array.isArray(data.columns) && data.columns.every(column => typeof column==='string') &&
    Array.isArray(data.rows) && data.rows.every(Array.isArray)) {
    return {columns:data.columns,rows:data.rows};
  }
  return null;
}
function cellText(value:unknown):string {
  if(value==null)return '—';
  return typeof value==='object' ? JSON.stringify(value) : String(value);
}
const normalizedMarkdown=(text:string|undefined) => (text || '').replace(/\r\n/g,'\n').trim();

function sourceTime(value:string):string {
  const date=new Date(value);
  return Number.isNaN(date.getTime())?value:date.toLocaleString('zh-CN',{hour12:false});
}
function ResultDetails({card,renderer}:{card:ResultCard;renderer?:WidgetOptions['renderResult']}) {
  const result=card.result;
  const custom=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    if(!result||!renderer||!custom.current)return;
    const target=custom.current;
    const dispose=renderer(result,target);
    return ()=>{dispose?.();target.replaceChildren();};
  },[result,renderer]);
  if(result&&renderer)return <div className="xy-custom-result" ref={custom}/>;
  const markdown=result?.markdown||card.markdown;
  const seenMarkdown=new Set([normalizedMarkdown(result?.summary),normalizedMarkdown(markdown)]);
  return <>
    {markdown&&<div className="xy-markdown"><Markdown text={markdown}/></div>}
    {(result?.artifacts||card.artifacts||[]).map((artifact,index)=>{
      if(artifact.type==='markdown') {
        const text=normalizedMarkdown(artifact.markdown);
        if(!text||seenMarkdown.has(text))return null;
        seenMarkdown.add(text);
        return <section className="xy-attachment" key={index} aria-label={artifact.title||'详细结果'}>
          {artifact.title&&<div className="xy-attachment-label">{artifact.title}</div>}
          <div className="xy-markdown"><Markdown text={text}/></div>
        </section>;
      }
      const table=artifactTable(artifact.data);
      if(!table)return null;
      return <section className="xy-attachment" key={index} aria-label={artifact.title||'结果表格'}>
        {artifact.title&&<div className="xy-attachment-label">{artifact.title}</div>}
        {table.rows.length>0?<div className="xy-markdown xy-artifact-table" tabIndex={0} role="region" aria-label={`${artifact.title||'结果表格'}，可横向滚动`}>
          <table><thead><tr>{table.columns.map((column,columnIndex)=><th scope="col" key={columnIndex}>{column}</th>)}</tr></thead>
            <tbody>{table.rows.map((row,rowIndex)=><tr key={rowIndex}>{table.columns.map((_,columnIndex)=><td key={columnIndex}>{cellText(row[columnIndex])}</td>)}</tr>)}</tbody>
          </table></div>:<p className="xy-artifact-empty">暂无数据</p>}
      </section>;
    })}
    {!!result?.sources?.length&&<section className="xy-sources" aria-label="查询来源">
      <h4>查询来源</h4>
      <ol>{result.sources.map((source,index)=><li key={`${source.url}:${index}`}>
        {/^https?:\/\//i.test(source.url)?<a href={source.url} target="_blank" rel="noopener noreferrer">{source.title||source.url}</a>:<span>{source.title||source.url}</span>}
        {source.publishedAt&&<span>发布于 {sourceTime(source.publishedAt)}</span>}
        {source.updatedAt&&<span>更新于 {sourceTime(source.updatedAt)}</span>}
        <span>查询于 {sourceTime(source.fetchedAt)}</span>
      </li>)}</ol>
    </section>}
  </>;
}

function Card({card,handlers,options,exiting,onExit,captionTaskId}:{card:ResultCard;handlers:WidgetHandlers;options:WidgetOptions;exiting:boolean;onExit:(id:string)=>void;captionTaskId?:string}) {
  const [hovered,setHovered]=useState(false);
  const [focused,setFocused]=useState(false);
  const [expanded,setExpanded]=useState(false);
  const reading=!exiting&&(hovered||focused||expanded);
  useCardLifetime(card,exiting||reading,handlers.onClose,options.ui);
  const {frame,content}=useCardHeight();
  useLayoutEffect(()=>{
    if(reading)handlers.onReadingChange(card.taskId,true);
    return ()=>{if(reading)handlers.onReadingChange(card.taskId,false);};
  },[reading,card.taskId,handlers]);
  useLayoutEffect(()=>{
    if(!exiting)return;
    const timer=setTimeout(()=>onExit(card.taskId),BUBBLE_EXIT_MS);
    return ()=>clearTimeout(timer);
  },[exiting,onExit,card.taskId]);
  const summary=card.result?.summary||card.transcript;
  const captionOwnsSummary=captionTaskId===card.taskId;
  const hasDetails=!!(card.result?.markdown||card.markdown||(card.result?.artifacts||card.artifacts)?.length||card.result?.sources?.length||(card.result&&options.renderResult));
  const pending=!!card.delivery&&['queued','generating','playing'].includes(card.delivery.status);
  const failedSpeech=card.delivery?.status==='failed';
  const interrupted=card.delivery?.status==='interrupted';
  const failedTask=card.status==='failed'||card.status==='interrupted';
  const selected=()=>handlers.onSelectResult(card.taskId);
  return <div className="xy-card-slot" data-task-id={card.taskId} data-delivery-id={card.delivery?.deliveryId} data-speaking={card.speaking} data-exiting={exiting} aria-hidden={exiting||undefined} inert={exiting||undefined}>
    {exiting&&<div className="xy-bubble-pop" aria-hidden="true">{[
      ['10%','20%',-14,-14],['45%','0%',-3,-20],['85%','12%',15,-16],
      ['100%','65%',20,4],['70%','100%',10,17],['5%','80%',-15,13],
    ].map(([x,y,dx,dy],i)=><i key={i} style={{'--px':x,'--py':y,'--dx':`${dx}px`,'--dy':`${dy}px`,'--delay':`${i*12}ms`} as CSSProperties}/>)}</div>}
    <article ref={frame} className="xy-card" data-speaking={card.speaking} data-pinned={card.pinned} data-expanded={expanded} aria-label={card.title||'小云的回复'}
      onPointerEnter={event=>{if(event.pointerType!=='touch')setHovered(true);}} onPointerLeave={()=>setHovered(false)}
      onClick={event=>{if(!(event.target as Element).closest('button,a'))selected();}}
      onFocusCapture={event=>setFocused((event.target as Element).matches(':focus-visible'))} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setFocused(false);}}>
      <div ref={content} className="xy-card-content">
        <header className="xy-card-head">
          <span className="xy-card-mark"><Icon name={card.pinned?'pin':'spark'}/></span>
          <h3 title={card.title}>{card.title||'小云'}</h3>
          <div className="xy-actions">
            <button type="button" className="xy-icon-button" aria-label={card.pinned?'取消固定结果':'固定结果'} title={card.pinned?'取消固定':'固定这张卡片'} aria-pressed={card.pinned} onClick={()=>handlers.onPin(card.taskId)}><Icon name="pin"/></button>
            <button type="button" className="xy-icon-button" aria-label={`关闭${card.title||'回复'}卡片`} title="关闭卡片" onClick={()=>handlers.onClose(card.taskId)}><Icon name="close"/></button>
          </div>
        </header>
        {!captionOwnsSummary&&<div className="xy-transcript xy-markdown"><Markdown text={summary||taskLabels[card.status]}/></div>}
        {captionOwnsSummary&&<div className="xy-delivery-note">{card.speaking?'正在介绍这份资料':'完整内容保存在这里'}</div>}
        {!card.speaking&&pending&&<div className="xy-delivery-note">{card.delivery?.status==='generating'?'正在准备声音':'稍后讲给你听'}</div>}
        {failedSpeech&&<div className="xy-delivery-error" role="status">声音没有顺利播放，结果已保留。{card.delivery?.reason&&<span>{card.delivery.reason}</span>}</div>}
        {!pending&&interrupted&&<div className="xy-delivery-note">刚才的结果留在这里，可以再听一次。</div>}
        <footer className="xy-card-tools">
          {hasDetails&&<button type="button" className="xy-text-button xy-details-toggle" aria-expanded={expanded} onClick={()=>{setExpanded(!expanded);selected();}}><span>{expanded?'收起详情':'查看详情'}</span><Icon name="chevron"/></button>}
          <span className="xy-tools-spacer"/>
          {failedTask&&<button type="button" className="xy-text-button" onClick={()=>handlers.onRetryTask(card.taskId)}>重试任务</button>}
          {pending||card.speaking?<button type="button" className="xy-text-button" aria-label={`停止播报：${card.title}`} onClick={()=>handlers.onStopDelivery(card.taskId)}><Icon name="stop"/><span>{card.speaking?'停止播报':'取消播报'}</span></button>:
            <button type="button" className="xy-text-button" aria-label={`重播：${card.title}`} onClick={()=>handlers.onReplay(card.taskId)}><Icon name="replay"/><span>{failedSpeech?'重试播报':'再听一次'}</span></button>}
        </footer>
        {expanded&&<div className="xy-details" tabIndex={0} role="region" aria-label={`${card.title}详细结果`}><ResultDetails card={card} renderer={options.renderResult}/></div>}
      </div>
    </article>
  </div>;
}

function taskProgress(task:TaskInfo):string {
  if(task.status==='collecting')return task.question||taskLabels.collecting;
  if(task.status==='queued')return taskLabels.queued;
  const progress=task.progress||'';
  if(/sql|数据库|查询数据/i.test(progress))return '正在查询数据';
  if(/python|计算|运算/i.test(progress))return '正在计算';
  if(/web_search|搜索|检索/i.test(progress))return '正在查找资料';
  if(/web_read|网页|读取/i.test(progress))return '正在核对资料';
  if(/summary|deliver|总结|整理/i.test(progress))return '正在整理结果';
  return taskLabels[task.status];
}

function Widget({snapshot,handlers,options,onCharacter}:{snapshot:WidgetSnapshot;handlers:WidgetHandlers;options:WidgetOptions;onCharacter:(view:CharacterView|null)=>void}) {
  const [textOpen,setTextOpen] = useState(false);
  const [text,setText] = useState('');
  const [hovered,setHovered]=useState(false);
  const [tasksExpanded,setTasksExpanded]=useState(false);
  const [caption,setCaption]=useState(snapshot.caption);
  const [captionLeaving,setCaptionLeaving]=useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const halo = useRef<HTMLSpanElement>(null);
  const character = useRef<CharacterView|null>(null);
  const input = useRef<HTMLInputElement>(null);
  const cards = useRef<HTMLDivElement>(null);
  const cardsInner = useRef<HTMLDivElement>(null);
  const followingCards = useRef(true);
  const readingCards=useRef(new Set<string>());
  const {present,remove}=useCardPresence(snapshot.cards);
  const dock=useDock(handlers.onToggleSession,options.ui?.position);
  const onReadingChange=useCallback((taskId:string,reading:boolean)=>{
    if(reading){
      readingCards.current.add(taskId);followingCards.current=false;
    }else{
      readingCards.current.delete(taskId);
    }
    handlers.onReadingChange(taskId,reading);
  },[handlers]);
  const cardHandlers=useMemo(()=>({...handlers,onReadingChange}),[handlers,onReadingChange]);
  useLayoutEffect(() => {
    const view=new CharacterView(svg.current!,halo.current!);
    character.current=view; onCharacter(view);
    return () => { onCharacter(null); character.current=null; view.destroy(); };
  },[onCharacter]);
  useLayoutEffect(() => { character.current?.update(snapshot.visualState); },[snapshot.visualState]);
  useLayoutEffect(() => { character.current?.setMicEnabled(snapshot.micEnabled); },[snapshot.micEnabled]);
  useLayoutEffect(() => { character.current?.setHovered(hovered&&!dock.dragging); },[hovered,dock.dragging]);
  useLayoutEffect(() => { if(textOpen) input.current?.focus(); },[textOpen]);
  useLayoutEffect(()=>{
    if(snapshot.caption){setCaption(snapshot.caption);setCaptionLeaving(false);return;}
    setCaptionLeaving(true);
    const timer=setTimeout(()=>setCaption(undefined),BUBBLE_EXIT_MS);
    return ()=>clearTimeout(timer);
  },[snapshot.caption]);
  useLayoutEffect(()=>{
    const observer=new ResizeObserver(()=>{if(cards.current&&followingCards.current&&!readingCards.current.size)cards.current.scrollTop=dock.panelsBelow?0:cards.current.scrollHeight;});
    observer.observe(cardsInner.current!);return ()=>observer.disconnect();
  },[dock.panelsBelow]);
  useLayoutEffect(() => {
    if(cards.current&&followingCards.current&&!readingCards.current.size)cards.current.scrollTop=dock.panelsBelow?0:cards.current.scrollHeight;
  },[snapshot.cards,dock.panelsBelow]);
  function submit(event:FormEvent) {
    event.preventDefault(); const value=text.trim(); if(!value) return;
    handlers.onSubmitText(value); setText('');
  }
  const activeTasks = snapshot.tasks.filter(task => ['collecting','queued','running'].includes(task.status));
  const currentStatus = snapshot.statusText || (!snapshot.connected ? '正在连接本地服务…':snapshot.visualState==='listening'&&!snapshot.micEnabled?'可以继续输入 · 开麦后可说话':stateLabels[snapshot.visualState]);
  const showCaption=caption&&(caption.text||caption.status==='playing'||caption.status==='failed')&&(caption.status!=='generating'||snapshot.mode==='demo');
  const captionActive=!!showCaption&&!captionLeaving&&snapshot.caption?.deliveryId===caption?.deliveryId&&snapshot.caption.status==='playing';
  return <section ref={dock.widget} className="xy-widget" style={{'--xy-font-size':`${options.ui?.baseFontSize??14}px`} as CSSProperties} data-state={snapshot.visualState} data-mic-enabled={snapshot.micEnabled} data-dragging={dock.dragging} aria-label="小云语音助手">
    <div className="xy-panels">
    <div className="xy-cards" ref={cards} onScroll={() => {
      const el=cards.current;if(el)followingCards.current=dock.panelsBelow?el.scrollTop<45:el.scrollHeight-el.scrollTop-el.clientHeight<45;
    }}><div className="xy-cards-inner" ref={cardsInner}>{present.map(({card,exiting})=><Card key={card.taskId} card={card} handlers={cardHandlers} options={options} exiting={exiting} onExit={remove} captionTaskId={showCaption?caption.taskId:undefined}/>)}</div></div>
    <div className="xy-live-area"><div className="xy-live-inner"><div className="xy-live-meta">
    {activeTasks.length>0&&<section className="xy-task-group" aria-label="进行中的任务">
      <button type="button" className="xy-task-toggle" aria-expanded={tasksExpanded} onClick={()=>setTasksExpanded(!tasksExpanded)}><span className="xy-task-dot"/><span>{activeTasks.length===1?taskProgress(activeTasks[0]):`${activeTasks.length} 个任务正在处理`}</span><Icon name="chevron"/></button>
      {tasksExpanded&&<div className="xy-task-list">{activeTasks.map(task=><div className="xy-task" key={task.taskId}>
        <div className="xy-task-body"><div className="xy-task-title">{task.title}</div><div className="xy-task-progress">{taskProgress(task)}</div></div>
        <button type="button" className="xy-icon-button" aria-label={`取消任务：${task.title}`} title="取消这个任务" onClick={()=>handlers.onCancelTask(task.taskId)}><Icon name="stop"/></button>
      </div>)}</div>}
    </section>}
    {snapshot.pendingResultCount>0&&<button type="button" className="xy-new-results" onClick={()=>{followingCards.current=true;handlers.onAcceptResults();}}><span className="xy-task-dot"/>有 {snapshot.pendingResultCount} 条新结果<Icon name="chevron"/></button>}
    </div>
    {showCaption&&<div className="xy-caption-shell" key={caption.deliveryId} data-delivery-id={caption.deliveryId} data-leaving={captionLeaving} data-active={captionActive}>
      <svg className="xy-caption-tail" viewBox="0 0 48 30" aria-hidden="true"><path d="M0 0H34C31 10 37 21 47 27C27 28 10 19 7 0Z"/></svg>
      <div className="xy-caption" data-kind={caption.kind} data-failed={caption.status==='failed'} role="status" aria-live="polite">
      <div className="xy-caption-body"><div className="xy-markdown"><Markdown text={caption.text||(caption.status==='failed'?'这次语音回应没有完成。':'…')} streaming={captionActive}/></div>
        {caption.status==='failed'&&<button type="button" className="xy-text-button xy-caption-retry" onClick={()=>handlers.onRetryDelivery(caption.deliveryId)}><Icon name="replay"/><span>重试回应</span></button>}
      </div></div>
    </div>}
    </div></div>
    {textOpen && <form className="xy-composer" onSubmit={submit}>
      <div className="xy-composer-label"><span>也可以打字告诉小云</span><button type="button" className="xy-icon-button" aria-label="关闭文字输入" onClick={() => setTextOpen(false)}><Icon name="close"/></button></div>
      <div className="xy-composer-row"><input ref={input} value={text} onChange={event => setText(event.target.value)} placeholder="告诉小云你想做什么…" aria-label="给小云发送文字指令" autoComplete="off"/><button type="submit" className="xy-send" disabled={!text.trim()} aria-label="发送指令"><Icon name="send"/></button></div>
      <p className="xy-composer-note">Enter 发送 · 正在进行的任务会继续处理</p>
    </form>}
    </div>
    <div className="xy-dock" data-touch-controls={dock.touchControls}>
      <div className="xy-dock-meta">
        {(snapshot.visualState!=='speaking'||snapshot.statusText||!snapshot.connected)&&<div className="xy-status" role="status" data-error={snapshot.visualState==='error'}>{snapshot.mode==='demo' && <span className="xy-mode">演示</span>}{currentStatus}</div>}
        <div className="xy-dock-controls" role="group" aria-label="小云输入工具">
          <button type="button" className="xy-pill" aria-label={snapshot.micEnabled ? '关闭麦克风和语音唤醒':'开启麦克风和语音唤醒'} title={snapshot.micEnabled ? '关闭麦克风':'开启麦克风'} aria-pressed={snapshot.micEnabled} onClick={handlers.onToggleMic}><Icon name={snapshot.micEnabled ? 'mic':'mic-off'}/><span className="xy-tool-label">麦克风</span></button>
          <button type="button" className="xy-pill" aria-label="文字输入" aria-pressed={textOpen} onClick={() => setTextOpen(!textOpen)}><Icon name="keyboard"/><span className="xy-tool-label">打字</span></button>
        </div>
      </div>
      <button type="button" className="xy-character-button" aria-label={snapshot.sessionActive ? '结束与小云的对话':'唤醒小云'} aria-pressed={snapshot.sessionActive}
        onPointerEnter={event=>{if(event.pointerType!=='touch')setHovered(true);}} onPointerLeave={()=>setHovered(false)}
        onPointerDown={dock.onPointerDown} onPointerMove={dock.onPointerMove} onPointerUp={dock.onPointerUp} onPointerCancel={dock.onPointerCancel} onClick={dock.onClick}
        title={snapshot.sessionActive ? '点击结束对话 · 按住拖动':'点击和小云说话 · 按住拖动'}>
        <span className="xy-character-halo" ref={halo} data-state={snapshot.visualState}/>
        <svg ref={svg} className="xy-character-svg" aria-hidden="true"/>
        <span className="xy-connection-dot" data-connected={snapshot.connected} aria-hidden="true"/>
      </button>
    </div>
  </section>;
}

export function createWidgetView(root:ShadowRoot,handlers:WidgetHandlers,options:WidgetOptions={}):WidgetView {
  const style=document.createElement('style'); style.textContent=styles+(options.ui?.theme==='power-earth'?powerEarthTheme:'');
  const mount=document.createElement('div'); root.append(style,mount);
  const reactRoot=createRoot(mount);
  let character:CharacterView|null=null;
  let disposed=false;
  const setCharacter=(view:CharacterView|null) => { character=view; };
  return {
    render(snapshot) { if(!disposed) reactRoot.render(<Widget snapshot={snapshot} handlers={handlers} options={options} onCharacter={setCharacter}/>); },
    setAudioLevel(level) { character?.setAudioLevel(level); },
    destroy() { if(disposed) return; disposed=true; reactRoot.unmount(); mount.remove(); style.remove(); },
  };
}
