import {mkdirSync,openSync,closeSync,writeFileSync,renameSync,fsyncSync,readdirSync,realpathSync,existsSync,lstatSync} from 'node:fs';
import {dirname,isAbsolute,join,resolve,relative} from 'node:path';
import {randomUUID} from 'node:crypto';
import {privatePath,privateRead,privateLease} from '../standalone/workspace.js';
import {fail} from '../standalone/types.js';

export function outsideSource(path:string):string{
  if(!isAbsolute(path))fail('UNSAFE_PATH','Absolute operator path required');
  const root=realpathSync(path);
  for(let p=root;;p=dirname(p)){if(readdirSync(p).includes('.git'))fail('UNSAFE_PATH','Private installation cannot be inside source');if(dirname(p)===p)break;}
  return root;
}
export function createPrivateRoot(path:string):string{
  if(!isAbsolute(path))fail('UNSAFE_PATH','Absolute operator path required');
  const parent=outsideSource(dirname(resolve(path))),root=join(parent,resolve(path).split('/').at(-1)!);
  try{mkdirSync(root,{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')fail('INSTALLATION_EXISTS','Occupied installation requires explicit inspect/attach',409);throw e;}
  privatePath(root,true);return root;
}
export function assertSeparate(a:string,b:string):void{
  const inside=(x:string,y:string)=>{const r=relative(x,y);return !r||(!r.startsWith('..')&&!isAbsolute(r));};
  if(inside(a,b)||inside(b,a))fail('UNSAFE_PATH','Installation, runtime and workspace roots must be separate');
}
export function writePrivate(path:string,value:unknown,replace=false):void{
  privatePath(dirname(path),true);
  if(existsSync(path)){privatePath(path);if(!replace)fail('PATH_EXISTS','Private state already exists',409);}
  const temp=path+'.pending-'+randomUUID(),fd=openSync(temp,'wx',0o600);
  try{writeFileSync(fd,JSON.stringify(value)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
  if(!replace&&existsSync(path))fail('PATH_EXISTS','Private state appeared during write',409);
  if(existsSync(path))privatePath(path);
  renameSync(temp,path);const directory=openSync(dirname(path),'r');try{fsyncSync(directory);}finally{closeSync(directory);}
}
export function readPrivate(path:string,max=65536):unknown{return JSON.parse(privateRead(path,max));}
export function operatorLock(root:string):()=>void{
  privatePath(root,true);const path=join(root,'operator.sqlite');
  if(!existsSync(path)){const fd=openSync(path,'wx',0o600);closeSync(fd);}privatePath(path);
  const db=privateLease(path,'INSTALLATION_BUSY','Another operator command owns this installation');
  return ()=>db.close();
}
/** Settle only the verified empty control store. SQLite owns rollback/journal
 * removal; business journals and normal no-allocation lease paths stay intact. */
export function settleOperatorJournal(root:string):void{
  privatePath(root,true);if(!readdirSync(root).includes('operator.sqlite-journal'))return;
  const path=join(root,'operator.sqlite'),journal=path+'-journal';privatePath(journal);privatePath(path);
  if(lstatSync(journal).size>65536)fail('LEASE_EVIDENCE','Oversized operator lease journal was preserved',409);
  const before=lstatSync(path),db=privateLease(path,'INSTALLATION_BUSY','The formal worker still owns its operator lease');
  try{db.exec('PRAGMA user_version=1;COMMIT');}finally{db.close();}
  const after=lstatSync(path);
  if(after.dev!==before.dev||after.ino!==before.ino||existsSync(journal))fail('LEASE_EVIDENCE','Operator lease did not settle at its original location',409);
}
