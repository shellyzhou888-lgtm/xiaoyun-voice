#!/usr/bin/env node
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {cp,mkdir,readFile,writeFile,access} from 'node:fs/promises';
import dotenv from 'dotenv';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [command='help',...args]=process.argv.slice(2);
const exists=async file=>{try{await access(file);return true;}catch{return false;}};
async function assets(target){
  const destination=path.resolve(target||'public/xiaoyun');
  await mkdir(destination,{recursive:true});
  await cp(path.join(root,'packages/voice/dist/assets'),destination,{recursive:true});
  console.log(`小云资源已复制到 ${destination}`);
}
async function main(){
  if(command==='assets'){await assets(args[0]);return;}
  if(command==='init'){
    await assets(args[0]);
    if(!await exists('.env.xiaoyun')){await cp(path.join(root,'.env.example'),'.env.xiaoyun');console.log('已创建 .env.xiaoyun，请填写后台密钥和 Python 路径。');}
    const previous=await readFile('.gitignore','utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
    const rules=['.env.xiaoyun','.xiaoyun/'];const missing=rules.filter(rule=>!previous.split(/\r?\n/).includes(rule));
    if(missing.length)await writeFile('.gitignore',previous+(previous&&!previous.endsWith('\n')?'\n':'')+missing.join('\n')+'\n');
    console.log('页面使用 projectId: "default", assetBaseUrl: "/xiaoyun/"。运行 npx xiaoyun start 启动后台。');return;
  }
  if(command==='start'){
    const envIndex=args.indexOf('--env');const envFile=envIndex>=0?args[envIndex+1]:'.env.xiaoyun';
    if(envIndex>=0&&!envFile)throw new Error('--env 后需要文件路径');
    if(await exists(envFile))dotenv.config({path:envFile,quiet:true});
    process.env.XIAOYUN_PACKAGE_ROOT=root;process.env.VOICE_ENABLE_DEMO??='false';process.env.VOICE_MODE??='live';
    const version=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version;
    const url=`http://${process.env.HOST&&process.env.HOST!=='0.0.0.0'?process.env.HOST:'127.0.0.1'}:${Number(process.env.PORT||8765)}`;
    let health;try{const response=await fetch(`${url}/api/health`,{signal:AbortSignal.timeout(1000)});if(response.ok)health=await response.json();}catch{}
    if(health){if(health.protocolVersion!==version)throw new Error(`端口上的小云后台版本为 ${health.protocolVersion||'未知'}，请先同步更新到 ${version}。`);console.log(`小云后台已在运行：${url}；页面可直接复用。`);return;}
    const {startServer}=await import('../backend/index.js');const app=await startServer();
    const close=()=>{void app.close().finally(()=>process.exit(0));};process.once('SIGINT',close);process.once('SIGTERM',close);
    return;
  }
  if(command!=='help'&&command!=='--help')throw new Error(`未知命令：${command}`);
  console.log('小云组件\n  xiaoyun init [public资源目录]  复制资源并准备后台配置\n  xiaoyun assets [目录]          只复制浏览器资源\n  xiaoyun start [--env 文件]     启动或复用本地后台');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
