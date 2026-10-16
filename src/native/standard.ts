import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { nativeBytesDigest, nativeSha256, nativeFrozenClone } from '../../vendor/compatibility/v1/native.mjs';
import type { OntologyStandard } from './types.js';
import { fail } from '../state.js';
// src/native and dist/native share the same two-level package-root relation.
const specificationRoot = fileURLToPath(new URL('../../specifications/v1/', import.meta.url));
export function standardDirectory(): string { return specificationRoot; }
export function contractDigest(): string { return nativeBytesDigest(readFileSync(new URL('../../vendor/compatibility/v1/native.mjs', import.meta.url))); }
export function inspectOntologyStandard(): Readonly<OntologyStandard> {
  const base = specificationRoot;
  const entries: { path: string; sha256: string }[] = [];
  const visit = (directory: string): void => {
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) fail('INVALID_STANDARD', 'Regular installed standard directory required');
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name), stat = lstatSync(path);
      if (name.startsWith('.') || stat.isSymbolicLink()) fail('INVALID_STANDARD', 'Unlisted/linked normative content');
      if (stat.isDirectory()) visit(path);
      else if (stat.isFile()) entries.push({ path: relative(base, path).replaceAll('\\', '/'), sha256: nativeBytesDigest(readFileSync(path)) });
      else fail('INVALID_STANDARD', 'Regular normative file required');
    }
  };
  visit(base); entries.sort((a, b) => a.path<b.path?-1:a.path>b.path?1:0);
  const lockBytes = readFileSync(join(base, 'standards.lock.json'));
  const lock: unknown = JSON.parse(lockBytes.toString('utf8'));
  const supportMatrix: unknown = JSON.parse(readFileSync(join(base, 'support-matrix.json'), 'utf8'));
  return nativeFrozenClone({ schema: 'evopilot-standard-inspection/v1', owner: 'ontology', specVersion: 'v1', standardDigest: nativeSha256(entries), standardLockDigest: nativeBytesDigest(lockBytes), contractDigest: contractDigest(), files: entries, lock, supportMatrix, authority: false });
}
