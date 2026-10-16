import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

export function readYaml(file) {
  return parseYaml(fs.readFileSync(file, "utf8"));
}

export function persistedJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function digest(value) {
  const payload = Buffer.isBuffer(value) ? value : typeof value === "string" ? value : canonicalJson(value);
  return `sha256:${crypto.createHash("sha256").update(payload).digest("hex")}`;
}

export function safeId(value, fallback = "asset") {
  return String(value ?? "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}

export function walkFiles(root, predicate = () => true) {
  if (!fs.existsSync(root)) return [];
  const result = [];
  const stack = [path.resolve(root)];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if ([".git", "node_modules", "dist", "target", "build", ".gradle", ".idea"].includes(entry.name)) continue;
      const resolved = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(resolved);
      else if (entry.isFile() && predicate(resolved)) result.push(resolved);
    }
  }
  return result.sort();
}

export function redact(text) {
  return String(text ?? "")
    .replace(/(https?:\/\/)([^/@\s]+)@/gi, "$1[REDACTED]@")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [REDACTED]")
    .replace(/(authorization|token|password|api[_-]?key|secret)([=:"'\s]+)([^\s"',}]+)/gi, "$1$2[REDACTED]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/\b(?:10|172\.(?:1[6-9]|2\d|3[0-1])|192\.168)\.\d{1,3}\.\d{1,3}(?::\d{2,5})?\b/g, "[REDACTED_ENDPOINT]");
}

export function bumpPatch(version) {
  const match = String(version ?? "0.0.0").match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? `${match[1]}.${match[2]}.${Number(match[3]) + 1}` : "0.1.0";
}

export function usage(message) {
  const error = new Error(message);
  error.name = "UsageError";
  throw error;
}

export function ensureRelative(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Path escapes root: ${target}`);
  return relative;
}

export function unique(values) {
  return [...new Set(values.filter((value) => value != null && String(value).trim()).map((value) => String(value).trim()))];
}
