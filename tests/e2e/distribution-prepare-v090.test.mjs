import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chmodSync,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,readlinkSync,realpathSync,rmSync,unlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {prepareDistribution,abortDistributionPreparation,inspectDistributionPreparation} from '../../dist/installation/distribution-prepare.js';
import {main} from '../../dist/standalone/cli.js';

const EVIDENCE='DISTRIBUTION_PREPARATION_EVIDENCE',UNOWNED='DISTRIBUTION_PREPARATION_UNOWNED';
const RESERVE_BYTES=8*1024*1024;
const sha=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value!==null&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
const hash=value=>sha(canonical(value));
const node=path=>{const s=lstatSync(path,{bigint:true});return {device:String(s.dev),inode:String(s.ino),mode:Number(s.mode&0o777n)};};
const syntheticNode=inode=>({device:'900000',inode:String(inode),mode:0o700});
const bytes=value=>Buffer.from(JSON.stringify(value)+'\n');
const clone=value=>structuredClone(value);

// These are explicitly synthetic retained-control fixtures. They establish
// envelope coherence and recovery refusal only: no archive is materialized,
// no tool/package bytes are installed and no Java/Python or hooks are executed.
// Original runtime, bundle and tool paths deliberately do not exist.
function archive(label,files){
  const entries=[],directories=new Set();
  for(const file of files){
    const parts=file.path.split('/');
    for(let i=1;i<parts.length;i++)directories.add(parts.slice(0,i).join('/'));
    const data=Buffer.from(file.data??'synthetic '+label);
    entries.push({path:file.path,kind:'file',mode:file.mode??0o600,bytes:data.length,digest:sha(data),target:null,resolvedTarget:null,derived:false});
  }
  for(const path of directories)entries.push({path,kind:'directory',mode:0o700,bytes:0,digest:null,target:null,resolvedTarget:null,derived:true});
  entries.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  const body={schema:'ontology-tar-inventory/v1',artifactDigest:sha('synthetic raw archive '+label),artifactBytes:1024,tarBytes:1024+entries.filter(e=>e.kind==='file').reduce((n,e)=>n+512+Math.ceil(e.bytes/512)*512,0),entryCount:entries.length,fileCount:files.length,directoryCount:directories.size,symlinkCount:0,fileBytes:entries.reduce((n,e)=>n+e.bytes,0),entries};
  return {...body,inventoryDigest:hash(body)};
}
function syntheticWheels(){
  return [['html5rdf','1.2.1','py2.py3'],['owlrl','7.6.2','py3'],['packaging','26.3','py3'],['prettytable','3.18.0','py3'],['pyparsing','3.3.3','py3'],['pyshacl','0.40.1','py3'],['rdflib','7.6.0','py3'],['wcwidth','0.9.2','py3']].map(([distribution,version,tag])=>{
    const data=Buffer.from('synthetic '+distribution),body={schema:'ontology-wheel-inventory/v1',filename:distribution+'-'+version+'-'+tag+'-none-any.whl',digest:sha('synthetic wheel '+distribution),bytes:32,distribution,version,expandedBytes:data.length,entries:[{path:distribution+'/synthetic.py',bytes:data.length,digest:sha(data),mode:0o600}]};
    return {...body,inventoryDigest:hash(body)};
  });
}
function fixture(t,{owned=true}={}){
  const root=realpathSync(mkdtempSync(join(tmpdir(),'ontology-prepare-control-')));chmodSync(root,0o700);
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const controlRoot=join(root,'control'),runtimeRoot=join(root,'absent-runtime'),toolRoot=join(root,'absent-tools');
  const report={schema:'ontology-distribution-preparation-report/v1',status:'PLAN_VERIFIED',fixturePurpose:'SYNTHETIC_RETAINED_CONTROL_ONLY',executorsExecuted:false,authority:false};
  const inspection={report,reportDigest:hash(report),authority:false};
  const input={schema:'ontology-distribution-prepare-input/v1',requestId:'synthetic-prepare-01',controlRoot,inspectionDigest:inspection.reportDigest,distribution:{schema:'ontology-distribution-inspect-input/v1',bundleId:'linux-arm64-temurin21-pbs20260211-candidate1',bundleRoot:join(root,'absent-bundle'),runtimeRoot,runtimeDigest:sha('synthetic runtime'),toolRoot,installationRoot:join(root,'absent-installation'),workspaceRoot:join(root,'absent-workspace')}};
  const runtime={root:runtimeRoot,packageRoot:join(runtimeRoot,'node_modules/@evopilot-next/ontology'),version:'0.9.0',digest:input.distribution.runtimeDigest,files:1,bytes:1,nodePath:join(root,'absent-node/bin/node'),nodeDigest:sha('synthetic Node'),nodeVersion:'24.14.0'};
  const wheels=syntheticWheels(),venvConfiguration='home = '+toolRoot+'/python/python/bin\ninclude-system-site-packages = false\nversion = 3.12.12\nexecutable = '+toolRoot+'/python/python/bin/python3.12\n';
  const archives=[
    {artifactId:'dl-payload',role:'dl',stripPrefix:'dl',inventory:archive('dl',[{path:'worker.jar'},{path:'dependencies/synthetic.jar'},{path:'engine-source/synthetic.java'}])},
    {artifactId:'java-runtime',role:'java',stripPrefix:'jdk-21.0.13+9-jre',inventory:archive('java',[{path:'bin/java',mode:0o700},{path:'lib/synthetic.so'},{path:'conf/synthetic.conf'},{path:'release'}])},
    {artifactId:'python-runtime',role:'python',stripPrefix:'python',inventory:archive('python',[{path:'bin/python3.12',mode:0o700}])},
    {artifactId:'python-wheels',role:'python',stripPrefix:null,inventory:archive('wheels',wheels.map(w=>({path:w.filename})))},
  ];
  const adapter={digest:sha('synthetic adapter'),bytes:17},compatibility={nodeVersion:'24.14.0',workerSourceDigest:sha('synthetic worker source'),dependencyLockDigest:sha('synthetic dependency lock'),shaclAdapterDigest:adapter.digest};
  const plan={schema:'ontology-distribution-preparation-plan/v1',recipe:'LINUX_ARM64_OFFLINE_V1',inputDigest:hash(input),manifestDigest:sha('synthetic catalog'),payloadRecipeDigest:sha('synthetic payload recipe'),runtime,toolParent:node(root),compatibility,archives,wheels,venvConfiguration,adapter,capacity:{toolBytes:65536,toolInodes:64,controlBytes:65536}};
  const write=(name,value)=>writeFileSync(join(controlRoot,name),Buffer.isBuffer(value)?value:bytes(value),{mode:0o600});
  const read=name=>JSON.parse(readFileSync(join(controlRoot,name),'utf8'));
  const f={root,input,inspection,plan,write,read,owner:null};
  if(owned){
    mkdirSync(controlRoot,{mode:0o700});
    f.owner={schema:'ontology-distribution-preparation-owner/v1',input:clone(input),inputDigest:hash(input),planDigest:hash(plan),node:node(controlRoot),parent:node(root)};
    write('owner.json',f.owner);
  }
  return f;
}
const reserve=f=>({schema:'ontology-distribution-preparation-reserve/v1',inputDigest:f.owner.inputDigest,planDigest:f.owner.planDigest,controlNode:f.owner.node});
const aborted=f=>({schema:'ontology-distribution-preparation-aborted/v1',requestId:f.input.requestId,inputDigest:f.owner.inputDigest,planDigest:f.owner.planDigest,inspectionDigest:f.input.inspectionDigest,toolRoot:f.input.distribution.toolRoot,partialMaterialsRetained:true,toolsBound:false,serviceStarted:false,authority:false});
function admit(f,direction='completion'){
  f.write('plan.json',f.plan);f.write('inspection.json',f.inspection);f.write('abort-ready.json',aborted(f));
  f.write('admission.json',{schema:'ontology-distribution-preparation-admission/v1',inputDigest:f.owner.inputDigest,planDigest:f.owner.planDigest,inspectionDigest:f.input.inspectionDigest,ownerDigest:hash(f.owner),reserveBytes:RESERVE_BYTES,authority:false});
  f.write(direction+'.reserve',direction==='completion'?Buffer.concat([bytes(reserve(f)),Buffer.alloc(RESERVE_BYTES,32)]):bytes(reserve(f)));
  return f;
}
function retainMaterialization(f){
  const toolNode=syntheticNode(100),tool={schema:'ontology-distribution-tool-root/v1',inputDigest:f.owner.inputDigest,planDigest:f.owner.planDigest,controlRoot:f.input.controlRoot,controlNode:f.owner.node,toolRoot:f.input.distribution.toolRoot,node:toolNode,parent:f.plan.toolParent};
  const components={schema:'ontology-distribution-component-roots/v1',inputDigest:f.owner.inputDigest,planDigest:f.owner.planDigest,toolNode,components:{dl:syntheticNode(101),java:syntheticNode(102),python:syntheticNode(103),shacl:syntheticNode(104),pythonRuntime:syntheticNode(105)}};
  const materialized={schema:'ontology-distribution-materialized/v1',inputDigest:f.owner.inputDigest,planDigest:f.owner.planDigest,toolNode,componentOwnersDigest:hash(components),archives:f.plan.archives.slice(0,3).map(a=>a.inventory.inventoryDigest),wheels:f.plan.wheels.map(w=>w.inventoryDigest),venvConfigurationDigest:sha(f.plan.venvConfiguration),adapterDigest:f.plan.adapter.digest,executorsExecuted:false,authority:false};
  f.write('tool-owner.json',tool);f.write('component-owners.json',components);f.write('materialized.json',materialized);
  return f;
}
function retainChains(f){
  const selectedRoot=f.input.distribution.toolRoot;
  const files=entries=>entries.filter(e=>e.kind!=='directory').map(e=>({path:e.path,kind:'file',digest:e.digest,mode:e.mode})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  const dlIdentity={schema:'ontology-dl-toolchain/v1',root:join(selectedRoot,'dl'),javaRoot:join(selectedRoot,'java'),javaVersion:'21.0.13',platform:'linux',arch:'arm64',engine:'hermit:1.4.5.519+evopilot.2;jfact:5.0.3;structural-alc:1',owlapi:'owlapi-distribution:5.5.1',workerSourceDigest:f.plan.compatibility.workerSourceDigest,dependencyLockDigest:f.plan.compatibility.dependencyLockDigest,runtimeFiles:files(f.plan.archives[0].inventory.entries),javaFiles:files(f.plan.archives[1].inventory.entries)};
  const runtimeFiles=[...files(f.plan.archives[2].inventory.entries).map(e=>({...e,path:'python/'+e.path})),...f.plan.wheels.flatMap(w=>w.entries.map(e=>({path:'venv/lib/python3.12/site-packages/'+e.path,kind:'file',digest:e.digest,mode:e.mode}))),{path:'venv/pyvenv.cfg',kind:'file',digest:sha(f.plan.venvConfiguration),mode:0o600},...['python','python3','python3.12'].map(name=>({path:'venv/bin/'+name,kind:'link',digest:hash(name==='python3.12'?'../../python/bin/python3.12':'python3.12'),mode:0o777}))].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  const shaclIdentity={schema:'ontology-shacl-toolchain/v2',root:join(selectedRoot,'shacl'),runtimeRoot:join(selectedRoot,'python'),python:join(selectedRoot,'python/venv/bin/python3.12'),pythonVersion:'3.12.12',pyshacl:'0.40.1',rdflib:'7.6.0',platform:'linux',arch:'arm64',adapterDigest:f.plan.adapter.digest,runtimeFiles};
  f.write('dl-toolchain.json',{...dlIdentity,digest:hash(dlIdentity)});f.write('shacl-toolchain.json',{...shaclIdentity,digest:hash(shaclIdentity)});return f;
}
const verification=f=>({schema:'ontology-distribution-prepared-verification/v1',inputDigest:f.owner.inputDigest,planDigest:f.owner.planDigest,materializedDigest:hash(f.read('materialized.json')),toolOwnerDigest:hash(f.read('tool-owner.json')),runtimeDigest:f.plan.runtime.digest,dl:{path:join(f.input.controlRoot,'dl-toolchain.json'),digest:f.read('dl-toolchain.json').digest},shacl:{path:join(f.input.controlRoot,'shacl-toolchain.json'),digest:f.read('shacl-toolchain.json').digest},filesVerified:true,executorsExecuted:false,authority:false});
const prepared=f=>{const verified=f.read('verified.json');return {schema:'ontology-distribution-prepared-receipt/v1',requestId:f.input.requestId,inputDigest:f.owner.inputDigest,planDigest:f.owner.planDigest,inspectionDigest:f.input.inspectionDigest,verificationDigest:hash(verified),toolRoot:f.input.distribution.toolRoot,runtimeDigest:f.input.distribution.runtimeDigest,dl:verified.dl,shacl:verified.shacl,filesMaterialized:true,loadabilityVerified:false,resourceBackendVerified:false,toolsBound:false,serviceStarted:false,hostConnected:false,productAcceptance:'NOT_EVALUATED',authority:false};};

function snapshot(root){
  if(!existsSync(root))return null;const rows=[];
  function visit(path,relative){
    const s=lstatSync(path,{bigint:true});
    rows.push({path:relative,device:String(s.dev),inode:String(s.ino),uid:String(s.uid),mode:Number(s.mode),links:String(s.nlink),bytes:String(s.size),mtime:String(s.mtimeNs),ctime:String(s.ctimeNs),digest:s.isFile()?sha(readFileSync(path)):null,target:s.isSymbolicLink()?readlinkSync(path):null});
    if(s.isDirectory())for(const name of readdirSync(path).sort())visit(join(path,name),relative?relative+'/'+name:name);
  }
  visit(root,'');return rows;
}
function preserved(f,before,label){
  assert.deepEqual(snapshot(f.root),before,label);
  assert.equal(existsSync(join(f.input.controlRoot,'operator.sqlite')),false,'Read-only state must not open/create a lease');
}
function status(f,expectedStatus,input=f.input){
  const before=snapshot(f.root),result=inspectDistributionPreparation(input);preserved(f,before,'Status preserves node, mode, content and timestamps');
  assert.equal(result.status,expectedStatus);assert.equal(result.authority,false);
  if(f.owner){assert.equal(result.currentToolVerification,'NOT_RUN');assert.equal(result.filesWritten,false);assert.equal(result.executorsExecuted,false);assert.equal(result.processLiveness,'NOT_INFERRED');}
  return result;
}
async function rejectUnchanged(f,operation,code=EVIDENCE,label=''){
  const before=snapshot(f.root);
  await assert.rejects(async()=>operation(),error=>{assert.equal(error.code,code,label||error.message);return true;},label);
  preserved(f,before,'Rejected operation preserves retained evidence: '+label);
}
async function rejectAll(f,code=EVIDENCE,input=f.input){
  for(const [label,operation] of [['status',()=>inspectDistributionPreparation(input)],['prepare',()=>prepareDistribution(input)],['abort',()=>abortDistributionPreparation(input)]])await rejectUnchanged(f,operation,code,label);
}
function absentOriginals(f){for(const key of ['runtimeRoot','bundleRoot','toolRoot','installationRoot','workspaceRoot'])assert.equal(existsSync(f.input.distribution[key]),false,key+' remains absent');}

test('NOT_FOUND status creates no control or lease and first preparation checks platform before mutation',async t=>{
  const f=fixture(t,{owned:false});assert.deepEqual(status(f,'NOT_FOUND'),{status:'NOT_FOUND',requestId:f.input.requestId,authority:false});
  const glibc=process.report.getReport().header.glibcVersionRuntime?.split('.').map(Number);
  const supported=process.platform==='linux'&&process.arch==='arm64'&&glibc?.length>=2&&(glibc[0]>2||glibc[0]===2&&glibc[1]>=28);
  await rejectUnchanged(f,()=>prepareDistribution(f.input),supported?'DISTRIBUTION_INSPECTION_REQUIRED':'DISTRIBUTION_PREPARATION_UNSUPPORTED');
  assert.equal(existsSync(f.input.controlRoot),false);absentOriginals(f);
});

test('empty or prefix-only bootstrap is observable but cannot be adopted before platform admission',async t=>{
  for(const pending of [null,Buffer.alloc(0),Buffer.from('{"schema":')]){
    const f=fixture(t,{owned:false});mkdirSync(f.input.controlRoot,{mode:0o700});if(pending!==null)f.write('owner.json.pending',pending);
    const result=status(f,'UNOWNED_BOOTSTRAP');assert.equal(result.automaticAdoption,false);assert.equal(result.materialsPreserved,true);
    await rejectUnchanged(f,()=>prepareDistribution(f.input),UNOWNED);await rejectUnchanged(f,()=>abortDistributionPreparation(f.input),UNOWNED);
    assert.equal(existsSync(join(f.input.controlRoot,'owner.json')),false);
  }
});

test('exact owner input and physical node conflicts are refused before platform or lease acquisition',async t=>{
  const f=fixture(t);status(f,'BOOTSTRAP_PENDING');
  for(const mutate of [i=>{i.requestId='another-request';},i=>{i.inspectionDigest=sha('another inspection');},i=>{i.distribution.toolRoot=join(f.root,'another-tool-root');}]){
    const input=clone(f.input);mutate(input);await rejectAll(f,EVIDENCE,input);
  }
  const owner=clone(f.owner);owner.node.inode=String(BigInt(owner.node.inode)+1n);f.write('owner.json',owner);await rejectAll(f);
});

test('unknown material and full plus pending records are preserved and never repaired by any entry point',async t=>{
  for(const kind of ['unknown','owner-pending','abort-pending','reserve-pending']){
    const f=fixture(t);status(f,'BOOTSTRAP_PENDING');
    if(kind==='unknown')f.write('foreign-control.json',{fixture:'not selected'});
    if(kind==='owner-pending')f.write('owner.json.pending',Buffer.alloc(0));
    if(kind==='abort-pending'){f.write('abort-ready.json',aborted(f));f.write('abort-ready.json.pending',bytes(aborted(f)).subarray(0,20));}
    if(kind==='reserve-pending'){admit(f);f.write('completion.reserve.pending',Buffer.alloc(0));}
    await rejectAll(f);
  }
});

test('ABORTED receipts replay unchanged without original runtime, bundle or tool health, including admitted history',async t=>{
  for(const admitted of [false,true]){
    const f=fixture(t);if(admitted){admit(f,'abort');unlinkSync(join(f.input.controlRoot,'abort-ready.json'));}
    const receipt=aborted(f);f.write('aborted.json',receipt);absentOriginals(f);
    const result=status(f,'ABORTED');assert.deepEqual(result.receipt,receipt);
    for(const operation of [()=>prepareDistribution(f.input),()=>abortDistributionPreparation(f.input)]){
      const before=snapshot(f.root),replayed=await operation();preserved(f,before,'Terminal replay is strictly read-only');
      assert.deepEqual(replayed,{status:'ABORTED',receipt,replayed:true,currentToolVerification:'NOT_RUN',authority:false});
    }
    absentOriginals(f);
  }
});

test('prepared and aborted terminal directions cannot coexist or supersede one another',async t=>{
  for(const kind of ['both-receipts','both-directions','aborted-forward']){
    const f=fixture(t);admit(f,'abort');unlinkSync(join(f.input.controlRoot,'abort-ready.json'));f.write('aborted.json',aborted(f));status(f,'ABORTED');
    if(kind==='both-receipts')f.write('prepared.json',{fixture:'conflicting terminal'});
    if(kind==='both-directions')f.write('prepared.reserve',bytes(reserve(f)));
    if(kind==='aborted-forward'){unlinkSync(join(f.input.controlRoot,'abort.reserve'));f.write('prepared.reserve',bytes(reserve(f)));}
    await rejectAll(f);
  }
});

test('admitted reserve loss, contradictory directions and damaged allocations never recreate headroom',async t=>{
  for(const selection of [[],['completion','prepared'],['completion','abort'],['prepared','abort'],['completion','prepared','abort']]){
    const f=admit(fixture(t));status(f,'ADMITTED');unlinkSync(join(f.input.controlRoot,'completion.reserve'));
    for(const direction of selection)f.write(direction+'.reserve',direction==='completion'?Buffer.concat([bytes(reserve(f)),Buffer.alloc(RESERVE_BYTES,32)]):bytes(reserve(f)));
    await rejectAll(f);assert.equal(existsSync(join(f.input.controlRoot,'completion.reserve')),selection.includes('completion'));
  }
  for(const damage of ['truncated','foreign','missing-with-pending']){
    const f=admit(fixture(t));status(f,'ADMITTED');
    if(damage==='truncated')f.write('completion.reserve',bytes(reserve(f)));
    if(damage==='foreign'){const content=Buffer.concat([bytes(reserve(f)),Buffer.alloc(RESERVE_BYTES,32)]);content[content.length-1]=33;f.write('completion.reserve',content);}
    if(damage==='missing-with-pending'){unlinkSync(join(f.input.controlRoot,'completion.reserve'));f.write('completion.reserve.pending',Buffer.alloc(0));}
    await rejectAll(f);
  }
});

test('status validates tool ownership and materialized closure from controls without consulting absent tool trees',async t=>{
  for(const [file,mutate] of [
    ['tool-owner.json',v=>{v.inputDigest=sha('foreign input');}],
    ['component-owners.json',v=>{v.planDigest=sha('foreign plan');}],
    ['materialized.json',v=>{v.componentOwnersDigest=sha('foreign components');}],
  ]){
    const f=retainMaterialization(admit(fixture(t)));status(f,'FINALIZING');absentOriginals(f);
    const value=f.read(file);mutate(value);f.write(file,value);
    await rejectUnchanged(f,()=>inspectDistributionPreparation(f.input),EVIDENCE,file);
  }
});

test('independent complete chain records and constructible verified.pending cannot hide corruption behind a normal phase',async t=>{
  for(const role of ['dl','shacl']){
    const f=retainChains(retainMaterialization(admit(fixture(t))));status(f,'FINALIZING');
    const file=role+'-toolchain.json',chain=f.read(file);chain.digest=sha('foreign full '+role+' chain');f.write(file,chain);
    await rejectUnchanged(f,()=>inspectDistributionPreparation(f.input),EVIDENCE,'independent full '+role+' chain');
  }
  const f=retainChains(retainMaterialization(admit(fixture(t))));status(f,'FINALIZING');
  const verified=verification(f);f.write('verified.json.pending',bytes(verified).subarray(0,64));status(f,'FINALIZING');
  f.write('verified.json.pending',Buffer.from('foreign'));
  await rejectUnchanged(f,()=>inspectDistributionPreparation(f.input),EVIDENCE,'constructible verification prefix');
});

function corruptChain(f,role,mutate){
  const file=role+'-toolchain.json',before=f.read(file),chain=clone(before);mutate(chain);
  const {digest:_old,...identity}=chain,changed={...identity,digest:hash(identity)};
  assert.notEqual(changed.digest,before.digest,'The synthetic corruption must alter content, not merely its stored digest');
  f.write(file,changed);
  assert.deepEqual(f.read('plan.json'),f.plan,'Original sealed plan remains fixed');
  assert.equal(hash(f.read('plan.json')),f.owner.planDigest);
  return changed;
}

const chainCorruptions=[
  ['dl','runtime file digest',chain=>{chain.runtimeFiles[0].digest=sha('different DL payload');}],
  ['dl','runtime file omission',chain=>{chain.runtimeFiles.pop();}],
  ['dl','Java file digest',chain=>{chain.javaFiles[0].digest=sha('different Java payload');}],
  ['dl','Java version',chain=>{chain.javaVersion='21.0.12';}],
  ['dl','worker source',chain=>{chain.workerSourceDigest=sha('different worker source');}],
  ['dl','dependency lock',chain=>{chain.dependencyLockDigest=sha('different dependency lock');}],
  ['shacl','runtime file digest',chain=>{chain.runtimeFiles.find(e=>e.kind==='file').digest=sha('different Python payload');}],
  ['shacl','venv link identity',chain=>{chain.runtimeFiles.find(e=>e.kind==='link').digest=hash('../../unselected/python');}],
  ['shacl','Python version',chain=>{chain.pythonVersion='3.12.11';}],
  ['shacl','adapter identity',chain=>{chain.adapterDigest=sha('different adapter');}],
];

test('FINALIZING rejects self-hashed complete chains that contradict the original plan',async t=>{
  for(const [role,label,mutate] of chainCorruptions){
    const f=retainChains(retainMaterialization(admit(fixture(t))));status(f,'FINALIZING');absentOriginals(f);
    corruptChain(f,role,mutate);
    await rejectUnchanged(f,()=>inspectDistributionPreparation(f.input),EVIDENCE,role+': '+label);
    absentOriginals(f);
  }
});

test('planned complete-chain bytes also determine valid and foreign pending prefixes without original materials',async t=>{
  for(const role of ['dl','shacl']){
    const f=retainChains(retainMaterialization(admit(fixture(t)))),file=role+'-toolchain.json',complete=bytes(f.read(file));
    unlinkSync(join(f.input.controlRoot,file));
    const prefix=complete.subarray(0,complete.length-8);f.write(file+'.pending',prefix);
    const observed=status(f,'FINALIZING');assert.equal(observed.partialRecordsRequireOriginalInputs,false);absentOriginals(f);
    const foreign=Buffer.from(prefix);foreign[foreign.length-1]^=1;f.write(file+'.pending',foreign);
    await rejectUnchanged(f,()=>inspectDistributionPreparation(f.input),EVIDENCE,role+' exact pending prefix');absentOriginals(f);
  }
});

test('self-consistent verification cannot authorize forward completion; supported Linux enters the real completion path',async t=>{
  const glibc=process.report.getReport().header.glibcVersionRuntime?.split('.').map(Number);
  const supported=process.platform==='linux'&&process.arch==='arm64'&&glibc?.length>=2&&(glibc[0]>2||glibc[0]===2&&glibc[1]>=28);
  for(const role of ['dl','shacl']){
    const f=retainChains(retainMaterialization(admit(fixture(t),'prepared')));
    f.write('verified.json',verification(f));status(f,'COMPLETION_PENDING');absentOriginals(f);
    corruptChain(f,role,chain=>{chain.runtimeFiles[0].digest=sha('self-consistent forward corruption '+role);});
    f.write('verified.json',verification(f));
    assert.equal(f.read('verified.json')[role].digest,f.read(role+'-toolchain.json').digest,'Verification is deliberately coherent with the altered manifest');
    await rejectUnchanged(f,()=>inspectDistributionPreparation(f.input),EVIDENCE,role+' forward status');
    if(!supported){
      // This actual call proves only the unsupported-platform refusal. It does
      // not claim that this platform entered complete() or acquired a lease.
      await rejectUnchanged(f,()=>prepareDistribution(f.input),'DISTRIBUTION_PREPARATION_UNSUPPORTED',role+' unsupported platform');
    }else{
      // Initialize only a valid empty lease in fixture setup. Then the real
      // product resume can acquire it without first creating metadata, making
      // the full before/after evidence snapshot meaningful at complete().
      const lease=join(f.input.controlRoot,'operator.sqlite');writeFileSync(lease,Buffer.alloc(0),{mode:0o600,flag:'wx'});
      const db=new DatabaseSync(lease);
      try{db.exec('PRAGMA journal_mode=DELETE;PRAGMA user_version=1');}finally{db.close();}
      const before=snapshot(f.root);
      await assert.rejects(prepareDistribution(f.input),error=>{assert.equal(error.code,EVIDENCE);return true;});
      assert.deepEqual(snapshot(f.root),before,'Real Linux forward refusal preserves all retained nodes and bytes, including the existing lease');
    }
    assert.equal(existsSync(join(f.input.controlRoot,'prepared.json')),false);absentOriginals(f);
  }
  t.diagnostic(supported?'Actual Linux ARM64 forward completion refusal was called; no tools or archives were present.':'Actual unsupported-platform prepare refusal was called; only retained status exercised plan coherence.');
});

test('PREPARED rejects coherently rehashed manifest, verification and receipt against the unchanged original plan',async t=>{
  for(const role of ['dl','shacl']){
    const f=retainChains(retainMaterialization(admit(fixture(t),'prepared')));
    f.write('verified.json',verification(f));f.write('prepared.json',prepared(f));status(f,'PREPARED');absentOriginals(f);
    corruptChain(f,role,chain=>{chain.runtimeFiles[0].digest=sha('self-consistent terminal corruption '+role);});
    f.write('verified.json',verification(f));f.write('prepared.json',prepared(f));
    assert.equal(f.read('prepared.json').verificationDigest,hash(f.read('verified.json')));
    assert.equal(f.read('prepared.json')[role].digest,f.read(role+'-toolchain.json').digest);
    await rejectAll(f);absentOriginals(f);
  }
});

test('coherent prepared historical controls replay without source health and reject an abort',async t=>{
  const f=retainChains(retainMaterialization(admit(fixture(t),'prepared')));
  f.write('verified.json',verification(f));f.write('prepared.json',prepared(f));const receipt=f.read('prepared.json');
  assert.deepEqual(status(f,'PREPARED').receipt,receipt);absentOriginals(f);
  const before=snapshot(f.root),result=await prepareDistribution(f.input);preserved(f,before,'Prepared receipt replay must not revalidate external executors');
  assert.deepEqual(result,{status:'PREPARED',receipt,replayed:true,currentToolVerification:'NOT_RUN',authority:false});
  await rejectUnchanged(f,()=>abortDistributionPreparation(f.input),'DISTRIBUTION_PREPARATION_COMPLETED');
});

test('public preparation CLI requires exact flags and preserves read-only status and terminal replay semantics',async t=>{
  for(const command of ['distribution-prepare','distribution-prepare-status','distribution-prepare-abort']){
    for(const tail of [[],['--json','--json'],['--json','--manifest','override'],['--json','--force','true'],['--json','--input','/duplicate.json']]){
      await assert.rejects(main([command,'--input','/must-not-read.json',...tail],()=>assert.fail('Invalid flags cannot produce a result')),e=>e.code==='INVALID_ARGUMENTS');
    }
    if(command!=='distribution-prepare')await assert.rejects(main([command,'--input','/must-not-read.json','--inspection','/must-not-read-report.json','--json'],()=>assert.fail()),e=>e.code==='INVALID_ARGUMENTS');
  }
  const f=fixture(t);f.write('aborted.json',aborted(f));const inputFile=join(f.root,'input.json');writeFileSync(inputFile,bytes(f.input),{mode:0o600});
  for(const command of ['distribution-prepare-status','distribution-prepare','distribution-prepare-abort']){
    const before=snapshot(f.root),results=[];await main([command,'--input',inputFile,'--json'],value=>results.push(value));
    preserved(f,before,'CLI replay/status preserves the whole fixture');assert.equal(results.length,1);assert.equal(results[0].status,'ABORTED');assert.deepEqual(results[0].receipt,aborted(f));
  }
});
