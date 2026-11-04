import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,readFileSync,writeFileSync,rmSync,readdirSync,lstatSync,unlinkSync,existsSync,renameSync,chmodSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';

const source=fileURLToPath(new URL('../..',import.meta.url));
const execute=(file,args,options={})=>new Promise((resolve,reject)=>execFile(file,args,{timeout:60000,maxBuffer:16*1024*1024,...options},(error,stdout,stderr)=>error?reject(Error(stdout+'\n'+stderr)):resolve(stdout)));
let base,runtime,next,manager,control,workspace,validation,toolchains,tools,cli,nextCli;
const installations=new Set();
before(async()=>{
  assert.ok(process.env.EVOPILOT_TEST_DL_TOOLCHAIN&&process.env.EVOPILOT_TEST_SHACL_TOOLCHAIN,'Real installed tools required');
  base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-upgrade-cli-')));
  const packed=JSON.parse(await execute('npm',['pack','--ignore-scripts','--json','--pack-destination',base],{cwd:source})),roots=['base-runtime','next-runtime'].map(name=>join(base,name));
  for(const root of roots){mkdirSync(root,{mode:0o700});await execute('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--prefix',root,join(base,packed[0].filename)],{cwd:base});}
  // Actual installed packages with an explicitly synthetic next Expert template;
  // this fixture does not represent a published candidate or product acceptance.
  const skill=join(roots[1],'node_modules/@evopilot-next/ontology/plugins/codex/skills/evopilot-ontology-expert/SKILL.md');writeFileSync(skill,readFileSync(skill,'utf8')+'\nSynthetic public upgrade CLI candidate.\n');
  const installed=join(roots[0],'node_modules/@evopilot-next/ontology'),load=name=>import(pathToFileURL(join(installed,'dist',name+'.js'))),r=await load('installation/runtime');
  runtime=r.inspectRuntime(roots[0]);next=r.inspectRuntime(roots[1]);manager=await load('installation/manager');control=await load('installation/upgrade-control');workspace=await load('standalone/workspace');validation=await load('standalone/validation');toolchains=await load('installation/toolchains');
  const select=key=>({toolchainFile:process.env[key],toolchainDigest:JSON.parse(readFileSync(process.env[key])).digest});tools={dl:select('EVOPILOT_TEST_DL_TOOLCHAIN'),shacl:select('EVOPILOT_TEST_SHACL_TOOLCHAIN')};
  cli=join(roots[0],'node_modules/.bin/evopilot-ontology');nextCli=join(roots[1],'node_modules/.bin/evopilot-ontology');assert.equal(realpathSync(cli),join(installed,'dist/standalone/cli.js'));
});
function writable(path){if(lstatSync(path).isDirectory()){chmodSync(path,0o700);for(const name of readdirSync(path))writable(join(path,name));}}
after(async()=>{
  const failures=[];
  // These commands must never start services. If that assertion fails, retain
  // uncertain owner state rather than delete a root whose service cannot stop.
  for(const root of installations)if(existsSync(join(root,'current-run.json')))try{await manager.stopInstallation(root);}catch(error){failures.push(error);}
  if(failures.length)throw new AggregateError(failures,'Owned service exit is unproven; fixtures were preserved');
  if(base){writable(base);rmSync(base,{recursive:true,force:true});}
});
function fixture(name,configured=true){
  const i=manager.prepareInstallation({root:join(base,name+'-installation'),workspaceRoot:join(base,name+'-workspace'),workspaceId:name,projectId:'demo',principalId:'operator',runtimeRoot:runtime.root,runtimeDigest:runtime.digest,mode:'create'});installations.add(i.root);
  const binding={requestId:'original-bind',previousBindingDigest:null,...tools};if(configured)manager.bindInstallationToolchains(i.root,binding);
  return {i,binding,input:{requestId:'cli-'+name,upgradeRoot:join(base,name+'-upgrade'),runtimeRoot:next.root,runtimeDigest:next.digest,toolchains:configured?tools:null},inputFile:join(base,name+'-input.json'),p:null,s:null,reserve:null};
}
function raw(args,entry=cli){return new Promise((resolve,reject)=>execFile(process.execPath,[entry,...args],{cwd:base,timeout:60000,maxBuffer:16*1024*1024,env:{...process.env,NODE_NO_WARNINGS:'1'}},(error,stdout,stderr)=>{
  if(error?.signal||error&&typeof error.code!=='number'){reject(Error('CLI process failed: '+String(error)));return;}
  try{resolve({exitCode:error?.code??0,body:JSON.parse(stdout),stdout,stderr});}catch{reject(Error('CLI returned no single JSON response: '+stderr));}
}));}
async function success(args,entry=cli){const result=await raw(args,entry);assert.equal(result.exitCode,0,result.stdout);assert.equal(result.body.ok,true,result.stdout);return result.body.result;}
function failed(result,expected){assert.equal(result.exitCode,1,result.stdout);assert.equal(result.body.ok,false,result.stdout);if(expected)assert.equal(result.body.error.code,expected,result.stdout);else assert.equal(typeof result.body.error.code,'string');}
function args(f,command){
  if(command==='upgrade-status')return [command,'--installation',f.i.root,'--request-id',f.input.requestId,'--json'];
  return [command,'--installation',f.i.root,'--input',f.inputFile,...(command==='upgrade-inspect'?[]:['--expected-report',f.p.reportDigest]),...(command==='upgrade-activate'?['--expected-prepared',f.s.preparedDigest]:[]),'--json'];
}
async function inspect(f){writeFileSync(f.inputFile,JSON.stringify(f.input)+'\n',{mode:0o600});f.p=await success(args(f,'upgrade-inspect'));return f.p;}
async function stage(f){f.s=await success(args(f,'upgrade-stage'));if(f.s.status==='STAGED')f.reserve=readFileSync(record(f,'.reserve'));return f.s;}
const activate=(f,entry=cli)=>success(args(f,'upgrade-activate'),entry);
const record=(f,suffix='.json')=>join(f.i.root,workspace.UPGRADE_RECORDS,workspace.upgradeControlKey(f.input.requestId)+suffix);
const readJSON=path=>JSON.parse(readFileSync(path));
const node=path=>{const stat=lstatSync(path,{bigint:true});return {device:String(stat.dev),inode:String(stat.ino),mode:Number(stat.mode&0o777n)};};
function snapshot(root){
  if(!existsSync(root))return null;const entries=[];
  const visit=(path,relative)=>{const stat=lstatSync(path);entries.push([relative,stat.dev,stat.ino,stat.mode&0o777,stat.isFile()?validation.hashBytes(readFileSync(path)):null]);if(stat.isDirectory())for(const name of readdirSync(path).sort())visit(join(path,name),relative?relative+'/'+name:name);};visit(root,'');return entries;
}
const snapshots=f=>[f.i.root,f.i.workspaceRoot,f.input.upgradeRoot].map(snapshot);
async function rejectedUnchanged(f,command,expected,entry=cli){const before=snapshots(f),result=await raw(command,entry);failed(result,expected);assert.deepEqual(snapshots(f),before);return result;}
async function status(f,phase,entry=cli){
  const before=snapshots(f),result=await success(args(f,'upgrade-status'),entry);assert.deepEqual(snapshots(f),before,'Status must not create, repair or rewrite physical state');
  assert.equal(result.schema,'ontology-upgrade-status/v1');assert.equal(result.installationRoot,f.i.root);assert.equal(result.requestId,f.input.requestId);assert.equal(result.phase,phase);assert.equal(result.validation,'RETAINED_RECORDS_ONLY');assert.equal(result.runtimeHealth,'NOT_CHECKED');assert.equal(result.productAcceptance,'NOT_EVALUATED');assert.equal(result.authority,false);return result;
}
function noAutostart(f){assert.equal(existsSync(join(f.i.root,'current-run.json')),false);assert.deepEqual(readdirSync(join(f.i.root,'runs')),[]);}
function marker(f,root){const a=readJSON(record(f)),i=a.report.ownerSnapshot.installation;return {schema:'ontology-upgrade-barrier/v1',root,upgradeRoot:f.input.upgradeRoot,installationId:i.installationId,workspaceId:i.workspaceId,serviceId:i.serviceId,requestId:f.input.requestId,requestDigest:a.requestDigest,reportDigest:a.reportDigest};}
// Synthetic interruption reconstruction from actual completed, configured nodes.
// Preserve all component and seal identities; no product pause hook is involved.
function rewind(f){
  const sw=readJSON(record(f,'.switch.json'));assert.ok(!sw.components.some(c=>c.name==='formal-work'));
  for(const c of sw.components){renameSync(join(f.i.root,c.name),join(f.input.upgradeRoot,'next',c.name));if(c.previous)renameSync(join(f.input.upgradeRoot,'previous',c.name),join(f.i.root,c.name));}
  for(const suffix of ['.completed.json','.released.json'])unlinkSync(record(f,suffix));writeFileSync(record(f,'.reserve'),f.reserve,{mode:0o600});
  for(const root of [f.i.root,f.i.workspaceRoot,join(f.i.root,'formal-work')])writeFileSync(join(root,workspace.UPGRADE_BARRIER),JSON.stringify(marker(f,root))+'\n',{mode:0o600});return sw;
}

test('installed upgrade commands enforce strict flags and bounded local input before owner mutation',async()=>{
  const f=fixture('strict',false);await inspect(f);f.s={preparedDigest:'sha256:'+'a'.repeat(64)};
  for(const command of ['upgrade-stage','upgrade-activate','upgrade-abort','upgrade-status']){
    const valid=args(f,command),required=valid.filter(value=>value.startsWith('--')&&value!=='--json');
    for(const key of required){const at=valid.indexOf(key);await rejectedUnchanged(f,[...valid.slice(0,at),...valid.slice(at+2)],'INVALID_ARGUMENTS');}
    for(const invalid of [valid.filter(value=>value!=='--json'),[...valid,'--json'],[...valid,'--installation',f.i.root],[...valid,'--force'],[...valid,'unexpected'],[...valid,'--input']])await rejectedUnchanged(f,invalid,'INVALID_ARGUMENTS');
  }
  for(const command of ['upgrade-stage','upgrade-activate','upgrade-status'])await rejectedUnchanged(f,[...args(f,command),'--retained-report',f.inputFile],'INVALID_ARGUMENTS');
  const original=readFileSync(f.inputFile),large=join(base,'oversize-input.json'),link=join(base,'input-link.json');writeFileSync(large,Buffer.alloc(512*1024+1,32),{mode:0o600});symlinkSync(f.inputFile,link);
  const withInput=path=>args(f,'upgrade-stage').map(value=>value===f.inputFile?path:value);
  await rejectedUnchanged(f,withInput('relative.json'),'UNSAFE_PATH');await rejectedUnchanged(f,withInput(large),'INPUT_LIMIT');await rejectedUnchanged(f,withInput(base),'UNSAFE_PATH');await rejectedUnchanged(f,withInput(link));
  writeFileSync(f.inputFile,Buffer.from([0xc3,0x28]));await rejectedUnchanged(f,args(f,'upgrade-stage'));writeFileSync(f.inputFile,original);
  noAutostart(f);
});

test('installed inspect stage status activate and replay preserve private owner material without automatic startup',async()=>{
  const f=fixture('complete'),custom=join(f.i.root,'plugin/private.txt'),secret='synthetic-private-cli-sentinel';writeFileSync(custom,secret,{mode:0o400});
  const owner=snapshot(f.i.workspaceRoot),plugin=snapshot(join(f.i.root,'plugin')),credentials=readFileSync(f.i.credentialFile),before=snapshots(f);await inspect(f);assert.deepEqual(snapshots(f),before);assert.equal(f.p.report.status,'READY');
  const staged=await stage(f);assert.equal(staged.status,'STAGED');assert.equal(staged.runtimeActivated,false);assert.equal(staged.serviceStarted,false);assert.equal(staged.authority,false);const sealed=snapshots(f),replay=await stage(f);assert.equal(replay.replayed,true);assert.equal(replay.preparedDigest,staged.preparedDigest);assert.deepEqual(snapshots(f),sealed);
  const pending=await status(f,'STAGE_OWNED');assert.equal(pending.digests.prepared,null);assert.equal(pending.releaseState,'ABSENT');assert.equal(pending.identity.reportDigest,f.p.reportDigest);noAutostart(f);
  const complete=await activate(f);assert.equal(complete.status,'COMPLETED');assert.equal(complete.runtimeActivated,true);assert.equal(complete.serviceStarted,false);assert.equal(complete.authority,false);assert.equal(manager.readInstallation(f.i.root).runtime.digest,next.digest);assert.equal(toolchains.readToolchainLedger(manager.readInstallation(f.i.root)).records.at(-1).digest,staged.toolchainBindingDigest);
  assert.deepEqual(snapshot(f.i.workspaceRoot),owner);assert.deepEqual(snapshot(join(f.input.upgradeRoot,'previous/plugin')),plugin);assert.deepEqual(readFileSync(f.i.credentialFile),credentials);assert.equal(readFileSync(custom,'utf8'),secret);
  const terminal=await status(f,'COMPLETED');assert.equal(terminal.releaseState,'VALIDATED');assert.equal(terminal.recoveryDirection,'NONE');assert.equal(terminal.digests.prepared,staged.preparedDigest);assert.equal(terminal.digests.completion,complete.receiptDigest);
  const after=snapshots(f),again=await activate(f);assert.equal(again.replayed,true);assert.deepEqual(again.receipt,complete.receipt);assert.deepEqual(snapshots(f),after);assert.equal(manager.bindInstallationToolchains(f.i.root,f.binding).replayed,true);
  for(const root of [f.i.root,f.i.workspaceRoot,join(f.i.root,'formal-work')])workspace.requireMaintenanceAvailable(root);noAutostart(f);
  assert.equal(JSON.stringify([f.p,staged,pending,complete,terminal]).includes(secret),false);assert.equal(JSON.stringify([f.p,staged,pending,complete,terminal]).includes(credentials.toString('utf8').trim()),false);
});

test('installed pre-switch abort preserves the sealed candidate and replays without its external runtime or stage',async()=>{
  const f=fixture('abort'),owner=snapshot(f.i.workspaceRoot),plugin=snapshot(join(f.i.root,'plugin'));await inspect(f);await stage(f);const sealed=snapshot(f.input.upgradeRoot),first=await success(args(f,'upgrade-abort'));
  assert.equal(first.status,'ABORTED');assert.equal(first.receipt.partialMaterialRetained,true);assert.deepEqual(snapshot(f.input.upgradeRoot),sealed);assert.deepEqual(snapshot(f.i.workspaceRoot),owner);assert.deepEqual(snapshot(join(f.i.root,'plugin')),plugin);
  const terminal=await status(f,'ABORTED');assert.equal(terminal.releaseState,'VALIDATED');assert.equal(terminal.recoveryDirection,'NONE');assert.equal(terminal.digests.prepared,null);
  const moved=next.root+'-abort-unavailable';renameSync(f.input.upgradeRoot,f.input.upgradeRoot+'-retained');renameSync(next.root,moved);
  try{const replay=await success(args(f,'upgrade-abort'));assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,first.receipt);assert.deepEqual(await status(f,'ABORTED'),terminal);}finally{renameSync(moved,next.root);}
  noAutostart(f);
});

test('installed partial-admission abort accepts an actual raw report above 512 KiB and rejects absent invalid or oversized reports',async()=>{
  const f=fixture('partial-admission',false);
  // Real inventory entries make the parsed report itself exceed the ordinary
  // request cap; whitespace padding would not exercise this maintenance input.
  for(let index=0;index<2000;index++)writeFileSync(join(f.i.workspaceRoot,'retained-'+String(index).padStart(4,'0')+'-'+ 'x'.repeat(160)+'.txt'),'retained',{mode:0o600});
  await inspect(f);const reportBytes=Buffer.from(JSON.stringify(f.p.report)+'\n');assert.ok(reportBytes.length>512*1024);assert.ok(reportBytes.length<8*1024*1024);
  control.admitInstallationUpgrade(f.i.root,f.input,f.p.reportDigest);const admission=readFileSync(record(f));
  // Explicit synthetic admission-write interruption; the original full report
  // remains external, and later source material must survive an exact abort.
  for(const root of [f.i.root,f.i.workspaceRoot])unlinkSync(join(root,workspace.UPGRADE_BARRIER));unlinkSync(record(f));unlinkSync(record(f,'.reserve'));writeFileSync(record(f)+'.pending',admission.subarray(0,1000),{mode:0o600});
  const note=join(f.i.workspaceRoot,'later-private-note.txt');writeFileSync(note,'preserve after interruption',{mode:0o600});const pending=await status(f,'ADMISSION_PENDING');assert.deepEqual(pending.pendingRecords,['admission']);assert.equal(pending.recoveryDirection,'RECONCILE_ADMISSION');
  await rejectedUnchanged(f,args(f,'upgrade-abort'),'UPGRADE_ADMISSION_MISSING');
  const report=join(base,'retained-report.json'),oversize=join(base,'oversize-report.json'),link=join(base,'retained-report-link.json'),selected=path=>[...args(f,'upgrade-abort'),'--retained-report',path];
  writeFileSync(report,JSON.stringify({ok:true,result:f.p}),{mode:0o600});await rejectedUnchanged(f,selected(report));
  writeFileSync(report,JSON.stringify({...f.p.report,requestId:'another-request'}));await rejectedUnchanged(f,selected(report),'UPGRADE_EVIDENCE');
  writeFileSync(oversize,Buffer.alloc(8*1024*1024+1,32),{mode:0o600});await rejectedUnchanged(f,selected(oversize),'INPUT_LIMIT');await rejectedUnchanged(f,selected('relative-report.json'),'UNSAFE_PATH');
  writeFileSync(report,Buffer.from([0xc3,0x28]));await rejectedUnchanged(f,selected(report));writeFileSync(report,reportBytes);symlinkSync(report,link);await rejectedUnchanged(f,selected(link));
  const result=await success(selected(report));assert.equal(result.status,'ABORTED');assert.equal(readFileSync(note,'utf8'),'preserve after interruption');assert.deepEqual(readFileSync(record(f)),admission);assert.equal((await success(selected(report))).replayed,true);await status(f,'ABORTED');noAutostart(f);
});

test('installed status and activation recover an admitted switch with live installation metadata absent',async()=>{
  const f=fixture('missing-metadata');await inspect(f);await stage(f);const first=await activate(f),sw=rewind(f),plugin=sw.components.find(c=>c.name==='plugin');assert.ok(plugin);
  renameSync(join(f.i.root,'plugin'),join(f.input.upgradeRoot,'previous/plugin'));renameSync(join(f.input.upgradeRoot,'next/plugin'),join(f.i.root,'plugin'));renameSync(join(f.i.root,'installation.json'),join(f.input.upgradeRoot,'previous/installation.json'));assert.equal(existsSync(join(f.i.root,'installation.json')),false);
  const pending=await status(f,'SWITCH_RECORDED');assert.equal(pending.recoveryDirection,'FORWARD_ONLY');assert.equal(pending.digests.prepared,f.s.preparedDigest);assert.equal(pending.identity.installationId,f.i.installationId);
  await rejectedUnchanged(f,args(f,'upgrade-stage'),'UPGRADE_SWITCH_PENDING');await rejectedUnchanged(f,args(f,'upgrade-abort'),'UPGRADE_SWITCH_PENDING');
  const resumed=await activate(f);assert.deepEqual(resumed.receipt,first.receipt);assert.equal(resumed.serviceStarted,false);assert.equal(manager.readInstallation(f.i.root).runtime.digest,next.digest);
  for(const c of sw.components){assert.deepEqual(node(join(f.i.root,c.name)),c.next);if(c.previous)assert.deepEqual(node(join(f.input.upgradeRoot,'previous',c.name)),c.previous);}
  await status(f,'COMPLETED');assert.equal((await activate(f)).replayed,true);noAutostart(f);
});

test('installed historical completion status and replay survive later upgrade and unavailable original dependencies',async()=>{
  const f=fixture('historical');await inspect(f);await stage(f);const first=await activate(f),terminal=await status(f,'COMPLETED');
  const second={...f,input:{...f.input,requestId:'cli-return-original',upgradeRoot:join(base,'historical-return-upgrade'),runtimeRoot:runtime.root,runtimeDigest:runtime.digest},inputFile:join(base,'historical-return-input.json'),p:null,s:null,reserve:null};await inspect(second);await stage(second);await activate(second);assert.equal(manager.readInstallation(f.i.root).runtime.digest,runtime.digest);
  renameSync(f.input.upgradeRoot,f.input.upgradeRoot+'-retained');
  for(const [root,entry] of [[next.root,cli],[runtime.root,nextCli]]){
    const moved=root+'-unavailable';renameSync(root,moved);
    try{const before=snapshots(f),replay=await activate(f,entry);assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,first.receipt);assert.deepEqual(await status(f,'COMPLETED',entry),terminal);assert.deepEqual(snapshots(f),before);}finally{renameSync(moved,root);}
  }
  assert.equal(toolchains.readToolchainLedger(manager.readInstallation(f.i.root)).records.length,3);noAutostart(f);
});

test('installed status rejects forged completion history and released envelopes without repairing retained evidence',async()=>{
  const f=fixture('status-completion');await inspect(f);await stage(f);await activate(f);
  const completion=record(f,'.completed.json'),released=record(f,'.released.json'),originalCompletion=readFileSync(completion),originalRelease=readFileSync(released);
  // Synthetic completed-before-release control state. Status validates retained
  // history itself and must not perform cleanup or consult live runtime health.
  unlinkSync(released);const unfinished=await status(f,'COMPLETED');assert.equal(unfinished.releaseState,'ABSENT');assert.equal(unfinished.recoveryDirection,'CLEANUP_ONLY');
  for(const field of ['transitionDigest','installationDigest']){
    writeFileSync(completion,JSON.stringify({...JSON.parse(originalCompletion),[field]:'sha256:'+'f'.repeat(64)})+'\n');await rejectedUnchanged(f,args(f,'upgrade-status'),'UPGRADE_EVIDENCE');writeFileSync(completion,originalCompletion);
  }
  assert.deepEqual(await status(f,'COMPLETED'),unfinished);
  writeFileSync(released,JSON.stringify({...JSON.parse(originalRelease),completionDigest:'sha256:'+'f'.repeat(64)})+'\n',{mode:0o600});await rejectedUnchanged(f,args(f,'upgrade-status'),'UPGRADE_EVIDENCE');
  writeFileSync(released,originalRelease);assert.equal((await status(f,'COMPLETED')).releaseState,'VALIDATED');noAutostart(f);
});

test('installed status distinguishes absent requests from orphan or contradictory controls without repair',async()=>{
  const f=fixture('status-orphan',false),missing=await status(f,'NOT_FOUND');assert.equal(missing.identity,null);assert.equal(missing.recoveryDirection,'NONE');assert.equal(missing.releaseState,'ABSENT');assert.ok(Object.values(missing.digests).every(value=>value===null));assert.equal(existsSync(join(f.i.root,workspace.UPGRADE_RECORDS)),false);
  const controls=join(f.i.root,workspace.UPGRADE_RECORDS);mkdirSync(controls,{mode:0o700});writeFileSync(record(f,'.reserve'),'{}\n',{mode:0o600});await rejectedUnchanged(f,args(f,'upgrade-status'),'UPGRADE_EVIDENCE');unlinkSync(record(f,'.reserve'));
  writeFileSync(join(controls,'unrecognized-control'),'preserve unknown bytes',{mode:0o600});await rejectedUnchanged(f,args(f,'upgrade-status'),'UPGRADE_EVIDENCE');unlinkSync(join(controls,'unrecognized-control'));
  await inspect(f);await stage(f);const bytes=readFileSync(record(f));writeFileSync(record(f)+'.pending',bytes.subarray(0,100),{mode:0o600});await rejectedUnchanged(f,args(f,'upgrade-status'),'UPGRADE_EVIDENCE');noAutostart(f);
});
