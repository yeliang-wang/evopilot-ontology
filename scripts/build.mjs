import { spawnSync } from 'node:child_process';
import { chmod, cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const compiler = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
const result = spawnSync(process.execPath, [compiler, '-p', fileURLToPath(new URL('../tsconfig.json', import.meta.url))], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
else {
  await cp(new URL('../src/compat/', import.meta.url), new URL('../dist/compat/', import.meta.url), { recursive: true });
  await chmod(new URL('../dist/cli.js', import.meta.url), 0o755);
  await chmod(new URL('../dist/standalone/cli.js', import.meta.url), 0o755);
  await mkdir(new URL('../plugins/codex/skills/evopilot-ontology-expert/',import.meta.url),{recursive:true});
  await cp(new URL('../src/expert/SKILL.md',import.meta.url),new URL('../plugins/codex/skills/evopilot-ontology-expert/SKILL.md',import.meta.url));
}
