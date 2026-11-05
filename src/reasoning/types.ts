import type {Json} from '../standalone/types.js';

export const DL_LIMITS=Object.freeze({documents:64,documentBytes:8*1024*1024,closureBytes:32*1024*1024,requestBytes:48*1024*1024,outputBytes:8*1024*1024,importDepth:16,imports:512,entities:1000,axioms:100000,taskMs:120000,explanationMs:30000});
export type DLFormat='turtle'|'rdfxml'|'functional';
export interface DLQuery {format:DLFormat;content:string;digest:string;}
export interface DLDocument extends DLQuery {id:string;documentIri:string;ontologyIri:string|null;versionIri:string|null;}
export interface DLClosure {rootDocumentId:string;documents:DLDocument[];imports:{from:string;iri:string;to:string}[];}
export type DLTask={kind:'legality'|'consistency'}|{kind:'rdfGraph';documentId:string}|{kind:'entailment'|'satisfiability';query:DLQuery}|{kind:'classHierarchy'|'objectPropertyHierarchy'|'dataPropertyHierarchy'|'realization';entities:string[];direct:boolean}|{kind:'identity';entities:string[]}|{kind:'explanation';target:'entailment'|'inconsistency';query?:DLQuery};
export interface DLRequest {schema:'ontology-dl-request/v1';requestId:string;closure:DLClosure;task:DLTask;}
export type DLStatus='COMPLETED'|'ENTAILED'|'NOT_ENTAILED'|'INCONSISTENT'|'INVALID_INPUT'|'MISSING_IMPORT'|'TIMEOUT'|'CANCELLED'|'FAILED';
export interface DLResponse {schema:'ontology-dl-result/v1';requestId:string;requestDigest:string;closureDigest:string;configurationDigest:string;toolchainDigest:string;status:DLStatus;complete:boolean;elapsedMs:number;result:Json;error:{code:string;message:string}|null;}
