import path from 'node:path';
import {pathToFileURL} from 'node:url';
import Ajv from 'ajv';
import type {ActionDescriptor,JsonObject,TaskResult} from '../../protocol/src/index.ts';
import {config,ROOT} from './config.ts';
import {projectSkills} from './skills.ts';
import {salesPath, querySql,type QueryResult} from './execution.ts';
import {runReadOnly} from './tool-runtime.ts';

export interface ProjectToolContext {signal:AbortSignal; taskId:string; contextAtStart:JsonObject}
export type FormattedProjectResult=Pick<TaskResult,'summary'|'markdown'|'data'|'artifacts'|'sources'>;
export interface ProjectTool {
  name:string; description:string; parameters:JsonObject;
  readOnly?:boolean; voiceDirect?:boolean;
  execute:(args:JsonObject, context:ProjectToolContext)=>Promise<unknown>;
  formatResult?:(value:unknown,args:JsonObject,context:ProjectToolContext)=>FormattedProjectResult|Promise<FormattedProjectResult>;
}
export interface ProjectDefinition {
  id:string; description?:string; databases?:Record<string,string>; tools?:ProjectTool[];
  /** Skill directories containing SKILL.md; relative paths use the project module directory. */
  skills?:string[];
}
const ajv=new Ajv({allErrors:true,strict:false});
const validators=new WeakMap<ProjectTool,ReturnType<typeof ajv.compile>>();
const coreToolNames=new Set(['query_sql','run_python','web_search','fetch_page','request_clarification','deliver_result','read_skill','observe_page','execute_page_action']);
function validateProject(project:ProjectDefinition) {
  const names=new Set<string>();
  for(const tool of project.tools||[]){
    if(!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(tool.name)||names.has(tool.name)||coreToolNames.has(tool.name))throw new Error(`项目工具名称无效或冲突：${tool.name}`);
    names.add(tool.name);
  }
}
export const defineProject = <T extends ProjectDefinition>(project:T):T => {validateProject(project);return project;};
export function getVoiceDirectTools(project:ProjectDefinition):ActionDescriptor[] {
  validateProject(project);
  return (project.tools||[]).filter(tool=>tool.voiceDirect&&tool.formatResult).map(tool=>({name:`project__${tool.name}`,description:tool.description,parameters:tool.parameters}));
}
export function validateProjectToolArgs(tool:ProjectTool,args:JsonObject) {
  let validate=validators.get(tool);
  if(!validate){validate=ajv.compile(tool.parameters);validators.set(tool,validate);}
  if(!validate(args))throw new Error(`工具 ${tool.name} 参数不符合要求：${ajv.errorsText(validate.errors,{separator:'；'})}`);
}
export async function runProjectTool(project:ProjectDefinition,name:string,args:JsonObject,context:ProjectToolContext):Promise<FormattedProjectResult> {
  validateProject(project);
  const tool=project.tools?.find(item=>item.name===name);
  if(!tool?.voiceDirect||!tool.formatResult)throw new Error(`项目未开放这个直达工具：${name}`);
  validateProjectToolArgs(tool,args);context.signal.throwIfAborted();
  const value=await (tool.readOnly?runReadOnly(context.signal,()=>tool.execute(args,context)):tool.execute(args,context));
  context.signal.throwIfAborted();
  const result=await tool.formatResult(value,args,context);
  context.signal.throwIfAborted();
  if(!result||typeof result.summary!=='string'||!result.summary.trim())throw new Error(`工具 ${name} 没有提供可朗读的结果摘要`);
  return result;
}
export const demoProject = defineProject({
  id:'playground', description:'销售展示项目。年度数据分析及多步页面操作使用 sales-analysis Skill；单个明确的按钮可直接执行。',
  skills:[path.join(ROOT,'skills','sales-analysis')],
  databases:{sales:salesPath},
  tools:[{
    name:'sales_summary', description:'直接查询指定地区 2025、2026 年的销售收入、成本和利润同比，使用现有业务数据，结果同步更新销售图表。无需启动后台分析。',
    readOnly:true,voiceDirect:true,
    parameters:{type:'object',properties:{region:{type:'string',enum:['华东','华南','华北','西部']}},required:['region'],additionalProperties:false},
    execute:async (args:JsonObject, ctx:{signal:AbortSignal}) => querySql('SELECT year, ROUND(SUM(revenue),2) revenue, ROUND(SUM(cost),2) cost, ROUND(SUM(revenue-cost),2) profit FROM sales WHERE region=? GROUP BY year ORDER BY year',[args.region],ctx.signal),
    formatResult:(value:unknown,args:JsonObject)=>{
      const rows=(value as QueryResult).rows.map(row=>({year:Number(row.year),revenue:Number(row.revenue),cost:Number(row.cost),profit:Number(row.profit)}));
      const previous=rows.find(row=>row.year===2025),current=rows.find(row=>row.year===2026);
      if(!previous||!current)throw new Error('该地区缺少完整的年度销售数据');
      const changePercent=previous.profit===0?null:Number(((current.profit-previous.profit)/Math.abs(previous.profit)*100).toFixed(2));
      const change=changePercent===null?'上年利润为零，无法计算同比。':`利润同比${changePercent>=0?'增长':'下降'}${Math.abs(changePercent)}%。`;
      return {summary:`${args.region}地区 2026 年${change}`,data:{kind:'profit_comparison',region:args.region,rows,changePercent},markdown:`### ${args.region}年度销售汇总\n\n金额单位：元。\n\n| 年份 | 收入 | 成本 | 利润 |\n| --- | ---: | ---: | ---: |\n${rows.map(row=>`| ${row.year} | ${row.revenue.toFixed(2)} | ${row.cost.toFixed(2)} | ${row.profit.toFixed(2)} |`).join('\n')}`};
    },
  }],
});
export async function loadProjects():Promise<Map<string,ProjectDefinition>> {
  const projects = new Map<string,ProjectDefinition>([['default',{id:'default',description:'通用语音 Agent。可以自然对话、检索资料、分析与制定方案，并使用当前项目提供的数据源和工具执行任务。页面动作由宿主注册。'}]]);
  if(config.enableDemo){projects.set('playground',demoProject);projects.set('demo',{...demoProject,id:'demo'});}
  if (config.projectModule) {
    const loaded = await import(pathToFileURL(path.resolve(config.projectModule)).href);
    const list:ProjectDefinition[] = Array.isArray(loaded.default) ? loaded.default : [loaded.default];
    for (const project of list) {
      if (!project?.id) throw new Error('PROJECT_MODULE 必须默认导出 defineProject 配置或配置数组');
      if(project.skills)project.skills=project.skills.map(directory=>path.resolve(path.dirname(path.resolve(config.projectModule!)),directory));
      validateProject(project);
      projects.set(project.id, project);
    }
  }
  await Promise.all([...projects.values()].map(project=>projectSkills(project)));
  return projects;
}
