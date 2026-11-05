// External acceptance fault injection, never an Ontology product capability.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {hashBytes} from '../../../scripts/standards-gate.mjs';

const program=`import os,sys,time
from pathlib import Path
p=Path(sys.argv[1]);s=p.stat()
assert str(s.st_dev)==sys.argv[2] and str(s.st_ino)==sys.argv[3]
assert (p/'memory.max').read_text().strip()=='2147483648'
assert (p/'memory.swap.max').read_text().strip()=='0'
assert (p/'memory.oom.group').read_text().strip()=='1'
assert (p/'pids.max').read_text().strip()=='128'
# Move only this newly spawned fault process into the exact retained test unit.
(p/'cgroup.procs').write_text('0')
assert Path('/proc/self/cgroup').read_text().strip()=='0::'+sys.argv[4]
print('ENTERED_EXACT_TEST_GROUP',flush=True)
x=[]
for i in range(192):
 x.append(bytearray(16*1024*1024))
raise RuntimeError('The 2 GiB group did not enforce its memory ceiling')
`;

export async function injectWorkerMemoryFault(c,f,taskId){
  const path=join(c.config.runtimeRoot,'node_modules/@evopilot-next/ontology/dist/installation/worker-journal.js');
  const {taskWorkerReferences,readWorkerAttempt}=await import(pathToFileURL(path).href);
  const root=join(f.installation,'formal-work'),end=performance.now()+10000;let reference,attempt;
  for(;;){
    const refs=taskWorkerReferences(root,taskId);assert(refs.length<=1);
    if(refs.length){reference=refs[0];attempt=readWorkerAttempt(reference);if(attempt.unit&&attempt.worker)break;assert.equal(attempt.outcome,null,'Original task ended before fault injection; do not redispatch');}
    assert(performance.now()<end,'Exact owned worker was not observed');await delay(10);
  }
  const unit=attempt.unit;assert.equal(unit.configurationDigest,attempt.intent.configurationDigest);
  assert(unit.unitName.startsWith('ontology-worker-')&&unit.unitName.endsWith('.service'));
  assert(unit.controlGroup.startsWith('/user.slice/')&&unit.controlGroup.endsWith('/'+unit.unitName));
  const python='/usr/bin/python3',args=['-B','-c',program,'/sys/fs/cgroup'+unit.controlGroup,unit.device,unit.inode,unit.controlGroup];
  c.observe({kind:'EXTERNAL_EXACT_WORKER_MEMORY_FAULT',productCapability:false,taskId,reference,unit,program,programDigest:hashBytes(program),executable:python,executableDigest:hashBytes(readFileSync(python)),maximumRequestedBytes:192*16*1024*1024,actualKernelCeiling:2147483648,scope:'Only a newly spawned test process joins the exact synthetic reasoner group; existing processes and limits are unchanged'});
  // Enter via the same ordinary user manager: a login session lies outside
  // its delegated cgroup subtree and cannot move itself into a user service.
  const faultUnit='ontology-acceptance-memory-'+reference.attemptId+'.service';
  const launch=['--user','--quiet','--wait','--pipe','--unit',faultUnit,'--property','MemoryMax=64M','--property','MemorySwapMax=0','--property','RuntimeMaxSec=25s',python,...args];
  c.observe({kind:'EXTERNAL_FAULT_LAUNCH',executable:'/usr/bin/systemd-run',digest:hashBytes(readFileSync('/usr/bin/systemd-run')),args:launch});
  const child=spawn('/usr/bin/systemd-run',launch,{stdio:['ignore','pipe','pipe'],env:{...process.env,PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}});let stdout='',stderr='',ended=false,overflow=false;
  child.stdout.on('data',b=>{stdout+=b;if(Buffer.byteLength(stdout)>65536){overflow=true;child.kill('SIGKILL');}});child.stderr.on('data',b=>{stderr+=b;if(Buffer.byteLength(stderr)>65536){overflow=true;child.kill('SIGKILL');}});
  const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{ended=true;resolve({code,signal});});});
  try{
    const exit=await Promise.race([closed,delay(20000,undefined,{ref:false}).then(()=>{throw Error('Memory fault did not close in its bounded interval');})]);
    c.observe({kind:'EXTERNAL_MEMORY_FAULT_EXIT',pid:child.pid,...exit,stdout,stderr});
    assert.equal(overflow,false);assert.equal(stdout.trim(),'ENTERED_EXACT_TEST_GROUP',stderr);assert.notEqual(exit.code,0,stderr);
    return {reference,readAttempt:()=>readWorkerAttempt(reference)};
  }finally{
    if(!ended){child.kill('SIGKILL');await closed;}
    const stopped=spawnSync('/usr/bin/systemctl',['--user','stop',faultUnit],{encoding:'utf8',timeout:10000,maxBuffer:65536});
    c.observe({kind:'EXTERNAL_FAULT_UNIT_CLEANUP',unit:faultUnit,status:stopped.status,stdout:stopped.stdout,stderr:stopped.stderr});assert.ifError(stopped.error);
    const state=spawnSync('/usr/bin/systemctl',['--user','is-active',faultUnit],{encoding:'utf8',timeout:10000,maxBuffer:65536});assert.ifError(state.error);assert(['inactive','failed','unknown'].includes(state.stdout.trim()),state.stdout);
  }
}
