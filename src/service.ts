import {createOntologyReadiness,READINESS_ONTOLOGY_OPERATIONS} from './readiness.js';
export type * from './readiness.js';
import type {NativeOntologyRecord} from './native/types.js';
import type {ReadRequest} from '../vendor/readability/v1/readability.mjs';
import {createReadableAPI,READABLE_OPERATIONS} from '../vendor/readability/v1/readability.mjs';
import {ontologyReadSnapshot} from './readable.js';
export type {ReadSnapshot,ReadRow,ReadQuery,ReadRequest,ReadScope} from '../vendor/readability/v1/readability.mjs';
import {createOwnerFeedback,OWNER_FEEDBACK_OPERATIONS} from '../vendor/compatibility/feedback/v1/owner.mjs';
import type {FeedbackEnvelope} from '../vendor/compatibility/feedback/v1/feedback.mjs';
import {feedbackScope} from '../vendor/compatibility/feedback/v1/feedback.mjs';
import {nativeExact} from '../vendor/compatibility/v1/native.mjs';
import type {ResponseEnvelope} from '../vendor/compatibility/response/v1/response.mjs';
import {inspectOperationsProfile, instantiateOperationsProfile} from './operations-profile.js';
export type * from '../vendor/compatibility/feedback/v1/feedback.mjs';
import type { NativeRequest, NativeOutputs, LegacyQueryRequest, LegacyQueryOutput, HistoricalRequest, HistoricalMutation, ClassificationControlRequest, ClassificationOutputs, ClassificationReceipt, ExecuteRequest } from './types.js';
export type * from './types.js';
export { inspectOperationsProfile, instantiateOperationsProfile, verifyOperationsProfileMaterial, verifyOperationsProfilePackage } from './operations-profile.js';
export type { OperationsProfileBinding, OperationsProfileMaterial } from './operations-profile.js';
import type { WorkspaceOptions, TrustedProviders, DispatchRequest, ClassificationRequest, Receipt } from './types.js';
import type { Store } from './persistence-types.js';
import { errorCode } from './state.js';
import { exactFields, frozenClone, sha256, stableSerialize } from '../vendor/compatibility/v1/reference.mjs';
import { openState, bounded, fail, LIMITS, validateState } from './state.js';
import { operations, mutations, validateRequest, operate } from './native-operations.js';
import { catalogMutations, verifyCatalogReceipt } from './catalog-operations.js';
import { classificationDispatch, classificationOperations, findClassification } from './classification-operations.js';
import { classificationProviders, createClassificationRunner } from './classification-runner.js';
import { createNativeOntologyOperations, ontologyNativeOperations } from './native/service.js';
export type * from './native/types.js';

// Construction and discovery are pure. Persistence begins only at initialize().
export function createOntologyService(options: WorkspaceOptions, trustedProviders: TrustedProviders = {}) {
  bounded(options); exactFields(options, ['workspaceRoot', 'workspaceId']);
  const providers = classificationProviders(trustedProviders);
  const { workspaceRoot, workspaceId } = options;
  let store: Store | null = null, closed = false;
  const capabilities = () => frozenClone({ product: 'ontology', version: '0.8.2', stage: 'NATIVE_STANDARDS', readinessOperations:READINESS_ONTOLOGY_OPERATIONS, readableOperations:READABLE_OPERATIONS, operations: operations.filter(op => !mutations.includes(op)), nativeOperations: ontologyNativeOperations, feedbackOperations: OWNER_FEEDBACK_OPERATIONS, responseOperations: ['response.profile.inspect', 'response.profile.instantiate'], historicalOperationsReadOnly: true, limits: LIMITS, authority: false, softwareRelease: false, pending: ['exact-candidate acceptance'] });
  function initialize() {
    if (closed) fail('CLOSED', 'Service is closed');
    if (!store) { store = Object.assign(openState(workspaceRoot, workspaceId), { trustedProviders: providers }); }
    return frozenClone({ workspaceId, initialized: true, authority: false });
  }
  const runClassification = createClassificationRunner(() => store);
  const native = createNativeOntologyOperations(() => store, () => closed);
  function executeCore(request: unknown, onDispatch?: () => void): unknown {
    let transaction = false, validatedOperation = "";
    try {
      bounded(request);
      const r = frozenClone(request) as unknown as DispatchRequest, write = validateRequest(r);
      if (write) fail('HISTORICAL_READ_ONLY', 'Retired JSON/compatibility mutations cannot create current work; use native package operations');
      validatedOperation = r.operation;
      if (classificationDispatch.includes(r.operation) && !onDispatch) fail('ASYNC_REQUIRED', 'Use service.classify for classification dispatch');
      if (closed) fail('CLOSED', 'Service is closed');
      if (!store) fail('NOT_INITIALIZED', 'Explicit initialize required');
      store.guard();
      const { db } = store;
      db.exec((write || r.operation === 'semantic.catalog.recovery-readback') ? 'BEGIN IMMEDIATE' : 'BEGIN'); transaction = true;
      const scope = stableSerialize(r.scope);
      // expectedRevision is a CAS precondition, not part of the idempotent intent.
      const digest = write ? sha256({ operation: r.operation, scope: r.scope, input: r.input }) : null;
      if (write) {
        const old = db.prepare('SELECT digest, receipt FROM receipts WHERE scope = ? AND request_id = ?').get(scope, r.requestId);
        if (old) {
          if (old.digest !== digest) fail('REQUEST_CONFLICT', 'Request id already binds different content');
          const result = JSON.parse(old.receipt as string);
          if (catalogMutations.includes(r.operation)) {
            const current = db.prepare('SELECT data FROM state WHERE singleton = 1').get();
            verifyCatalogReceipt(store, validateState(JSON.parse(current!.data as string)), r.scope, result);
          }
          if (classificationOperations.includes(r.operation)) findClassification(store, validateState(JSON.parse(db.prepare('SELECT data FROM state WHERE singleton = 1').get()!.data as string)), r.scope, r.input.id as string);
          db.exec('COMMIT'); transaction = false; return frozenClone(result);
        }
      }
      const row = db.prepare('SELECT revision, data FROM state WHERE singleton = 1').get() as { revision: number; data: string } | undefined;
      if (!row || !Number.isSafeInteger(row.revision)) fail('CORRUPT_STATE', 'Missing state');
      if (write && row.revision !== r.expectedRevision) fail('REVISION_CONFLICT', 'Global product revision changed');
      const state = validateState(JSON.parse(row.data));
      let result: unknown;
      if (r.operation === 'workspace.inspect') result = { workspaceId, revision: row.revision, scope: r.scope, assetCount: state.assets.filter(a => stableSerialize(a.scope) === scope).length, authority: false };
      else if (r.operation === 'receipt.inspect') {
        const receipt = db.prepare('SELECT receipt FROM receipts WHERE scope = ? AND request_id = ?').get(scope, r.input.requestId as string);
        if (!receipt) fail('NOT_FOUND', 'Receipt not found in scope');
        const saved = JSON.parse(receipt.receipt as string);
        result = saved;
        if (catalogMutations.includes(saved.operation)) verifyCatalogReceipt(store, state, r.scope, saved);
        if (classificationOperations.includes(saved.operation)) findClassification(store, state, r.scope, saved.result.id ?? saved.result.classificationSessionId);
      } else result = operate(store, state, r);
      if (write) {
        if (db.prepare('SELECT count(*) AS n FROM receipts').get()!.n as number >= LIMITS.receipts || row.revision >= Number.MAX_SAFE_INTEGER) fail('LIMIT', 'Receipt/revision limit');
        const data = stableSerialize(state);
        if (Buffer.byteLength(data) > LIMITS.stateBytes) fail('LIMIT', 'State byte limit');
        validateState(state);
        const revision = row.revision + 1;
        const receipt = { requestId: r.requestId, scope: r.scope, operation: r.operation, requestDigest: digest, revision, uid: store.uid, result };
        const receiptJSON = stableSerialize(receipt);
        if (db.prepare('SELECT coalesce(sum(length(CAST(receipt AS BLOB))),0) AS bytes FROM receipts').get()!.bytes as number + Buffer.byteLength(receiptJSON) > LIMITS.receiptBytes) fail('LIMIT', 'Receipt byte limit');
        db.prepare('UPDATE state SET revision = ?, data = ? WHERE singleton = 1 AND revision = ?').run(revision, data, row.revision);
        db.prepare('INSERT INTO receipts(scope, request_id, digest, receipt) VALUES(?,?,?,?)').run(scope, r.requestId, digest, receiptJSON);
        db.prepare('INSERT INTO audit(revision, uid, operation, request_digest, result_digest) VALUES(?,?,?,?,?)').run(revision, store.uid, r.operation, digest, sha256(result));
        result = receipt;
      }
      db.exec('COMMIT'); transaction = false;
      if (classificationDispatch.includes(r.operation)) onDispatch!();
      return frozenClone(result);
    } catch (e) {
      const code = errorCode(e);
      if (transaction) { try { store!.db.exec('ROLLBACK'); } catch { /* Preserve original failure. */ } }
      if (['semantic.catalog.recover', 'semantic.catalog.recovery-readback', 'semantic.catalog.recovery-inspect'].includes(validatedOperation)) {
        throw Object.assign(new Error('Catalog recovery result unresolved'), { code: 'UNKNOWN', causeCode: code ?? 'INVALID_REQUEST', status: 'UNKNOWN' });
      }
      if (classificationOperations.includes(validatedOperation)) fail(typeof code === 'string' && /^[A-Z_]+$/.test(code) ? code : 'CLASSIFICATION_FAILED', 'Classification request failed');
      if (typeof code === 'string' && !code.startsWith('ERR_') && !code.startsWith('SQLITE_')) throw e;
      fail(code === 'ERR_SQLITE_ERROR' ? 'STATE_ERROR' : 'INVALID_REQUEST', 'Service request failed: ' + (code || 'invalid data'));
    }
  }
  function execute(request: NativeRequest<'workspace.inspect'>): NativeOutputs['workspace.inspect'];
  function execute(request: NativeRequest<'receipt.inspect'>): NativeOutputs['receipt.inspect'];
  function execute(request: NativeRequest<'asset.put'>): NativeOutputs['asset.put'];
  function execute(request: NativeRequest<'asset.inspect'>): NativeOutputs['asset.inspect'];
  function execute(request: NativeRequest<'asset.list'>): NativeOutputs['asset.list'];
  function execute(request: NativeRequest<'asset.review'>): NativeOutputs['asset.review'];
  function execute(request: NativeRequest<'asset.decide'>): NativeOutputs['asset.decide'];
  function execute(request: NativeRequest<'asset.publish'>): NativeOutputs['asset.publish'];
  function execute(request: NativeRequest<'source.install'>): NativeOutputs['source.install'];
  function execute(request: NativeRequest<'source.inspect'>): NativeOutputs['source.inspect'];
  function execute(request: NativeRequest<'source.list'>): NativeOutputs['source.list'];
  function execute(request: NativeRequest<'legacy.import'>): NativeOutputs['legacy.import'];
  function execute(request: NativeRequest<'legacy.derive'>): NativeOutputs['legacy.derive'];
  function execute(request: NativeRequest): NativeOutputs[keyof NativeOutputs];
  function execute(request: Extract<ClassificationControlRequest, { operation: 'classification.inspect' }>): ClassificationOutputs['classification.inspect'];
  function execute(request: Extract<ClassificationControlRequest, { operation: 'classification.resume' }>): ClassificationOutputs['classification.resume'];
  function execute(request: Extract<ClassificationControlRequest, { operation: 'classification.list' }>): ClassificationOutputs['classification.list'];
  function execute(request: Extract<ClassificationControlRequest, { operation: 'classification.close' }>): ClassificationOutputs['classification.close'];
  function execute(request: Extract<ClassificationControlRequest, { operation: 'classification.continue_to_harness' }>): ClassificationOutputs['classification.continue_to_harness'];
  function execute(request: LegacyQueryRequest): LegacyQueryOutput;
  function execute(request: Extract<HistoricalRequest, { operation: HistoricalMutation }>): Receipt<unknown>;
  function execute(request: HistoricalRequest): unknown;
  function execute(request: ExecuteRequest): unknown;
  function execute(request: ExecuteRequest): unknown { return executeCore(request); }
  async function classify(request: ClassificationRequest): Promise<ClassificationReceipt> {
    bounded(request);
    const r = frozenClone(request) as unknown as ClassificationRequest;
    if (!classificationDispatch.includes(r.operation)) fail('INVALID_REQUEST', 'classify accepts start or reanalyze only');
    let created = false;
    const receipt = executeCore(r, () => { created = true; });
    // executeCore has validated the dispatch operation and persisted its admission receipt.
    // The runner returns that same receipt after asynchronously recording completion.
    return (created ? await runClassification(r, receipt as ClassificationReceipt) : receipt) as ClassificationReceipt;
  }
  let activeFeedback=0;
  async function feedback(request:FeedbackEnvelope):Promise<unknown>{if(closed)fail('CLOSED','Service closed');if(!store)fail('NOT_INITIALIZED','Explicit initialize required');activeFeedback++;try{return await createOwnerFeedback(store,'ontology',providers).feedback(request);}finally{activeFeedback--;}}
  async function response(request:ResponseEnvelope):Promise<unknown>{
    if(closed)fail('CLOSED','Service closed');
    bounded(request);nativeExact(request,['operation','scope','input']);feedbackScope(request.scope);
    if(request.operation==='response.profile.inspect'){nativeExact(request.input,[]);return inspectOperationsProfile();}
    if(request.operation==='response.profile.instantiate'){
      nativeExact(request.input,['namespace','direction']);
      return instantiateOperationsProfile(request.input as {namespace:string;direction:'forward'|'reverse'});
    }
    fail('RESPONSE_OPERATION','Unknown read-only operations profile operation');
  }
  let activeReadable=0;
  const readableAPI=createReadableAPI({kind:'asset',list:scope=>native({operation:'native.package.list',scope,input:{}}),get:async(scope,identity)=>{const record=await native({operation:'native.package.inspect',scope,input:{id:identity.id,version:identity.version!}});if(!trustedProviders.nativeToolchain)fail('TOOLCHAIN_NOT_READY','Readable graph requires the pinned RDF toolchain');return ontologyReadSnapshot(record as NativeOntologyRecord,workspaceId,scope,trustedProviders.nativeToolchain);}});
  async function readable(request:ReadRequest):Promise<unknown>{if(closed)fail('CLOSED','Service is closed');if(!store)fail('NOT_INITIALIZED','Explicit initialize required');activeReadable++;try{return await readableAPI(request);}finally{activeReadable--;}}
  let activeReadiness=0;
  const readinessAPI=createOntologyReadiness(workspaceId,async(scope,id,version)=>{const r=await native({operation:'native.package.inspect',scope,input:{id,version}}) as NativeOntologyRecord;return {package:r.package,published:r.reference!==null,reference:r.reference};});
  async function readiness(request:FeedbackEnvelope):Promise<unknown>{if(closed)fail('CLOSED','Service closed');if(!store)fail('NOT_INITIALIZED','Explicit initialize required');activeReadiness++;try{return await readinessAPI.readiness(request);}finally{activeReadiness--;}}
  function close() { if(activeReadiness)fail('BUSY','Readiness operation in progress'); if(activeReadable)fail('BUSY','Readable snapshot is in progress'); if(activeFeedback)fail('BUSY','Feedback operation is still in progress'); if (store) { store.db.close(); store = null; } closed = true; }
  return Object.freeze({ readiness, capabilities, initialize, execute, native, readable, feedback, response, classify, close });
}

export type OntologyService = ReturnType<typeof createOntologyService>;
