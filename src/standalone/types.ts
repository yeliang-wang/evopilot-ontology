export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
interface WorkspaceBase {
  workspaceId: string; serviceId: string;
  stateVersion: 14; createdAt: string;
}
export type WorkspaceRecovery = {
  schema:'ontology-workspace-recovery/v1';generation:string;requestId:string;planDigest:string;
  snapshotDigest:string;retainedDigest:string|null;credentialPolicy:'CURRENT'|'REKEY_LOST_OWNER';
  decisionAuditFloor?:number|null;
};
export type WorkspaceIdentity = WorkspaceBase & ({schema:'ontology-workspace/v1'}|{schema:'ontology-workspace/v2';recovery:WorkspaceRecovery});
export interface Grant {
  id: string; principalId: string; tokenHash: string; projectIds: string[];
  permissions: ('read' | 'write' | 'review')[]; expiresAt: string; revoked: boolean;
}
export interface Credentials {
  schema: 'ontology-credentials/v1'; workspaceId: string; serviceId: string; grants: Grant[];
}
export interface ServiceRequest {
  workspaceId: string; serviceId: string; projectId: string; operation: string;
  input: { [key: string]: Json }; requestId?: string; expectedRevision?: number;
}
export interface Project {
  projectId: string; label: string; revision: number; createdAt: string;
}
export interface ModelingIntent {
  purpose: string; mode: 'forward' | 'reverse' | 'composition';
  scope: string; exclusions: string[]; sources: SourceBinding[];
  requirements: { id: string; statement: string }[];
}
export interface SourceBinding {
  id: string; locator: string; revision: string; digest: string;
  origin: 'source' | 'requirement' | 'design' | 'reference';
}
export interface Receipt {
  schema: 'ontology-receipt/v1'; workspaceId: string; serviceId: string; projectId: string;
  principalId: string; requestId: string; requestDigest: string; operation: string;
  revision: number; status: 'COMPLETED'; recordedAt: string; result: Json;
}
export const LIMITS = Object.freeze({requestBytes: 512 * 1024, responseBytes: 1024 * 1024, stateBytes:64*1024*1024,
  jsonDepth: 24, jsonNodes: 30000, projects: 1000, receipts: 100000, grants: 1000,
  sourceBindings: 1000, requirements: 1000, pageSize: 100});
export class ServiceError extends Error {
  constructor(public readonly code: string, message: string, public readonly httpStatus = 400) {
    super(message); this.name = 'OntologyServiceError';
  }
}
export function fail(code: string, message: string, status = 400): never { throw new ServiceError(code, message, status); }
