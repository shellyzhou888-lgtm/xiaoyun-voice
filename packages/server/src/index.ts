import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile,stat} from 'node:fs/promises';
import {WebSocketServer} from 'ws';
import {config,health,ROOT} from './config.ts';
import {initializeData,querySql,closeExecution} from './execution.ts';
import {loadProjects} from './project.ts';
import {TaskManager} from './task-manager.ts';
import {VoiceSession} from './session.ts';
import type {ClientMessage} from '../../protocol/src/index.ts';

const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.onnx':'application/octet-stream','.wav':'audio/wav','.ttf':'font/ttf','.woff2':'font/woff2'};
function originAllowed(origin:string|undefined){
  if(!origin)return true;if(config.origins.includes(origin))return true;
  try{const url=new URL(origin);return ['localhost','127.0.0.1','[::1]'].includes(url.hostname);}catch{return false;}
}
export async function startServer(){
  await initializeData();const projects=await loadProjects();const manager=new TaskManager();
  const server=http.createServer(async(req,res)=>{
    const origin=req.headers.origin;if(!originAllowed(origin)){res.writeHead(403);res.end('Origin is not allowed');return;}
    if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
    res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
    if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
    const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
    const json=(data:unknown,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    try{
      if(url.pathname==='/api/health'){json(health());return;}
      if(url.pathname==='/api/demo/sales'&&config.enableDemo){
        const region=url.searchParams.get('region')||'all';const year=Number(url.searchParams.get('year')||2026);
        if(![2025,2026].includes(year)){json({error:'year 必须为 2025 或 2026'},400);return;}
        const result=await querySql(`SELECT region,year,month,product,revenue,cost FROM sales WHERE year=?${region==='all'?'':' AND region=?'} ORDER BY month,region,product`,region==='all'?[year]:[year,region]);
        json({...result,year,region,regions:['华东','华南','华北','西部'],years:[2025,2026]});return;
      }
      if(!config.enableDemo&&!url.pathname.startsWith('/sdk/')){json({service:'Xiaoyun voice backend',...health()});return;}
      const sdk=url.pathname.startsWith('/sdk/');const base=path.resolve(ROOT,sdk?'packages/voice/dist':'apps/playground/dist');
      const relative=decodeURIComponent(sdk?url.pathname.slice(5):url.pathname.slice(1))||'index.html';const file=path.resolve(base,relative);
      if(file!==base&&!file.startsWith(base+path.sep)){json({error:'Invalid path'},400);return;}
      if(!(await stat(file)).isFile()){res.writeHead(404);res.end('Not found');return;}
      res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(await readFile(file));
    }catch(error){
      if((error as NodeJS.ErrnoException).code==='ENOENT'){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('文件不存在。首次运行请先执行 npm run build，再打开测试页面。');}
      else json({error:error instanceof Error?error.message:String(error)},500);
    }
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:2*1024*1024});
  server.on('upgrade',(req,socket,head)=>{
    if(new URL(req.url||'/',`http://${req.headers.host}`).pathname!=='/voice'||!originAllowed(req.headers.origin)){socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
  });
  wss.on('connection',ws=>{
    const session=new VoiceSession(ws,manager,projects);
    ws.on('message',(raw,binary)=>{
      if(binary){session.appendAudio(Buffer.isBuffer(raw)?raw:Buffer.from(raw as ArrayBuffer));return;}
      try{void session.receive(JSON.parse(raw.toString()) as ClientMessage).catch(error=>session.send({type:'error',message:error.message}));}
      catch{session.send({type:'error',message:'无效的客户端消息'});}
    });
    ws.on('close',()=>session.dispose());ws.on('error',()=>{});
  });
  await new Promise<void>(resolve=>server.listen(config.port,config.host,resolve));
  console.log(`小云后台：http://${config.host}:${config.port} · ${health().mode} 模式`);
  return {server,manager,close:async()=>{for(const ws of wss.clients)ws.close();await manager.flush();await closeExecution();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  startServer().then(app=>{
    const close=()=>{void app.close().finally(()=>process.exit(0));};process.once('SIGINT',close);process.once('SIGTERM',close);
  }).catch(error=>{console.error(error.message);process.exitCode=1;});
}
