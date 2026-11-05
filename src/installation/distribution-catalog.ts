import {constants,openSync,closeSync,fstatSync,readSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {hashBytes} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import {DISTRIBUTION_LIMITS,validateDistributionManifest} from './distribution-contract.js';
import type {DistributionManifest} from './distribution-contract.js';

/** Product-owned identities. No CLI, environment or local bundle can supply a
 * replacement catalog. This candidate is development material, not a release. */
const CATALOG=Object.freeze([Object.freeze({
  id:'linux-arm64-temurin21-pbs20260211-candidate1',
  file:'governance/distribution-linux-arm64-v090.json',
  digest:'sha256:3bfb22e341764e0995b9c3cbf3f788aee6377e9b74664c332b9008efa83afe78',
}),Object.freeze({
  id:'linux-arm64-temurin21-pbs20260211-candidate2',
  file:'governance/distribution-linux-arm64-v090-candidate2.json',
  digest:'sha256:907114f83a3d1db711e4cc66d8ad7387150d01f9d025297a9feceae008e069e6',
}),Object.freeze({
  id:'linux-arm64-temurin21-pbs20260211-candidate3',
  file:'governance/distribution-linux-arm64-v090-candidate3.json',
  digest:'sha256:a233094a462f4e290349ff79bdee97d1e34fe9f0ac1374dc868a8f90e3e19f19',
}),Object.freeze({
  id:'linux-arm64-temurin21-pbs20260211-candidate4',
  file:'governance/distribution-linux-arm64-v090-candidate4.json',
  digest:'sha256:88ec62e5335c1e384475a3f498c07215572b4c048c45a23189f448683c80a175',
})]);

export function selectedDistribution(packageRoot:string,id:string):{manifest:DistributionManifest;manifestDigest:string;catalogEntry:string} {
  const entry=CATALOG.find(item=>item.id===id);
  if(!entry)fail('NO_DISTRIBUTION_CANDIDATE','No product-owned distribution candidate matches this selection',404);
  const path=join(packageRoot,entry.file),before=lstatSync(path,{bigint:true});
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const s=fstatSync(fd,{bigint:true});
    if(!s.isFile()||s.nlink!==1n||(s.mode&0o022n)!==0n||s.size<1n||s.size>BigInt(DISTRIBUTION_LIMITS.manifestBytes)||s.dev!==before.dev||s.ino!==before.ino)fail('DISTRIBUTION_CATALOG_CHANGED','Product distribution manifest is not a bounded regular file',409);
    const raw=Buffer.alloc(Number(s.size));let offset=0;
    while(offset<raw.length){const n=readSync(fd,raw,offset,raw.length-offset,offset);if(!n)fail('DISTRIBUTION_CATALOG_CHANGED','Product distribution manifest ended early',409);offset+=n;}
    const after=fstatSync(fd,{bigint:true}),named=lstatSync(path,{bigint:true});
    for(const v of [after,named])if(v.dev!==s.dev||v.ino!==s.ino||v.size!==s.size||v.mode!==s.mode||v.mtimeNs!==s.mtimeNs||v.ctimeNs!==s.ctimeNs)fail('DISTRIBUTION_CATALOG_CHANGED','Product distribution manifest changed during inspection',409);
    if(hashBytes(raw)!==entry.digest)fail('DISTRIBUTION_CATALOG_CHANGED','Product distribution manifest differs from the compiled catalog',409);
    const manifest:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));validateDistributionManifest(manifest);
    if(manifest.id!==id)fail('DISTRIBUTION_CATALOG_CHANGED','Product distribution identity differs from its catalog',409);
    return {manifest,manifestDigest:entry.digest,catalogEntry:entry.file};
  }finally{closeSync(fd);}
}
