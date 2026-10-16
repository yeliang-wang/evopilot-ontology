import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
// Test-only attestation. This helper never represents an actual human decision.
export function syntheticDecisionEvidence(root, subject) {
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const directory = join(root, 'synthetic-decision-evidence');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const source = JSON.stringify({ synthetic: true, message: 'Synthetic test operator attestation; no actual human approval.', subject });
  const sourcePath = join(directory, sha(source) + '.source.json');
  writeFileSync(sourcePath, source, { mode: 0o600 });
  const body = JSON.stringify({ schema: 'evopilot-decision-evidence/v1', subject, source: { reference: pathToFileURL(sourcePath).href + '#sha256=' + sha(source), description: 'Isolated synthetic test evidence, never real human authority' } });
  const filename = join(directory, sha(body) + '.json');
  writeFileSync(filename, body, { mode: 0o600 });
  return pathToFileURL(filename).href + '#sha256=' + sha(body);
}
