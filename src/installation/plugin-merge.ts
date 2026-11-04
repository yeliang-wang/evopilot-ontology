import {parseDocument} from 'yaml';
import {hash,hashBytes,json} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';
import {PLUGIN_LIMITS,PLUGIN_PATHS} from './plugin-content.js';

export interface PluginConflict {reason:string;pointer?:string;startLine?:number;endLine?:number;}
export interface PluginResolution {path:string;baseDigest:string|null;currentDigest:string|null;newDigest:string|null;content:Buffer|null;}
export interface PluginFileReport {
  path:string;baseDigest:string|null;currentDigest:string|null;newDigest:string|null;
  outputDigest:string|null;outputBytes:number|null;
  action:'UNCHANGED'|'CURRENT'|'UPSTREAM'|'MERGED'|'RESOLVED'|'CONFLICT';conflicts:PluginConflict[];
}
export interface PluginMerge {files:Map<string,Buffer>;report:PluginFileReport[];}
export const pluginDigest=(b:Buffer|undefined|null):string|null=>b===undefined||b===null?null:hashBytes(b);
const same=(a:Buffer|undefined|null,b:Buffer|undefined|null)=>pluginDigest(a)===pluginDigest(b);
const utf8=(b:Buffer):string|null=>{const s=b.toString('utf8');return !s.includes('\0')&&Buffer.from(s,'utf8').equals(b)?s:null;};
const plain=(v:Json|undefined):v is {[key:string]:Json}=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const jsonSame=(a:Json|undefined,b:Json|undefined)=>a===undefined||b===undefined?a===b:hash(a)===hash(b);
const pointerPart=(s:string)=>s.replaceAll('~','~0').replaceAll('/','~1');

export function parsePluginJSON(b:Buffer):Json {
  const s=utf8(b);if(s===null)throw Error('UTF8');
  // JSON.parse alone silently accepts duplicate keys. The YAML parser is used
  // only to reject ambiguous mapping keys; JSON.parse still defines syntax.
  const d=parseDocument(s,{uniqueKeys:true,strict:true});if(d.errors.length||d.warnings.length)throw Error('JSON');
  const v:unknown=JSON.parse(s);json(v);return v;
}
function mergeJSON(base:Json|undefined,current:Json|undefined,next:Json|undefined,pointer:string,conflicts:PluginConflict[]):Json|undefined {
  if(jsonSame(current,next))return current;
  if(jsonSame(current,base))return next;
  if(jsonSame(next,base))return current;
  if(plain(base)&&plain(current)&&plain(next)){
    const result:{[key:string]:Json}=Object.create(null) as {[key:string]:Json};
    for(const key of [...new Set([...Object.keys(base),...Object.keys(current),...Object.keys(next)])].sort()){
      const v=mergeJSON(base[key],current[key],next[key],pointer+'/'+pointerPart(key),conflicts);if(v!==undefined)result[key]=v;
    }
    return result;
  }
  conflicts.push({reason:'JSON_VALUE_CONFLICT',pointer});return undefined;
}
interface Edit {start:number;end:number;lines:string[];}
const lines=(s:string):string[]=>s.match(/[^\n]*\n|[^\n]+$/g)??[];
/** Bounded LCS edits over exact lines (including line terminators). No external
 * process, heuristic whole-file replacement or conflict-marker execution. */
function edits(base:string[],changed:string[]):Edit[]|null {
  let start=0,endA=base.length,endB=changed.length;
  while(start<endA&&start<endB&&base[start]===changed[start])start++;
  while(endA>start&&endB>start&&base[endA-1]===changed[endB-1]){endA--;endB--;}
  const n=endA-start,m=endB-start;if((n+1)*(m+1)>PLUGIN_LIMITS.diffCells)return null;
  if(!n&&!m)return [];
  const width=m+1,grid=new Uint32Array((n+1)*width);
  for(let a=n-1;a>=0;a--)for(let b=m-1;b>=0;b--)grid[a*width+b]=base[start+a]===changed[start+b]?grid[(a+1)*width+b+1]+1:Math.max(grid[(a+1)*width+b],grid[a*width+b+1]);
  const result:Edit[]=[];let a=0,b=0,edit:Edit|null=null;
  const flush=()=>{if(edit){result.push(edit);edit=null;}};
  while(a<n||b<m){
    if(a<n&&b<m&&base[start+a]===changed[start+b]){flush();a++;b++;continue;}
    if(!edit)edit={start:start+a,end:start+a,lines:[]};
    if(b<m&&(a===n||grid[a*width+b+1]>grid[(a+1)*width+b]))edit.lines.push(changed[start+b++]);
    else{a++;edit.end=start+a;}
  }
  flush();return result;
}
const editSame=(a:Edit,b:Edit)=>a.start===b.start&&a.end===b.end&&a.lines.length===b.lines.length&&a.lines.every((v,i)=>v===b.lines[i]);
function overlap(a:Edit,b:Edit):boolean {
  if(a.start===a.end&&b.start===b.end)return a.start===b.start;
  if(a.start===a.end)return a.start>=b.start&&a.start<=b.end;
  if(b.start===b.end)return b.start>=a.start&&b.start<=a.end;
  return Math.max(a.start,b.start)<Math.min(a.end,b.end);
}
function mergeText(b:Buffer,c:Buffer,n:Buffer,conflicts:PluginConflict[]):Buffer|null {
  const strings=[b,c,n].map(utf8);if(strings.some(s=>s===null)){conflicts.push({reason:'BINARY_CONFLICT'});return null;}
  const [base,current,next]=strings.map(s=>lines(s!));
  if([base,current,next].some(v=>v.length>PLUGIN_LIMITS.lines)){conflicts.push({reason:'TEXT_MERGE_LIMIT'});return null;}
  const a=edits(base,current),d=edits(base,next);if(!a||!d){conflicts.push({reason:'TEXT_MERGE_LIMIT'});return null;}
  const joined=[...a];
  for(const right of d){
    let duplicate=false;
    for(const left of a){
      if(editSame(left,right)){duplicate=true;continue;}
      if(overlap(left,right))conflicts.push({reason:'TEXT_EDIT_CONFLICT',startLine:Math.min(left.start,right.start)+1,endLine:Math.max(left.end,right.end)+1});
    }
    if(!duplicate)joined.push(right);
  }
  if(conflicts.length)return null;
  joined.sort((x,y)=>x.start-y.start||x.end-y.end);const out:string[]=[];let position=0;
  for(const e of joined){out.push(...base.slice(position,e.start),...e.lines);position=e.end;}out.push(...base.slice(position));return Buffer.from(out.join(''));
}
function checkManaged(path:string,output:Buffer|undefined,next:Buffer|undefined):PluginConflict[] {
  if(!Object.values(PLUGIN_PATHS).some(p=>p===path))return [];
  if(!output||!output.length)return [{reason:'REQUIRED_PLUGIN_FILE'}];
  if(utf8(output)===null)return [{reason:'INVALID_PLUGIN_TEXT'}];
  try{
    if(path===PLUGIN_PATHS.skill)return [];
    if(path===PLUGIN_PATHS.agent){const d=parseDocument(output.toString('utf8'),{uniqueKeys:true,strict:true});if(d.errors.length||d.warnings.length)throw Error('YAML');const v:unknown=d.toJS({maxAliasCount:0});json(v);if(!plain(v))throw Error('YAML');return [];}
    const v=parsePluginJSON(output),expected=next?parsePluginJSON(next):undefined;if(!plain(v)||!plain(expected))throw Error('OBJECT');
    if(path===PLUGIN_PATHS.manifest){
      return ['name','version','skills','mcpServers','requires_local_executor'].filter(k=>!jsonSame(v[k],expected[k])).map(k=>({reason:'OWNED_PLUGIN_BINDING',pointer:'/'+pointerPart(k)}));
    }
    const servers=v.mcpServers,es=expected.mcpServers;
    if(!plain(servers)||!plain(es))throw Error('SERVERS');
    const s=servers['evopilot-ontology'],e=es['evopilot-ontology'];if(!plain(s)||!plain(e))throw Error('SERVER');
    const conflicts:PluginConflict[]=[];
    for(const k of ['command','args'])if(!jsonSame(s[k],e[k]))conflicts.push({reason:'OWNED_PLUGIN_BINDING',pointer:'/mcpServers/evopilot-ontology/'+k});
    const env=s.env;if(!plain(env)||env.NODE_OPTIONS!==''||env.NODE_PATH!==''||Object.values(env).some(v=>typeof v!=='string'))conflicts.push({reason:'OWNED_PLUGIN_BINDING',pointer:'/mcpServers/evopilot-ontology/env'});
    if(Object.hasOwn(s,'url')||s.type!==undefined&&s.type!=='stdio')conflicts.push({reason:'OWNED_PLUGIN_BINDING',pointer:'/mcpServers/evopilot-ontology'});
    return conflicts;
  }catch{return [{reason:'INVALID_PLUGIN_CONFIGURATION'}];}
}
/** Private buffers stay in memory. Routine reports contain identities and
 * conflict coordinates only, never credentials or file contents. */
export function mergePluginFiles(base:Map<string,Buffer>,current:Map<string,Buffer>,next:Map<string,Buffer>,resolutions:PluginResolution[]=[]):PluginMerge {
  for(const files of [base,current,next]){
    let bytes=0;for(const b of files.values()){bytes+=b.length;if(b.length>PLUGIN_LIMITS.fileBytes||bytes>PLUGIN_LIMITS.totalBytes)fail('PLUGIN_LIMIT','Plugin merge input exceeds its byte budget',413);}
    if(files.size>PLUGIN_LIMITS.entries)fail('PLUGIN_LIMIT','Plugin merge input exceeds its entry budget',413);
  }
  const keys=[...new Set([...base.keys(),...current.keys(),...next.keys()])].sort(),chosen=new Map<string,PluginResolution>();
  for(const r of resolutions){if(chosen.has(r.path)||!keys.includes(r.path))fail('PLUGIN_RESOLUTION','Duplicate or unknown plugin resolution',409);chosen.set(r.path,r);}
  const files=new Map<string,Buffer>(),report:PluginFileReport[]=[];let total=0;
  for(const path of keys){
    const b=base.get(path),c=current.get(path),n=next.get(path),r=chosen.get(path);
    const entry:PluginFileReport={path,baseDigest:pluginDigest(b),currentDigest:pluginDigest(c),newDigest:pluginDigest(n),outputDigest:null,outputBytes:null,action:'UNCHANGED',conflicts:[]};let output:Buffer|undefined;
    if(r){
      if(r.baseDigest!==entry.baseDigest||r.currentDigest!==entry.currentDigest||r.newDigest!==entry.newDigest)fail('PLUGIN_RESOLUTION_STALE','Plugin resolution no longer matches all three inputs',409);
      entry.action='RESOLVED';output=r.content??undefined;
    }else if(same(c,n)){entry.action='UNCHANGED';output=c;}
    else if(same(c,b)){entry.action='UPSTREAM';output=n;}
    else if(same(n,b)){entry.action='CURRENT';output=c;}
    else if(!b||!c||!n){entry.conflicts.push({reason:!b?'ADD_ADD_CONFLICT':'DELETE_EDIT_CONFLICT'});}
    else if(path===PLUGIN_PATHS.mcp||path===PLUGIN_PATHS.manifest){
      try{const value=mergeJSON(parsePluginJSON(b),parsePluginJSON(c),parsePluginJSON(n),'',entry.conflicts);if(value!==undefined&&!entry.conflicts.length)output=Buffer.from(JSON.stringify(value)+'\n');}catch{entry.conflicts.push({reason:'INVALID_PLUGIN_CONFIGURATION'});}
      entry.action='MERGED';
    }else{output=mergeText(b,c,n,entry.conflicts)??undefined;entry.action='MERGED';}
    if(!entry.conflicts.length)entry.conflicts.push(...checkManaged(path,output,n));
    if(entry.conflicts.length){entry.action='CONFLICT';output=undefined;}
    if(output){
      total+=output.length;if(output.length>PLUGIN_LIMITS.fileBytes||total>PLUGIN_LIMITS.totalBytes)fail('PLUGIN_LIMIT','Merged plugin exceeds its byte budget',413);
      files.set(path,Buffer.from(output));entry.outputDigest=hashBytes(output);entry.outputBytes=output.length;
    }else if(!entry.conflicts.length)entry.outputBytes=0;
    report.push(entry);
  }
  if(keys.length>PLUGIN_LIMITS.entries)fail('PLUGIN_LIMIT','Merged plugin exceeds its entry budget',413);
  return {files,report};
}
