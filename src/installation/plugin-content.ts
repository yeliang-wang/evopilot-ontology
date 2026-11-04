import {openSync,closeSync,fstatSync,readSync,constants} from 'node:fs';
import {join} from 'node:path';
import {parseDocument} from 'yaml';
import type {RuntimeBinding} from './runtime.js';
import {fail} from '../standalone/types.js';
import {json} from '../standalone/validation.js';

export const PLUGIN_PATHS=Object.freeze({manifest:'.codex-plugin/plugin.json',mcp:'.mcp.json',skill:'skills/evopilot-ontology-expert/SKILL.md',agent:'skills/evopilot-ontology-expert/agents/openai.yaml'});
export const PLUGIN_DIRECTORIES=Object.freeze(['.codex-plugin','skills','skills/evopilot-ontology-expert','skills/evopilot-ontology-expert/agents']);
export const PLUGIN_LIMITS=Object.freeze({entries:1024,fileBytes:1024*1024,totalBytes:16*1024*1024,depth:24,lines:10000,diffCells:4000000});
function sourceBytes(path:string):Buffer {
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const s=fstatSync(fd);if(!s.isFile()||s.nlink!==1||s.size>PLUGIN_LIMITS.fileBytes)fail('PLUGIN_SOURCE','Installed plugin source must be bounded and regular',409);
    const b=Buffer.alloc(PLUGIN_LIMITS.fileBytes+1);let offset=0;
    while(offset<b.length){const n=readSync(fd,b,offset,b.length-offset,null);if(!n)break;offset+=n;}
    if(offset>PLUGIN_LIMITS.fileBytes)fail('PLUGIN_SOURCE','Installed plugin source exceeds its byte budget',409);return Buffer.from(b.subarray(0,offset));
  }finally{closeSync(fd);}
}
export function pluginMCP(runtime:RuntimeBinding,installationRoot:string):Record<string,unknown> {
  return {mcpServers:{'evopilot-ontology':{command:runtime.nodePath,args:[join(runtime.packageRoot,'dist/standalone/bridge.js'),'--connection',join(installationRoot,'connection.json')],env:{NODE_OPTIONS:'',NODE_PATH:''}}}};
}
/** Exact initial-generation bytes also define the upstream side of an upgrade.
 * Callers must verify the complete installed RuntimeBinding before and after. */
export function pluginContent(runtime:RuntimeBinding,installationRoot:string):Map<string,Buffer> {
  const source=join(runtime.packageRoot,'plugins/codex'),files=new Map<string,Buffer>();
  for(const path of [PLUGIN_PATHS.manifest,PLUGIN_PATHS.skill,PLUGIN_PATHS.agent]){
    const raw=sourceBytes(join(source,path));
    if(raw.length>PLUGIN_LIMITS.fileBytes||!Buffer.from(raw.toString('utf8'),'utf8').equals(raw))fail('PLUGIN_SOURCE','Installed plugin text is not bounded UTF-8',409);
    if(path===PLUGIN_PATHS.manifest){
      let value:unknown;try{const s=raw.toString('utf8'),d=parseDocument(s,{uniqueKeys:true,strict:true});if(d.errors.length||d.warnings.length)throw Error('JSON');value=JSON.parse(s);json(value);}catch{fail('PLUGIN_SOURCE','Installed plugin manifest is invalid JSON',409);}
      if(!value||typeof value!=='object'||Array.isArray(value)||!('skills' in value)||value.skills!=='./skills/'||!('mcpServers' in value)||value.mcpServers!=='./.mcp.json')fail('PLUGIN_SOURCE','Installed plugin uses unsupported resource locations',409);
      files.set(path,Buffer.from(JSON.stringify(value)+'\n'));
    }else files.set(path,raw);
  }
  files.set(PLUGIN_PATHS.mcp,Buffer.from(JSON.stringify(pluginMCP(runtime,installationRoot))+'\n'));
  return files;
}
