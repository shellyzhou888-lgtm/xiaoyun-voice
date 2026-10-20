import {parse,type DefaultTreeAdapterTypes as Tree} from 'parse5';
import type {TaskSource} from '../../protocol/src/index.ts';

type Node=Tree.Node;
const children=(node:Node):Node[]=>'childNodes' in node?node.childNodes:[];
const tag=(node:Node)=>'tagName' in node?node.tagName:'';
const attr=(node:Node,name:string)=>'attrs' in node?node.attrs.find(item=>item.name===name)?.value:undefined;
const rawText=(node:Node):string=>'value' in node?String(node.value):children(node).map(rawText).join('');
function descendants(node:Node,predicate:(node:Node)=>boolean):Node[]{return [...(predicate(node)?[node]:[]),...children(node).flatMap(child=>descendants(child,predicate))];}
const clean=(text:string)=>text.replace(/[\t \u00a0]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
const excluded=new Set(['script','style','nav','footer','aside','noscript','template','form','button','svg']);

function readable(node:Node):string {
  const name=tag(node);
  if(excluded.has(name)||['navigation','contentinfo'].includes(attr(node,'role')||'')||attr(node,'aria-hidden')==='true'||attr(node,'hidden')!==undefined)return '';
  if('value' in node)return String(node.value).replace(/\s+/g,' ');
  if(name==='br')return '\n';
  if(name==='table'){
    const rows=descendants(node,item=>tag(item)==='tr').map(row=>children(row).filter(cell=>['td','th'].includes(tag(cell))).map(cell=>clean(children(cell).map(readable).join('')).replace(/\|/g,'\\|').replace(/\n/g,' '))).filter(row=>row.length);
    if(!rows.length)return '';
    const width=Math.max(...rows.map(row=>row.length));
    const line=(row:string[])=>`| ${Array.from({length:width},(_,i)=>row[i]||'').join(' | ')} |`;
    return '\n\n'+[line(rows[0]),line(Array(width).fill('---')),...rows.slice(1).map(line)].join('\n')+'\n\n';
  }
  const body=children(node).map(readable).join('');
  if(/^h[1-6]$/.test(name))return `\n\n${'#'.repeat(Number(name[1]))} ${clean(body)}\n\n`;
  if(name==='li')return `\n- ${clean(body)}\n`;
  return ['p','div','section','article','main','header','ul','ol','blockquote','pre','dl','dt','dd'].includes(name)?`\n${body}\n`:body;
}

/** Only explicit absolute source dates are accepted; retrieval time is separate. */
export function sourceDate(value:unknown):string|undefined {
  if(typeof value!=='string')return undefined;
  const text=value.trim();
  if(!/^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(text))return undefined;
  if(!Number.isFinite(Date.parse(text)))return undefined;
  // Preserve dates and timezone-free publication text without inventing a zone.
  return text;
}

function explicitDates(document:Node):Pick<TaskSource,'publishedAt'|'updatedAt'> {
  const result:Pick<TaskSource,'publishedAt'|'updatedAt'>={};
  const assign=(field:'publishedAt'|'updatedAt',value:unknown)=>{const date=sourceDate(value);if(date&&!result[field])result[field]=date;};
  for(const node of descendants(document,item=>['meta','time','script'].includes(tag(item)))){
    const key=(attr(node,'property')||attr(node,'name')||attr(node,'itemprop')||'').toLowerCase();
    const value=attr(node,'content')||attr(node,'datetime');
    if(['article:published_time','datepublished','datecreated','pubdate','publishdate'].includes(key))assign('publishedAt',value);
    if(['article:modified_time','datemodified','lastmod','last-modified'].includes(key))assign('updatedAt',value);
    if(tag(node)==='script'&&attr(node,'type')==='application/ld+json'){
      try{
        const inspect=(item:unknown)=>{
          if(Array.isArray(item)){item.forEach(inspect);return;}
          if(!item||typeof item!=='object')return;
          const data=item as Record<string,unknown>;
          const kinds=Array.isArray(data['@type'])?data['@type']:[data['@type']];
          if(kinds.some(kind=>typeof kind==='string'&&/(?:Article|WebPage|BlogPosting)$/.test(kind))){assign('publishedAt',data.datePublished);assign('updatedAt',data.dateModified);}
          if(data['@graph'])inspect(data['@graph']);
        };
        inspect(JSON.parse(rawText(node)));
      }catch{/* Malformed metadata does not prevent reading the page. */}
    }
  }
  return result;
}

export function extractPage(html:string,url:string,fetchedAt=new Date().toISOString()):{title:string;text:string;source:TaskSource} {
  const document=parse(html);
  const mains=descendants(document,node=>tag(node)==='main'||attr(node,'role')==='main');
  const articles=descendants(document,node=>tag(node)==='article');
  const candidates=mains.length?mains:articles.length?articles:descendants(document,node=>tag(node)==='body');
  const content=candidates.map(readable).sort((a,b)=>b.length-a.length)[0]||readable(document);
  const heading=descendants(document,node=>tag(node)==='h1')[0];
  const titleNode=descendants(document,node=>tag(node)==='title')[0];
  const title=clean((titleNode&&rawText(titleNode))||(heading&&rawText(heading))||url);
  return {title,text:clean(content).slice(0,30000),source:{title,url,fetchedAt,...explicitDates(document)}};
}
