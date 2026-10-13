#!/usr/bin/env node
import type { ExecuteRequest, ClassificationRequest } from './types.js';
import { constants, realpathSync } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT, VERSION, capabilities } from './index.js';
import { createOntologyService } from './service.js';
import { operations, validateRequest } from './native-operations.js';
import { classificationDispatch } from './classification-operations.js';
import { bounded, fail, LIMITS, slug, errorCode } from './state.js';

const serviceCodes = new Set("APPROVAL_REQUIRED ASSET_EXISTS ASYNC_REQUIRED CLASSIFICATION_FAILED CLASSIFICATION_HANDOFF_BLOCKED CLASSIFICATION_MATCH_REQUIRED CLASSIFICATION_PROVIDER_UNAVAILABLE CLASSIFICATION_PROVIDER_UNRESOLVED CLASSIFICATION_REPLAY_INTEGRITY_FAILED CLASSIFICATION_SOURCE_ASYNC CLASSIFICATION_SOURCE_DRIFT CLASSIFICATION_SOURCE_INVALID CLASSIFICATION_SOURCE_UNAVAILABLE CLASSIFICATION_UNRESOLVED CLOSED CORRUPT_BLOB CORRUPT_STATE DEPENDENCY_CHANGED EMPTY_PUBLICATION EXPLICIT_HANDOFF_DECISION_REQUIRED FOREIGN_MATERIAL HEAD_CONFLICT HUMAN_EVIDENCE_MISMATCH IDENTITY_MISMATCH IMMUTABLE_VERSION INVALID_DELIVERY INVALID_ENCODING INVALID_FORMAT INVALID_MODEL INVALID_REQUEST INVALID_SOURCE INVALID_TAXONOMY LIMIT MATERIAL_REQUIRED NOT_DERIVABLE NOT_FOUND NOT_INITIALIZED OWNED_MATERIAL_REQUIRED PENDING_MODEL PLAN_CONSUMED PLAN_OPERATION_MISMATCH PROVIDER_ASYNC PROVIDER_FAILED PROVIDER_MISMATCH PROVIDER_REQUIRED REQUEST_CONFLICT REVIEW_MISMATCH REVIEW_REQUIRED REVISION_CONFLICT REVOKED_MATERIAL SCOPE_MISMATCH SESSION_EXISTS SOURCE_BINDING_MISMATCH SOURCE_MISMATCH SOURCE_QUARANTINED STATE_ERROR UNKNOWN UNKNOWN_REVOCATION UNKNOWN_SOURCE UNKNOWN_WORKSPACE UNSAFE_WORKSPACE UNSUPPORTED_DEPENDENCY UNSUPPORTED_KIND UNSUPPORTED_OPERATION UNSUPPORTED_PLATFORM".split(' '));
const help = {
  usage: ['evopilot-next-ontology capabilities', 'evopilot-next-ontology help', 'evopilot-next-ontology version', 'evopilot-next-ontology request --workspace <canonicalAbsoluteRoot> --workspace-id <slug> [--request-file <absoluteJSONpath>]'],
  input: 'One bounded JSON request from stdin or the exact explicit regular file.',
  exitCodes: { success: 0, serviceFailure: 1, invalidInput: 2 },
};
function parseArgs(args: string[]) {
  if (!Array.isArray(args) || args.some(a => typeof a !== 'string')) fail('USAGE', 'Invalid arguments');
  const [raw, ...rest] = args;
  const command = raw === '--help' ? 'help' : raw === '--version' ? 'version' : raw;
  if (['capabilities', 'help', 'version'].includes(command)) {
    if (rest.length) fail('USAGE', 'Unexpected arguments');
    return { command };
  }
  if (command !== 'request') fail('USAGE', 'Expected a supported command');
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i], value = rest[i + 1];
    if (!['--workspace', '--workspace-id', '--request-file'].includes(key) || Object.hasOwn(flags, key) || !value || value.startsWith('--')) fail('USAGE', 'Invalid request flags');
    flags[key] = value;
  }
  const root = flags['--workspace'];
  if (!root || !isAbsolute(root) || resolve(root) !== root || !flags['--workspace-id']) fail('USAGE', 'Explicit canonical workspace and workspace id required');
  slug(flags['--workspace-id']);
  const file = flags['--request-file'];
  if (file && !isAbsolute(file)) fail('USAGE', 'Absolute request file required');
  return { command, root, id: flags['--workspace-id'], file };
}
async function readInput(file: string | undefined, stdin: AsyncIterable<string | Buffer>) {
  const chunks: Buffer[] = []; let size = 0;
  const add = (chunk: string | Buffer) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > LIMITS.requestBytes) fail('LIMIT', 'Request byte limit');
    chunks.push(bytes);
  };
  if (file) {
    let handle;
    try {
      const before = await lstat(file);
      if (!before.isFile() || before.isSymbolicLink()) fail('INPUT_FILE', 'Regular request file required');
      if (before.size > LIMITS.requestBytes) fail('LIMIT', 'Request byte limit');
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const actual = await handle.stat();
      if (!actual.isFile() || actual.dev !== before.dev || actual.ino !== before.ino) fail('INPUT_FILE', 'Request file changed');
      if (actual.size > LIMITS.requestBytes) fail('LIMIT', 'Request byte limit');
      while (true) {
        const buffer = Buffer.alloc(Math.min(65536, LIMITS.requestBytes + 1 - size));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        add(buffer.subarray(0, bytesRead));
      }
    } catch (error) {
      if (errorCode(error) === 'LIMIT') throw error;
      fail('INPUT_FILE', 'Cannot read regular request file');
    } finally { await handle?.close(); }
  } else {
    for await (const chunk of stdin) add(chunk);
  }
  const bytes = Buffer.concat(chunks), text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) fail('INVALID_ENCODING', 'Invalid UTF-8');
  let request;
  try { request = JSON.parse(text); } catch { fail('INVALID_REQUEST', 'Expected one JSON request'); }
  bounded(request);
  validateRequest(request);
  return request as unknown as ExecuteRequest | ClassificationRequest;
}

// Injected streams are trusted test/host code, never request-configurable providers.
export async function main(args: string[], { stdin = process.stdin, stdout = process.stdout }: { stdin?: AsyncIterable<string | Buffer>; stdout?: { write(chunk: string): unknown } } = {}) {
  let response, exitCode = 0, executing = false;
  try {
    const parsed = parseArgs(args);
    let result;
    if (parsed.command === 'help') result = help;
    else if (parsed.command === 'version') result = { product: PRODUCT, version: VERSION };
    else if (parsed.command === 'capabilities') result = {
      ...capabilities(), stage: 'M2_STANDALONE_CLI', operations,
      limits: LIMITS, authority: false, softwareRelease: false,
      pending: ['M3 trusted provider wiring', 'MCP', 'Expert', 'full Host acceptance'],
      providers: { resolveClassificationSource: false, classificationAdvisor: false, classificationModel: false, resolveLegacyHarness: false },
    };
    else {
      const request = await readInput(parsed.file, stdin);
      const service = createOntologyService({ workspaceRoot: parsed.root!, workspaceId: parsed.id! });
      try {
        executing = true;
        service.initialize();
        result = classificationDispatch.includes(request.operation) ? await service.classify(request as ClassificationRequest) : service.execute(request as ExecuteRequest);
      } finally { service.close(); }
    }
    response = { ok: true, product: PRODUCT, version: VERSION, result, authority: false };
  } catch (error) {
    const code = ['USAGE', 'INPUT_FILE'].includes(errorCode(error) ?? "") || serviceCodes.has(errorCode(error) ?? "") ? errorCode(error)! : executing ? 'STATE_ERROR' : 'INVALID_REQUEST';
    // Never echo exception messages, paths, parser excerpts or caller-controlled fields.
    const message = code === 'USAGE' ? 'Invalid command arguments; use help.'
      : code === 'INPUT_FILE' ? 'Cannot read a bounded regular request file.'
      : ['CLASSIFICATION_PROVIDER_UNAVAILABLE', 'CLASSIFICATION_SOURCE_UNAVAILABLE', 'PROVIDER_REQUIRED'].includes(code) ? 'Required trusted provider unavailable.'
      : executing ? 'Ontology service request failed.' : 'Invalid or oversized request input.';
    response = { ok: false, error: { code, message }, authority: false };
    exitCode = executing ? 1 : 2;
  }
  stdout.write(JSON.stringify(response) + '\n');
  return exitCode;
}

// Resolve the argv entry so an installed package-manager bin symlink also works.
function isEntry() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); }
  catch { return false; }
}
if (isEntry()) process.exitCode = await main(process.argv.slice(2));
