import { LIMITS } from './types.js';

/** Wire admission counts encoded bytes, not JavaScript heap or durable state.
 * Only operations that already admit bounded native v2 documents gain room. */
export const REQUEST_BUDGETS = Object.freeze({
  sourceBytes: 48 * 1024 * 1024,
  modelBytes: 48 * 1024 * 1024,
  expectationsBytes: 16 * 1024 * 1024,
  inputEnvelopeBytes: 4096,
  ownerEnvelopeBytes: 4096,
  mcpEnvelopeBytes: 16384,
  maxOwnerBytes: 48 * 1024 * 1024 + 8192,
  maxWireBytes: 48 * 1024 * 1024 + 24576,
  aggregateBytes: 64 * 1024 * 1024,
  activeRequests: 8,
  ordinaryTimeoutMs: 10000,
  largeTimeoutMs: 60000,
  mcpResponseBytes: 8 * 1024 * 1024 + 65536,
});

function documentBudget(operation: unknown): number | null {
  if (operation === 'source.admit') return REQUEST_BUDGETS.sourceBytes;
  if (operation === 'model.record') return REQUEST_BUDGETS.modelBytes;
  if (operation === 'expectations.record') return REQUEST_BUDGETS.expectationsBytes;
  return null;
}
export function inputBudget(operation: unknown): number {
  const bytes = documentBudget(operation);
  return bytes === null ? LIMITS.requestBytes : bytes + REQUEST_BUDGETS.inputEnvelopeBytes;
}
export function ownerRequestBudget(operation: unknown): number {
  const bytes = documentBudget(operation);
  return bytes === null ? LIMITS.requestBytes : inputBudget(operation) + REQUEST_BUDGETS.ownerEnvelopeBytes;
}
export function requestTimeoutMs(operation: unknown): number {
  return documentBudget(operation) === null ? REQUEST_BUDGETS.ordinaryTimeoutMs : REQUEST_BUDGETS.largeTimeoutMs;
}
