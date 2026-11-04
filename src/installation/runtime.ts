import {lstatSync,readdirSync,readFileSync,readlinkSync,realpathSync,openSync,closeSync,fstatSync,readSync,constants} from 'node:fs';
import {isAbsolute,join,relative,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {outsideSource} from './files.js';
import {hash,exact,digest,text} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';

export interface RuntimeBinding{root:string;packageRoot:string;version:string;digest:string;files:number;bytes:number;nodePath:string;nodeDigest:string;nodeVersion:string;}
export function validateRuntimeBinding(value:unknown):asserts value is RuntimeBinding {
  exact(value,['root','packageRoot','version','digest','files','bytes','nodePath','nodeDigest','nodeVersion']);
  digest(value.digest);digest(value.nodeDigest);text(value.version,40);text(value.nodeVersion,40);
  for(const k of ['root','packageRoot','nodePath']){text(value[k],4096);if(!isAbsolute(value[k] as string)||resolve(value[k] as string)!==value[k])fail('RUNTIME_IDENTITY','Canonical absolute runtime references required',409);}
  if(value.packageRoot!==join(value.root as string,'node_modules/@evopilot-next/ontology')||![value.files,value.bytes].every(n=>Number.isSafeInteger(n)&&(n as number)>=0))fail('RUNTIME_IDENTITY','Invalid retained runtime identity',409);
}
export function fileDigest(path:string,max=256*1024*1024):string{
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const stat=fstatSync(fd);if(!stat.isFile()||stat.size>max)fail('RUNTIME_LIMIT','Runtime file is not bounded and regular');
    const hash=createHash('sha256'),buffer=Buffer.alloc(65536);let bytes=0;
    for(;;){const n=readSync(fd,buffer,0,buffer.length,null);if(!n)break;bytes+=n;if(bytes>max)fail('RUNTIME_LIMIT','Runtime file grew beyond budget');hash.update(buffer.subarray(0,n));}
    return 'sha256:'+hash.digest('hex');
  }finally{closeSync(fd);}
}
export function inspectRuntime(path:string):RuntimeBinding{
  if(!isAbsolute(path)||lstatSync(path).isSymbolicLink())fail('UNSAFE_PATH','Explicit regular runtime root required');
  const root=outsideSource(path),entries:{path:string;kind:string;digest:string;mode:number}[]=[];let bytes=0;
  const visit=(dir:string):void=>{
    for(const name of readdirSync(dir).sort()){
      const file=join(dir,name),stat=lstatSync(file),rel=relative(root,file);
      if(++count>20000)fail('RUNTIME_LIMIT','Runtime file count exceeds budget');
      if(stat.isDirectory()){visit(file);continue;}
      if(stat.isSymbolicLink()){
        // npm's bin links are admitted only when their exact target stays in this runtime tree.
        const link=readlinkSync(file),target=realpathSync(file),r=relative(root,target);
        if(!rel.startsWith('node_modules/.bin/')||isAbsolute(link)||r.startsWith('..')||isAbsolute(r)||!lstatSync(target).isFile())fail('UNSAFE_PATH','Runtime link escapes admitted package tree');
        entries.push({path:rel,kind:'link',digest:hash(link),mode:stat.mode&0o777});continue;
      }
      if(!stat.isFile()||stat.nlink!==1)fail('UNSAFE_PATH','Runtime must contain regular unlinked files');
      bytes+=stat.size;if(bytes>256*1024*1024)fail('RUNTIME_LIMIT','Runtime byte budget exceeded');
      entries.push({path:rel,kind:'file',digest:fileDigest(file),mode:stat.mode&0o777});
    }
  };let count=0;visit(root);
  const packageRoot=join(root,'node_modules/@evopilot-next/ontology');
  const pkg:unknown=JSON.parse(readFileSync(join(packageRoot,'package.json'),'utf8'));
  if(!pkg||typeof pkg!=='object'||!('name' in pkg)||pkg.name!=='@evopilot-next/ontology'||!('version' in pkg)||typeof pkg.version!=='string')fail('RUNTIME_IDENTITY','Expected independently installed Ontology package');
  for(const file of ['dist/installation/daemon.js','dist/standalone/bridge.js','dist/standalone/cli.js','plugins/codex/skills/evopilot-ontology-expert/SKILL.md'])if(!entries.some(e=>e.path===relative(root,join(packageRoot,file))))fail('RUNTIME_IDENTITY','Installed package is missing operator or Expert entry');
  const nodePath=realpathSync(process.execPath);
  return {root,packageRoot,version:pkg.version,digest:hash(entries),files:entries.length,bytes,nodePath,nodeDigest:fileDigest(nodePath),nodeVersion:process.versions.node};
}
export function verifyRuntime(binding:RuntimeBinding):void{
  validateRuntimeBinding(binding);
  const actual=inspectRuntime(binding.root);
  if(hash({...actual})!==hash({...binding}))fail('RUNTIME_CHANGED','Installed runtime bytes or Node identity changed; no implicit execution',409);
}
