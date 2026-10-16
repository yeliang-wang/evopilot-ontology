// Test-only reproducible frozen reader/writer. Never included in product package files.
import { execFileSync } from 'node:child_process';
import { mkdirSync,writeFileSync,chmodSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
const head='1f493544be931898bf514cfaf52a3cb52838a8e1',root=new URL('./historical-v020/',import.meta.url),files=[];
const paths=execFileSync('git',['ls-tree','-r','--name-only',head,'src','vendor','assets','specifications','schemas'],{encoding:'utf8'}).trim().split('\n');
for(const path of paths){
 const source=execFileSync('git',['show',head+':'+path]);
 let output=path,bytes=source;
 if(path.startsWith('src/')){output=path.replace(/^src\//,'dist/');if(path.endsWith('.ts')){output=output.slice(0,-3)+'.js';bytes=Buffer.from(ts.transpileModule(source.toString(),{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText);}}
 const target=new URL(output,root);mkdirSync(dirname(target.pathname),{recursive:true});writeFileSync(target,bytes);if(output==='dist/cli.js')chmodSync(target,0o755);
 files.push({source:path,output,sourceSha256:createHash('sha256').update(source).digest('hex'),outputSha256:createHash('sha256').update(bytes).digest('hex')});
}
writeFileSync(new URL('source.json',root),JSON.stringify({purpose:'Synthetic historical state construction and retained 0.2.0 regression only; never current native acceptance or runtime distribution',head,compiler:'typescript@'+ts.version,files},null,2)+'\n');
