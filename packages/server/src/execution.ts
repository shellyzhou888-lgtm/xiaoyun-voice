import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Monty} from '@pydantic/monty';
import {config} from './config.ts';

const worker = fileURLToPath(new URL('./python_worker.py', import.meta.url));
export const salesPath = path.join(config.dataDir, 'sales.sqlite');
export const statePath = path.join(config.dataDir, 'tasks.sqlite');

export function python<T = unknown>(request: Record<string, unknown>, signal?: AbortSignal, timeout = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.python, ['-u', worker], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: {...process.env, PYTHONIOENCODING: 'utf-8'},
    });
    let stdout = ''; let stderr = ''; let settled = false;
    const finish = (err?: Error, value?: T) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (err) reject(err); else resolve(value as T);
    };
    const abort = () => { child.kill(); finish(new Error('任务已取消')); };
    const timer = setTimeout(() => { child.kill(); finish(new Error('工具执行超时')); }, timeout);
    signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted) { abort(); return; }
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 8_000_000) {child.kill(); finish(new Error('工具返回内容过大'));} });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => finish(error));
    child.on('close', () => {
      try { const response = JSON.parse(stdout); finish(response.ok ? undefined : new Error(response.error), response.result); }
      catch { finish(new Error(stderr.trim() || 'Python 工作者未返回有效结果')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(request));
  });
}

export interface QueryResult { rows: Record<string, unknown>[]; columns: string[]; truncated: boolean }
export const querySql = (sql: string, params: unknown[] = [], signal?: AbortSignal, database = salesPath) =>
  python<QueryResult>({command:'query', path:database, sql, params}, signal);
export const initializeData = () => python({command:'init', dataDir:config.dataDir, salesPath, statePath,seedDemo:config.enableDemo});

let montyPool: Promise<Monty> | undefined;
export async function runPython(code: string, inputs: Record<string, unknown>, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const pool = await (montyPool ||= Monty.create({minProcesses:1, maxProcesses:3, requestTimeout:12}));
  const session = await pool.checkout({limits:{maxDurationSecs:8, maxMemory:64 * 1024 * 1024, maxRecursionDepth:100}});
  let stdout = '';
  const abort = () => { void session.close(); };
  signal?.addEventListener('abort', abort, {once:true});
  try {
    signal?.throwIfAborted();
    const result = await session.feedRun(code, {inputs, printCallback:(_stream, text) => { stdout = (stdout + text).slice(0, 16000); }});
    signal?.throwIfAborted();
    // Monty maps Python dictionaries to JS Map; convert before model/JSON transport.
    const jsonResult=JSON.parse(JSON.stringify(result,(_key,value)=>value instanceof Map?Object.fromEntries(value):value instanceof Set?[...value]:typeof value==='bigint'?value.toString():value)??'null');
    return {result:jsonResult, stdout};
  } finally { signal?.removeEventListener('abort', abort); await session.close(); }
}
export async function closeExecution() { const pool=montyPool;montyPool=undefined;if(pool)await(await pool).close(); }
