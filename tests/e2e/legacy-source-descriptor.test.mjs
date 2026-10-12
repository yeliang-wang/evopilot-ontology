import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSourceConceptHypothesis } from "../../src/compat/v4/classification/source-concept.mjs";
import { normalizeSourceDescriptor, resolveSourceDescriptor, sourceDescriptorDigest } from "../../src/compat/v4/classification/source-descriptor.mjs";

test("GitHub locator vectors share one canonical repository identity and reject embedded credentials", () => {
  const shorthand = normalizeSourceDescriptor({ type: "GITHUB_REPOSITORY", repository: "openai/openai-node", requestedRef: "main" });
  const https = normalizeSourceDescriptor({ type: "GITHUB_REPOSITORY", repository: "https://github.com/openai/openai-node.git", requestedRef: "main" });
  const ssh = normalizeSourceDescriptor({ type: "GITHUB_REPOSITORY", repository: "git@github.com:openai/openai-node.git", requestedRef: "main" });
  assert.equal(shorthand.locator.repository, "openai/openai-node");
  assert.equal(https.locator.repository, shorthand.locator.repository);
  assert.equal(ssh.locator.repository, shorthand.locator.repository);
  assert.equal(https.sourceId, shorthand.sourceId);
  assert.equal(ssh.sourceId, shorthand.sourceId);
  assert.equal(ssh.locator.transport, "SSH");
  assert.throws(() => normalizeSourceDescriptor({ type: "GITHUB_REPOSITORY", repository: "https://user:secret@github.com/openai/openai-node.git" }), (error) => error.code === "SOURCE_EMBEDDED_CREDENTIALS_REJECTED");
});

test("local Source resolution is read-only and acquisition time is outside deterministic Source bindings", () => {
  const home = workspace();
  const source = path.join(home, "source");
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "README.md"), "distributed cache replication failover\n");
  const descriptor = normalizeSourceDescriptor({ sourceId: "cache-source", type: "LOCAL_DIRECTORY", path: source });
  const before = fileState(source);
  const first = resolveSourceDescriptor({ descriptor, workspace: home, now: "2026-08-28T01:00:00.000Z" });
  const second = resolveSourceDescriptor({ descriptor, workspace: home, now: "2026-08-28T02:00:00.000Z" });
  assert.notEqual(first.acquiredAt, second.acquiredAt);
  assert.equal(first.sourceResolutionDigest, second.sourceResolutionDigest);
  assert.equal(buildSourceConceptHypothesis(first).sourceSnapshotDigest, buildSourceConceptHypothesis(second).sourceSnapshotDigest);
  assert.deepEqual(fileState(source), before);
});

test("ordered attachment membership and order are exact deterministic bindings", () => {
  const home = workspace();
  const firstFile = path.join(home, "first.md");
  const secondFile = path.join(home, "second.md");
  fs.writeFileSync(firstFile, "first cache architecture\n");
  fs.writeFileSync(secondFile, "second gateway design\n");
  const firstOrder = { type: "ORDERED_ATTACHMENT_SET", members: [{ sourceId: "first-source", path: firstFile }, { sourceId: "second-source", path: secondFile }] };
  const reversed = { type: "ORDERED_ATTACHMENT_SET", members: [{ sourceId: "second-source", path: secondFile }, { sourceId: "first-source", path: firstFile }] };
  assert.notEqual(sourceDescriptorDigest(firstOrder), sourceDescriptorDigest(reversed));
  const firstSnapshot = buildSourceConceptHypothesis(resolveSourceDescriptor({ descriptor: firstOrder, workspace: home }));
  const reversedSnapshot = buildSourceConceptHypothesis(resolveSourceDescriptor({ descriptor: reversed, workspace: home }));
  assert.notEqual(firstSnapshot.sourceSnapshotDigest, reversedSnapshot.sourceSnapshotDigest);
  assert.deepEqual(firstSnapshot.sourceSnapshot.sourceBinding.members.map((item) => item.sourceId), ["first-source", "second-source"]);
  assert.deepEqual(reversedSnapshot.sourceSnapshot.sourceBinding.members.map((item) => item.sourceId), ["second-source", "first-source"]);
});

function fileState(root) {
  return fs.readdirSync(root).sort().map((name) => ({ name, bytes: fs.readFileSync(path.join(root, name)).toString("hex") }));
}

function workspace() { return fs.mkdtempSync(path.join(os.tmpdir(), "ontology-source-descriptor-")); }

test("local file descriptors and invalid/redacted paths require no default home", () => {
  const root = workspace(), file = path.join(root, "note.md");
  fs.writeFileSync(file, "public source");
  const result = resolveSourceDescriptor({descriptor: {type: "LOCAL_FILE", path: file}});
  assert.equal(result.path, file);
  assert.equal(result.networkAcquisition, "NONE");
  for (const descriptor of [{type: "UNKNOWN"}, {type: "LOCAL_FILE"}, {type: "ORDERED_ATTACHMENT_SET", members: []}]) assert.throws(() => normalizeSourceDescriptor(descriptor));
  assert.throws(() => normalizeSourceDescriptor({type: "LOCAL_FILE", path: path.join(root, "credentials.json")}), {code: "SOURCE_PROTECTED_PATH"});
  assert.throws(() => resolveSourceDescriptor({descriptor: {type: "GITHUB_REPOSITORY", repository: "example/public"}}));
});
test("public Git cache requires an explicit confined external workspace before acquisition", () => {
  const descriptor = {type: "GITHUB_REPOSITORY", repository: "example/public", requestedRef: "a".repeat(40)};
  assert.throws(() => resolveSourceDescriptor({descriptor, workspace: path.resolve(import.meta.dirname, "../..")}), /outside/);
  const root = workspace();
  fs.symlinkSync(path.resolve(import.meta.dirname, "../.."), path.join(root, "source-cache"));
  assert.throws(() => resolveSourceDescriptor({descriptor, workspace: root}), {code: "WORKSPACE_WRITE_BOUNDARY_VIOLATION"});
});
