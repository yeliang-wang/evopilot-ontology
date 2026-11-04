import test from 'node:test';
import assert from 'node:assert/strict';
import {constants,openSync,closeSync,fstatSync,mkdtempSync,realpathSync,mkdirSync,writeFileSync,readFileSync,readdirSync,lstatSync,readlinkSync,chmodSync,linkSync,symlinkSync,renameSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {gzipSync} from 'node:zlib';
import {hash,hashBytes} from '../../dist/standalone/validation.js';
import {inspectTarArchive,readTarArchive,validateArchiveInventory,validateArchiveEntryTree} from '../../dist/installation/distribution-archive.js';
import {materializeTarArchive,materializeMemoryTree,verifyMaterializedTree} from '../../dist/installation/distribution-materialize.js';

const EVIDENCE='DISTRIBUTION_MATERIALIZE_EVIDENCE',CHANGED='DISTRIBUTION_MATERIALIZE_CHANGED',UNSUPPORTED='DISTRIBUTION_MATERIALIZE_UNSUPPORTED';
const BLOCK=512;
function field(h,offset,width,value){const b=Buffer.from(value);assert.ok(b.length<=width);b.copy(h,offset);}
function octal(h,offset,width,value){field(h,offset,width,value.toString(8).padStart(width-1,'0')+'\0');}
function member({name,type='0',mode=0o644,target='',data=Buffer.alloc(0)}){
  const body=Buffer.from(data),h=Buffer.alloc(BLOCK);
  field(h,0,100,name);octal(h,100,8,mode);octal(h,108,8,1000);octal(h,116,8,1000);octal(h,124,12,body.length);octal(h,136,12,1700000000);
  field(h,156,1,type);field(h,157,100,target);field(h,257,6,'ustar\0');field(h,263,2,'00');h.fill(32,148,156);
  field(h,148,8,h.reduce((n,b)=>n+b,0).toString(8).padStart(6,'0')+'\0 ');
  return Buffer.concat([h,body,Buffer.alloc((BLOCK-body.length%BLOCK)%BLOCK)]);
}
const tar=records=>Buffer.concat([...records.map(member),Buffer.alloc(2*BLOCK)]);
const file=(path,data,mode=0o600)=>({path,kind:'file',mode,bytes:Buffer.byteLength(data),digest:hashBytes(data),target:null,resolvedTarget:null,derived:false});
const directory=path=>({path,kind:'directory',mode:0o700,bytes:0,digest:null,target:null,resolvedTarget:null,derived:false});
const link=(path,target)=>({path,kind:'symlink',mode:0o700,bytes:0,digest:null,target,resolvedTarget:null,derived:false});
function rootIdentity(path){
  const fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{const s=fstatSync(fd,{bigint:true});return {path,device:String(s.dev),inode:String(s.ino)};}finally{closeSync(fd);}
}
function put(path,data,mode=0o600){mkdirSync(dirname(path),{recursive:true,mode:0o700});writeFileSync(path,data,{mode});}
function snapshot(root){
  const rows=[];
  const visit=(path,relative)=>{
    const s=lstatSync(path,{bigint:true});
    rows.push({path:relative,device:String(s.dev),inode:String(s.ino),mode:String(s.mode),links:String(s.nlink),bytes:String(s.size),mtime:String(s.mtimeNs),ctime:String(s.ctimeNs),digest:s.isFile()?hashBytes(readFileSync(path)):null,target:s.isSymbolicLink()?readlinkSync(path):null});
    if(s.isDirectory())for(const name of readdirSync(path).sort())visit(join(path,name),relative?relative+'/'+name:name);
  };visit(root,'');return rows;
}
async function fixture(t,records=[{name:'file.bin',data:'selected payload bytes'}],{format='tar',stripPrefix=null}={}){
  const base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-materialize-'))),root=join(base,'target');mkdirSync(root,{mode:0o700});
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const plain=tar(records),bytes=format==='tar.gz'?gzipSync(plain):plain,archive=join(base,format==='tar.gz'?'input.tar.gz':'input.tar');
  writeFileSync(archive,bytes,{mode:0o600});
  const spec={format,bytes:bytes.length,digest:hashBytes(bytes),stripPrefix,maxEntries:128,maxFileBytes:256*1024,maxExpandedBytes:512*1024,maxTarBytes:1024*1024,timeoutMs:10000};
  const expected=await inspectTarArchive(archive,spec),identity=rootIdentity(root);
  return {base,root,archive,bytes,spec,expected,identity,materialize:()=>materializeTarArchive(archive,spec,expected,identity)};
}
async function rejectsUnchanged(base,action,code,label=''){
  const before=snapshot(base);await assert.rejects(async()=>action(),{code},label);assert.deepEqual(snapshot(base),before,'Rejection must preserve the selected existing state: '+label);
}
function inventory(entries){
  const body={schema:'ontology-tar-inventory/v1',artifactDigest:hashBytes('declared archive identity'),artifactBytes:2048,tarBytes:16384,entryCount:entries.length,
    fileCount:entries.filter(e=>e.kind==='file').length,directoryCount:entries.filter(e=>e.kind==='directory').length,symlinkCount:entries.filter(e=>e.kind==='symlink').length,fileBytes:entries.reduce((n,e)=>n+e.bytes,0),entries};
  return {...body,inventoryDigest:hash(body)};
}
function rehash(value){const {inventoryDigest,...body}=value;value.inventoryDigest=hash(body);return value;}

test('pure archive tree validation derives parents and resolves contained Python and venv links on every platform',()=>{
  const input=[file('python/bin/python3.12','synthetic interpreter',0o700),file('python/lib/pkg.py','VALUE = 1\n'),link('python/bin/python3','python3.12'),link('venv/bin/python3.12','../../python/bin/python3.12')],before=structuredClone(input);
  const entries=validateArchiveEntryTree(input,32),byPath=new Map(entries.map(e=>[e.path,e]));
  assert.deepEqual(input,before,'Pure tree validation does not mutate its input');
  assert.deepEqual(entries.map(e=>e.path),['python','python/bin','python/bin/python3','python/bin/python3.12','python/lib','python/lib/pkg.py','venv','venv/bin','venv/bin/python3.12']);
  assert.equal(byPath.get('venv/bin/python3.12').resolvedTarget,'python/bin/python3.12');assert.equal(byPath.get('python/bin/python3').resolvedTarget,'python/bin/python3.12');
  assert.equal(byPath.get('venv/bin').derived,true);assert.equal(byPath.get('venv/bin').mode,0o700);
  assert.deepEqual(validateArchiveEntryTree([file('A','upper'),file('a','lower')],2).map(e=>e.path),['A','a']);
  for(const bad of [
    [file('same','a'),file('same','b')],[file('parent','a'),file('parent/child','b')],
    [link('alias','real'),file('alias/child','a'),file('real/child','b')],
    [file('alias/child','a'),link('alias','real'),file('real/child','b')],
    [link('missing','outside')],[link('escape','../outside')],[link('absolute','/etc/passwd')],
    [link('a','b'),link('b','a')],[file('../outside','a')],[file('a/./b','a')],[{...file('wrong-mode','a'),mode:0o644}],
  ])assert.throws(()=>validateArchiveEntryTree(bad,32),{code:'DISTRIBUTION_ARCHIVE_INVALID'});
  assert.throws(()=>validateArchiveEntryTree([file('a/b/c/file','x')],3),{code:'DISTRIBUTION_ARCHIVE_LIMIT'});
});

test('retained archive inventory validation checks counters, exact schema, sorted closure and digest without filesystem evidence',()=>{
  const entries=validateArchiveEntryTree([file('bin/runtime','synthetic',0o700),link('bin/current','runtime'),file('config','v=1')],16),good=inventory(entries);
  const before=structuredClone(good);validateArchiveInventory(good);assert.deepEqual(good,before);
  const changes=[
    v=>v.extra='unrecognized',v=>v.schema='other',v=>v.entryCount++,v=>v.fileCount++,v=>v.directoryCount++,v=>v.symlinkCount++,v=>v.fileBytes++,
    v=>v.artifactBytes=0,v=>v.tarBytes=1024,v=>v.tarBytes++,v=>v.entries.reverse(),
    v=>v.entries.find(e=>e.kind==='file').mode=0o644,
    v=>v.entries.find(e=>e.kind==='symlink').resolvedTarget='config',
    v=>v.entries.find(e=>e.kind==='symlink').target='../missing',
    v=>{v.entries=v.entries.filter(e=>e.path!=='bin');v.entryCount--;v.directoryCount--;},
    v=>{v.entries.push({...v.entries[0]});v.entryCount++;v.directoryCount++;},
    v=>v.entries[0].unexpected=true,
  ];
  for(const change of changes){const bad=structuredClone(good);change(bad);rehash(bad);assert.throws(()=>validateArchiveInventory(bad),'A coherent self-hash alone cannot validate a contradictory tree');}
  const stale=structuredClone(good);stale.inventoryDigest=hashBytes('stale');assert.throws(()=>validateArchiveInventory(stale),{code:'INVALID_INPUT'});
  const empty=inventory([]);empty.tarBytes=1024;rehash(empty);validateArchiveInventory(empty);
});

test('archive consumer propagates the original injected write error; this is not a physical ENOSPC test',async t=>{
  const f=await fixture(t),before=snapshot(f.base);
  for(const point of ['onEntry','onFileChunk','onFileEnd']){
    const original=Object.assign(new Error('injected consumer failure at '+point),{code:'ENOSPC'});
    await assert.rejects(()=>readTarArchive(f.archive,f.spec,{[point](){throw original;}}),error=>{assert.equal(error,original);return true;});
    assert.deepEqual(snapshot(f.base),before,'A consumer failure must neither alter the input nor leak a later write');
  }
});

test('Linux backend materializes exact prefixes; unsupported platforms refuse without writes',async t=>{
  if(process.platform!=='linux'){
    const f=await fixture(t);
    await rejectsUnchanged(f.base,()=>f.materialize(),UNSUPPORTED);
    await rejectsUnchanged(f.base,()=>materializeMemoryTree(f.identity,[{path:'memory.txt',data:Buffer.from('payload'),mode:0o600}]),UNSUPPORTED);
    await rejectsUnchanged(f.base,()=>verifyMaterializedTree(f.identity,f.expected.entries),UNSUPPORTED);
    return;
  }

  await t.test('gzip materialization resumes an actual retained prefix and replays complete files without replacing them',async t=>{
    const payload=Buffer.alloc(96*1024+23);for(let n=0;n<payload.length;n++)payload[n]=n%251;
    const f=await fixture(t,[
      {name:'payload/',type:'5',mode:0o755},
      {name:'payload/data/body.bin',data:payload},
      {name:'payload/bin/tool',type:'2',target:'../scripts/tool',mode:0o777},
      {name:'payload/scripts/tool',data:'synthetic executable; never executed',mode:0o755},
      {name:'payload/data/empty',data:Buffer.alloc(0)},
    ],{format:'tar.gz',stripPrefix:'payload'});
    const partial=join(f.root,'data/body.bin');put(partial,payload.subarray(0,65541));const inode=lstatSync(partial).ino;
    assert.deepEqual(await f.materialize(),f.expected);assert.equal(lstatSync(partial).ino,inode);assert.deepEqual(readFileSync(partial),payload);
    assert.equal(lstatSync(partial).mode&0o777,0o600);assert.equal(lstatSync(join(f.root,'scripts/tool')).mode&0o777,0o700);
    assert.equal(readlinkSync(join(f.root,'bin/tool')),'../scripts/tool');assert.equal(lstatSync(join(f.root,'data/empty')).size,0);
    assert.deepEqual(readFileSync(f.archive),f.bytes);
    const complete=snapshot(f.base);verifyMaterializedTree(f.identity,f.expected.entries);assert.deepEqual(snapshot(f.base),complete);
    assert.deepEqual(await f.materialize(),f.expected);assert.deepEqual(snapshot(f.base),complete,'Complete replay must not replace nodes, chmod again or rewrite payloads');
  });

  await t.test('a foreign retained prefix is preserved instead of truncated or replaced',async t=>{
    const f=await fixture(t);put(join(f.root,'file.bin'),'WRONG');
    await rejectsUnchanged(f.base,()=>f.materialize(),EVIDENCE);
    assert.equal(readFileSync(join(f.root,'file.bin'),'utf8'),'WRONG');
  });

  await t.test('self-consistent forged inventory and changed raw payload are refused before target writes',async t=>{
    const f=await fixture(t),forged=structuredClone(f.expected);forged.entries[0].digest=hashBytes('different payload');rehash(forged);validateArchiveInventory(forged);
    await rejectsUnchanged(f.base,()=>materializeTarArchive(f.archive,f.spec,forged,f.identity),EVIDENCE);
    const changed=Buffer.from(f.bytes);changed[BLOCK]^=1;writeFileSync(f.archive,changed);
    await rejectsUnchanged(f.base,()=>f.materialize(),'DISTRIBUTION_ARCHIVE_CHANGED');
  });

  await t.test('preflight rejects unknown nodes, overlong files, hardlinks and substituted symlink ancestors',async t=>{
    const cases=[
      ['unknown',f=>put(join(f.root,'unrelated'),'preserve')],
      ['overlong',f=>put(join(f.root,'dir/a'),Buffer.alloc(100))],
      ['hardlink',f=>{put(join(f.root,'dir/a'),'same');linkSync(join(f.root,'dir/a'),join(f.root,'dir/b'));}],
      ['symlink file',f=>{put(join(f.base,'outside'),'same');mkdirSync(join(f.root,'dir'),{mode:0o700});symlinkSync(join(f.base,'outside'),join(f.root,'dir/a'));}],
      ['symlink parent',f=>{mkdirSync(join(f.base,'outside-dir'),{mode:0o700});put(join(f.base,'outside-dir/keep'),'preserve');symlinkSync(join(f.base,'outside-dir'),join(f.root,'dir'));}],
      ['nonprivate parent',f=>{mkdirSync(join(f.root,'dir'),{mode:0o700});chmodSync(join(f.root,'dir'),0o755);}],
    ];
    for(const [label,setup] of cases){
      const f=await fixture(t,[{name:'dir/a',data:'same'},{name:'dir/b',data:'same'}]);setup(f);
      await rejectsUnchanged(f.base,()=>f.materialize(),EVIDENCE,label);
    }
  });

  await t.test('replaced root inode and root-path symlink cannot acquire write authority',async t=>{
    const f=await fixture(t),original=join(f.base,'original-root');put(join(f.root,'keep'),'original owned bytes');
    renameSync(f.root,original);mkdirSync(f.root,{mode:0o700});
    await rejectsUnchanged(f.base,()=>f.materialize(),CHANGED);
    await rejectsUnchanged(f.base,()=>materializeMemoryTree(f.identity,[{path:'new',data:Buffer.from('x'),mode:0o600}]),CHANGED);
    await rejectsUnchanged(f.base,()=>verifyMaterializedTree(f.identity,f.expected.entries),CHANGED);
    assert.equal(readFileSync(join(original,'keep'),'utf8'),'original owned bytes');
    rmSync(f.root,{recursive:true});symlinkSync(original,f.root);
    await rejectsUnchanged(f.base,()=>f.materialize(),EVIDENCE);
  });

  await t.test('the exact-tree verifier refuses missing, changed and excess material without repairing it',async t=>{
    const files=[{path:'data/a',data:Buffer.from('alpha'),mode:0o600},{path:'data/b',data:Buffer.from('beta'),mode:0o700}],links=[{path:'bin/b',target:'../data/b'}];
    const entries=validateArchiveEntryTree([...files.map(f=>file(f.path,f.data,f.mode)),...links.map(l=>link(l.path,l.target))],32);
    for(const mutate of [
      root=>rmSync(join(root,'data/a')),
      root=>writeFileSync(join(root,'data/a'),'ALPHA'),
      root=>chmodSync(join(root,'data/b'),0o600),
      root=>put(join(root,'extra'),'foreign'),
      root=>{rmSync(join(root,'bin/b'));symlinkSync('../data/a',join(root,'bin/b'));},
    ]){
      const f=await fixture(t);await materializeMemoryTree(f.identity,files,links);
      const before=snapshot(f.base);verifyMaterializedTree(f.identity,entries);assert.deepEqual(snapshot(f.base),before);
      mutate(f.root);await rejectsUnchanged(f.base,()=>verifyMaterializedTree(f.identity,entries),EVIDENCE);
    }
  });

  await t.test('retained Python bytes stay immutable while contained final-path venv links and memory files resume',async t=>{
    const f=await fixture(t,[{name:'python/bin/python3.12',data:'synthetic interpreter only',mode:0o755},{name:'python/bin/python3',type:'2',target:'python3.12'},{name:'python/lib/pkg.py',data:'VALUE = 1\n'}],{stripPrefix:'python'});
    const python=join(f.root,'python');mkdirSync(python,{mode:0o700});
    await materializeTarArchive(f.archive,f.spec,f.expected,rootIdentity(python));
    const retained=[directory('python'),...f.expected.entries.map(e=>({...e,path:'python/'+e.path,resolvedTarget:e.resolvedTarget===null?null:'python/'+e.resolvedTarget}))];
    const files=[{path:'venv/pyvenv.cfg',data:Buffer.from('home = '+python+'/bin\ninclude-system-site-packages = false\n'),mode:0o600},{path:'venv/lib/python3.12/site-packages/example.py',data:Buffer.from('VALUE = 2\n'),mode:0o600}];
    const links=[{path:'venv/bin/python3.12',target:'../../python/bin/python3.12'},{path:'venv/bin/python3',target:'python3.12'},{path:'venv/bin/python',target:'python3.12'}];
    put(join(f.root,files[1].path),files[1].data.subarray(0,3));const pythonBefore=snapshot(python);
    await materializeMemoryTree(f.identity,files,links,retained);assert.deepEqual(snapshot(python),pythonBefore,'Retained Python subtree must not be rewritten or chmodded');
    for(const selected of links){assert.equal(readlinkSync(join(f.root,selected.path)),selected.target);assert.equal(realpathSync(join(f.root,selected.path)),join(python,'bin/python3.12'));}
    const all=validateArchiveEntryTree([...retained,...files.map(f=>file(f.path,f.data,f.mode)),...links.map(l=>link(l.path,l.target))],128),complete=snapshot(f.base);
    verifyMaterializedTree(f.identity,all);await materializeMemoryTree(f.identity,files,links,retained);assert.deepEqual(snapshot(f.base),complete);
    await rejectsUnchanged(f.base,()=>materializeMemoryTree(f.identity,[{path:'python/new.py',data:Buffer.from('not allowed'),mode:0o600}],[],retained),EVIDENCE);
    await rejectsUnchanged(f.base,()=>materializeMemoryTree(f.identity,files,[{path:'venv/bin/escape',target:'../../../outside'}],retained),'DISTRIBUTION_ARCHIVE_INVALID');
    writeFileSync(join(python,'lib/pkg.py'),'VALUE = 9\n');
    await rejectsUnchanged(f.base,()=>materializeMemoryTree(f.identity,files,links,retained),EVIDENCE);
  });

  await t.test('memory payload and inferred-entry budgets fail before filesystem mutation',async t=>{
    const f=await fixture(t);
    await rejectsUnchanged(f.base,()=>materializeMemoryTree(f.identity,[{path:'large',data:Buffer.alloc(32*1024*1024+1),mode:0o600}]),'DISTRIBUTION_MATERIALIZE_LIMIT');
    const files=Array.from({length:2000},(_,n)=>({path:'parent/file-'+n,data:Buffer.alloc(0),mode:0o600}));
    await rejectsUnchanged(f.base,()=>materializeMemoryTree(f.identity,files),'DISTRIBUTION_ARCHIVE_LIMIT');
  });
});
