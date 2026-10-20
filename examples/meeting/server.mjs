import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'public');
const sdk=fileURLToPath(import.meta.resolve('@xiaoyun/voice'));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml'};
http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');const file=url.pathname==='/vendor/voice.js'?sdk:path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(file!==sdk&&!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  try{const data=await readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end('Not found');}
}).listen(Number(process.env.UI_PORT||8766),'127.0.0.1',()=>console.log(`会议示例：http://127.0.0.1:${process.env.UI_PORT||8766}`));
