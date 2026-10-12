import { assertSourcePath, captureSourceFile } from "../source/path-policy.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { digest, persistedJson, safeId } from "../../v3/utils.mjs";
import { resolveWorkspacePath } from "../constants.mjs";

export const SOURCE_DESCRIPTOR_SCHEMA = "evopilot-harness-source-descriptor/v1";
export const SOURCE_RESOLUTION_SCHEMA = "evopilot-harness-source-resolution/v1";
export const SOURCE_RESOLVER_POLICY = "evopilot-harness-source-resolver/v1";
export const SOURCE_REDACTION_POLICY = "evopilot-harness-source-redaction/v1";

const LOCAL_TYPES = new Set(["LOCAL_FILE", "LOCAL_DIRECTORY", "LOCAL_GIT_REPOSITORY", "CONTROLLED_FIXTURE"]);
const GITHUB_REPOSITORY = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/;
const FULL_COMMIT = /^[a-f0-9]{40}$/i;
const MAX_GIT_ARCHIVE_BYTES = 256 * 1024 * 1024;

export function normalizeSourceDescriptor(input) {
  if (typeof input === "string") input = { type: inferLocalType(input), path: input };
  if (!input || typeof input !== "object" || Array.isArray(input)) throw sourceDescriptorError("SOURCE_DESCRIPTOR_REQUIRED", "SourceDescriptor/v1 is required.", "supply-source-descriptor");
  const type = String(input.type ?? "").trim().toUpperCase();
  if (![...LOCAL_TYPES, "GITHUB_REPOSITORY", "ORDERED_ATTACHMENT_SET"].includes(type)) throw sourceDescriptorError("SOURCE_TYPE_UNSUPPORTED", `Unsupported Source type: ${type || "[missing]"}.`, "choose-supported-source-type");

  const safeLabel = normalizeSafeLabel(input.safeLabel);
  const sourceId = normalizeSourceId(input.sourceId, input, type);
  const common = {
    schema: SOURCE_DESCRIPTOR_SCHEMA,
    sourceId,
    ...(safeLabel ? { safeLabel } : {}),
    type,
    acquisitionPolicy: acquisitionPolicy(type),
    redactionPolicy: { id: SOURCE_REDACTION_POLICY },
    sourceExecutionAllowed: false
  };

  if (LOCAL_TYPES.has(type)) {
    const locatorPath = input.locator?.path ?? input.path;
    if (!String(locatorPath ?? "").trim()) throw sourceDescriptorError("SOURCE_LOCATOR_REQUIRED", `${type} requires a local path.`, "supply-local-source-path");
    const canonical = canonicalLocalPath(locatorPath);
    return { ...common, sourceId: input.sourceId ? sourceId : generatedSourceId({ type, path: canonical }), locator: { class: "LOCAL_PATH", path: canonical } };
  }
  if (type === "ORDERED_ATTACHMENT_SET") {
    const members = Array.isArray(input.members) ? input.members : [];
    if (!members.length) throw sourceDescriptorError("SOURCE_ORDERED_MEMBERS_REQUIRED", "ORDERED_ATTACHMENT_SET requires at least one ordered member.", "supply-ordered-source-members");
    if (members.length > 128) throw sourceDescriptorError("SOURCE_ORDERED_MEMBERS_LIMIT_EXCEEDED", "ORDERED_ATTACHMENT_SET supports at most 128 members.", "reduce-ordered-source-members");
    const normalizedMembers = members.map((member, index) => {
      const memberPath = member?.path ?? member?.locator?.path;
      if (!String(memberPath ?? "").trim()) throw sourceDescriptorError("SOURCE_ORDERED_MEMBER_INVALID", `Ordered Source member ${index + 1} requires a local file path.`, "repair-ordered-source-member");
      const canonical = canonicalLocalPath(memberPath);
      return {
        sourceId: normalizeMemberId(member?.sourceId, canonical, index),
        ...(normalizeSafeLabel(member?.safeLabel) ? { safeLabel: normalizeSafeLabel(member.safeLabel) } : {}),
        path: canonical
      };
    });
    const duplicate = normalizedMembers.find((member, index) => normalizedMembers.findIndex((other) => other.sourceId === member.sourceId) !== index);
    if (duplicate) throw sourceDescriptorError("SOURCE_ORDERED_MEMBER_ID_DUPLICATE", `Ordered Source member id is duplicated: ${duplicate.sourceId}.`, "repair-ordered-source-member-ids");
    return { ...common, sourceId: input.sourceId ? sourceId : generatedSourceId({ type, members: normalizedMembers.map((member) => ({ sourceId: member.sourceId, path: member.path })) }), locator: { class: "ORDERED_MEMBERS" }, members: normalizedMembers };
  }

  const repositoryInput = input.locator?.repository ?? input.repository ?? input.url;
  const github = normalizeGitHubRepository(repositoryInput);
  const requestedRef = normalizeRequestedRef(input.requestedRef ?? input.ref);
  return {
    ...common,
    sourceId: input.sourceId ? sourceId : generatedSourceId({ type, repository: github.repository, requestedRef }),
    locator: { class: "GITHUB_REPOSITORY", repository: github.repository, transport: github.transport },
    ...(requestedRef ? { requestedRef } : {}),
    ...(input.privateRepository === true ? { privateRepository: true } : {})
  };
}

export function sourceDescriptorDigest(descriptorInput) {
  return digest(normalizeSourceDescriptor(descriptorInput));
}

export function resolveSourceDescriptor({ descriptor: descriptorInput, workspace, now = new Date().toISOString() }) {
  const descriptor = normalizeSourceDescriptor(descriptorInput);
  const descriptorDigest = digest(descriptor);
  if (descriptor.type === "GITHUB_REPOSITORY") return resolveGitHubSource({ descriptor, descriptorDigest, workspace, now });
  return resolveLocalSource({ descriptor, descriptorDigest, now });
}

function resolveLocalSource({ descriptor, descriptorDigest, now }) {
  const paths = descriptor.type === "ORDERED_ATTACHMENT_SET" ? descriptor.members.map((member) => member.path) : [descriptor.locator.path];
  for (const sourcePath of paths) {
    assertSourcePath(sourcePath);
    if (!fs.existsSync(sourcePath)) throw sourceDescriptorError("SOURCE_NOT_FOUND", `Source does not exist: ${sourcePath}.`, "repair-source-locator");
  }
  if (descriptor.type === "LOCAL_FILE" && !fs.statSync(paths[0]).isFile()) throw sourceDescriptorError("SOURCE_TYPE_MISMATCH", `${descriptor.type} requires a file.`, "repair-source-type-or-locator");
  if (["LOCAL_DIRECTORY", "LOCAL_GIT_REPOSITORY"].includes(descriptor.type) && !fs.statSync(paths[0]).isDirectory()) throw sourceDescriptorError("SOURCE_TYPE_MISMATCH", `${descriptor.type} requires a directory.`, "repair-source-type-or-locator");
  if (descriptor.type === "ORDERED_ATTACHMENT_SET" && paths.some((sourcePath) => !fs.statSync(sourcePath).isFile())) throw sourceDescriptorError("SOURCE_ORDERED_MEMBER_NOT_FILE", "Every ordered Source member must be a file.", "repair-ordered-source-members");

  let resolvedCommit = null;
  if (descriptor.type === "LOCAL_GIT_REPOSITORY") {
    try { resolvedCommit = git(["-C", paths[0], "rev-parse", "HEAD"]).trim(); }
    catch { throw sourceDescriptorError("SOURCE_LOCAL_GIT_INVALID", "LOCAL_GIT_REPOSITORY is not a readable Git repository with a resolved HEAD.", "repair-local-git-source"); }
    assertUnsupportedLocalGitFeatures(paths[0]);
  }
  const core = {
    schema: SOURCE_RESOLUTION_SCHEMA,
    sourceId: descriptor.sourceId,
    type: descriptor.type,
    sourceDescriptor: descriptor,
    sourceDescriptorDigest: descriptorDigest,
    acquisitionPolicy: descriptor.acquisitionPolicy,
    resolvedCommit,
    sourceExecution: false
  };
  core.sourceResolutionDigest = digest(core);
  return {
    ...core,
    acquiredAt: now,
    networkAcquisition: "NONE",
    path: descriptor.type === "ORDERED_ATTACHMENT_SET" ? null : paths[0],
    files: descriptor.type === "ORDERED_ATTACHMENT_SET" ? descriptor.members.map((member, index) => ({ path: member.path, sourceId: member.sourceId, safeLabel: member.safeLabel ?? path.basename(member.path), memberIndex: index })) : null
  };
}

function assertUnsupportedLocalGitFeatures(root) {
  if (fs.existsSync(path.join(root, ".gitmodules"))) throw sourceDescriptorError("SOURCE_GIT_SUBMODULE_UNSUPPORTED", "Git submodules are unsupported for v4.5 static Source acquisition.", "supply-source-without-submodules");
  const attributes = path.join(root, ".gitattributes");
  if (fs.existsSync(attributes) && /(?:^|\s)filter\s*=\s*lfs(?:\s|$)/im.test(captureSourceFile(attributes, { root }).bytes.toString("utf8"))) throw sourceDescriptorError("SOURCE_GIT_LFS_UNSUPPORTED", "Git LFS objects are unsupported for v4.5 static Source acquisition.", "supply-source-without-git-lfs");
}

function resolveGitHubSource({ descriptor, descriptorDigest, workspace, now }) {
  const repository = descriptor.locator.repository;
  const requestedRef = descriptor.requestedRef ?? "HEAD";
  const repoKey = digest({ repository, policy: SOURCE_RESOLVER_POLICY }).slice(7);
  const cacheRoot = resolveWorkspacePath(workspace, "source-cache", "github");
  const bare = resolveWorkspacePath(workspace, "source-cache", "github", "remotes", `${repoKey}.git`);
  const refCache = resolveWorkspacePath(workspace, "source-cache", "github", "refs", `${digest({ repository, requestedRef, policy: SOURCE_RESOLVER_POLICY }).slice(7)}.json`);
  fs.mkdirSync(path.dirname(bare), { recursive: true });
  fs.mkdirSync(path.dirname(refCache), { recursive: true });

  const pinnedSnapshot = FULL_COMMIT.test(requestedRef) ? snapshotPath(workspace, repoKey, requestedRef.toLowerCase()) : null;
  let resolvedCommit;
  let networkAcquisition = "FETCHED";
  if (pinnedSnapshot && fs.existsSync(pinnedSnapshot)) {
    resolvedCommit = requestedRef.toLowerCase();
    networkAcquisition = "CACHE_REPLAY";
  } else {
    // Public acquisition never invokes SSH or inherits its credential/config files.
    const remote = `https://github.com/${repository}.git`;
    try {
      if (!fs.existsSync(bare)) git(["init", "--bare", bare]);
      setRemote(bare, remote);
      git(["--git-dir", bare, "fetch", "--force", "--no-tags", "--depth", "1", "origin", requestedRef]);
      resolvedCommit = git(["--git-dir", bare, "rev-parse", "FETCH_HEAD"]).trim().toLowerCase();
    } catch (error) {
      throw mapGitAcquisitionError(error, descriptor, requestedRef);
    }
  }
  if (!FULL_COMMIT.test(resolvedCommit)) throw sourceDescriptorError("SOURCE_GITHUB_COMMIT_INVALID", "GitHub acquisition did not resolve a full commit.", "retry-github-source-acquisition");

  const cacheKey = digest({ repository, resolvedCommit, acquisitionPolicy: descriptor.acquisitionPolicy });
  const target = snapshotPath(workspace, repoKey, resolvedCommit);
  if (!fs.existsSync(target)) {
    assertUnsupportedGitFeatures(bare, resolvedCommit);
    materializeGitArchive({ bare, resolvedCommit, target });
  } else if (networkAcquisition === "FETCHED") {
    assertUnsupportedGitFeatures(bare, resolvedCommit);
  }
  const licenseDiscovery = discoverLicenses(target);
  const core = {
    schema: SOURCE_RESOLUTION_SCHEMA,
    sourceId: descriptor.sourceId,
    type: descriptor.type,
    sourceDescriptor: descriptor,
    sourceDescriptorDigest: descriptorDigest,
    canonicalRepository: repository,
    requestedRef,
    resolvedCommit,
    acquisitionPolicy: descriptor.acquisitionPolicy,
    cacheKey,
    provenance: { provider: "github.com", transport: descriptor.locator.transport, repository },
    licenseDiscovery,
    sourceExecution: false
  };
  core.sourceResolutionDigest = digest(core);
  fs.writeFileSync(refCache, `${JSON.stringify({ schema: "evopilot-harness-source-ref-resolution/v1", repository, requestedRef, resolvedCommit, cacheKey, resolvedAt: now }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return { ...core, acquiredAt: now, networkAcquisition, path: target, files: null };
}

function assertUnsupportedGitFeatures(bare, commit) {
  if (gitObjectExists(bare, `${commit}:.gitmodules`)) throw sourceDescriptorError("SOURCE_GIT_SUBMODULE_UNSUPPORTED", "Git submodules are unsupported for v4.5 static Source acquisition.", "supply-source-without-submodules");
  const attributes = gitObjectText(bare, `${commit}:.gitattributes`);
  if (/(?:^|\s)filter\s*=\s*lfs(?:\s|$)/im.test(attributes)) throw sourceDescriptorError("SOURCE_GIT_LFS_UNSUPPORTED", "Git LFS objects are unsupported for v4.5 static Source acquisition.", "supply-source-without-git-lfs");
}

function materializeGitArchive({ bare, resolvedCommit, target }) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = fs.mkdtempSync(path.join(path.dirname(target), `.materialize-${resolvedCommit.slice(0, 12)}-`));
  const archive = `${temporary}.tar`;
  try {
    const bytes = git(["--git-dir", bare, "archive", "--format=tar", resolvedCommit], { encoding: null, maxBuffer: MAX_GIT_ARCHIVE_BYTES });
    fs.writeFileSync(archive, bytes, { mode: 0o600 });
    execFileSync("/usr/bin/tar", ["-xf", archive, "-C", temporary], { stdio: ["ignore", "pipe", "pipe"] });
    fs.renameSync(temporary, target);
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw sourceDescriptorError("SOURCE_GITHUB_SNAPSHOT_FAILED", `Unable to materialize the bounded static GitHub Source snapshot: ${safeGitMessage(error)}.`, "retry-github-source-acquisition");
  } finally {
    fs.rmSync(archive, { force: true });
  }
}

function discoverLicenses(root) {
  const files = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile() && /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i.test(entry.name)).map((entry) => entry.name).sort();
  return { status: files.length ? "DISCOVERED" : "NOT_DISCOVERED", files: files.map((file) => ({ name: file, digest: digest(captureSourceFile(path.join(root, file), { root }).bytes) })) };
}

function normalizeGitHubRepository(value) {
  const input = String(value ?? "").trim();
  if (!input) throw sourceDescriptorError("SOURCE_GITHUB_LOCATOR_REQUIRED", "GITHUB_REPOSITORY requires owner/repository, HTTPS, or SSH syntax.", "supply-github-repository");
  let repository;
  let transport = "HTTPS";
  const shorthand = input.match(GITHUB_REPOSITORY);
  if (shorthand) repository = `${shorthand[1]}/${shorthand[2]}`;
  else {
    const ssh = input.match(/^git@github\.com:([^/\s]+)\/(.+?)(?:\.git)?$/i);
    if (ssh) { repository = `${ssh[1]}/${ssh[2].replace(/\.git$/i, "")}`; transport = "SSH"; }
    else {
      let url;
      try { url = new URL(input); } catch { throw sourceDescriptorError("SOURCE_GITHUB_LOCATOR_INVALID", "GitHub locator must use owner/repository, https://github.com/owner/repository, or git@github.com:owner/repository.git.", "repair-github-repository"); }
      if (url.username || url.password) throw sourceDescriptorError("SOURCE_EMBEDDED_CREDENTIALS_REJECTED", "Do not embed credentials in a GitHub Source locator; use operator-managed ambient Git authentication.", "remove-embedded-credentials");
      if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") throw sourceDescriptorError("SOURCE_GITHUB_LOCATOR_INVALID", "Only github.com HTTPS or SSH repository locators are accepted.", "repair-github-repository");
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length !== 2) throw sourceDescriptorError("SOURCE_GITHUB_LOCATOR_INVALID", "GitHub locator must identify exactly owner/repository.", "repair-github-repository");
      repository = `${parts[0]}/${parts[1].replace(/\.git$/i, "")}`;
    }
  }
  if (!GITHUB_REPOSITORY.test(repository)) throw sourceDescriptorError("SOURCE_GITHUB_LOCATOR_INVALID", "GitHub repository identity is invalid.", "repair-github-repository");
  return { repository, transport };
}

function acquisitionPolicy(type) {
  const github = type === "GITHUB_REPOSITORY";
  return { id: SOURCE_RESOLVER_POLICY, mode: github ? "BOUNDED_READ_ONLY_GIT" : "LOCAL_READ_ONLY", networkAllowed: github, submodulesAllowed: false, gitLfsAllowed: false };
}

function inferLocalType(value) {
  const target = canonicalLocalPath(value);
  if (!fs.existsSync(target)) return "LOCAL_FILE";
  if (fs.statSync(target).isDirectory()) return fs.existsSync(path.join(target, ".git")) ? "LOCAL_GIT_REPOSITORY" : "LOCAL_DIRECTORY";
  return "LOCAL_FILE";
}

function canonicalLocalPath(value) { return assertSourcePath(String(value), { mustExist: false }); }
function normalizeSafeLabel(value) { const text = String(value ?? "").trim(); return text ? text.slice(0, 160) : null; }
function normalizeSourceId(value, input, type) { const supplied = String(value ?? "").trim().toLowerCase(); const generated = `source-${digest({ type, locator: input.locator ?? input.path ?? input.repository ?? input.url ?? input.members }).slice(7, 23)}`; return validateSourceId(supplied || generated); }
function generatedSourceId(binding) { return validateSourceId(`source-${digest(binding).slice(7, 23)}`); }
function normalizeMemberId(value, memberPath, index) { return validateSourceId(String(value ?? "").trim().toLowerCase() || `member-${index + 1}-${digest(memberPath).slice(7, 15)}`); }
function validateSourceId(value) { const normalized = safeId(value); if (!/^[a-z0-9][a-z0-9._-]{2,95}$/.test(normalized)) throw sourceDescriptorError("SOURCE_ID_INVALID", "Source id must contain 3-96 lowercase safe-id characters.", "repair-source-id"); return normalized; }
function normalizeRequestedRef(value) { const text = String(value ?? "").trim(); if (!text) return null; if (text.length > 256 || /[\0\r\n]/.test(text) || text.startsWith("-")) throw sourceDescriptorError("SOURCE_GITHUB_REF_INVALID", "GitHub requested ref is invalid.", "repair-github-ref"); return text; }
function snapshotPath(workspace, repoKey, commit) { return resolveWorkspacePath(workspace, "source-cache", "github", "snapshots", repoKey, commit); }

function setRemote(bare, remote) {
  try { git(["--git-dir", bare, "remote", "set-url", "origin", remote]); }
  catch { git(["--git-dir", bare, "remote", "add", "origin", remote]); }
}
function gitObjectExists(bare, object) { try { git(["--git-dir", bare, "cat-file", "-e", object]); return true; } catch { return false; } }
function gitObjectText(bare, object) { try { return git(["--git-dir", bare, "show", object]); } catch { return ""; } }
function git(args, overrides = {}) { return execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "credential.helper=", "-c", "http.extraHeader=", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000, killSignal: "SIGTERM", env: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1", GIT_OPTIONAL_LOCKS: "0" }, ...overrides }); }

function mapGitAcquisitionError(error, descriptor, requestedRef) {
  const message = safeGitMessage(error);
  if (/ETIMEDOUT|could not resolve host|failed to connect|network is unreachable|connection timed out|operation timed out|timed out/i.test(message)) return sourceDescriptorError("SOURCE_GITHUB_NETWORK_UNAVAILABLE", "GitHub network acquisition is unavailable.", "repair-network-and-retry");
  if (descriptor.privateRepository === true || /authentication failed|could not read username|permission denied|publickey/i.test(message)) return sourceDescriptorError("SOURCE_GITHUB_AMBIENT_AUTH_REQUIRED", "Private GitHub Source requires operator-managed ambient Git authentication; Harness does not collect credentials.", "prepare-ambient-git-authentication");
  if (/couldn't find remote ref|not our ref|invalid refspec|ambiguous argument/i.test(message)) return sourceDescriptorError("SOURCE_GITHUB_REF_NOT_FOUND", `GitHub requested ref is unavailable: ${requestedRef}.`, "repair-github-ref");
  if (/repository not found|does not appear to be a git repository/i.test(message)) return sourceDescriptorError("SOURCE_GITHUB_REPOSITORY_NOT_FOUND", "GitHub repository is unavailable or not found.", "repair-github-repository");
  return sourceDescriptorError("SOURCE_GITHUB_ACQUISITION_FAILED", `Bounded GitHub Source acquisition failed: ${message}.`, "inspect-git-readiness-and-retry");
}

function safeGitMessage(error) {
  const raw = String(error?.stderr ?? error?.message ?? error ?? "unknown Git error");
  return raw.replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, "https://[REDACTED]@").replace(/[\r\n]+/g, " ").slice(0, 500);
}

function sourceDescriptorError(code, message, nextAction) {
  const error = new Error(message);
  error.name = "SourceDescriptorError";
  error.code = code;
  error.nextAction = nextAction;
  return error;
}
