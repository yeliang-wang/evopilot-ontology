import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const fail = message => { throw new Error(message); };
const hash = raw => `sha256:${createHash('sha256').update(raw).digest('hex')}`;
export async function inspectGovernance(root = ROOT) {
  const read = path => readFile(resolve(root, path), 'utf8');
  const target = JSON.parse(await read('governance/target-v090.json'));
  if (target.schema !== 'evopilot-evolution-target/v1' || target.owner !== 'ontology' || target.targetVersion !== '0.9.0' || target.implementationStatus !== 'AUTHORIZED') fail('UNKNOWN: invalid target identity or implementation status');
  const bindings = {
    roadmapDigest: 'governance/roadmap.json', planDigest: 'docs/ontology-v090-plan.md',
    adrDigest: 'docs/architecture/0001-ontology-v090-independence.md', acceptanceDigest: 'governance/acceptance-v090.json',
    expertSourceDigest: 'governance/expert-source-v090.json',
  };
  for (const [key, path] of Object.entries(bindings)) if (hash(await read(path)) !== target[key]) fail(`DEVIATION: ${key} drift`);
  const roadmap = JSON.parse(await read(bindings.roadmapDigest));
  const matrix = JSON.parse(await read(bindings.acceptanceDigest));
  if (roadmap.owner !== 'ontology' || roadmap.targetVersion !== target.targetVersion || matrix.version !== target.targetVersion) fail('DEVIATION: version/owner mismatch');
  const stages = roadmap.milestones.map(m => m.id);
  if (JSON.stringify(stages) !== JSON.stringify(Array.from({length: 7}, (_, i) => `P${i}`))) fail('DEVIATION: milestone set');
  if (!Array.isArray(matrix.cases) || !matrix.cases.length || new Set(matrix.cases.map(c => c.id)).size !== matrix.cases.length) fail('DEVIATION: missing/duplicate cases');
  for (const c of matrix.cases) {
    if (!stages.includes(c.stage) || !roadmap.milestones.find(m => m.id === c.stage).groups.includes(c.group) || !c.variant || !c.requiredOrigin || !c.collector?.startsWith('tests/acceptance/v090/')) fail(`DEVIATION: unmapped case ${c.id}`);
    if (c.status !== 'NOT_EVALUATED' || c.evidence.length !== 0) fail('DEVIATION: source matrix must not claim private acceptance');
  }
  for (const m of roadmap.milestones) for (const g of m.groups) if (!matrix.cases.some(c => c.group === g && c.stage === m.id)) fail(`DEVIATION: empty group ${g}`);
  return {target, targetDigest: hash(await read('governance/target-v090.json')), caseCount: matrix.cases.length};
}

export async function gate({stage, intent, paths}, root = ROOT) {
  const {target, targetDigest, caseCount} = await inspectGovernance(root);
  const scopes = target.workScopes[stage];
  if (!scopes || typeof intent !== 'string' || !intent.trim() || !Array.isArray(paths) || !paths.length) fail('UNKNOWN: concrete stage, intent and paths required');
  const rootReal = await realpath(root);
  for (const path of paths) {
    if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\') || path.split('/').some(p => !p || p === '.' || p === '..')) fail('BOUNDARY_CHANGE: invalid relative path');
    if (['src/compat/', 'vendor/', 'specifications/v1/'].some(p => path === p.slice(0,-1) || path.startsWith(p))) fail('BOUNDARY_CHANGE: frozen historical path');
    if (!scopes.some(p => p.endsWith('/') ? path.startsWith(p) : path === p)) fail(`UNPLANNED: ${path} outside ${stage}`);
    // Existing ancestors must resolve within this owner; planned files may not exist yet.
    let parent = resolve(root, path);
    while (true) {
      try {
        const actual = await realpath(parent), rel = relative(rootReal, actual);
        if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail('BOUNDARY_CHANGE: path escapes owner through symlink');
        break;
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        const next = resolve(parent, '..');
        if (next === parent) throw e;
        parent = next;
      }
    }
  }
  return {status:'ALIGNED', stage, intent, paths, targetDigest, roadmapDigest:target.roadmapDigest, caseCount, acceptance:'NOT_EVALUATED', authority:false, releaseAuthorized:false, scopeOnly:true};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--check') {
      const info = await inspectGovernance();
      console.log(JSON.stringify({status:'PASSED', targetDigest:info.targetDigest, caseCount:info.caseCount, acceptance:'NOT_EVALUATED', authority:false}));
    } else if (args[0] === '--gate') {
      const params = {paths:[]};
      for (let i=1;i<args.length;i+=2) {
        const key = args[i], value = args[i+1];
        if (!value || !['--stage','--intent','--path'].includes(key)) fail('UNKNOWN: invalid gate arguments');
        if (key === '--path') params.paths.push(value);
        else { const name=key.slice(2); if (params[name] !== undefined) fail('UNKNOWN: duplicate argument'); params[name]=value; }
      }
      console.log(JSON.stringify(await gate(params)));
    } else fail('UNKNOWN: use --check or --gate --stage Pn --intent text --path relative/path; this checker does not grant release or cutover authority');
  } catch (e) { console.error(e.message); process.exitCode=1; }
}
