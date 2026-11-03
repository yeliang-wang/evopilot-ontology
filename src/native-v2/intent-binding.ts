import type {DatabaseSync} from 'node:sqlite';
import {hash,validateIntent} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {ModelingIntent} from '../standalone/types.js';

export function boundIntent(db:DatabaseSync,projectId:string,intentDigest:string):ModelingIntent {
  if(!db.isTransaction)fail('TRANSACTION_REQUIRED','Intent binding requires the owner transaction',409);
  const row=db.prepare('SELECT document FROM intents WHERE project_id=? AND digest=?').get(projectId,intentDigest);
  if(!row)fail('NOT_FOUND','Bound intent is absent in selected project',404);
  const value=JSON.parse(String(row.document));validateIntent(value.definition);
  if(hash(value)!==intentDigest)fail('CORRUPT_STATE','Bound intent differs from immutable identity',409);
  return value.definition;
}
