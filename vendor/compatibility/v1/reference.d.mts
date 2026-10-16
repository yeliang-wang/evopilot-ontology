export type JSONValue = null | boolean | number | string | JSONValue[] | {[key:string]:JSONValue};
export interface Reference {product:'ontology'|'harness';id:string;version:string;specVersion:'v1';digest:string;visibility:'public'|'private'}
export interface ReferenceOptions {product?:'ontology'|'harness';visibility?:'public'|'private'}
export const CONTRACT_REVISION: '1.0.0';
export function assertJSON(value:unknown, ancestors?:Set<object>): asserts value is JSONValue;
export function stableSerialize(value:unknown):string;
export function sha256(value:unknown):string;
export function frozenClone<T>(value:T):T;
export function exactFields<K extends string>(value:unknown,required:readonly K[],optional?:readonly string[]):asserts value is Record<K,unknown>;
export function textField(value:unknown):asserts value is string;
export const SOURCE_STATUSES: readonly ['design-proposed','design-confirmed','source-observed','inferred','runtime-observed','human-reviewed','synthetic'];
export const ENVELOPE_FIELDS: readonly ['id','version','product','specVersion','visibility','provenance','extensions','dependencies'];
export function validateEnvelope(asset:unknown):{extensions:{namespace:string;version:string;status:'VALID'|'NOT_EVALUATED'}[];authority:false};
export function validateReference(value:unknown,options?:ReferenceOptions):Readonly<Reference>;
export function inspectReference(ref:unknown,observed:unknown,options?:ReferenceOptions):Readonly<{reference:Readonly<Reference>;exactMatch:true;authority:false}>;
