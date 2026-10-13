import type { JSONValue, Visibility } from './types.js';

/** Historical payloads retain their original schema and require their own validator. */
export interface LegacyValidation { valid: boolean; errors: unknown[] }
export interface PreservedIdentity {
  kind: JSONValue; schema: JSONValue; apiVersion: JSONValue;
  id: JSONValue; version: JSONValue; digest: JSONValue;
}
export interface PreservedDocument {
  [key: string]: JSONValue | undefined;
  metadata?: { [key: string]: JSONValue };
}
export interface ArchiveEntry {
  raw: string; bytes: number; sha256: string; classification: string;
  observed: PreservedIdentity;
}
export interface SourceArchive {
  schema: string; version: number; owner: string; sourceCommit: string;
  entries: Record<string, ArchiveEntry>;
}
export interface PublicSourceReport {
  schema: string; status: string; owner: string; sourcePath: string; sourceCommit: string;
  classification: string; observed: PreservedIdentity;
  sourceReference: PreservedIdentity & { sourcePath: string; sourceCommit: string; rawDigest: string };
  sha256: string; bytes: number; raw: string; document: PreservedDocument;
  authority: boolean; businessConfirmed: boolean; released: boolean;
}

/** Fields consumed after the corresponding historical schema validator succeeds. */
export interface HistoricalConcept {
  [key: string]: unknown;
  id: string; conceptId?: string; label?: string; definition?: string;
  parents?: string[];
  relationships?: { id?: string; from: string; to: string; directed: boolean }[];
}
export interface HistoricalDocument {
  [key: string]: unknown;
  schema: string; kind: string; apiVersion?: string;
  id?: string; version?: string; digest?: string; status?: string;
  metadata?: { id?: string; version?: string; digest?: string; lifecycle?: string };
  concepts: HistoricalConcept[];
  resolvedPackSet: HistoricalDocument;
  spec: { concepts: HistoricalConcept[]; domains: HistoricalConcept[]; products: HistoricalConcept[]; snapshot: HistoricalDocument; projectOntologySkill: HistoricalDocument };
}
export interface MigrationOptions {
  sourceLocator: string; sourceRevision: string; sourceVisibility: Visibility;
  expectedDocumentDigest?: string;
}
export interface DerivationOptions extends MigrationOptions {
  id: string; version: string; visibility: Visibility;
}
