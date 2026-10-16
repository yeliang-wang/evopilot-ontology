import fs from "node:fs";
import path from "node:path";
import { PACKAGE_ROOT } from "../v3/constants.mjs";

const RELEASE_ROOT = PACKAGE_ROOT;

export function assertExternalWorkspace(home) {
  const resolved = path.resolve(home);
  const release = path.resolve(RELEASE_ROOT);
  const canonical = canonicalTarget(resolved);
  const canonicalRelease = fs.realpathSync(release);
  if (inside(release, resolved) || inside(canonicalRelease, canonical)) {
    throw new Error(`Ontology Workspace must be outside the evopilot-ontology Release: ${canonical}`);
  }
  return canonical;
}

export function resolveWorkspacePath(home, ...segments) {
  const workspace = assertExternalWorkspace(home);
  const target = path.resolve(workspace, ...segments.map(String));
  if (!inside(workspace, target)) throw workspaceBoundaryError(target);
  const canonical = canonicalTarget(target);
  if (!inside(workspace, canonical)) throw workspaceBoundaryError(canonical);
  return canonical;
}

export function assertWorkspaceTreeConfined(home) {
  const workspace = assertExternalWorkspace(home);
  if (!fs.existsSync(workspace)) return workspace;
  scanWorkspaceLinks(workspace, workspace);
  return workspace;
}

function canonicalTarget(target) {
  let existing = target;
  const suffix = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error(`Ontology Workspace has no existing ancestor: ${target}`);
    suffix.unshift(path.basename(existing));
    existing = parent;
  }
  return path.resolve(fs.realpathSync(existing), ...suffix);
}

function inside(root, target) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function scanWorkspaceLinks(workspace, directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      if (isImmutableGitHubSnapshotPath(workspace, target)) continue;
      let canonical;
      try {
        canonical = fs.realpathSync(target);
      } catch {
        throw workspaceBoundaryError(target);
      }
      if (!inside(workspace, canonical)) throw workspaceBoundaryError(canonical);
    } else if (entry.isDirectory()) {
      scanWorkspaceLinks(workspace, target);
    }
  }
}

function isImmutableGitHubSnapshotPath(workspace, target) {
  const relative = path.relative(workspace, target).split(path.sep).join("/");
  return /^source-cache\/github\/snapshots\/[a-f0-9]{64}\/[a-f0-9]{40}\//.test(relative);
}

function workspaceBoundaryError(target) {
  const error = new Error(`Ontology Workspace path must remain inside the external Workspace: ${target}`);
  error.name = "OntologyWorkspaceBoundaryError";
  error.code = "WORKSPACE_WRITE_BOUNDARY_VIOLATION";
  error.nextAction = "remove-or-replace-workspace-symlink";
  return error;
}
