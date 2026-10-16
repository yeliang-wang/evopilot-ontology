const RAW_SECRET_KEY = /^(?:api[-_]?key|access[-_]?token|refresh[-_]?token|token|password|passwd|secret|authorization|cookie|credentials?)$/i;
const SAFE_REFERENCE_KEY = /(?:ref|file|path|profile|profileid|id)$/i;
const SAFE_PATH_KEY = /^(?:privateKey|publicKey|modelsFile)$/i;

const RAW_SECRET_PATTERNS = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i,
  /\b(?:authorization|proxy-authorization)\s*[:=]\s*bearer\s+\S+/i,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\b(?:api[-_]?key|access[-_]?token|refresh[-_]?token|token|password|passwd|secret|cookie|credentials?)\s*[:=]\s*\S+/i,
  /\bsk-[A-Za-z0-9_-]{8,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{12,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{12,}\b/,
  /\bglpat-[A-Za-z0-9_-]{12,}\b/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /:\/\/[^/\s:@]+:[^/\s@]+@/,
  /[?&](?:api[-_]?key|access[-_]?token|token|password|secret)=[^&\s]+/i
];

export function assertNoSensitiveMaterial(value, location = "value") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveMaterial(item, `${location}[${index}]`));
    return value;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (RAW_SECRET_KEY.test(key) && !SAFE_REFERENCE_KEY.test(key) && !SAFE_PATH_KEY.test(key)) {
        throw sensitiveError(`${location}.${key} cannot contain raw secret material; use a reviewed file or profile reference.`);
      }
      assertNoSensitiveMaterial(item, `${location}.${key}`);
    }
    return value;
  }
  if (typeof value === "string" && RAW_SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
    throw sensitiveError(`${location} appears to contain raw secret material; use a reviewed file or profile reference.`);
  }
  return value;
}

function sensitiveError(message) {
  const error = new Error(message);
  error.name = "OntologyMaterialError";
  error.code = "SENSITIVE_SESSION_INPUT_REJECTED";
  error.nextAction = "replace-secret-with-reference";
  return error;
}
