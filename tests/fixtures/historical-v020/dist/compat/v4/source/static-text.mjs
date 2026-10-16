import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { captureSourceFile, requireSourceCapture } from "./path-policy.mjs";

const STATIC_EVIDENCE_EXTRACTORS = new Set(["pdftotext", "unzip"]);
const MAX_EXTRACTOR_BUFFER_BYTES = 16_000_000;

export function extractStaticSourceText(file, { captured, maxBuffer = MAX_EXTRACTOR_BUFFER_BYTES } = {}) {
  // Policy and acquisition failures must not be swallowed as empty evidence.
  const source = captured ? requireSourceCapture(file, captured) : captureSourceFile(file);
  const extension = path.extname(file).toLowerCase();
  if (![".pdf", ".docx", ".pptx"].includes(extension)) return source.bytes.toString("utf8");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-static-extract-"));
  const frozenFile = path.join(temporary, `source${extension}`);
  try {
    fs.writeFileSync(frozenFile, source.bytes, { mode: 0o600, flag: "wx" });
    if (extension === ".pdf") return extract("pdftotext", [frozenFile, "-"], maxBuffer);
    const pattern = extension === ".docx" ? "word/document.xml" : "ppt/slides/*.xml";
    return extract("unzip", ["-p", frozenFile, pattern], maxBuffer).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  } catch { return ""; }
  finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

function extract(command, args, maxBuffer) {
  if (!STATIC_EVIDENCE_EXTRACTORS.has(command)) throw new Error(`Static Source extractor is not allowed: ${command}`);
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15_000, maxBuffer });
}
