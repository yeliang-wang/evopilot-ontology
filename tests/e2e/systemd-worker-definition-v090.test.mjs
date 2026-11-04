import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {validateSystemdUnitDefinition} from '../../dist/installation/systemd-worker.js';
import {hash} from '../../dist/standalone/validation.js';
import {ServiceError} from '../../dist/standalone/types.js';

// Pure synthetic D-Bus contract tests. No manager, installed executable or
// worker is started; these checks do not establish actual maintenance acceptance.
const currentLauncher=fileURLToPath(new URL('../../dist/installation/worker-supervisor.js',import.meta.url));
const historicalLauncher='/ontology-synthetic-unavailable/runtime old%/dist/installation/worker-supervisor.js';
const invocationBytes=Array.from({length:16},(_,n)=>n+16);
const invocationId=Buffer.from(invocationBytes).toString('hex');
const tuple=argv=>[[argv[0],[...argv],false,1790000000000000,1000000,1790000001000000,2000000,1234,1,0]];
function fixture(){
  const executable=path=>({path,digest:hash(path)}),identity={schema:'ontology-systemd-binding/v1',uid:1000,runtimeDirectory:'/run/user/1000',machineId:hash('synthetic-machine'),managerVersion:'255.4',run:executable('/synthetic/bin/systemd-run'),bus:executable('/synthetic/bin/busctl'),manager:executable('/synthetic/lib/systemd'),node:executable('/synthetic/bin/node')};
  const binding={...identity,digest:hash(identity)},plan={schema:'ontology-owned-worker/v2',systemd:{binding,owner:{bootId:'11111111-2222-3333-4444-555555555555',pid:123,startTicks:'456'}},requestId:'validation-synthetic',requestDigest:hash('request'),configurationDigest:hash('reasoning-configuration'),toolchainDigest:hash('toolchain'),executable:'/synthetic/bin/java',args:['-version'],env:{LANG:'C.UTF-8'},stdinDigest:hash('input'),stdinBytes:5,timeoutMs:10000,outputBytes:1048576,diagnosticBytes:65536};
  // Retained business JSON may reorder these keys. The actual launch argument
  // remains the explicitly ordered createWorkerAttempt representation.
  const reference={intentDigest:hash(plan),attemptId:'attempt-synthetic',journalId:'journal-synthetic',root:'/synthetic/owner%/formal-work'};
  const argument=JSON.stringify({root:reference.root,journalId:reference.journalId,attemptId:reference.attemptId,intentDigest:reference.intentDigest});
  const currentCommands=tuple([binding.node.path,currentLauncher,'--systemd',argument]);
  const current=validateSystemdUnitDefinition(reference,plan,null,currentCommands,invocationBytes);
  const historicalArgv=[binding.node.path,historicalLauncher,'--systemd',argument];
  const retained={schema:'ontology-worker-unit/v1',unitName:'ontology-worker-synthetic.service',invocationId,bootId:plan.systemd.owner.bootId,supervisorPid:1234,configurationDigest:hash({binding:binding.digest,properties:current.definition.properties,argv:historicalArgv}),controlGroup:'/user.slice/user-1000.slice/ontology-worker-synthetic.service',device:'1',inode:'2',recordedAt:'2026-11-04T00:00:00.000Z'};
  return {reference,plan,retained,commands:tuple(historicalArgv),invocationBytes:[...invocationBytes],current,currentCommands};
}
const check=f=>validateSystemdUnitDefinition(f.reference,f.plan,f.retained,f.commands,f.invocationBytes);
const rejected=f=>assert.throws(()=>check(f),e=>e instanceof ServiceError&&e.code==='WORKER_UNIT_CHANGED');

test('new admission requires the current launcher and preserves the original reference argument order',()=>{
  const f=fixture();
  assert.equal(f.current.invocationId,invocationId);
  assert.equal(f.current.definition.argv[1],currentLauncher);
  assert.notEqual(f.current.definition.argv[3],JSON.stringify(f.reference));
  assert.equal(f.current.definition.properties.MemoryMax,'2147483648');
  assert.equal(f.current.definition.properties.KillMode,'control-group');
  assert.equal(f.current.definition.properties.WorkingDirectory,'/synthetic/owner%%/formal-work');
  assert.equal(f.current.definition.digest,hash({binding:f.plan.systemd.binding.digest,properties:f.current.definition.properties,argv:f.current.definition.argv}));
  const retained={...f.retained,configurationDigest:f.current.definition.digest};
  assert.deepEqual(validateSystemdUnitDefinition(f.reference,f.plan,retained,f.currentCommands,f.invocationBytes),f.current);
});

test('an admitted historical launcher is accepted only through its original configuration and invocation',()=>{
  const f=fixture(),before=structuredClone(f),result=check(f);
  assert.deepEqual(result.definition.argv,f.commands[0][1]);
  assert.equal(result.definition.argv[1],historicalLauncher);
  assert.equal(result.definition.digest,f.retained.configurationDigest);
  assert.notEqual(result.definition.digest,f.current.definition.digest);
  assert.equal(result.invocationId,f.retained.invocationId);
  assert.deepEqual(f,before,'Identity projection must not rewrite retained evidence');
});

test('manager-supplied historical argv cannot establish a new admission',()=>{
  const f=fixture();f.retained=null;rejected(f);
  f.commands=f.currentCommands;assert.equal(check(f).definition.argv[1],currentLauncher);
});

test('complete typed ExecStart tuples reject malformed or ambiguous command metadata',()=>{
  const mutations=[
    f=>{f.commands=[];},
    f=>{f.commands.push(structuredClone(f.commands[0]));},
    f=>{f.commands[0]=f.commands[0].slice(0,2);},
    f=>{f.commands[0].push('extra');},
    f=>{f.commands[0][2]=true;},
    f=>{f.commands[0][2]='false';},
    f=>{f.commands[0][3]=-1;},
    f=>{f.commands[0][4]=0.5;},
    f=>{f.commands[0][5]='1790000001000000';},
    f=>{f.commands[0][6]=Number.MAX_SAFE_INTEGER+1;},
    f=>{f.commands[0][7]=0x100000000;},
    f=>{f.commands[0][8]='1';},
    f=>{f.commands[0][9]=-0x80000001;},
  ];
  for(const mutate of mutations){const f=fixture();mutate(f);rejected(f);}
});

test('historical launcher trust does not relax executable, flags or exact reference argv',()=>{
  const mutations=[
    f=>{f.commands[0][0]='/different/node';},
    f=>{f.commands[0][1][0]='/different/node';},
    f=>{f.commands[0][0]='/different/node';f.commands[0][1][0]='/different/node';},
    f=>{f.commands[0][1][1]='/different/worker-supervisor.js';},
    f=>{f.commands[0][1][1]='relative/worker-supervisor.js';},
    f=>{f.commands[0][1][1]='/historical/../worker-supervisor.js';},
    f=>{f.commands[0][1][1]+='\0';},
    f=>{f.commands[0][1][2]='--other-mode';},
    f=>{f.commands[0][1][3]=JSON.stringify(f.reference);},
    f=>{f.commands[0][1][3]=f.commands[0][1][3].replace('attempt-synthetic','another-attempt');},
    f=>{f.commands[0][1].push('--extra');},
    f=>{f.commands[0][1].pop();},
    f=>{f.commands[0][1][1]=null;},
  ];
  for(const mutate of mutations){const f=fixture();mutate(f);rejected(f);}
});

test('an unchanged configuration cannot authorize a different or malformed invocation',()=>{
  for(const bytes of [[...invocationBytes.slice(0,15),255],invocationBytes.slice(1),[...invocationBytes,0],[...invocationBytes.slice(0,15),-1],[...invocationBytes.slice(0,15),256],[...invocationBytes.slice(0,15),0.5],[...invocationBytes.slice(0,15),'1'],new Uint8Array(invocationBytes)]){
    const f=fixture();f.invocationBytes=bytes;rejected(f);
  }
  const f=fixture();f.retained.invocationId='00'.repeat(16);rejected(f);
});

test('an unchanged invocation cannot authorize altered configuration, policy or binding',()=>{
  const mutations=[
    f=>{f.retained.configurationDigest=hash('another-configuration');},
    f=>{f.retained.configurationDigest=f.current.definition.digest;},
    f=>{f.plan.timeoutMs+=1;},
    f=>{f.plan.systemd.binding.digest=hash('another-binding');},
  ];
  for(const mutate of mutations){const f=fixture();mutate(f);rejected(f);}
});
