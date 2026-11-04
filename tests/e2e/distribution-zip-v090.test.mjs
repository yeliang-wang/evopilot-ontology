import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {inspectWheelArchive} from '../../dist/installation/distribution-zip.js';

const INVALID='DISTRIBUTION_WHEEL_INVALID',LIMIT='DISTRIBUTION_WHEEL_LIMIT',CHANGED='DISTRIBUTION_WHEEL_CHANGED';
const sha=data=>'sha256:'+createHash('sha256').update(data).digest('hex');
const base64=data=>'sha256='+createHash('sha256').update(data).digest('base64url');
const filename='demo_pkg-1.2.3-py3-none-any.whl',root='demo_pkg-1.2.3.dist-info';
const metadata='Metadata-Version: 2.4\nName: demo-pkg\nVersion: 1.2.3\n\nFixture description.\n';
const wheelText='Wheel-Version: 1.0\nGenerator: isolated-test-fixture\nRoot-Is-Purelib: true\nTag: py3-none-any\n';
const csvField=value=>/[",\r\n]/.test(value)?'"'+value.replaceAll('"','""')+'"':value;
const csv=rows=>rows.map(row=>row.map(csvField).join(',')).join('\n')+'\n';
function crc32(data){
  let c=0xffffffff;
  for(const byte of data){c^=byte;for(let bit=0;bit<8;bit++)c=c&1?(c>>>1)^0xedb88320:c>>>1;}
  return (c^0xffffffff)>>>0;
}

// Independent small ZIP records exercise actual byte layouts and decompression;
// no package manager, upstream code, external binary or filesystem extraction.
function zip(members,{prefix=Buffer.alloc(0),gap=Buffer.alloc(0),archiveComment=Buffer.alloc(0)}={}){
  const locals=[],centrals=[],localOffsets=[],centralOffsets=[];let offset=prefix.length;
  for(const member of members){
    const name=member.nameBytes??Buffer.from(member.path),data=Buffer.isBuffer(member.data)?member.data:Buffer.from(member.data??'');
    const method=member.method??8,compressed=member.compressed??(method===0?data:deflateRawSync(data));
    const extra=member.extra??Buffer.alloc(0),comment=member.comment??Buffer.alloc(0),localExtra=member.localExtra??extra;
    const flags=member.flags??0,mode=member.mode??0o100644,crc=member.crc??crc32(data),bytes=member.declaredBytes??data.length;
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(flags,6);local.writeUInt16LE(method,8);
    local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(bytes,22);local.writeUInt16LE(name.length,26);local.writeUInt16LE(localExtra.length,28);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(0x0314,4);central.writeUInt16LE(20,6);central.writeUInt16LE(flags,8);central.writeUInt16LE(method,10);
    central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(bytes,24);central.writeUInt16LE(name.length,28);central.writeUInt16LE(extra.length,30);central.writeUInt16LE(comment.length,32);
    central.writeUInt32LE(((mode<<16)|(member.dosAttribute??0))>>>0,38);central.writeUInt32LE(offset,42);
    localOffsets.push(offset);locals.push(Buffer.concat([local,name,localExtra,compressed]));offset+=locals.at(-1).length;
    centrals.push(Buffer.concat([central,name,extra,comment]));
  }
  const centralStart=offset+gap.length;let centralAt=centralStart;
  for(const c of centrals){centralOffsets.push(centralAt);centralAt+=c.length;}
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(members.length,8);end.writeUInt16LE(members.length,10);
  end.writeUInt32LE(centralAt-centralStart,12);end.writeUInt32LE(centralStart,16);end.writeUInt16LE(archiveComment.length,20);
  return {raw:Buffer.concat([prefix,...locals,gap,...centrals,end,archiveComment]),localOffsets,centralOffsets,eocd:centralAt,centralStart};
}
function wheel(options={}){
  const dist=options.root??root,recordPath=dist+'/RECORD';
  const members=[...(options.payloads??[{path:'demo_pkg/__init__.py',data:'VALUE = 42\n'}]),{path:dist+'/METADATA',data:options.metadata??metadata},{path:dist+'/WHEEL',data:options.wheelText??wheelText}];
  const rows=members.map(m=>{const data=Buffer.isBuffer(m.data)?m.data:Buffer.from(m.data??'');return [m.path,base64(data),String(data.length)];});rows.push([recordPath,'','']);
  members.push({path:recordPath,data:options.record??(options.recordTransform?options.recordTransform(rows):csv(rows))});
  const selected=options.membersTransform?options.membersTransform(members):members;
  return {...zip(selected,options.zipOptions),filename:options.filename??filename};
}
function expected(f){return {filename:f.filename,digest:sha(f.raw),bytes:f.raw.length};}
function inspect(f,override={}){
  const before=Buffer.from(f.raw),result=inspectWheelArchive(f.raw,{...expected(f),...override});
  assert.deepEqual(f.raw,before,'Successful inspection preserves source bytes');return result;
}
function reject(f,code=INVALID,label='',override={}){
  const before=Buffer.from(f.raw);
  assert.throws(()=>inspectWheelArchive(f.raw,{...expected(f),...override}),error=>{assert.equal(error.code,code,label||error.message);return true;},label);
  assert.deepEqual(f.raw,before,'Rejected inspection preserves source bytes: '+label);
}
function changedZip(mutate){const f=wheel();mutate(f.raw,f);return f;}

test('purelib wheels return exact bounded payloads with canonical metadata and detached 0600 data',()=>{
  const f=wheel({payloads:[{path:'demo_pkg/z.txt',data:'data, not code\n',method:0},{path:'demo_pkg/__init__.py',data:'VALUE = 42\n',method:8},{path:'demo_pkg/cache.pickle',data:Buffer.from([0x80,0x04,0x95,0x00])},{path:root+'/entry_points.txt',data:'[console_scripts]\ndemo = demo_pkg:main\n'}]});
  const result=inspect(f),again=inspect(f);
  assert.equal(result.schema,'ontology-wheel-inventory/v1');assert.equal(result.distribution,'demo_pkg');assert.equal(result.version,'1.2.3');
  assert.equal(result.digest,sha(f.raw));assert.equal(result.bytes,f.raw.length);assert.equal(result.inventoryDigest,again.inventoryDigest);
  assert.deepEqual(result.entries.map(e=>e.path),result.entries.map(e=>e.path).sort());
  assert.equal(result.expandedBytes,result.entries.reduce((n,e)=>n+e.bytes,0));
  for(const e of result.entries){assert.equal(e.mode,0o600);assert.equal(e.bytes,e.data.length);assert.equal(e.digest,sha(e.data));}
  assert.equal(result.entries.find(e=>e.path==='demo_pkg/z.txt').data.toString(),'data, not code\n');
  assert.ok(result.entries.some(e=>e.path.endsWith('/entry_points.txt')),'Entry point metadata is retained as inert content');
  const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value!==null&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
  const {inventoryDigest,entries,...meta}=result;
  assert.equal(inventoryDigest,sha(canonical({...meta,entries:entries.map(({data,...e})=>e)})),'Inventory identity excludes Buffer data and binds stable metadata');
  const original=Buffer.from(f.raw);result.entries.find(e=>e.path==='demo_pkg/z.txt').data.fill(0);
  assert.deepEqual(f.raw,original,'Stored payload results do not alias the input buffer');
});

test('real upstream permission patterns normalize safely, including nine owlrl and one rdflib executable Python sources',()=>{
  // Observed modes in the pinned wheels: owlrl has nine 0100755 .py files,
  // rdflib has one; html5rdf/wcwidth include 0100664; poetry also emits 0000644.
  const owlrl=['AxiomaticTriples','Closure','CombinedClosure','DatatypeHandling','OWLRL','OWLRLExtras','RDFSClosure','XsdDatatypes','__init__'];
  const payloads=owlrl.map(name=>({path:'owlrl/'+name+'.py',mode:0o100755,data:'# inert fixture\n'}));
  payloads.push({path:'rdflib/plugins/parsers/notation3.py',mode:0o100755,data:'# inert fixture\n'},{path:'html5rdf/data.txt',mode:0o100664,data:'data'},{path:'wcwidth/table.py',mode:0o100664,data:'# inert fixture\n'},{path:'demo_pkg/poetry.py',mode:0o644,data:'# inert fixture\n'});
  const result=inspect(wheel({payloads}));assert.ok(result.entries.every(e=>e.mode===0o600));
  for(const mode of [0o104755,0o102755,0o101644])reject(wheel({payloads:[{path:'demo_pkg/code.py',mode,data:'# never run\n'}]}),INVALID,'special permission '+mode.toString(8));
  reject(wheel({payloads:[{path:'demo_pkg/script',mode:0o100755,data:'#!/bin/sh\n'}]}),INVALID,'non-Python executable');
});

test('compressed Python tags, folded legacy metadata and UTF-8 path byte identities remain coherent',()=>{
  const result=inspect(wheel({filename:'demo_pkg-1.2.3-py2.py3-none-any.whl',metadata:'Metadata-Version: 2.1\nName: Demo.Pkg\nVersion: 1.2.3\nLicense: first line\n        second line\n        \n        final line\n\nBody.\n',wheelText:wheelText.replace('Tag: py3-none-any','Tag: py2-none-any\nTag: py3-none-any'),payloads:[{path:'\uFEFFinitial.py',data:'# BOM belongs to the filename\n',flags:0x800},{path:'demo_pkg/名字.py',data:'# unicode\n',flags:0x800},{path:'demo_pkg/A.py',data:'A=1'},{path:'demo_pkg/a.py',data:'a=2'},{path:'demo_pkg/comma,"quote".txt',data:'csv path'}],recordTransform:rows=>csv(rows).replaceAll('\n','\r\n')}));
  assert.ok(result.entries.some(e=>e.path==='\uFEFFinitial.py'));
  assert.ok(result.entries.some(e=>e.path==='demo_pkg/名字.py'));
  assert.equal(result.entries.filter(e=>/\/a\.py$/i.test(e.path)).length,2,'Case-sensitive paths retain distinct identities');
  assert.ok(result.entries.some(e=>e.path==='demo_pkg/comma,"quote".txt'));
  inspect(wheel({filename:'demo_pkg-1.2.3-1-py3-none-any.whl',wheelText:wheelText+'Build: 1\n'}));
});

test('expected raw identity, parameter shape and fixed raw/entry/expansion budgets fail before unbounded processing',()=>{
  const f=wheel();reject(f,CHANGED,'wrong digest',{digest:'sha256:'+'0'.repeat(64)});reject(f,CHANGED,'wrong raw size',{bytes:f.raw.length+1});
  reject(f,'INVALID_INPUT','invalid digest',{digest:'sha256:no'});reject(f,'INVALID_INPUT','extra field',{extra:true});
  reject(f,'INVALID_INPUT','invalid size',{bytes:-1});
  const huge={raw:Buffer.alloc(8*1024*1024+1),filename};reject(huge,LIMIT,'raw byte budget');
  reject(changedZip((b,f)=>{b.writeUInt16LE(1001,f.eocd+8);b.writeUInt16LE(1001,f.eocd+10);}),LIMIT,'entry budget');
  reject(wheel({payloads:[{path:'demo_pkg/huge.txt',data:'small',declaredBytes:16*1024*1024+1}]}),LIMIT,'declared expansion budget');
  reject(wheel({payloads:[{path:'demo_pkg/compressed.txt',data:Buffer.alloc(64*1024,65),declaredBytes:1}]}),INVALID,'actual deflate expansion exceeds declared size');
});

test('local and central records cannot disagree or conceal prefix, gaps, trailing bytes or duplicate offsets',()=>{
  const mutations=[
    ['local name',(b,f)=>{b[f.localOffsets[0]+30]^=1;}],
    ['local flags',(b,f)=>b.writeUInt16LE(0x800,f.localOffsets[0]+6)],
    ['local compression',(b,f)=>b.writeUInt16LE(0,f.localOffsets[0]+8)],
    ['local timestamp',(b,f)=>b.writeUInt16LE(1,f.localOffsets[0]+10)],
    ['local size',(b,f)=>b.writeUInt32LE(999,f.localOffsets[0]+22)],
    ['central offset overlap',(b,f)=>b.writeUInt32LE(0,f.centralOffsets[1]+42)],
    ['central count omits member',(b,f)=>{b.writeUInt16LE(3,f.eocd+8);b.writeUInt16LE(3,f.eocd+10);}],
    ['central size',(b,f)=>b.writeUInt32LE(1,f.eocd+12)],
    ['local signature',(b,f)=>b.writeUInt32LE(0,f.localOffsets[0])],
    ['central signature',(b,f)=>b.writeUInt32LE(0,f.centralOffsets[0])],
  ];
  for(const [label,mutate] of mutations)reject(changedZip(mutate),INVALID,label);
  reject(wheel({zipOptions:{prefix:Buffer.from('SFX')}}),INVALID,'self-extracting prefix');
  reject(wheel({zipOptions:{gap:Buffer.from('unindexed')}}),INVALID,'gap before central directory');
  const f=wheel();reject({...f,raw:Buffer.concat([f.raw,Buffer.from('tail')])},INVALID,'trailing garbage');
  for(const cut of [1,21,22,60,f.raw.length-1])reject({...f,raw:f.raw.subarray(0,f.raw.length-cut)},INVALID,'truncated '+cut);
});

test('unsupported ZIP features are rejected without interpreting ambiguous installation data',()=>{
  for(const [label,member] of [
    ['encryption',{flags:1}],['data descriptor',{flags:8}],['unknown flag',{flags:0x10}],['compression method',{method:12}],
    ['central extra',{extra:Buffer.from([1,0,0,0])}],['local-only extra',{localExtra:Buffer.from([1,0,0,0])}],['member comment',{comment:Buffer.from('comment')}],['DOS directory',{dosAttribute:0x10}],
  ])reject(wheel({payloads:[{path:'demo_pkg/data.txt',data:'data',...member}]}),INVALID,label);
  reject(wheel({zipOptions:{archiveComment:Buffer.from('comment')}}),INVALID,'archive comment');
  for(const [label,mutate] of [
    ['multidisk',(b,f)=>b.writeUInt16LE(1,f.eocd+4)],
    ['entry disk',(b,f)=>b.writeUInt16LE(1,f.centralOffsets[0]+34)],
    ['ZIP64 count',(b,f)=>{b.writeUInt16LE(0xffff,f.eocd+8);b.writeUInt16LE(0xffff,f.eocd+10);}],
    ['ZIP64 offset',(b,f)=>b.writeUInt32LE(0xffffffff,f.centralOffsets[0]+42)],
    ['ZIP64 member size',(b,f)=>b.writeUInt32LE(0xffffffff,f.centralOffsets[0]+24)],
    ['unsupported required version',(b,f)=>b.writeUInt16LE(45,f.centralOffsets[0]+6)],
    ['unsupported creator',(b,f)=>b.writeUInt16LE(0x0714,f.centralOffsets[0]+4)],
  ])reject(changedZip(mutate),INVALID,label);
});

test('payload validation verifies CRC, exact stored/deflated sizes and compressed input consumption',()=>{
  reject(wheel({payloads:[{path:'demo_pkg/x.txt',data:'payload',crc:0}]}),INVALID,'CRC mismatch despite local/central agreement');
  reject(wheel({payloads:[{path:'demo_pkg/x.txt',data:'payload',method:0,declaredBytes:6}]}),INVALID,'stored size');
  const compressed=deflateRawSync(Buffer.from('payload'));
  reject(wheel({payloads:[{path:'demo_pkg/x.txt',data:'payload',compressed:Buffer.concat([compressed,Buffer.from('hidden')])}]}),INVALID,'deflate trailing bytes');
  reject(wheel({payloads:[{path:'demo_pkg/x.txt',data:'payload',compressed:compressed.subarray(0,-1)}]}),INVALID,'truncated deflate');
  reject(wheel({payloads:[{path:'demo_pkg/x.txt',data:'payload',declaredBytes:8}]}),INVALID,'decoded size below claim');
  const empty=inspect(wheel({payloads:[{path:'demo_pkg/empty.txt',data:''}]}));assert.equal(empty.entries.find(e=>e.path.endsWith('/empty.txt')).bytes,0);
});

test('unsafe paths, aliases, file ancestors and nonregular/native installation payloads fail closed',()=>{
  for(const path of ['../escape.py','/absolute.py','C:/drive.py','demo_pkg/../escape.py','demo_pkg//x.py','./demo_pkg/x.py','demo_pkg\\x.py','demo_pkg/x\0.py','demo_pkg/x\n.py','demo_pkg/x\u0085.py','demo_pkg/directory/','demo_pkg-1.2.3.data/scripts/run','demo_pkg/start.pth','demo_pkg/module.so','demo_pkg/lib.so.1','demo_pkg/module.pyd','demo_pkg/app.exe','demo_pkg/cache.pyc',root+'/RECORD.jws'])reject(wheel({payloads:[{path,data:'x'}]}),INVALID,path);
  reject(wheel({payloads:[{path:'same.py',data:'a'},{path:'same.py',data:'b'}]}),INVALID,'duplicate name');
  reject(wheel({payloads:[{path:'demo_pkg',data:'file'},{path:'demo_pkg/child.py',data:'child'}]}),INVALID,'file parent');
  for(const mode of [0o120777,0o40755,0o20600,0o60600,0o10600,0o140600])reject(wheel({payloads:[{path:'demo_pkg/special.py',mode,data:'x'}]}),INVALID,'nonregular '+mode.toString(8));
  for(const data of [Buffer.from([0x7f,0x45,0x4c,0x46]),Buffer.from([0x4d,0x5a,0,0]),Buffer.from([0xcf,0xfa,0xed,0xfe])])reject(wheel({payloads:[{path:'demo_pkg/disguised.txt',data}]}),INVALID,'native magic');
  reject(wheel({payloads:[{path:'demo_pkg/x.py',nameBytes:Buffer.from([0xff,0xfe]),data:'x'}]}),INVALID,'invalid UTF-8');
});

test('filename, unique dist-info, METADATA and WHEEL tags form one purelib identity',()=>{
  for(const name of ['demo_pkg-1.2.3-cp312-cp312-linux_x86_64.whl','demo_pkg-1.2.3-py3-none-macosx.whl','../demo_pkg-1.2.3-py3-none-any.whl','other-1.2.3-py3-none-any.whl','demo_pkg-2.0-py3-none-any.whl'])reject(wheel({filename:name}),INVALID,name);
  for(const text of [metadata.replace('Name: demo-pkg','Name: other'),metadata.replace('Version: 1.2.3','Version: 2'),metadata.replace('Name: demo-pkg','Name: demo-pkg\nName: demo-pkg'),metadata.replace('Metadata-Version: 2.4\n','')])reject(wheel({metadata:text}),INVALID,'METADATA identity');
  for(const text of [wheelText.replace('true','false'),wheelText.replace('1.0','2.0'),wheelText.replace('py3-none-any','cp312-cp312-linux_x86_64'),wheelText.replace('Tag: py3-none-any\n',''),wheelText+'Tag: py3-none-any\n',wheelText+'Build: 1\n'])reject(wheel({wheelText:text}),INVALID,'WHEEL identity');
  reject(wheel({filename:'demo_pkg-1.2.3-1-py3-none-any.whl'}),INVALID,'missing build identity');
  reject(wheel({root:'other-1.2.3.dist-info'}),INVALID,'dist-info name');
  reject(wheel({payloads:[{path:'other-1.0.dist-info/METADATA',data:'x'}]}),INVALID,'multiple dist-info');
  reject(wheel({payloads:[{path:'demo_pkg/nested.dist-info/x',data:'x'}]}),INVALID,'nested dist-info');
  for(const name of ['METADATA','WHEEL','RECORD'])reject(wheel({membersTransform:members=>members.filter(m=>m.path!==root+'/'+name)}),INVALID,'missing '+name);
});

test('RECORD covers every payload exactly once with canonical SHA-256 and byte counts',()=>{
  const edits=[
    ['missing payload',rows=>csv(rows.slice(1))],
    ['unknown payload',rows=>csv([...rows,['unknown.py',base64('x'),'1']])],
    ['duplicate row',rows=>csv([...rows,rows[0]])],
    ['missing self',rows=>csv(rows.slice(0,-1))],
    ['wrong hash',rows=>csv(rows.map((r,i)=>i===0?[r[0],base64('wrong'),r[2]]:r))],
    ['empty payload digest',rows=>csv(rows.map((r,i)=>i===0?[r[0],'',r[2]]:r))],
    ['weak hash',rows=>csv(rows.map((r,i)=>i===0?[r[0],'md5=abcd',r[2]]:r))],
    ['padded base64',rows=>csv(rows.map((r,i)=>i===0?[r[0],r[1]+'=',r[2]]:r))],
    ['wrong size',rows=>csv(rows.map((r,i)=>i===0?[r[0],r[1],'999']:r))],
    ['noncanonical size',rows=>csv(rows.map((r,i)=>i===0?[r[0],r[1],'0'+r[2]]:r))],
    ['empty size',rows=>csv(rows.map((r,i)=>i===0?[r[0],r[1],'']:r))],
    ['nonempty self',rows=>csv(rows.map((r,i)=>i===rows.length-1?[r[0],base64('x'),'1']:r))],
    ['path alias',rows=>csv(rows.map((r,i)=>i===0?['./'+r[0],r[1],r[2]]:r))],
  ];
  for(const [label,recordTransform] of edits)reject(wheel({recordTransform}),INVALID,label);
  for(const record of ['"unclosed,sha256=x,1\n','"path"tail,x,1\n','path,x,1,extra\n','path,x,1\r','\n','path"quote,x,1\n'])reject(wheel({record}),INVALID,'malformed CSV');
  reject(wheel({membersTransform:members=>members.map((m,i)=>i===0?{...m,data:'tampered after RECORD was computed'}:m)}),INVALID,'actual payload hash changed with valid ZIP CRC');
});
