import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { digest } from "../../v3/utils.mjs";

export const SOURCE_CONTENT_POLICY = "evopilot-harness-source-content-boundary/v1";
const PROTECTED_DIRECTORIES = [".codex", ".codebuddy", ".workbuddy", ".claude", ".opencode", ".cursor", ".ssh", ".aws", ".azure", ".kube", ".gnupg", ".config", ".cache"];
const PROTECTED_SEQUENCES = [[".local", "share"], ["library", "keychains"], ["library", "application support"]];
const PROTECTED_FILES = [".netrc", ".npmrc", ".pypirc", ".git-credentials", "auth.json", "credentials.json", "credentials.yaml", "credentials.yml", "models.json", "models.yaml", "models.yml", "model-config.json", "model-config.yaml", "model-config.yml", "mcp.json", "mcp.config.json", "mcp.config.yaml", "mcp.config.yml"];
const ENV_EXAMPLES = [".env.example", ".env.sample", ".env.template"];
const KEY_EXTENSIONS = [".pem", ".key", ".p12", ".pfx", ".keystore"];
const ORDINARY_EXCLUSIONS = new Set([".git", "node_modules", "dist", "target", "build", ".gradle", ".idea"]);
export const MAX_SOURCE_FILE_BYTES = 256 * 1024 * 1024;
export const SOURCE_CONTENT_POLICY_DIGEST = digest({ id: SOURCE_CONTENT_POLICY, protectedDirectories: PROTECTED_DIRECTORIES, protectedSequences: PROTECTED_SEQUENCES, protectedFiles: PROTECTED_FILES, environmentExamples: ENV_EXAMPLES, keyExtensions: KEY_EXTENSIONS, maxFileBytes: MAX_SOURCE_FILE_BYTES, publicContainers: ["user-home/.codex/worktrees/<id>/<repository>", "user-home/.codex/evidence/<declared-source>"], containerRule: "declared inputs only; every descendant protected segment remains excluded", symlinks: "REJECT_EXPLICIT_SKIP_TRAVERSAL", hardlinks: "REJECT" });
const captures = new WeakSet();

export function sourcePathError(code = "SOURCE_PROTECTED_PATH") {
  const error = new Error(code === "SOURCE_PROTECTED_PATH" ? "Protected Host, model configuration, credential or linked state cannot be used as Source evidence." : code === "SOURCE_FILE_LIMIT" ? "Source file exceeds the bounded static read limit." : "Source identity changed during static acquisition; no partial evidence was accepted.");
  error.name = "SourcePathError";
  error.code = code;
  error.nextAction = "supply-public-static-source";
  return error;
}

function protectedParts(parts) {
  const lower = parts.map((part) => part.toLowerCase());
  for (let index = 0; index < lower.length; index += 1) {
    const part = lower[index];
    if (PROTECTED_DIRECTORIES.includes(part)) return true;
    if (PROTECTED_SEQUENCES.some((sequence) => sequence.every((item, offset) => lower[index + offset] === item))) return true;
  }
  const basename = lower.at(-1) ?? "";
  return PROTECTED_FILES.includes(basename) || (basename === ".env" || basename.startsWith(".env.")) && !ENV_EXAMPLES.includes(basename) || KEY_EXTENSIONS.includes(path.extname(basename));
}

export function isProtectedSourceRelativePath(relative) {
  return path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`) || protectedParts(relative.split(path.sep));
}

export function isProtectedSourcePath(file, { root } = {}) {
  const absolute = path.resolve(String(file));
  return absoluteProtected(absolute) || Boolean(root && isProtectedSourceRelativePath(path.relative(path.resolve(root), absolute)));
}

// Only these actual user-home containers can be unrelated environmental
// ancestors of explicitly selected public material. Traversal of a parent
// still excludes .codex, and no protected descendant receives an exception.
function absoluteProtected(file) {
  for (const [container, minimumDepth] of [["worktrees", 2], ["evidence", 1]]) {
    const relative = path.relative(path.join(os.homedir(), ".codex", container), file);
    const pieces = relative.split(path.sep).filter(Boolean);
    if (inside(path.join(os.homedir(), ".codex", container), file) && pieces.length >= minimumDepth) return protectedParts(pieces);
  }
  return protectedParts(file.split(path.sep));
}

function assertNoSourceAliases(file) {
  const parsed = path.parse(file);
  let current = parsed.root;
  for (const segment of file.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) { if (error?.code === "ENOENT") return; throw error; }
    if (!stat.isSymbolicLink()) continue;
    // macOS supplies these fixed filesystem aliases; an arbitrary Source
    // ancestor alias has no equivalent exception.
    const systemAlias = new Map([["/tmp", "/private/tmp"], ["/var", "/private/var"], ["/etc", "/private/etc"]]);
    if (current === file || systemAlias.get(current) !== fs.realpathSync(current)) throw sourcePathError();
  }
}

function inside(root, file) { const relative = path.relative(root, file); return relative === "" || relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); }

/** Metadata only: this function never opens Source contents. */
export function assertSourcePath(file, { root, mustExist = true } = {}) {
  const absolute = path.resolve(String(file));
  if (isProtectedSourcePath(absolute, { root })) throw sourcePathError();
  assertNoSourceAliases(absolute);
  if (!fs.existsSync(absolute)) {
    // existsSync follows links, so a dangling selected link is still rejected.
    try { if (fs.lstatSync(absolute).isSymbolicLink()) throw sourcePathError(); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    if (!mustExist) return absolute;
    const error = new Error("Source does not exist."); error.code = "SOURCE_NOT_FOUND"; error.nextAction = "repair-source-locator"; throw error;
  }
  if (fs.lstatSync(absolute).isSymbolicLink()) throw sourcePathError();
  const canonical = fs.realpathSync(absolute);
  if (absoluteProtected(canonical)) throw sourcePathError();
  if (root && !inside(fs.realpathSync(path.resolve(root)), canonical)) throw sourcePathError();
  return absolute;
}

export function walkSourceFiles(root, predicate = () => true) {
  const absolute = assertSourcePath(root);
  const files = [], excluded = { protectedDirectories: 0, protectedFiles: 0, symlinks: 0 };
  const stack = [absolute];
  while (stack.length) {
    const current = stack.pop();
    assertSourcePath(current, { root: absolute });
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const file = path.join(current, entry.name);
      if (ORDINARY_EXCLUSIONS.has(entry.name)) continue;
      if (entry.isSymbolicLink()) { excluded.symlinks += 1; continue; }
      if (isProtectedSourcePath(file, { root: absolute })) { excluded[entry.isDirectory() ? "protectedDirectories" : "protectedFiles"] += 1; continue; }
      if (entry.isDirectory()) stack.push(file);
      else if (entry.isFile() && predicate(file)) files.push(file);
    }
  }
  return { files: files.sort(), boundary: { policy: SOURCE_CONTENT_POLICY, policyDigest: SOURCE_CONTENT_POLICY_DIGEST, excluded } };
}

export function sourceContentBoundary() { return { policy: SOURCE_CONTENT_POLICY, policyDigest: SOURCE_CONTENT_POLICY_DIGEST, excluded: { protectedDirectories: 0, protectedFiles: 0, symlinks: 0 } }; }

/** Open once, validate identity before any content read, and never follow a
 * selected symlink. Hashing and extractors consume these same captured bytes. */
export function captureSourceFile(file, { root } = {}) {
  const absolute = assertSourcePath(file, { root });
  const before = fs.lstatSync(absolute);
  if (!before.isFile() || before.nlink !== 1) throw sourcePathError();
  if (before.size > MAX_SOURCE_FILE_BYTES) throw sourcePathError("SOURCE_FILE_LIMIT");
  let fd;
  try {
    fd = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs || opened.ctimeMs !== before.ctimeMs) throw sourcePathError("SOURCE_PATH_CHANGED");
    assertSourcePath(absolute, { root });
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, Math.min(64 * 1024, bytes.length - offset), offset);
      if (!count) throw sourcePathError("SOURCE_PATH_CHANGED");
      offset += count;
    }
    const after = fs.fstatSync(fd);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw sourcePathError("SOURCE_PATH_CHANGED");
    const captured = Object.freeze({ file: absolute, bytes, size: opened.size });
    captures.add(captured);
    return captured;
  } catch (error) {
    if (["ELOOP", "ENOTDIR"].includes(error?.code)) throw sourcePathError();
    throw error;
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

export function requireSourceCapture(file, captured) {
  if (!captures.has(captured) || captured.file !== path.resolve(file)) throw sourcePathError("SOURCE_PATH_CHANGED");
  return captured;
}

export function assertCurrentSourcePolicy(result) {
  const hypothesis = result?.sourceConceptHypothesis ?? result?.hypothesis ?? result;
  const boundary = hypothesis?.provenance?.sourceContentBoundary;
  if (boundary?.policy !== SOURCE_CONTENT_POLICY || boundary?.policyDigest !== SOURCE_CONTENT_POLICY_DIGEST) {
    const error = new Error("The stored Source analysis predates the current content boundary; re-analysis is required before continuation.");
    error.name = "SourcePolicyError"; error.code = "SOURCE_POLICY_REANALYSIS_REQUIRED"; error.nextAction = "reanalyze-source-with-current-content-policy"; throw error;
  }
}
