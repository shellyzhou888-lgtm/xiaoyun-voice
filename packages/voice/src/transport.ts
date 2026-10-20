import {PROTOCOL_VERSION,type ClientMessage,type ServerMessage} from '@xiaoyun/protocol';
export class VoiceTransport {
  private socket?:WebSocket;
  private closed=false;
  private retry?:ReturnType<typeof setTimeout>;
  private queue:ClientMessage[]=[];
  private hello?:Extract<ClientMessage,{type:'hello'}>;
  private ready=false;
  constructor(private url:string,private onMessage:(message:ServerMessage)=>void,private onConnection:(value:boolean)=>void) {}
  connect(hello:Extract<ClientMessage,{type:'hello'}>) {
    this.hello=hello;this.closed=false;this.open();
  }
  private open() {
    if(this.closed)return;
    this.ready=false;
    const url=new URL('/voice',this.url);url.protocol=url.protocol==='https:'?'wss:':'ws:';
    const socket=new WebSocket(url);socket.binaryType='arraybuffer';this.socket=socket;
    let helloVersion:number|undefined;
    socket.onopen=()=>{helloVersion=this.hello?.contextVersion;socket.send(JSON.stringify(this.hello));};
    socket.onmessage=({data})=>{
      if(typeof data!=='string')return;
      const message=JSON.parse(data) as ServerMessage;
      if(message.type==='error'&&message.code==='protocol_mismatch'){this.closed=true;this.onMessage(message);socket.close();return;}
      if(message.type==='ready'&&message.protocolVersion!==PROTOCOL_VERSION){this.closed=true;this.onMessage({type:'error',code:'protocol_mismatch',message:`组件与后台协议不一致，请同步更新到 ${PROTOCOL_VERSION}。`});socket.close();return;}
      if(message.type==='ready') {
        this.ready=true;
        // The hello already carries configuration. Never replay older queued snapshots over it.
        if(this.hello&&this.hello.contextVersion!==helloVersion){
          socket.send(JSON.stringify({type:'context.update',context:this.hello.context,contextVersion:this.hello.contextVersion}));
          socket.send(JSON.stringify({type:'actions.update',actions:this.hello.actions,contextVersion:this.hello.contextVersion}));
        }
        const pending=this.queue;this.queue=[];
        for(const queued of pending)if(queued.type!=='context.update'&&queued.type!=='actions.update')socket.send(JSON.stringify(queued));
        // Reconnect wake and queued control messages must precede buffered microphone audio.
        this.onMessage(message);this.onConnection(true);return;
      }
      this.onMessage(message);
    };
    socket.onclose=()=>{this.ready=false;this.onConnection(false);if(!this.closed)this.retry=setTimeout(()=>this.open(),1500);};
    socket.onerror=()=>this.onConnection(false);
  }
  updateHello(context:Extract<ClientMessage,{type:'hello'}>['context'],actions:Extract<ClientMessage,{type:'hello'}>['actions'],contextVersion:number) {if(this.hello){this.hello.context=context;this.hello.actions=actions;this.hello.contextVersion=contextVersion;}}
  send(message:ClientMessage) {if(this.ready&&this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify(message));else this.queue.push(message);}
  audio(pcm:ArrayBuffer) {if(this.ready&&this.socket?.readyState===WebSocket.OPEN&&this.socket.bufferedAmount<320000)this.socket.send(pcm);}
  destroy() {this.closed=true;this.ready=false;clearTimeout(this.retry);this.queue=[];this.socket?.close();}
}
