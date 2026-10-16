import type { JSONValue, ArtifactReference, Visibility } from '../../../src/types.js';
export const CONTRACT_REVISION: '1.0.0';
export function assertJSON(value: unknown, ancestors?: Set<object>): asserts value is JSONValue;
export function stableSerialize(value: unknown): string;
export function sha256(value: unknown): string;
/** Runtime cloning freezes recursively; callers must treat the returned value as immutable. */
export function frozenClone<T>(value: T): T;
export function exactFields(value: unknown, required: readonly string[], optional?: readonly string[]): asserts value is Record<string, unknown>;
export function textField(value: unknown): asserts value is string;
export const SOURCE_STATUSES: readonly string[];
export const ENVELOPE_FIELDS: readonly string[];
export function validateEnvelope(asset: unknown): { extensions: { namespace: string; version: string; status: 'VALID' | 'NOT_EVALUATED' }[]; authority: false };
export interface ReferenceOptions { product?: 'ontology' | 'harness'; visibility?: Visibility }
export function validateReference(value: unknown, options?: ReferenceOptions): Readonly<ArtifactReference>;
export function inspectReference(ref: unknown, observed: unknown, options?: ReferenceOptions): { reference: Readonly<ArtifactReference>; exactMatch: true; authority: false };
