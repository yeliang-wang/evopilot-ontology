import { mkdirSync, writeFileSync, openSync, closeSync, fsyncSync, realpathSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { FILES, STATE_VERSION, workspacePath } from '../standalone/workspace.js';
import { id, hashBytes } from '../standalone/validation.js';
import { fail } from '../standalone/types.js';
import type { Credentials, WorkspaceIdentity } from '../standalone/types.js';
import { SOURCE_TABLES } from '../native-v2/store.js';
import { MODEL_TABLES } from '../native-v2/model-store.js';
import { EXPECTATION_TABLES } from '../native-v2/expectations-store.js';
import { VIEW_TABLES } from '../native-v2/view-store.js';
import { TASK_TABLES } from '../native-v2/tasks.js';

/** Local operator only: never imported by the domain service or HTTP dispatcher. */
export function initializeWorkspace(input: {root: string; workspaceId: string; projectId: string; principalId: string; serviceId?:string}) {
  id(input.workspaceId); id(input.projectId); id(input.principalId);
  if(input.serviceId!==undefined)id(input.serviceId);
  if (!isAbsolute(input.root)) fail('UNSAFE_PATH','Absolute workspace location required');
  const root=join(realpathSync(dirname(resolve(input.root))), resolve(input.root).split('/').at(-1)!);
  // Exclusive creation avoids adopting or overwriting any occupied workspace.
  try {mkdirSync(root,{mode:0o700});} catch (e) { if ((e as NodeJS.ErrnoException).code==='EEXIST') fail('WORKSPACE_EXISTS','Explicit attach or recovery required',409); throw e; }
  workspacePath(root);
  const identity: WorkspaceIdentity={schema:'ontology-workspace/v1',workspaceId:input.workspaceId,serviceId:input.serviceId??randomUUID(),stateVersion:STATE_VERSION,createdAt:new Date().toISOString()};
  const raw=JSON.stringify(identity), token=randomBytes(32).toString('base64url');
  const credentials: Credentials={schema:'ontology-credentials/v1',workspaceId:identity.workspaceId,serviceId:identity.serviceId,grants:[{id:randomUUID(),principalId:input.principalId,tokenHash:hashBytes(token),projectIds:[input.projectId],permissions:['read','write'],expiresAt:new Date(Date.now()+30*86400000).toISOString(),revoked:false}]};
  const write = (name: string, bytes: string): void => {const fd=openSync(join(root,name),'wx',0o600);try {writeFileSync(fd,bytes);fsyncSync(fd);} finally {closeSync(fd);}};
  // Initialization leaves failed partial state for explicit recovery, never deletes data.
  write(FILES.db,''); write(FILES.lease,'');
  const db=new DatabaseSync(join(root,FILES.db));
  try {
    db.exec(`PRAGMA synchronous=FULL; BEGIN IMMEDIATE;
      CREATE TABLE workspace(singleton INTEGER PRIMARY KEY CHECK(singleton=1),identity TEXT NOT NULL);
      CREATE TABLE projects(id TEXT PRIMARY KEY,label TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE intents(project_id TEXT NOT NULL,digest TEXT NOT NULL,revision INTEGER NOT NULL,document TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(project_id,digest),FOREIGN KEY(project_id) REFERENCES projects(id));
      CREATE TABLE project_heads(project_id TEXT PRIMARY KEY,intent_digest TEXT,FOREIGN KEY(project_id) REFERENCES projects(id));
      CREATE TABLE receipts(project_id TEXT NOT NULL,principal_id TEXT NOT NULL,request_id TEXT NOT NULL,digest TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(project_id,principal_id,request_id));
      CREATE TABLE audit(sequence INTEGER PRIMARY KEY,project_id TEXT NOT NULL,principal_id TEXT NOT NULL,request_id TEXT NOT NULL,operation TEXT NOT NULL,request_digest TEXT NOT NULL,receipt_digest TEXT NOT NULL,recorded_at TEXT NOT NULL);
      ${SOURCE_TABLES}
      ${EXPECTATION_TABLES}
      ${MODEL_TABLES}
      ${TASK_TABLES}
      ${VIEW_TABLES}
      PRAGMA user_version=${STATE_VERSION};`);
    db.prepare('INSERT INTO workspace VALUES(1,?)').run(raw); db.exec('COMMIT');
  } finally {db.close();}
  write(FILES.credentials,JSON.stringify(credentials)); write('operator-token',token); write(FILES.identity,raw);
  const dir=openSync(root,'r');try{fsyncSync(dir);}finally{closeSync(dir);}
  return {...identity,root,credentialFile:join(root,'operator-token')};
}
