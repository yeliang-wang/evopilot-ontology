import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveSourceDescriptor } from '../../src/compat/v4/classification/source-descriptor.mjs';
export function taxonomy(overrides = {}) {
  return {
    apiVersion: "harness.evopilot.io/v1",
    kind: "Taxonomy",
    metadata: { namespace: "example", name: "software-products", version: "1.0.0" },
    spec: {
      engineRange: ">=4.5.0 <5.0.0",
      requiredCapabilities: ["taxonomy-c14n/v1", "source-concept-hypothesis/v1", "open-world-taxonomy-classifier/v1", "taxonomy-decision-aggregate/v1"],
      axisPolicies: { domainCardinality: "SINGLE", productCardinality: "SINGLE" },
      domains: [
        { id: "technology", label: "Technology", assignable: false },
        { id: "middleware", label: "Middleware", definition: "Reusable software infrastructure between applications and platforms.", aliases: ["middleware"], parents: ["technology"], assignable: true, positiveEvidenceHints: ["redis", "cache", "middleware"] }
      ],
      products: [
        { id: "infrastructure-product", label: "Infrastructure product", assignable: false },
        { id: "distributed-cache", label: "Distributed cache", definition: "A distributed key-value caching system with expiry and replication.", aliases: ["redis", "cache"], parents: ["infrastructure-product"], assignable: true, positiveEvidenceHints: ["redis", "ttl", "eviction", "replication"] }
      ]
    },
    ...overrides
  };
}

export function supportingAdvisor(input) {
  return {
    candidates: Object.entries(input.candidates).flatMap(([axis, candidates]) => candidates.map((candidate) => {
      const evidenceIds = candidate.nonLlmEvidence.slice(0, 2).map((item) => item.evidenceId);
      return { axis, nodeId: candidate.nodeId, support: evidenceIds.length ? "SUPPORT" : "NEUTRAL", confidence: evidenceIds.length ? 0.9 : 0.5, evidenceIds };
    })),
    unresolvedConcepts: []
  };
}


export function fixture() {
  const parent = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ontology-classification-'));
  fs.chmodSync(parent, 0o700);
  const source = path.join(parent, 'source'); fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'README.md'), 'This middleware provides a Redis distributed cache, key-value storage, TTL, eviction, replication, and cache client operations.\n');
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({name: 'cache-service', dependencies: {redis: '5.0.0', ioredis: '5.4.0'}}));
  const resolvedSource = resolveSourceDescriptor({descriptor: {type: 'LOCAL_DIRECTORY', sourceId: 'synthetic-cache', path: source}});
  return {
    parent, source, options: {workspaceRoot: path.join(parent, 'workspace'), workspaceId: 'synthetic'},
    providers: {classificationAdvisor: supportingAdvisor, classificationModel: {providerId: 'synthetic', modelId: 'fixture', revision: 'v1', timeoutMs: 1000}, resolveClassificationSource: binding => ({...binding, resolvedSource})},
    cleanup: () => fs.rmSync(parent, {recursive: true, force: true})
  };
}
