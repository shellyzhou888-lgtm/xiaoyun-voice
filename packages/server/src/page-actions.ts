import Ajv from 'ajv';
import type {ActionDescriptor,JsonObject} from '../../protocol/src/index.ts';

export interface PageSnapshot {context:JsonObject;version:number;actions:ActionDescriptor[]}
export interface PageAccess {
  observe():PageSnapshot;
  execute(name:string,args:JsonObject,expectedVersion:number,taskId:string,signal:AbortSignal):Promise<{result:unknown;page:PageSnapshot}>;
}

/** A single page has one action lane even when several Pi tasks are computing. */
export class PageActionLane {
  private tail:Promise<unknown>=Promise.resolve();
  private ajv=new Ajv({strict:false,allErrors:true});
  private validators=new WeakMap<ActionDescriptor,ReturnType<Ajv['compile']>>();
  constructor(private observe:()=>PageSnapshot,private invoke:(name:string,args:JsonObject,version:number,taskId?:string)=>Promise<unknown>){}
  execute(name:string,args:JsonObject,expectedVersion:number,taskId?:string,signal?:AbortSignal){
    const operation=this.tail.then(async()=>{
      signal?.throwIfAborted();
      const page=this.observe();
      if(page.version!==expectedVersion)throw new Error('页面上下文已改变，请重新读取页面状态并判断当前任务的下一步');
      const action=page.actions.find(action=>action.name===name);
      if(!action)throw new Error(`页面未注册动作 ${name}`);
      let validate=this.validators.get(action);
      if(!validate){validate=this.ajv.compile(action.parameters);this.validators.set(action,validate);}
      if(!validate(args))throw new Error(`页面动作参数不正确：${this.ajv.errorsText(validate.errors)}`);
      const result=await this.invoke(name,args,expectedVersion,taskId);
      signal?.throwIfAborted();
      return {result,page:this.observe()};
    });
    // Keep an in-flight browser function in the lane until its actual acknowledgement.
    this.tail=operation.catch(()=>{});return operation;
  }
}
