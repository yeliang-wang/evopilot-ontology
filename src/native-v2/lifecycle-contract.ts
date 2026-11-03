import {Ajv2020} from 'ajv/dist/2020.js';
import {MODEL_SCHEMA} from './model-schema.js';
import {CANDIDATE_SCHEMA,CANDIDATE_SCHEMA_DIGEST} from './candidate-schema.js';
import {REVIEW_SCHEMA,REVIEW_SCHEMA_DIGEST} from './review-schema.js';
import {DELIVERY_SCHEMA,DELIVERY_SCHEMA_DIGEST} from './delivery-schema.js';
import type {ReviewCandidate} from './candidate-contracts.js';
import type {ReviewDecision} from './review-contracts.js';
import type {DeliveryBundle} from './delivery-contracts.js';
import {hash,timestamp} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';

const ajv=new Ajv2020({strict:true,ownProperties:true}).addSchema(MODEL_SCHEMA);
const candidate=ajv.compile<ReviewCandidate>(CANDIDATE_SCHEMA),review=ajv.compile<ReviewDecision>(REVIEW_SCHEMA),delivery=ajv.compile<DeliveryBundle>(DELIVERY_SCHEMA);
export const LIFECYCLE_SCHEMA_DIGEST=hash({candidate:CANDIDATE_SCHEMA_DIGEST,review:REVIEW_SCHEMA_DIGEST,delivery:DELIVERY_SCHEMA_DIGEST});
export const LIFECYCLE_LIMITS=Object.freeze({bytes:32*1024*1024,explanations:32,pageBytes:65536});
export function checkCandidate(value:unknown):asserts value is ReviewCandidate {if(!candidate(value))fail('CANDIDATE_SCHEMA','Review candidate differs from v2 schema');}
export function checkDecision(value:unknown):asserts value is ReviewDecision {if(!review(value))fail('REVIEW_SCHEMA','Review decision differs from v2 schema');timestamp(value.recordedAt);}
export function checkBundle(value:unknown):asserts value is DeliveryBundle {
  if(Buffer.byteLength(JSON.stringify(value))>LIFECYCLE_LIMITS.bytes)fail('DELIVERY_LIMIT','Offline delivery exceeds its fixed byte envelope',413);
  if(!delivery(value))fail('DELIVERY_SCHEMA','Delivery bundle differs from v2 schema');timestamp(value.recordedAt);
}
