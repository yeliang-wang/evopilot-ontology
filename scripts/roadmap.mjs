import { readFile, realpath } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const fail = message => { throw new Error(message); };
const hash = raw => `sha256:${createHash('sha256').update(raw).digest('hex')}`;
// This parallel release contract is deliberately fixed in executable policy.
// Rehashing a modified source policy cannot silently weaken accepted obligations.
const LIMITED_PREVIEW_CONTRACT = {
  "schema": "ontology-limited-preview-policy/v1",
  "id": "ontology-v090-limited-preview",
  "owner": "ontology",
  "version": "0.9.0",
  "implementationStatus": "AUTHORIZED",
  "acceptanceStatus": "NOT_EVALUATED",
  "release": {
    "repository": "yeliang-wang/evopilot-ontology",
    "tag": "v0.9.0",
    "prerelease": true,
    "exactCandidateDecisionRequired": true,
    "technicalPassIsApproval": false,
    "releaseAuthorized": false
  },
  "platform": {
    "os": "linux",
    "arch": "arm64",
    "isolationRequired": true
  },
  "scope": [
    "native-asset-modeling",
    "asset-read",
    "declared-standards-validation",
    "malformed-input-and-scope-permission-negatives",
    "supported-historical-asset-read"
  ],
  "deferred": [
    "actual-desktop-expert-journeys",
    "cross-component-delivery",
    "daily-installation-or-plugin-switch",
    "test-asset-cleanup",
    "old-installation-upgrade"
  ],
  "runtimePolicy": "EXISTING_SCOPED_RBAC; DEFERRED_PROMISES_ARE_NOT_GLOBAL_API_DISABLEMENT",
  "sequence": [
    "FREEZE",
    "ISOLATED_INSTALL",
    "STANDARDS_E2E",
    "FULL_REPORT",
    "USER_REPORT_APPROVAL",
    "PRODUCT_E2E",
    "RELEASE_REVIEW",
    "DOWNLOADED_READBACK"
  ],
  "standards": {
    "policy": "governance/standards-gate-v090.json",
    "families": [
      "rdf11-turtle-syntax",
      "rdf11-turtle-eval",
      "rdfxml",
      "owl2-dl",
      "shacl-core",
      "shacl-sparql-local"
    ],
    "owlProfile": "OWL2_DL",
    "completeReportRequired": true,
    "allRequiredMustPass": true,
    "zeroRequiredIsPass": false,
    "decisionScope": "ENTER_LIMITED_PRODUCT_E2E_ONLY",
    "decisionBindings": [
      "candidateDigest",
      "corpusDigest",
      "toolchainDigest",
      "reportDigest",
      "freezeDigest",
      "targetDigest",
      "limitedPolicyDigest"
    ],
    "decisionSource": "EXPLICIT_USER_REVIEW_OF_COMPLETE_REPORT",
    "decisionLedger": "limited-review-ledger.json",
    "decisionSchema": "ontology-limited-standards-review/v1",
    "decisionAction": "APPROVE_LIMITED_PRODUCT_E2E",
    "decisionSourceSchema": "ontology-limited-user-review-source/v1"
  },
  "evidence": {
    "allRequiredMustPass": true,
    "zeroRequiredIsPass": false,
    "sourceCasesMustRemainNotEvaluated": true,
    "missingUnknownFailedStaleOrMismatchedBlocks": true,
    "preApprovalProductRuns": "DIAGNOSTIC_ONLY",
    "productCasesRequiringReportApproval": [
      "OL02",
      "OL03",
      "OL05",
      "OL06",
      "OL07",
      "OL08"
    ],
    "postReleaseCases": [
      "OL09",
      "OL10"
    ]
  },
  "fullTarget": {
    "acceptance": "governance/acceptance-v090.json",
    "requiredVariants": 143,
    "policy": "governance/standards-gate-v090.json",
    "plan": "docs/ontology-v090-plan.md",
    "adr": "docs/architecture/0001-ontology-v090-independence.md",
    "unchanged": true,
    "deferredIsPass": false
  },
  "document": "docs/ontology-v090-limited-preview.md",
  "entry": "scripts/limited-preview-gate-v090.mjs",
  "cases": [
    {
      "id": "OL01",
      "phase": "admission",
      "requirement": "SOURCE_CI_ARTIFACT",
      "expected": "Exact source CI succeeds and the candidate archive, manifest and toolchains match the frozen source and artifact digests.",
      "required": true,
      "status": "NOT_EVALUATED",
      "evidence": []
    },
    {
      "id": "OL02",
      "phase": "product",
      "requirement": "ISOLATED_INSTALL_LIFECYCLE",
      "expected": "Install the exact archive into a new isolated Linux arm64 root; start, inspect, read, stop and restart through the supported installed entries.",
      "required": true,
      "status": "NOT_EVALUATED",
      "evidence": []
    },
    {
      "id": "OL03",
      "phase": "product",
      "requirement": "NATIVE_MODELING_READ",
      "expected": "Use the installed scoped APIs to admit native modeling inputs and read the retained model and source-bound state.",
      "required": true,
      "status": "NOT_EVALUATED",
      "evidence": []
    },
    {
      "id": "OL04",
      "phase": "admission",
      "requirement": "STANDARDS_COMPLETE_REPORT",
      "expected": "All six standards families pass on the exact installed candidate, with the complete report and explicit user report approval bound to candidate, corpus, toolchain, report, freeze and Target digests.",
      "required": true,
      "status": "NOT_EVALUATED",
      "evidence": []
    },
    {
      "id": "OL05",
      "phase": "product",
      "requirement": "MALFORMED_INPUT_SCOPE_PERMISSIONS",
      "expected": "Observe installed rejection of malformed inputs, absent or invalid credentials, insufficient grants and cross-project access; retain actual request/response evidence.",
      "required": true,
      "status": "NOT_EVALUATED",
      "evidence": []
    },
    {
      "id": "OL06",
      "phase": "product",
      "requirement": "HISTORICAL_ASSET_READ",
      "expected": "Read unchanged historical asset bytes through an explicitly named supported read-only entry in an isolated copy; bind original and observed digests. This is not old-installation upgrade acceptance.",
      "required": true,
      "status": "NOT_EVALUATED",
      "evidence": []
    },
    {
      "id": "OL07",
      "phase": "product",
      "requirement": "DOCUMENTATION_PLUGIN_DECLARATIONS",
      "expected": "Check packaged English and Chinese release documentation, plugin declarations, supported operations and permission claims against the actual package, including every deferred promise.",
      "required": true,
      "status": "NOT_EVALUATED",
      "evidence": []
    },
    {
      "id": "OL08",
      "phase": "product",
      "requirement": "EXACT_RELEASE_REFUSAL",
      "expected": "Prove release review/publish refuses missing, failed, unknown, stale or mismatched required evidence and a missing exact publication decision; technical PASS never grants authority.",
      "required": true,
      "status": "NOT_EVALUATED",
      "evidence": []
    },
    {
      "id": "OL09",
      "phase": "post",
      "requirement": "PUBLIC_DOWNLOAD_DIGEST",
      "expected": "Download every published v0.9.0 prerelease asset from the public release and verify exact approved asset names, sizes and digests.",
      "required": true,
      "status": "NOT_EVALUATED",
      "evidence": []
    },
    {
      "id": "OL10",
      "phase": "post",
      "requirement": "DOWNLOADED_REINSTALL_READ_VALIDATION",
      "expected": "Install the publicly downloaded archive into a new isolated Linux arm64 root; repeat start/stop, modeling/read and declared validation checks against the same bound toolchains.",
      "required": true,
      "status": "NOT_EVALUATED",
      "evidence": []
    }
  ]
};
const LIMITED_PREVIEW_ROADMAP = {
  policy: 'governance/limited-preview-v090.json',
  document: 'docs/ontology-v090-limited-preview.md',
  target: 'ontology-v090-limited-preview',
  requiredCases: 10,
  fullTargetUnchanged: true,
};

export async function inspectGovernance(root = ROOT) {
  const read = path => readFile(resolve(root, path), 'utf8');
  const target = JSON.parse(await read('governance/target-v090.json'));
  if (target.schema !== 'evopilot-evolution-target/v1' || target.owner !== 'ontology' || target.targetVersion !== '0.9.0' || target.implementationStatus !== 'AUTHORIZED') fail('UNKNOWN: invalid target identity or implementation status');
  const bindings = {
    roadmapDigest: 'governance/roadmap.json', planDigest: 'docs/ontology-v090-plan.md',
    adrDigest: 'docs/architecture/0001-ontology-v090-independence.md', acceptanceDigest: 'governance/acceptance-v090.json',
    expertSourceDigest: 'governance/expert-source-v090.json',
    standardsGateDigest: 'governance/standards-gate-v090.json',
    standardsProtocolDigest: 'docs/standards-evaluation-v090.md',
    limitedPreviewDigest: 'governance/limited-preview-v090.json',
    limitedPreviewDocumentDigest: 'docs/ontology-v090-limited-preview.md',
  };
  if (target.limitedPreviewPolicy !== bindings.limitedPreviewDigest) fail('DEVIATION: missing limited Preview profile binding');
  for (const [key, path] of Object.entries(bindings)) {
    let raw;
    try { raw = await read(path); } catch (error) {
      if (error.code === 'ENOENT') fail(`DEVIATION: missing bound document ${path}`);
      throw error;
    }
    if (hash(raw) !== target[key]) fail(`DEVIATION: ${key} drift`);
  }
  const roadmap = JSON.parse(await read(bindings.roadmapDigest));
  const limitedPreview = JSON.parse(await read(bindings.limitedPreviewDigest));
  if (!isDeepStrictEqual(limitedPreview, LIMITED_PREVIEW_CONTRACT)) fail('DEVIATION: limited Preview contract changed');
  if (!isDeepStrictEqual(roadmap.limitedPreview, LIMITED_PREVIEW_ROADMAP)) fail('DEVIATION: limited Preview Roadmap binding changed');
  const matrix = JSON.parse(await read(bindings.acceptanceDigest));
  const standards = JSON.parse(await read(bindings.standardsGateDigest));
  const sequence = ['FREEZE','ISOLATED_INSTALL','STANDARDS_E2E','FULL_REPORT','USER_REPORT_APPROVAL','PRODUCT_E2E','RELEASE_REVIEW','DOWNLOADED_READBACK'];
  const families = ['rdf11-turtle-syntax','rdf11-turtle-eval','rdfxml','owl2-dl','shacl-core','shacl-sparql-local'];
  if (standards.schema !== 'ontology-standards-gate-policy/v1' || standards.version !== target.targetVersion || JSON.stringify(standards.sequence) !== JSON.stringify(sequence) || JSON.stringify(standards.families) !== JSON.stringify(families) || standards.officialStatus !== 'APPROVED' || standards.allRequiredMustPass !== true || standards.zeroRequiredIsPass !== false || standards.technicalPassIsApproval !== false || standards.releaseAuthorized !== false || standards.developmentChecksAreFormalAcceptance !== false || standards.originalRequiredVariants !== 143 || standards.sourceMatrixMustRemainNotEvaluated !== true || standards.decisionScope !== 'ENTER_ORIGINAL_PRODUCT_E2E_ONLY' || standards.productEntry !== 'scripts/formal-e2e.mjs' || standards.policyDocument !== bindings.standardsProtocolDigest) fail('DEVIATION: standards prerequisite changed');
  if (JSON.stringify(standards.decisionBindings) !== JSON.stringify(['candidateDigest','corpusDigest','toolchainDigest','reportDigest','freezeDigest','targetDigest']) || standards.decisionSource !== 'EXPLICIT_USER_REVIEW_OF_COMPLETE_REPORT') fail('DEVIATION: user review bindings changed');
  const prerequisite = roadmap.milestones.find(m => m.id === 'P5')?.entryGate;
  if (!prerequisite || prerequisite.policy !== bindings.standardsGateDigest || prerequisite.preflight !== standards.productEntry || JSON.stringify(prerequisite.sequence) !== JSON.stringify(sequence)) fail('DEVIATION: missing formal E2E dependency');
  if (roadmap.owner !== 'ontology' || roadmap.targetVersion !== target.targetVersion || matrix.version !== target.targetVersion) fail('DEVIATION: version/owner mismatch');
  const stages = roadmap.milestones.map(m => m.id);
  if (JSON.stringify(stages) !== JSON.stringify(Array.from({length: 7}, (_, i) => `P${i}`))) fail('DEVIATION: milestone set');
  if (!Array.isArray(matrix.cases) || matrix.cases.length !== 143 || new Set(matrix.cases.map(c => c.id)).size !== matrix.cases.length) fail('DEVIATION: missing/duplicate original cases');
  for (const c of matrix.cases) {
    if (!stages.includes(c.stage) || !roadmap.milestones.find(m => m.id === c.stage).groups.includes(c.group) || !c.variant || !c.requiredOrigin || !c.collector?.startsWith('tests/acceptance/v090/')) fail(`DEVIATION: unmapped case ${c.id}`);
    if (c.status !== 'NOT_EVALUATED' || c.evidence.length !== 0) fail('DEVIATION: source matrix must not claim private acceptance');
  }
  for (const m of roadmap.milestones) for (const g of m.groups) if (!matrix.cases.some(c => c.group === g && c.stage === m.id)) fail(`DEVIATION: empty group ${g}`);
  return {target, targetDigest: hash(await read('governance/target-v090.json')), caseCount: matrix.cases.length, limitedPreview, limitedPreviewDigest: target.limitedPreviewDigest};
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
