import {randomUUID} from 'node:crypto';
import type {Delivery, JsonObject, TaskInfo, TaskResult, TaskStatus} from '../../protocol/src/index.ts';
import {python, statePath} from './execution.ts';

export interface StoredTask {
  info:TaskInfo; projectId:string; clientId:string; prompt:string;
  result?:TaskResult; delivery?:Delivery; slots?:Record<string,string>; conversation?:unknown[];
}
export interface RuntimeTask extends StoredTask { abort:AbortController; run?:()=>Promise<TaskResult|undefined>; prepareDelivery?:(result:TaskResult)=>Delivery; onUpdate?:(task:RuntimeTask)=>void; onResult?:(task:RuntimeTask)=>void }
const terminal = (status:TaskStatus) => ['succeeded','failed','cancelled','interrupted'].includes(status);

export class TaskManager {
  tasks = new Map<string,RuntimeTask>();
  private active = 0;
  private queue:RuntimeTask[] = [];
  private writes = Promise.resolve();
  constructor(private persist = true, readonly concurrency = 3) {}
  create(options:{projectId:string;clientId:string;sessionId:string;title:string;prompt:string;context:JsonObject;order:number}):RuntimeTask {
    const now = Date.now();
    const task:RuntimeTask = {info:{taskId:randomUUID(),sessionId:options.sessionId,title:options.title,status:'collecting',requestOrder:options.order,createdAt:now,updatedAt:now,contextAtStart:structuredClone(options.context)},projectId:options.projectId,clientId:options.clientId,prompt:options.prompt,abort:new AbortController()};
    this.tasks.set(task.info.taskId,task); this.save(task); return task;
  }
  update(task:RuntimeTask, status:TaskStatus, progress?:string, question?:string) {
    const persist=task.info.status!==status||task.info.question!==question;
    task.info = {...task.info,status,progress,question,updatedAt:Date.now()};
    if(persist)this.save(task); task.onUpdate?.(task);
  }
  save(task:RuntimeTask) {
    if (!this.persist) return;
    const {info,projectId,clientId,prompt,result,delivery,slots,conversation} = task;
    let snapshot:StoredTask;
    try{snapshot=structuredClone({info,projectId,clientId,prompt,result,delivery,slots,conversation});}
    catch(error){console.error('Task persistence:',error instanceof Error?error.message:String(error));return;}
    this.writes = this.writes.then(async () => { await python({command:'save',path:statePath,task:snapshot}); }).catch(error => console.error('Task persistence:', error.message));
  }
  async restore(projectId:string,clientId:string):Promise<RuntimeTask[]> {
    await this.writes;
    const stored = this.persist ? await python<StoredTask[]>({command:'load',path:statePath,projectId,clientId}) : [];
    for (const task of stored) if (!this.tasks.has(task.info.taskId)) this.tasks.set(task.info.taskId,{...task,abort:new AbortController()});
    return [...this.tasks.values()].filter(t=>t.projectId===projectId&&t.clientId===clientId);
  }
  enqueue(task:RuntimeTask, run:()=>Promise<TaskResult|undefined>) {
    task.run = run; this.update(task,'queued','等待执行'); this.queue.push(task); this.pump();
  }
  private pump() {
    while (this.active < this.concurrency && this.queue.length) {
      const task = this.queue.shift()!; if (task.abort.signal.aborted) continue;
      this.active++; this.update(task,'running','正在处理');
      void task.run!().then(result => {
        if (result && !task.abort.signal.aborted) this.complete(task,result);
      }).catch(error => {
        if (!task.abort.signal.aborted) this.complete(task,this.result(task,{status:'failed',summary:error instanceof Error?error.message:String(error)}));
      }).finally(()=>{this.active--;this.pump();});
    }
  }
  complete(task:RuntimeTask,result:TaskResult) {
    task.result=result;task.delivery=task.prepareDelivery?.(result);
    task.info={...task.info,status:result.status,progress:result.status==='succeeded'?'已完成':result.summary,question:undefined,updatedAt:Date.now()};
    // Result and initial delivery share one SQLite transaction; memory delivery never waits for disk.
    this.save(task);task.onUpdate?.(task);task.onResult?.(task);
  }
  setDelivery(task:RuntimeTask,delivery:Delivery){task.delivery={...delivery};this.save(task);}
  runDirect(task:RuntimeTask,run:()=>Promise<TaskResult>){
    this.update(task,'running','正在查询');
    void run().then(result=>{if(!task.abort.signal.aborted)this.complete(task,result);}).catch(error=>{
      if(!task.abort.signal.aborted)this.complete(task,this.result(task,{status:'failed',summary:error instanceof Error?error.message:String(error)}));
    });
  }
  cancel(task:RuntimeTask) {
    if (terminal(task.info.status)) return;
    task.abort.abort();this.complete(task,this.result(task,{status:'cancelled',summary:'已取消这个任务。'}));
  }
  result(task:RuntimeTask, values:Partial<TaskResult>&{summary:string}):TaskResult {
    return {taskId:task.info.taskId,sessionId:task.info.sessionId,projectId:task.projectId,status:'succeeded',title:task.info.title,contextAtStart:task.info.contextAtStart,requestOrder:task.info.requestOrder,...values};
  }
  async flush(){await this.writes;}
}

/** Batches completions in the same event-loop turn, then breaks ties by request order. */
export class CompletionBatch<T extends {requestOrder:number}> {
  private pending:T[]=[];
  private scheduled=false;
  constructor(private emit:(items:T[])=>void) {}
  get pendingCount(){return this.pending.length;}
  add(item:T){this.pending.push(item);if(!this.scheduled){this.scheduled=true;setImmediate(()=>{const batch=this.pending;this.pending=[];this.scheduled=false;this.emit(batch.sort((a,b)=>a.requestOrder-b.requestOrder));});}}
}
