import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import { inspectLegacySource, deriveLegacyModel } from '../../dist/migration.js';
import { buildDelivery } from '../../dist/delivery.js';
import { validateOntology } from '../../dist/specification.js';
import { sha256 } from '../../vendor/compatibility/v1/reference.mjs';
import { createProfessionalPack, inspectProfessionalPack } from '../../src/compat/v4/semantics/professional-packs.mjs';
import { digest } from '../../src/compat/v3/utils.mjs';
const inspectionOptions = { sourceLocator: 'synthetic://legacy/source', sourceRevision: 'r1', sourceVisibility: 'public' };
const options = { ...inspectionOptions, id: 'derived', version: '1.0.0', visibility: 'private' };
function pack() { return createProfessionalPack({kind: 'DomainOntologyPack', metadata: {id: 'test', version: '1.0.0', namespace: 'test.domain', root: 'DOMAIN_TEAM', visibility: 'DOMAIN', owner: 'team', provenance: {author: 'author', reviewers: [], approvers: [], publishers: [], sourceRefs: ['synthetic://test']}}, spec: {concepts: [{conceptId: 'test.domain:item', label: 'Item', metaType: 'ENTITY', definition: 'A synthetic item.'}]}}); }
function frozen(v) { if (v && typeof v === 'object') { assert(Object.isFrozen(v)); Object.values(v).forEach(frozen); } }
test('complete synthetic pack and snapshot project to deliverable native models', () => {
  const source = pack();
  const snapshot = {schema: 'evopilot-harness-resolved-project-ontology-snapshot/v1', project: {}, foundationDigest: digest({}), proposalDigest: digest({}), baseDigest: digest({}), packSetDigest: digest({}), packs: [{}], dependencyGraph: [], concepts: source.spec.concepts, overlay: null, predecessorSnapshotDigest: null, resolvedAt: null, authority: {}};
  snapshot.snapshotDigest = digest(snapshot);
  for (const d of [source, snapshot]) {
    const before = JSON.stringify(d), report = deriveLegacyModel(d, options);
    assert.equal(report.status, 'VALID', JSON.stringify(report));
    assert.equal(validateOntology(report.model).valid, true);
    assert.equal(buildDelivery(report.model).buildReport.status, 'BUILT');
    assert.equal(report.businessConfirmed, false); frozen(report);
    assert.deepEqual(report, deriveLegacyModel(d, options));
    assert.equal(JSON.stringify(d), before);
    assert.equal(report.inspection.documentDigest, sha256(d));
    assert(report.coverage.mappings.some(m => m.sourcePointer.endsWith('/0/definition') && m.targetPointer === '/concepts/0/definition'));
  }
});
test('drift, schema/kind tampering, visibility, accessors and unknown options fail closed', () => {
  const p = pack();
  for (const d of [{...p, kind: 'DomainHarnessPack'}, {...p, schema: 'unknown/v999'}, {...p, metadata: {...p.metadata, digest: digest({})}}]) assert.equal(inspectLegacySource(d, inspectionOptions).valid, false);
  assert.equal(inspectLegacySource(p, {...inspectionOptions, expectedDocumentDigest: digest({})}).valid, false);
  assert.equal(deriveLegacyModel(p, {...options, sourceVisibility: 'private', visibility: 'public'}).valid, false);
  assert.equal(inspectLegacySource(p, {...inspectionOptions, extra: true}).valid, false);
  let calls = 0; const getter = {get schema() { calls++; return 'unknown'; }};
  assert.equal(inspectLegacySource(getter, inspectionOptions).valid, false);
  assert.equal(inspectLegacySource(p, getter).valid, false); assert.equal(calls, 0);
});
test('unsupported rules and dangling references remain required pending issues', () => {
  const p = pack(); p.spec.rules = [{ruleId: 'test.domain:rule', expression: 'item implies review', bounded: true}];
  p.spec.concepts[0].relationships = [{from: 'test.domain:item', to: 'missing', directed: true}];
  delete p.metadata.digest; p.metadata.digest = digest(p);
  const result = deriveLegacyModel(p, options);
  assert.equal(result.status, 'PENDING', JSON.stringify(result));
  assert(result.coverage.gaps.some(g => g.reason === 'UNSUPPORTED_CORE_SEMANTICS'));
  assert.throws(() => buildDelivery(result.model));
});
test('recognized technical document does not become an empty model', () => {
  const document = inspectProfessionalPack(pack());
  // A real owned factory provides a strictly valid technical receipt.
  const p = pack();
  assert.equal(inspectLegacySource(p, inspectionOptions).valid, true);
  assert.equal(inspectLegacySource(document, inspectionOptions).valid, true);
  assert.equal(deriveLegacyModel(document, options).status, 'NO_MODEL_PROJECTION');
});

// Exact public source from commit 372733fd7b67ec3bee9efe6322f0229db77b160d; SHA256 a04f0c27b4406db5cc534f8823c14e834926b9b1f94779e19137aa457facab53
const historicalBytes = "apiVersion: harness.evopilot.io/v1\nkind: OntologyPack\nmetadata:\n  id: software-engineering\n  version: 1.1.0\n  lifecycle: published\n  description: Product-neutral concepts used only to determine Harness asset eligibility and candidate relationships.\nspec:\n  evidenceKinds:\n    - source-code\n    - architecture-document\n    - build-manifest\n    - runtime-log\n    - attachment\n    - operator-note\n    - github-repository\n    - historical-harness\n    - research-evidence\n  concepts:\n    - id: distributed-cache\n      terms: [distributed cache, redis compatible, key-value store, ttl, eviction, hash slot, failover, cluster cache, 分布式缓存, 键值存储]\n      parents: [data-infrastructure]\n      conflicts: [redis-client]\n    - id: redis-client\n      terms: [spring-data-redis, jedis, redis client, redis template, redis serializer, connection factory]\n      parents: [client-library]\n      conflicts: [distributed-cache]\n    - id: database-product\n      terms: [database engine, sql parser, query optimizer, transaction, wal, mvcc, storage engine, distributed sql, 数据库内核]\n      parents: [data-infrastructure]\n      conflicts: [database-client]\n    - id: api-gateway\n      terms: [api gateway, reverse proxy, route policy, rate limit, upstream, ingress, traffic gateway, 网关, 限流]\n      parents: [network-infrastructure]\n      conflicts: [http-client]\n    - id: scheduler\n      terms: [scheduler, job scheduling, cron, task dispatch, worker queue, 调度系统, 任务调度]\n      parents: [platform-infrastructure]\n    - id: rpc-framework\n      terms: [rpc framework, dubbo, grpc, service discovery, remoting, rpc context]\n      parents: [network-infrastructure]\n    - id: observability\n      terms: [apm, tracing, telemetry, metrics, span, observability, 可观测性]\n      parents: [platform-infrastructure]\n    - id: management-software\n      terms: [rbac, admin console, workflow approval, reporting, audit trail, crm, enterprise management]\n      parents: [business-application]\n    - id: language-service\n      terms: [spring boot, java service, golang service, node service, python service, rest controller, code generation, 代码生成, 领域驱动设计, ddd, domain service, facade, manager, mybatis, plantuml, 持久层, 门面层, 业务逻辑]\n      parents: [application-runtime]\n    - id: executable-engineering\n      terms: [build, test, validate, deploy, diagnose, benchmark, migrate, verify, rollback, release]\n  roles:\n    - id: distributed-cache-product\n      domain: distributed-cache\n      taskClass: product-engineering\n      concepts: [distributed-cache, executable-engineering]\n      negativeConcepts: [redis-client]\n    - id: redis-client-library\n      domain: redis-client\n      taskClass: library-engineering\n      concepts: [redis-client, executable-engineering]\n      negativeConcepts: [distributed-cache]\n    - id: database-product\n      domain: database\n      taskClass: product-engineering\n      concepts: [database-product, executable-engineering]\n      negativeConcepts: [database-client]\n    - id: api-gateway-product\n      domain: api-gateway\n      taskClass: product-engineering\n      concepts: [api-gateway, executable-engineering]\n      negativeConcepts: [http-client]\n    - id: scheduler-platform\n      domain: scheduler\n      taskClass: platform-engineering\n      concepts: [scheduler, executable-engineering]\n    - id: rpc-framework\n      domain: rpc-framework\n      taskClass: framework-engineering\n      concepts: [rpc-framework, executable-engineering]\n    - id: observability-platform\n      domain: observability\n      taskClass: platform-engineering\n      concepts: [observability, executable-engineering]\n    - id: enterprise-management-application\n      domain: management-software\n      taskClass: application-engineering\n      concepts: [management-software, executable-engineering]\n    - id: language-service\n      domain: language-service\n      taskClass: service-engineering\n      concepts: [language-service, executable-engineering]\n";
test('actual historical source retains bytes and observed lifecycle but remains pending', () => {
 const before = historicalBytes, document = parse(historicalBytes);
 const result = deriveLegacyModel(document, options);
 assert.equal(result.status, 'PENDING', JSON.stringify(result));
 assert.equal(result.inspection.observed.lifecycle, 'published');
 assert.equal(result.inspection.observed.digest, null);
 assert.equal(result.inspection.documentDigest, sha256(document));
 assert.deepEqual(result.inspection.preservation.completeDocument, document);
 assert.equal(historicalBytes, before);
 assert(result.coverage.gaps.some(g => g.reason === 'MISSING_BUSINESS_DEFINITION'));
 assert(result.coverage.gaps.some(g => g.reason === 'MISSING_REFERENCED_CONCEPT'));
 assert.throws(() => buildDelivery(result.model));
 frozen(result);
 for (const mapping of result.coverage.mappings) {
   const source = mapping.sourcePointer.split('/').slice(1).reduce((v,k) => v[k.replaceAll('~1','/').replaceAll('~0','~')], document);
   assert.notEqual(source, undefined);
 }
});
