import path from 'node:path';
import {readFile,realpath,stat} from 'node:fs/promises';
import {parse} from 'yaml';

export interface SkillSummary {name:string;description:string}
interface SkillEntry extends SkillSummary {root:string}
/** Only explicitly registered skill folders are readable. Paths stay on the server. */
export class SkillLibrary {
  private entries=new Map<string,SkillEntry>();
  static async load(directories:string[]=[]){
    const library=new SkillLibrary();
    for(const directory of directories){
      const root=await realpath(path.resolve(directory));
      const text=await library.readFile(root,'SKILL.md');
      const match=/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
      const metadata=match?parse(match[1]):undefined;
      if(!metadata||typeof metadata.name!=='string'||!metadata.name.trim()||typeof metadata.description!=='string'||!metadata.description.trim())throw new Error(`Skill ${directory} 的 SKILL.md 需要 name 和 description 元数据`);
      if(library.entries.has(metadata.name))throw new Error(`Skill 名称重复：${metadata.name}`);
      library.entries.set(metadata.name,{name:metadata.name,description:metadata.description,root});
    }
    return library;
  }
  summaries():SkillSummary[]{return [...this.entries.values()].map(({name,description})=>({name,description}));}
  async read(name:string,reference='SKILL.md'){
    const entry=this.entries.get(name);if(!entry)throw new Error(`项目没有注册 Skill：${name}`);
    return {name,reference,text:await this.readFile(entry.root,reference)};
  }
  private async readFile(root:string,reference:string){
    const file=await realpath(path.resolve(root,reference));
    const relative=path.relative(root,file);
    if(!relative||relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw new Error('Skill 资料只能读取该 Skill 目录内的文件');
    const info=await stat(file);
    if(!info.isFile()||info.size>128*1024)throw new Error('Skill 资料必须是小于 128 KiB 的文本文件；大数据请通过业务工具读取');
    return readFile(file,'utf8');
  }
}

const libraries=new WeakMap<object,Promise<SkillLibrary>>();
export function projectSkills(project:{skills?:string[]}){
  let library=libraries.get(project);
  if(!library){library=SkillLibrary.load(project.skills);libraries.set(project,library);}
  return library;
}
