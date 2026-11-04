import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,realpathSync,writeFileSync,readFileSync,readdirSync,lstatSync,readlinkSync,chmodSync,linkSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {inspectTarArchive} from '../../dist/installation/distribution-archive.js';

const sha=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const INVALID='DISTRIBUTION_ARCHIVE_INVALID',LIMIT='DISTRIBUTION_ARCHIVE_LIMIT',CHANGED='DISTRIBUTION_ARCHIVE_CHANGED';
const BLOCK=512;

// Small real archive records, not parser mocks. Fixtures never execute their
// payloads and need neither tar, Python, Java nor an external package manager.
function field(buffer,at,width,value){
  const bytes=Buffer.from(value);assert.ok(bytes.length<=width,'Fixture field fits');bytes.copy(buffer,at);
}
function octal(buffer,at,width,value){field(buffer,at,width,value.toString(8).padStart(width-1,'0')+'\0');}
function checksum(header){
  header.fill(32,148,156);const sum=header.reduce((total,byte)=>total+byte,0);
  field(header,148,8,sum.toString(8).padStart(6,'0')+'\0 ');return header;
}
function header({name,type='0',mode=0o644,size=0,target='',prefix='',dialect='posix'}){
  const h=Buffer.alloc(BLOCK);field(h,0,100,name);octal(h,100,8,mode);octal(h,108,8,1000);octal(h,116,8,1000);
  octal(h,124,12,size);octal(h,136,12,1700000000);field(h,156,1,type);field(h,157,100,target);
  field(h,257,6,dialect==='gnu'?'ustar ':'ustar\0');field(h,263,2,dialect==='gnu'?' \0':'00');
  field(h,265,32,'fixture-owner');field(h,297,32,'fixture-group');field(h,345,155,prefix);return checksum(h);
}
function member(options){
  const data=Buffer.isBuffer(options.data)?options.data:Buffer.from(options.data??'');
  return Buffer.concat([header({...options,size:options.size??data.length}),data,Buffer.alloc((BLOCK-data.length%BLOCK)%BLOCK)]);
}
const tar=(records,tail=Buffer.alloc(2*BLOCK))=>Buffer.concat([...records,tail]);
function pax(key,value){
  const body=key+'='+value+'\n';let length=Buffer.byteLength(body)+2;
  for(;;){const line=length+' '+body,next=Buffer.byteLength(line);if(next===length)return Buffer.from(line);length=next;}
}
function fixture(t){
  const root=realpathSync(mkdtempSync(join(tmpdir(),'ontology-archive-test-')));let serial=0;
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  return {root,save(bytes,format='tar',overrides={}){
    const path=join(root,'archive-'+(++serial)+(format==='tar.gz'?'.tar.gz':'.tar'));writeFileSync(path,bytes,{mode:0o600});
    return {path,spec:{format,bytes:bytes.length,digest:sha(bytes),stripPrefix:null,maxEntries:128,maxFileBytes:64*1024,maxExpandedBytes:256*1024,maxTarBytes:512*1024,timeoutMs:10000,...overrides}};
  }};
}
function snapshot(root){
  const rows=[];
  const visit=(path,relative)=>{
    const s=lstatSync(path,{bigint:true});
    rows.push({path:relative,device:String(s.dev),inode:String(s.ino),mode:Number(s.mode),links:String(s.nlink),bytes:String(s.size),mtime:String(s.mtimeNs),ctime:String(s.ctimeNs),digest:s.isFile()?sha(readFileSync(path)):null,target:s.isSymbolicLink()?readlinkSync(path):null});
    if(s.isDirectory())for(const name of readdirSync(path).sort())visit(join(path,name),relative?relative+'/'+name:name);
  };visit(root,'');return rows;
}
async function inspectUnchanged(f,input){
  const before=snapshot(f.root);const result=await inspectTarArchive(input.path,input.spec);
  assert.deepEqual(snapshot(f.root),before,'Inspection must not write, extract, chmod or replace input state');return result;
}
async function rejectsUnchanged(f,input,code=INVALID,label=''){
  const before=snapshot(f.root);
  await assert.rejects(()=>inspectTarArchive(input.path,input.spec),error=>{assert.equal(error.code,code,label||error.message);return true;},label);
  assert.deepEqual(snapshot(f.root),before,'Rejected inspection must preserve physical input state: '+label);
}
function paths(inventory){return new Map(inventory.entries.map(entry=>[entry.path,entry]));}

test('tar inventory derives private directories and resolves contained links without extracting payloads',async t=>{
  const f=fixture(t),python=Buffer.from('synthetic executable bytes'),module=Buffer.from('VALUE = 7\n');
  const bytes=tar([
    member({name:'python/',type:'5',mode:0o755}),
    member({name:'python/bin/python3.12',mode:0o755,data:python}),
    member({name:'python/bin/python3',type:'2',target:'python3.12',mode:0o777}),
    member({name:'python/lib/pkg/__init__.py',mode:0o444,data:module}),
    member({name:'python/lib64',type:'2',target:'lib'}),
    member({name:'python/bin/module',type:'2',target:'../lib/pkg/__init__.py'}),
    member({name:'python/module',type:'2',target:'lib64/pkg/__init__.py'}),
    // A single explicit directory can confirm a parent inferred earlier.
    member({name:'python/lib/',type:'5',mode:0o755})
  ]);
  const input=f.save(bytes,'tar',{stripPrefix:'python'}),result=await inspectUnchanged(f,input),entries=paths(result);
  assert.equal(result.schema,'ontology-tar-inventory/v1');assert.equal(result.artifactDigest,sha(bytes));assert.equal(result.artifactBytes,bytes.length);assert.equal(result.tarBytes,bytes.length);
  assert.equal(result.entryCount,9);assert.equal(result.fileCount,2);assert.equal(result.directoryCount,3);assert.equal(result.symlinkCount,4);assert.equal(result.fileBytes,python.length+module.length);
  assert.deepEqual(result.entries.map(e=>e.path),['bin','bin/module','bin/python3','bin/python3.12','lib','lib/pkg','lib/pkg/__init__.py','lib64','module']);
  assert.equal(entries.has(''),false);assert.equal(entries.has('python'),false);
  assert.equal(entries.get('bin').derived,true);assert.equal(entries.get('lib/pkg').derived,true);assert.equal(entries.get('lib').derived,false);
  assert.equal(entries.get('bin/python3.12').digest,sha(python));assert.equal(entries.get('bin/python3.12').mode,0o700);
  assert.equal(entries.get('lib/pkg/__init__.py').digest,sha(module));assert.equal(entries.get('lib/pkg/__init__.py').mode,0o600);
  for(const [path,target,resolved] of [['bin/python3','python3.12','bin/python3.12'],['lib64','lib','lib'],['bin/module','../lib/pkg/__init__.py','lib/pkg/__init__.py'],['module','lib64/pkg/__init__.py','lib/pkg/__init__.py']]){
    const e=entries.get(path);assert.equal(e.kind,'symlink');assert.equal(e.target,target);assert.equal(e.resolvedTarget,resolved);assert.equal(e.digest,null);assert.equal(e.bytes,0);assert.equal(e.mode,0o700);assert.equal(e.derived,false);
  }
  for(const e of result.entries)if(e.kind!=='symlink'){assert.equal(e.target,null);assert.equal(e.resolvedTarget,null);if(e.kind==='directory'){assert.equal(e.mode,0o700);assert.equal(e.digest,null);assert.equal(e.bytes,0);}}
  assert.match(result.inventoryDigest,/^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(await inspectUnchanged(f,input),result,'Same bytes and specification have a stable inventory identity');
});

test('POSIX prefix fields, GNU ustar, stale C-string tails and mtime-only PAX remain readable',async t=>{
  const f=fixture(t),prefix='parent/'+ 'x'.repeat(105),payload=Buffer.from('data');
  const prefixed=await inspectUnchanged(f,f.save(tar([member({name:'leaf',prefix,data:payload})])));
  assert.equal(paths(prefixed).get(prefix+'/leaf').digest,sha(payload));
  const stale=header({name:'good.txt',size:payload.length,dialect:'gnu'});Buffer.from('../old-tail').copy(stale,10);checksum(stale);
  const raw=tar([Buffer.concat([stale,payload,Buffer.alloc(BLOCK-payload.length)])]);
  const gnu=await inspectUnchanged(f,f.save(raw));assert.deepEqual(gnu.entries.map(e=>e.path),['good.txt']);
  for(const mtime of ['1700000000.123456789','-1.25']){
    const bytes=tar([member({name:'././@PaxHeader',type:'x',data:pax('mtime',mtime)}),member({name:'python/data.txt',data:payload})]);
    const inventory=await inspectUnchanged(f,f.save(bytes,'tar',{stripPrefix:'python'}));
    assert.equal(inventory.entryCount,1);assert.deepEqual(inventory.entries.map(e=>e.path),['data.txt']);assert.equal(inventory.entries[0].digest,sha(payload));
  }
  const cases=await inspectUnchanged(f,f.save(tar([member({name:'A',data:'upper'}),member({name:'a',data:'lower'})])));
  assert.deepEqual(cases.entries.map(e=>e.path),['A','a'],'Archive virtual paths retain case-sensitive identity');
});

test('gzip preserves logical inventory and accounts for every decompressed tar block',async t=>{
  const f=fixture(t),raw=tar([member({name:'root/data.txt',data:'compressed fixture'})],Buffer.alloc(4*BLOCK));
  const plain=await inspectUnchanged(f,f.save(raw)),compressed=gzipSync(raw,{mtime:0}),gz=await inspectUnchanged(f,f.save(compressed,'tar.gz'));
  assert.deepEqual(gz.entries,plain.entries);assert.equal(gz.tarBytes,raw.length);assert.equal(gz.artifactBytes,compressed.length);assert.equal(gz.artifactDigest,sha(compressed));assert.equal(gz.fileBytes,plain.fileBytes);
  const corrupt=Buffer.from(compressed);corrupt[corrupt.length-8]^=1;
  for(const [label,bytes] of [['bad gzip checksum',corrupt],['truncated gzip',compressed.subarray(0,compressed.length-5)],['gzip trailing garbage',Buffer.concat([compressed,Buffer.from('garbage')])],['second tar after gzip end',Buffer.concat([compressed,gzipSync(tar([member({name:'extra',data:'x'})]))])]]){
    await rejectsUnchanged(f,f.save(bytes,'tar.gz'),INVALID,label);
  }
});

test('UTF-8 path and link fields preserve a leading U+FEFF instead of decoding it as a document marker',async t=>{
  const f=fixture(t),name='\uFEFFsafe';
  const result=await inspectUnchanged(f,f.save(tar([
    member({name:'safe',data:'plain'}),member({name,data:'different file'}),
    member({name:'link',type:'2',target:name})
  ])));
  const entries=paths(result);assert.equal(result.fileCount,2);
  assert.equal(entries.get(name).digest,sha('different file'));
  assert.equal(entries.get('link').target,name);assert.equal(entries.get('link').resolvedTarget,name);
  await rejectsUnchanged(f,f.save(tar([member({name:'safe',data:'plain'}),member({name:'link',type:'2',target:name})])),INVALID,'BOM-prefixed dangling target must not alias the plain file');
});

test('raw artifact identity and private single-link input are mandatory before scanning',async t=>{
  const f=fixture(t),bytes=tar([member({name:'file',data:'private artifact'})]);
  for(const changes of [{bytes:bytes.length+1},{bytes:bytes.length-1},{digest:'sha256:'+'0'.repeat(64)}])await rejectsUnchanged(f,f.save(bytes,'tar',changes),CHANGED);
  const publicFile=f.save(bytes);chmodSync(publicFile.path,0o664);await rejectsUnchanged(f,publicFile,'DISTRIBUTION_UNSAFE_ARTIFACT','group-writable');
  const linked=f.save(bytes);linkSync(linked.path,join(f.root,'second-hardlink'));await rejectsUnchanged(f,linked,'DISTRIBUTION_UNSAFE_ARTIFACT','multiply linked source');
  const regular=f.save(bytes),alias=join(f.root,'source-symlink');symlinkSync(regular.path,alias);await rejectsUnchanged(f,{path:alias,spec:regular.spec},'DISTRIBUTION_UNSAFE_ARTIFACT','source symlink');
  await rejectsUnchanged(f,{path:f.root,spec:regular.spec},'DISTRIBUTION_UNSAFE_ARTIFACT','directory source');
  const readonly=f.save(bytes);chmodSync(readonly.path,0o400);assert.equal((await inspectUnchanged(f,readonly)).fileCount,1,'Inspection does not require changing a read-only private input');
});

test('entry paths cannot escape, alias normalized names or violate the selected prefix',async t=>{
  const f=fixture(t);
  for(const name of ['/absolute','../outside','dir/../../outside','dir/../alias','dir//file','./file','dir/./file','dir\\file','control\nfile'])await rejectsUnchanged(f,f.save(tar([member({name,data:'x'})])),INVALID,name);
  const invalidUTF8=header({name:'x'});invalidUTF8[0]=0xff;checksum(invalidUTF8);await rejectsUnchanged(f,f.save(tar([invalidUTF8])),INVALID,'invalid UTF-8 path');
  for(const records of [[member({name:'other/data',data:'x'})],[member({name:'python',data:'x'})],[member({name:'python/data',data:'x'}),member({name:'outside',data:'x'})]])await rejectsUnchanged(f,f.save(tar(records),'tar',{stripPrefix:'python'}),INVALID,'prefix membership');
});

test('duplicates and file-directory conflicts fail regardless of archive order',async t=>{
  const f=fixture(t),file=name=>member({name,data:'x'}),directory=name=>member({name,type:'5',mode:0o755});
  const cases=[
    ['duplicate file',[file('a'),file('a')]],
    ['duplicate explicit directory',[directory('dir/'),directory('dir/')]],
    ['file before child',[file('a'),file('a/child')]],
    ['child before file',[file('a/child'),file('a')]],
    ['directory before file',[directory('a/'),file('a')]],
    ['file before directory',[file('a'),directory('a/')]],
    ['symlink before child',[member({name:'alias',type:'2',target:'real'}),file('alias/child'),file('real/target')]],
    ['child before symlink',[file('alias/child'),member({name:'alias',type:'2',target:'real'}),file('real/target')]]
  ];
  for(const [label,records] of cases)await rejectsUnchanged(f,f.save(tar(records)),INVALID,label);
});

test('links must resolve inside the virtual archive, never through host filesystem state',async t=>{
  const f=fixture(t);writeFileSync(join(f.root,'host-only'),'must not satisfy a dangling archive link',{mode:0o600});
  const cases=[
    ['absolute target',[member({name:'link',type:'2',target:'/etc/passwd'})]],
    ['escape target',[member({name:'link',type:'2',target:'../outside'})]],
    ['dangling target',[member({name:'link',type:'2',target:'host-only'})]],
    ['empty target',[member({name:'link',type:'2',target:''})]],
    ['self cycle',[member({name:'a',type:'2',target:'a'})]],
    ['two-link cycle',[member({name:'a',type:'2',target:'b'}),member({name:'b',type:'2',target:'a'})]],
    ['file used as directory',[member({name:'file',data:'x'}),member({name:'alias',type:'2',target:'file/child'})]]
  ];
  for(const [label,records] of cases)await rejectsUnchanged(f,f.save(tar(records)),INVALID,label);
});

test('hardlinks, special nodes, unreviewed tar extensions and privileged modes are rejected',async t=>{
  const f=fixture(t);
  for(const type of ['1','3','4','6','7','S','L','K','g'])await rejectsUnchanged(f,f.save(tar([member({name:'entry',type,target:'target'}),member({name:'target',data:'x'})])),INVALID,'type '+type);
  for(const mode of [0o4755,0o2755])await rejectsUnchanged(f,f.save(tar([member({name:'executable',mode,data:'x'})])),INVALID,'privileged mode '+mode.toString(8));
  for(const type of ['2','5'])await rejectsUnchanged(f,f.save(tar([member({name:'entry',type,target:type==='2'?'target':'',data:'nonempty'}),member({name:'target',data:'x'})])),INVALID,'non-file payload');
  for(const payload of [pax('path','replacement'),pax('linkpath','target'),pax('size','1'),pax('uid','0'),Buffer.concat([pax('mtime','1'),pax('mtime','2')]),pax('mtime','NaN'),Buffer.from('99 mtime=1\n'),Buffer.from([0x31,0x34,0x20,0x6d,0x74,0x69,0x6d,0x65,0x3d,0xff,0x0a])]){
    await rejectsUnchanged(f,f.save(tar([member({name:'././@PaxHeader',type:'x',data:payload}),member({name:'file',data:'x'})])),INVALID,'unsupported/malformed PAX');
  }
  const extended=member({name:'././@PaxHeader',type:'x',data:pax('mtime','1')});
  await rejectsUnchanged(f,f.save(tar([extended])),INVALID,'dangling PAX');
  await rejectsUnchanged(f,f.save(tar([extended,extended,member({name:'file',data:'x'})])),INVALID,'consecutive PAX headers');
});

test('header checksums, numeric fields, payload padding and complete tar termination are enforced',async t=>{
  const f=fixture(t),good=member({name:'file',data:'abc'}),badChecksum=Buffer.from(good);badChecksum[0]^=1;
  const badNumber=Buffer.from(good);badNumber.fill(57,124,136);checksum(badNumber.subarray(0,BLOCK));
  const binaryNumber=Buffer.from(good);binaryNumber[124]=0x80;checksum(binaryNumber.subarray(0,BLOCK));
  const badMagic=Buffer.from(good);badMagic.fill(0,257,265);checksum(badMagic.subarray(0,BLOCK));
  const badPadding=Buffer.from(good);badPadding[BLOCK+3]=1;
  const cases=[
    ['checksum',tar([badChecksum])],['non-octal size',tar([badNumber])],['base-256 size',tar([binaryNumber])],['unsupported header',tar([badMagic])],['nonzero payload padding',tar([badPadding])],
    ['truncated header',good.subarray(0,BLOCK-1)],['truncated payload',Buffer.concat([header({name:'file',size:100}),Buffer.from('short')])],
    ['no end blocks',good],['one end block',tar([good],Buffer.alloc(BLOCK))],['unaligned trailing bytes',Buffer.concat([tar([good]),Buffer.alloc(1)])],
    ['nonzero trailing block',Buffer.concat([tar([good]),Buffer.alloc(BLOCK,1)])],['second archive',Buffer.concat([tar([good]),tar([member({name:'second',data:'x'})])])]
  ];
  for(const [label,bytes] of cases)await rejectsUnchanged(f,f.save(bytes),INVALID,label);
});

test('file, aggregate, physical-header, derived-entry and decompressed-byte limits are independent',async t=>{
  const f=fixture(t);
  const cases=[
    ['one file exceeds budget',tar([member({name:'large',data:Buffer.alloc(129)})]),{maxFileBytes:128}],
    ['aggregate file bytes',tar([member({name:'a',data:Buffer.alloc(80)}),member({name:'b',data:Buffer.alloc(80)})]),{maxFileBytes:100,maxExpandedBytes:128}],
    ['derived parents count',tar([member({name:'a/b/c/file',data:'x'})]),{maxEntries:3}],
    ['PAX headers count',tar([member({name:'././@PaxHeader',type:'x',data:pax('mtime','1')}),member({name:'file',data:'x'})]),{maxEntries:1}],
    ['stripped prefix header counts',tar([member({name:'python/',type:'5'}),member({name:'python/file',data:'x'})]),{maxEntries:1,stripPrefix:'python'}]
  ];
  for(const [label,bytes,limits] of cases)await rejectsUnchanged(f,f.save(bytes,'tar',limits),LIMIT,label);
  const raw=tar([member({name:'zero-filled',data:Buffer.alloc(32*1024)})]),gz=gzipSync(raw);
  assert.ok(gz.length<1024,'Small compressed fixture has a larger declared payload');
  await rejectsUnchanged(f,f.save(gz,'tar.gz',{maxExpandedBytes:1024}),LIMIT,'compressed expansion');
  await rejectsUnchanged(f,f.save(gz,'tar.gz',{maxTarBytes:raw.length-1}),LIMIT,'decompressed tar including terminal blocks');
  const exact=await inspectUnchanged(f,f.save(raw,'tar',{maxEntries:1,maxFileBytes:32*1024,maxExpandedBytes:32*1024,maxTarBytes:raw.length}));
  assert.equal(exact.fileBytes,32*1024);assert.equal(exact.tarBytes,raw.length);
});

test('inspection has a real deadline and malformed specifications do not gain read authority',async t=>{
  const f=fixture(t),bytes=tar([member({name:'file',data:'x'})]);
  for(const override of [{format:'zip'},{bytes:-1},{digest:'not-a-digest'},{stripPrefix:'../escape'},{stripPrefix:'/absolute'},{stripPrefix:'python/'},{maxEntries:0},{maxFileBytes:-1},{maxExpandedBytes:-1},{maxTarBytes:-1},{timeoutMs:0},{timeoutMs:1.5}])await rejectsUnchanged(f,f.save(bytes,'tar',override),'INVALID_INPUT');
  // A bounded gzip stream forces actual asynchronous decompression work; the
  // deadline must abort it, not return an empty/partial successful inventory.
  const payloadBytes=8*1024*1024,raw=tar([member({name:'large',data:Buffer.alloc(payloadBytes,97)})]),gz=gzipSync(raw);
  await rejectsUnchanged(f,f.save(gz,'tar.gz',{maxFileBytes:payloadBytes,maxExpandedBytes:payloadBytes,maxTarBytes:raw.length,timeoutMs:1}),'DISTRIBUTION_ARCHIVE_TIMEOUT','bounded decompression deadline');
});
