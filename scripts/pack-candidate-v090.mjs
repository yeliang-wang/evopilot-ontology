import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

export function validateCandidatePack(records){
  assert(Array.isArray(records)&&records.length===1,'Exactly one independent package required');
  const p=records[0];assert.equal(p.name,'@evopilot-next/ontology');assert.equal(p.version,'0.9.0');assert.equal(p.filename,'evopilot-next-ontology-0.9.0.tgz');
  assert(Array.isArray(p.files)&&p.files.length>0);
  const paths=p.files.map(f=>f.path);assert.equal(paths.length,new Set(paths).size);
  for(const path of paths){assert(!isAbsolute(path)&&!path.split('/').some(x=>!x||x==='.'||x==='..')&&!/[\\\x00-\x1f]/u.test(path));assert(!/^(?:node_modules|tests|scripts|\.github|\.git|workspace|private)\//u.test(path),'Non-distribution source or state in package');}
  for(const path of ['package.json','dist/standalone/cli.js','dist/standalone/mcp.js','plugins/codex/.codex-plugin/plugin.json','src/expert/SKILL.md','toolchains/owl2-dl/dependencies.json','src/native-v2/shacl-worker.py','LICENSE','NOTICE'])assert(paths.includes(path),'Missing distribution file: '+path);
  return p.filename;
}
export function packCandidate(output){
  assert(isAbsolute(output));const root=resolve(output),source=fileURLToPath(new URL('../',import.meta.url));assert(!root.startsWith(source));mkdirSync(root,{mode:0o700});
  const command=(name,args)=>{const p=spawnSync(name,args,{cwd:source,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});assert.ifError(p.error);assert.equal(p.status,0,p.stderr);return p.stdout;};
  const head=command('git',['rev-parse','HEAD']).trim();assert.match(head,/^[a-f0-9]{40}$/);
  assert.equal(command('git',['status','--porcelain']),'','Commit the reviewed source before candidate packing');
  const records=JSON.parse(command('npm',['pack','--offline','--ignore-scripts','--json','--pack-destination',root])),filename=validateCandidatePack(records),bytes=readFileSync(join(root,filename)),digest=createHash('sha256').update(bytes).digest('hex');
  writeFileSync(join(root,'pack.json'),JSON.stringify(records,null,2)+'\n',{flag:'wx'});
  writeFileSync(join(root,'source-revision.txt'),head+'\n',{flag:'wx'});
  writeFileSync(join(root,'SHA256SUMS'),digest+'  '+filename+'\n',{flag:'wx'});
  const result={schema:'ontology-source-candidate/v1',sourceCommit:head,package:{filename,bytes:bytes.length,digest:'sha256:'+digest},acceptance:'NOT_EVALUATED',releaseAuthorized:false};
  writeFileSync(join(root,'candidate.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){assert.equal(process.argv.length,3,'Usage: node scripts/pack-candidate-v090.mjs ABS_NEW_OUTPUT');console.log(JSON.stringify(packCandidate(process.argv[2])));}
