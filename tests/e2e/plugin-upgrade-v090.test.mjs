import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,readFileSync,writeFileSync,rmSync,readdirSync,lstatSync,chmodSync,symlinkSync,linkSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {hashBytes} from '../../dist/standalone/validation.js';
import {mergePluginFiles} from '../../dist/installation/plugin-merge.js';
import {PLUGIN_PATHS as P,PLUGIN_LIMITS} from '../../dist/installation/plugin-content.js';

const source=fileURLToPath(new URL('../..',import.meta.url));
const execute=(file,args,options={})=>new Promise((resolve,reject)=>execFile(file,args,{timeout:60000,maxBuffer:8*1024*1024,...options},(e,out,err)=>e?reject(Object.assign(Error('Command failed '+e.code+' '+out+'\n'+err),{output:out})):resolve(out)));
const textMap=(s,path='custom.txt')=>new Map(s===null?[]:[[path,Buffer.from(s)]]);
const code=c=>e=>e.code===c;
let base,rt,next,manager,upgrade,cli;
before(async()=>{
  base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-plugin-upgrade-')));
  const pack=JSON.parse(await execute('npm',['pack','--ignore-scripts','--json','--pack-destination',base],{cwd:source}));
  const roots=['runtime-base','runtime-next'].map(n=>join(base,n));
  for(const root of roots){mkdirSync(root,{mode:0o700});await execute('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--prefix',root,join(base,pack[0].filename)],{cwd:base});}
  // Both are actual offline installs. Changes below are explicitly synthetic
  // upstream templates, not claims of another released product version.
  const packageRoot=join(roots[1],'node_modules/@evopilot-next/ontology'),plugin=join(packageRoot,'plugins/codex');
  const manifest=JSON.parse(readFileSync(join(plugin,P.manifest)));manifest.version='0.9.0-test.upgrade';manifest.description='Synthetic upstream plugin revision';writeFileSync(join(plugin,P.manifest),JSON.stringify(manifest)+'\n');
  const skill=readFileSync(join(plugin,P.skill),'utf8').replace('description: Use the selected','description: Synthetic next template; use the selected');writeFileSync(join(plugin,P.skill),skill);
  const agent=readFileSync(join(plugin,P.agent),'utf8').replace('Independent Ontology modeling and retained draft recovery','Synthetic upstream description');writeFileSync(join(plugin,P.agent),agent);
  const installed=join(roots[0],'node_modules/@evopilot-next/ontology');
  const runtime=await import(pathToFileURL(join(installed,'dist/installation/runtime.js')));rt=runtime.inspectRuntime(roots[0]);next=runtime.inspectRuntime(roots[1]);
  manager=await import(pathToFileURL(join(installed,'dist/installation/manager.js')));upgrade=await import(pathToFileURL(join(installed,'dist/installation/plugin-upgrade.js')));cli=join(installed,'dist/standalone/cli.js');
});
after(()=>{if(base)rmSync(base,{recursive:true,force:true});});
function fixture(name){
  const i=manager.prepareInstallation({root:join(base,name+'-installation'),workspaceRoot:join(base,name+'-workspace'),workspaceId:name,projectId:'demo',principalId:'operator',runtimeRoot:rt.root,runtimeDigest:rt.digest,mode:'create'});
  return {i,plugin:join(i.root,'plugin'),input:{runtimeRoot:next.root,runtimeDigest:next.digest}};
}
const inspect=f=>upgrade.preparePluginUpgrade(f.i.root,f.input);
function inventory(root){
  const values=[];const visit=(p,r)=>{const s=lstatSync(p);values.push([r,s.mode&0o777,s.dev,s.ino,s.isFile()?hashBytes(readFileSync(p)):null]);if(s.isDirectory())for(const n of readdirSync(p).sort())visit(join(p,n),r+'/'+n);};visit(root,'');return values;
}
function resolutions(f,entries){const file=join(base,f.i.workspaceId+'-resolutions.json');writeFileSync(file,JSON.stringify({schema:'ontology-plugin-resolutions/v1',resolutions:entries})+'\n',{mode:0o600});f.input.resolutionsFile=file;return file;}
function resolution(entry,file){return {path:entry.path,baseDigest:entry.baseDigest,currentDigest:entry.currentDigest,newDigest:entry.newDigest,file};}
const reportFile=(p,path)=>p.report.files.find(f=>f.path===path);

test('actual installed preview merges independent customizations and new templates without modifying the owner',async()=>{
  const f=fixture('preserved');
  await manager.startInstallation(f.i.root);await manager.stopInstallation(f.i.root);
  const setup=readFileSync(join(f.i.root,'setup.json')),credentials=readFileSync(join(f.i.workspaceRoot,'credentials.json'));
  const upstream=join(next.packageRoot,'plugins/codex');
  const localSkill=readFileSync(join(f.plugin,P.skill),'utf8')+'\nLocal policy: private-synthetic-sentinel.\n';writeFileSync(join(f.plugin,P.skill),localSkill);
  const localAgent=readFileSync(join(f.plugin,P.agent),'utf8')+'# Keep this private comment and spacing.\n';writeFileSync(join(f.plugin,P.agent),localAgent);
  const manifest=JSON.parse(readFileSync(join(f.plugin,P.manifest)));manifest.interface.displayName='Private display name';writeFileSync(join(f.plugin,P.manifest),JSON.stringify(manifest,null,2)+'\n');
  const mcp=JSON.parse(readFileSync(join(f.plugin,P.mcp)));mcp.mcpServers['evopilot-ontology'].env.PRIVATE_TOKEN='private-synthetic-sentinel';mcp.mcpServers.other={command:'/private/explicit-other',args:['selected']};writeFileSync(join(f.plugin,P.mcp),JSON.stringify(mcp,null,2)+'\n');
  mkdirSync(join(f.plugin,'empty-custom'),{mode:0o700});writeFileSync(join(f.plugin,'custom.bin'),Buffer.from([0,255,1,128]),{mode:0o600});writeFileSync(join(f.plugin,'custom-executable'),Buffer.from('#!/bin/false\n'),{mode:0o700});
  const before=[inventory(f.i.root),inventory(f.i.workspaceRoot)],p=inspect(f),again=inspect(f);assert.equal(p.report.status,'MERGED');assert.equal(again.reportDigest,p.reportDigest);
  assert.equal(p.files.get(P.skill).toString(),readFileSync(join(upstream,P.skill),'utf8')+'\nLocal policy: private-synthetic-sentinel.\n');
  assert.equal(p.files.get(P.agent).toString(),readFileSync(join(upstream,P.agent),'utf8')+'# Keep this private comment and spacing.\n');
  const merged=JSON.parse(p.files.get(P.manifest));assert.equal(merged.version,'0.9.0-test.upgrade');assert.equal(merged.interface.displayName,'Private display name');assert.equal(merged.description,'Synthetic upstream plugin revision');
  const config=JSON.parse(p.files.get(P.mcp));assert.deepEqual(config.mcpServers.other,mcp.mcpServers.other);assert.equal(config.mcpServers['evopilot-ontology'].env.PRIVATE_TOKEN,'private-synthetic-sentinel');assert.deepEqual(config.mcpServers['evopilot-ontology'].args,[join(next.packageRoot,'dist/standalone/bridge.js'),'--connection',join(f.i.root,'connection.json')]);
  assert.deepEqual(p.files.get('custom.bin'),Buffer.from([0,255,1,128]));assert.ok(p.report.directories.some(d=>d.path==='empty-custom'));assert.equal(p.report.fileModes.find(e=>e.path==='custom-executable').mode,0o700);
  assert.deepEqual([inventory(f.i.root),inventory(f.i.workspaceRoot)],before);assert.deepEqual(readFileSync(join(f.i.root,'setup.json')),setup);assert.deepEqual(readFileSync(join(f.i.workspaceRoot,'credentials.json')),credentials);
  const out=await execute(process.execPath,[cli,'upgrade-plugin-inspect','--installation',f.i.root,'--runtime-root',next.root,'--runtime-digest',next.digest,'--json']);
  assert.ok(!out.includes('private-synthetic-sentinel'));const result=JSON.parse(out).result;assert.equal(result.reportDigest,p.reportDigest);assert.equal(result.report.runtimeActivated,false);assert.equal(result.report.toolchainsVerified,false);assert.equal(result.report.productAcceptance,'NOT_EVALUATED');assert.equal(manager.readInstallation(f.i.root).runtime.digest,rt.digest);
});

test('text conflicts are reviewable; explicit private resolutions bind all three exact inputs',()=>{
  const f=fixture('conflict'),path=join(f.plugin,P.skill);writeFileSync(path,readFileSync(path,'utf8').replace('description: Use the selected','description: Private conflicting choice; use the selected'));
  const p=inspect(f),entry=reportFile(p,P.skill);assert.equal(p.report.status,'CONFLICT');assert.equal(entry.action,'CONFLICT');assert.ok(entry.conflicts.some(c=>c.reason==='TEXT_EDIT_CONFLICT'&&c.startLine<=3&&c.endLine>=3));assert.equal(p.files.has(P.skill),false);
  const fixed=join(base,'resolved-skill.txt');writeFileSync(fixed,readFileSync(join(next.packageRoot,'plugins/codex',P.skill),'utf8')+'\nApproved synthetic local text.\n',{mode:0o600});resolutions(f,[resolution(entry,fixed)]);
  const resolved=inspect(f);assert.equal(resolved.report.status,'MERGED');assert.equal(reportFile(resolved,P.skill).action,'RESOLVED');assert.deepEqual(resolved.files.get(P.skill),readFileSync(fixed));
  writeFileSync(path,readFileSync(path,'utf8')+'Later local change\n');assert.throws(()=>inspect(f),code('PLUGIN_RESOLUTION_STALE'));
});

test('deleted required resources, changed launcher authority and invalid merged configuration remain conflicts',()=>{
  const f=fixture('required');unlinkSync(join(f.plugin,P.skill));let p=inspect(f),entry=reportFile(p,P.skill);assert.equal(p.report.status,'CONFLICT');assert.equal(entry.conflicts[0].reason,'DELETE_EDIT_CONFLICT');
  resolutions(f,[resolution(entry,null)]);assert.equal(reportFile(inspect(f),P.skill).conflicts[0].reason,'REQUIRED_PLUGIN_FILE');delete f.input.resolutionsFile;
  writeFileSync(join(f.plugin,P.skill),readFileSync(join(rt.packageRoot,'plugins/codex',P.skill)),{mode:0o600});
  const file=join(f.plugin,P.mcp),original=readFileSync(file),mcp=JSON.parse(original);mcp.mcpServers['evopilot-ontology'].command='/private/foreign-executor';writeFileSync(file,JSON.stringify(mcp));
  p=inspect(f);assert.ok(reportFile(p,P.mcp).conflicts.some(c=>c.reason==='OWNED_PLUGIN_BINDING'&&c.pointer.endsWith('/command')));
  const correct=JSON.parse(original);correct.mcpServers['evopilot-ontology'].args[0]=join(next.packageRoot,'dist/standalone/bridge.js');correct.mcpServers['evopilot-ontology'].env.NODE_OPTIONS='--require=/private/foreign';const fixed=join(base,'unsafe-resolved-mcp.json');writeFileSync(fixed,JSON.stringify(correct),{mode:0o600});resolutions(f,[resolution(reportFile(p,P.mcp),fixed)]);assert.ok(reportFile(inspect(f),P.mcp).conflicts.some(c=>c.reason==='OWNED_PLUGIN_BINDING'&&c.pointer.endsWith('/env')));delete f.input.resolutionsFile;
  writeFileSync(file,'{"mcpServers":{},"mcpServers":{}}');assert.equal(reportFile(inspect(f),P.mcp).conflicts[0].reason,'INVALID_PLUGIN_CONFIGURATION');
  writeFileSync(file,original);const agent=join(f.plugin,P.agent);writeFileSync(agent,readFileSync(agent,'utf8')+'policy:\n  allow_implicit_invocation: true\n');assert.equal(reportFile(inspect(f),P.agent).conflicts[0].reason,'INVALID_PLUGIN_CONFIGURATION');
});

test('resolution ambiguity, links, public permissions and excessive private files are refused',()=>{
  const f=fixture('unsafe'),custom=join(f.plugin,'custom');symlinkSync(join(f.i.workspaceRoot,'operator-token'),custom);assert.throws(()=>inspect(f),code('UNSAFE_PATH'));unlinkSync(custom);
  linkSync(join(f.i.workspaceRoot,'operator-token'),custom);assert.throws(()=>inspect(f),code('UNSAFE_PATH'));unlinkSync(custom);
  writeFileSync(custom,'private',{mode:0o644});assert.throws(()=>inspect(f),code('UNSAFE_PATH'));chmodSync(custom,0o600);
  writeFileSync(custom,Buffer.alloc(PLUGIN_LIMITS.fileBytes+1));assert.throws(()=>inspect(f),code('PLUGIN_LIMIT'));unlinkSync(custom);
  const p=inspect(f),entry=reportFile(p,P.skill),file=join(base,'duplicate-resolutions.json');writeFileSync(file,'{"schema":"wrong","schema":"ontology-plugin-resolutions/v1","resolutions":[]}',{mode:0o600});f.input.resolutionsFile=file;assert.throws(()=>inspect(f),code('PLUGIN_RESOLUTION'));
  resolutions(f,[resolution(entry,null),resolution(entry,null)]);assert.throws(()=>inspect(f),code('PLUGIN_RESOLUTION'));
  resolutions(f,[{...resolution(entry,null),path:'../escape'}]);assert.throws(()=>inspect(f),code('PLUGIN_PATH'));
});

test('runtime selection, stopped-owner and structural conflicts cannot be treated as an activated upgrade',async()=>{
  const f=fixture('selected');assert.throws(()=>upgrade.preparePluginUpgrade(f.i.root,{...f.input,runtimeDigest:rt.digest}),code('RUNTIME_CHANGED'));
  assert.throws(()=>upgrade.preparePluginUpgrade(f.i.root,{runtimeRoot:rt.root,runtimeDigest:rt.digest}),code('UNSAFE_PATH'));
  await manager.startInstallation(f.i.root);try{assert.throws(()=>inspect(f),code('INSTALLATION_RUNNING'));}finally{await manager.stopInstallation(f.i.root);}
  unlinkSync(join(f.plugin,P.mcp));mkdirSync(join(f.plugin,P.mcp),{mode:0o700});const p=inspect(f),entry=reportFile(p,P.mcp),fixed=join(base,'structural-mcp.json');
  const config={mcpServers:{'evopilot-ontology':{command:next.nodePath,args:[join(next.packageRoot,'dist/standalone/bridge.js'),'--connection',join(f.i.root,'connection.json')],env:{NODE_OPTIONS:'',NODE_PATH:''}}}};writeFileSync(fixed,JSON.stringify(config),{mode:0o600});resolutions(f,[resolution(entry,fixed)]);
  const conflict=inspect(f);assert.equal(conflict.report.status,'CONFLICT');assert.deepEqual(conflict.report.treeConflicts,[P.mcp]);assert.ok(lstatSync(join(f.plugin,P.mcp)).isDirectory());
});

test('independent line edits preserve exact CRLF, missing final newline and repeated-context bytes',()=>{
  for(const [b,c,n,expected] of [
    ['a\nb\nc\n','A\nb\nc\n','a\nb\nC\n','A\nb\nC\n'],
    ['a\r\nb\r\nc','A\r\nb\r\nc','a\r\nb\r\nC','A\r\nb\r\nC'],
    ['a\nb\nc\n','new\na\nb\nc\n','a\nb\nc\nend\n','new\na\nb\nc\nend\n'],
    ['x\na\nx\nb\nx\nc\nx\n','x\nA\nx\nb\nx\nc\nx\n','x\na\nx\nb\nx\nC\nx\n','x\nA\nx\nb\nx\nC\nx\n'],
    ['a\nb\nc\nd\ne\n','A\nb\nc\nD\ne\n','A\nb\nc\nd\nE\n','A\nb\nc\nD\nE\n'],
  ]){const p=mergePluginFiles(textMap(b),textMap(c),textMap(n));assert.equal(p.report[0].action,'MERGED');assert.equal(p.files.get('custom.txt').toString(),expected);}
  // Independent oracle: replace distinct positions, then require their union.
  const baseLines=Array.from({length:10},(_,i)=>'line-'+i+'\n');
  for(let a=0;a<10;a++)for(let b=0;b<10;b++)if(a!==b){const c=[...baseLines],n=[...baseLines],expected=[...baseLines];c[a]='local-'+a+'\n';n[b]='upstream-'+b+'\n';expected[a]=c[a];expected[b]=n[b];assert.equal(mergePluginFiles(textMap(baseLines.join('')),textMap(c.join('')),textMap(n.join(''))).files.get('custom.txt').toString(),expected.join(''));}
});

test('both-changed binary, overlapping insertions, deletion and complexity limits retain explicit unresolved outcomes',()=>{
  for(const [b,c,n,reason] of [['a\nb\n','a\nlocal\nb\n','a\nnew\nb\n','TEXT_EDIT_CONFLICT'],['a\nb\n','a\n','a\nB\n','TEXT_EDIT_CONFLICT'],['a',null,'b','DELETE_EDIT_CONFLICT'],[null,'a','b','ADD_ADD_CONFLICT'],['a\0','b\0','c\0','BINARY_CONFLICT']]){
    const p=mergePluginFiles(textMap(b),textMap(c),textMap(n));assert.equal(p.files.size,0);assert.equal(p.report[0].action,'CONFLICT');assert.ok(p.report[0].conflicts.some(c=>c.reason===reason));
  }
  const b=Array.from({length:2200},(_,i)=>'base-'+i+'\n').join(''),c=b.replaceAll('base','current'),n=b.replaceAll('base','next');assert.equal(mergePluginFiles(textMap(b),textMap(c),textMap(n)).report[0].conflicts[0].reason,'TEXT_MERGE_LIMIT');
  const identical=mergePluginFiles(textMap('old'),textMap('same\r\n'),textMap('same\r\n'));assert.equal(identical.files.get('custom.txt').toString(),'same\r\n');
});
