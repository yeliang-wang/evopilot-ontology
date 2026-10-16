import fs from "node:fs";
import path from "node:path";
import { digest, redact } from "../../v3/utils.mjs";
import { extractStaticSourceText } from "../source/static-text.mjs";
import { assertSourcePath, captureSourceFile, sourceContentBoundary, walkSourceFiles } from "../source/path-policy.mjs";
import { canonicalCompare, normalizeTerm } from "./taxonomy.mjs";

export const SOURCE_CONCEPT_HYPOTHESIS_SCHEMA = "evopilot-harness-source-concept-hypothesis/v1";
const MAX_FILES = 512;
const MAX_CONCEPTS = 1024;
const MAX_FILE_BYTES = 128_000;
const MAX_TOTAL_CHARACTERS = 1_000_000;
const MAX_CHARACTERS_PER_FILE = Math.floor(MAX_TOTAL_CHARACTERS / MAX_FILES);
const MAX_OVERVIEW_ANALYSIS_CHARACTERS = 64_000;
const SOURCE_STOPWORDS = new Set([
  "and", "are", "but", "for", "from", "has", "have", "into", "not", "of", "on", "or", "the", "this", "that", "their", "then", "there", "these", "they", "to", "was", "were", "will", "with", "you", "your",
  "an", "as", "at", "be", "by", "can", "do", "if", "in", "is", "it", "its", "may", "our", "we",
  "com", "org", "http", "https", "www", "github", "readme", "md", "txt", "json", "yaml", "yml", "xml", "toml", "src", "main",
  "file", "files", "name", "version", "true", "false", "null", "undefined",
  "class", "final", "get", "import", "java", "js", "new", "package", "project", "public", "return", "string", "type", "util", "utils"
]);

export function buildSourceConceptHypothesis(sourceInput) {
  const resolved = normalizeResolvedSource(sourceInput);
  const root = resolved.path;
  const singleFile = resolved.files ? false : fs.statSync(root).isFile();
  const selection = !resolved.files && !singleFile ? walkSourceFiles(root, readableSourceFile) : { files: [], boundary: sourceContentBoundary() };
  const files = resolved.files ? resolved.files.slice(0, MAX_FILES).map((item) => item.path) : singleFile ? [root] : stratifiedSourceFiles(selection.files, root, MAX_FILES);
  const characterBudgetPerFile = Math.max(MAX_CHARACTERS_PER_FILE, Math.floor(MAX_TOTAL_CHARACTERS / Math.max(1, files.length)));
  const orderedByPath = new Map((resolved.files ?? []).map((item) => [item.path, item]));
  const citations = [];
  const contradictions = [];
  const structuredSignals = [];
  const dependencySignals = [];
  const sourceFiles = [];
  const termWeights = new Map();
  let characters = 0;
  for (const file of files) {
    const captured = captureSourceFile(file, { root: !resolved.files && !singleFile ? root : undefined });
    const stat = { size: captured.size };
    const ordered = orderedByPath.get(file);
    const relative = ordered ? `${String(ordered.memberIndex + 1).padStart(3, "0")}-${ordered.sourceId}/${path.basename(file)}` : singleFile ? path.basename(file) : path.relative(root, file);
    const governanceOnly = /(?:^|\/)(?:CONTRIBUTING|CODE_OF_CONDUCT|SECURITY|SUPPORT|LICENSE)(?:\.[^/]*)?$/i.test(relative);
    const lowTrust = governanceOnly || /(?:^|\/)(?:\.github|\.svn|\.settings|vendor|vendors|third[-_]?party|opensource|fixture|fixtures|test|tests|example|examples|sample|samples|generated|gen)(?:\/|$)/i.test(relative);
    const structuredFamily = lowTrust ? "low-trust-structured" : "structured";
    const contentFamily = lowTrust ? "low-trust-content" : "lexical-content";
    const extension = path.extname(file).toLowerCase() || "[none]";
    const fileDigest = digest(captured.bytes);
    const boundedContainer = isBoundedContainerDocument(file);
    const contentReadable = readableSourceFile(file) && (stat.size <= MAX_FILE_BYTES || boundedContainer);
    sourceFiles.push({ sourceRef: relative, sourceDigest: fileDigest, bytes: stat.size, readable: contentReadable, ...(ordered ? { memberIndex: ordered.memberIndex, memberSourceId: ordered.sourceId } : {}) });
    const structuredEvidenceId = evidenceId(structuredFamily, relative, fileDigest);
    structuredSignals.push({ family: structuredFamily, trust: lowTrust ? "LOW" : "NORMAL", kind: "file", path: relative, extension, evidenceId: structuredEvidenceId });
    addTerms(termWeights, tokenize(relative), lowTrust ? 0.1 : 2, structuredFamily, structuredEvidenceId);
    const semanticOverview = isSemanticOverviewFile(file);
    if (!contentReadable) {
      if (semanticOverview && isPlainTextOverview(file)) {
        const rawOverview = captured.bytes.subarray(0, MAX_FILE_BYTES).toString("utf8").slice(0, MAX_OVERVIEW_ANALYSIS_CHARACTERS);
        const analysisText = redact(rawOverview);
        addSemanticOverviewEvidence({ citations, contradictions, termWeights, text: analysisText, relative, fileDigest, lowTrust, redactionApplied: analysisText !== rawOverview });
      }
      continue;
    }
    const remaining = Math.max(0, MAX_TOTAL_CHARACTERS - characters);
    if (remaining === 0) continue;
    const extracted = extractStaticSourceText(file, { captured });
    const redacted = redact(extracted);
    const text = redacted.slice(0, Math.min(characterBudgetPerFile, remaining));
    characters += text.length;
    const citation = { evidenceId: evidenceId("content", relative, fileDigest), family: contentFamily, trust: lowTrust ? "LOW" : "NORMAL", sourceRef: relative, sourceDigest: fileDigest, excerpt: boundedRepresentativeExcerpt(text, 800), redactionApplied: redacted !== extracted };
    citations.push(citation);
    addTerms(termWeights, tokenize(text), lowTrust ? 0.1 : 1, contentFamily, citation.evidenceId);
    if (semanticOverview) {
      const analysisText = redacted.slice(0, Math.min(MAX_OVERVIEW_ANALYSIS_CHARACTERS, redacted.length));
      addSemanticOverviewEvidence({ citations, contradictions, termWeights, text: analysisText, relative, fileDigest, lowTrust, redactionApplied: redacted !== extracted });
    }
    if (extension === ".json") addStructuredResponsibilityEvidence({ structuredSignals, citations, contradictions, termWeights, text, relative, fileDigest, lowTrust, redactionApplied: redacted !== extracted });
    for (const dependency of extractDependencies(file, text)) {
      const signal = { family: lowTrust ? "low-trust-dependency" : "dependency", trust: lowTrust ? "LOW" : "NORMAL", dependency, sourceRef: relative, evidenceId: evidenceId("dependency", `${relative}:${dependency}`, fileDigest) };
      dependencySignals.push(signal);
      addTerms(termWeights, tokenize(dependency), lowTrust ? 0.1 : 3, signal.family, signal.evidenceId);
    }
  }
  const concepts = [...termWeights.entries()].map(([term, value]) => ({ term, weight: round(value.weight), evidenceFamilies: [...value.families].sort(canonicalCompare), evidenceIds: [...value.evidenceIds].sort(canonicalCompare) })).sort((a, b) => b.weight - a.weight || canonicalCompare(a.term, b.term)).slice(0, MAX_CONCEPTS);
  const snapshotRedactions = citations.filter((item) => ["lexical-content", "low-trust-content"].includes(item.family) && item.redactionApplied);
  const sourceSnapshot = {
    schema: "evopilot-harness-static-source-snapshot/v1",
    sourceBinding: staticSourceBinding(resolved),
    files: resolved.files ? sourceFiles : sourceFiles.sort((left, right) => canonicalCompare(left.sourceRef, right.sourceRef)),
    fileCount: sourceFiles.length,
    characterCount: characters,
    bounded: sourceFiles.length >= MAX_FILES || characters >= MAX_TOTAL_CHARACTERS,
    redactionResult: { policy: "evopilot-harness-source-redaction/v1", applied: snapshotRedactions.length > 0, redactedFileCount: snapshotRedactions.length },
    sourceExecution: false,
    networkAcquisition: resolved.type === "GITHUB_REPOSITORY"
  };
  sourceSnapshot.sourceSnapshotDigest = digest(sourceSnapshot);
  const evidenceGraph = {
    schema: "evopilot-harness-classification-evidence-graph/v1",
    sourceSnapshotDigest: sourceSnapshot.sourceSnapshotDigest,
    evidence: [...citations, ...structuredSignals, ...dependencySignals].map((item) => ({ evidenceId: item.evidenceId, family: item.family, sourceRef: item.sourceRef ?? item.path, sourceDigest: item.sourceDigest ?? sourceFiles.find((file) => file.sourceRef === (item.sourceRef ?? item.path))?.sourceDigest ?? null })).sort((left, right) => canonicalCompare(left.evidenceId, right.evidenceId))
  };
  evidenceGraph.evidenceGraphDigest = digest(evidenceGraph);
  const core = {
    schema: SOURCE_CONCEPT_HYPOTHESIS_SCHEMA,
    sourceDescriptorDigest: resolved.sourceDescriptorDigest,
    sourceResolutionDigest: resolved.sourceResolutionDigest,
    sourceSnapshot,
    sourceSnapshotDigest: sourceSnapshot.sourceSnapshotDigest,
    evidenceGraph,
    evidenceGraphDigest: evidenceGraph.evidenceGraphDigest,
    concepts,
    structuredSignals,
    dependencySignals,
    citations,
    contradictions,
    uncertainty: { status: concepts.length < 3 ? "HIGH" : "BOUNDED", reasons: concepts.length < 3 ? ["Too few supported concepts were extracted from the bounded static Source."] : [] },
    missingEvidence: concepts.length < 3 || new Set([...citations, ...dependencySignals, ...structuredSignals].map((item) => item.family)).size < 2 ? ["Provide more static Source files, dependency manifests, or design documentation."] : [],
    provenance: { sourceContentBoundary: selection.boundary, algorithm: "taxonomy-blind-source-concepts/v2", sampling: resolved.files ? "exact-ordered-members/v1" : "top-level-round-robin-diversified/v1", termFrequency: "one-vote-per-file-family/v1", semanticProjection: "overview-and-declared-responsibilities/v2", taxonomyExposed: false, advisorUsed: false, sourceExecution: false, networkAccess: resolved.type === "GITHUB_REPOSITORY", limits: { maxFiles: MAX_FILES, maxConcepts: MAX_CONCEPTS, maxFileBytes: MAX_FILE_BYTES, maxCharactersPerFile: MAX_CHARACTERS_PER_FILE, maxOverviewAnalysisCharacters: MAX_OVERVIEW_ANALYSIS_CHARACTERS, maxTotalCharacters: MAX_TOTAL_CHARACTERS } }
  };
  core.hypothesisDigest = digest(core);
  return core;
}

function normalizeResolvedSource(sourceInput) {
  if (typeof sourceInput === "string") {
    const root = assertSourcePath(sourceInput);
    if (!fs.existsSync(root)) throw sourceError("SOURCE_NOT_FOUND", `Source does not exist: ${root}`);
    return { path: root, files: null, type: fs.statSync(root).isFile() ? "LOCAL_FILE" : "LOCAL_DIRECTORY", sourceDescriptorDigest: digest({ legacyPath: root }), sourceResolutionDigest: digest({ legacyPath: root }) };
  }
  const root = sourceInput?.path ? path.resolve(sourceInput.path) : null;
  const files = Array.isArray(sourceInput?.files) ? sourceInput.files.map((item) => ({ ...item, path: path.resolve(item.path) })) : null;
  if (!root && !files?.length) throw sourceError("SOURCE_NOT_FOUND", "Resolved Source has no readable path or ordered members.");
  for (const target of files?.map((item) => item.path) ?? [root]) assertSourcePath(target);
  return { ...sourceInput, path: root, files };
}

function staticSourceBinding(resolved) {
  if (resolved.type === "GITHUB_REPOSITORY") return { type: resolved.type, sourceId: resolved.sourceId, canonicalRepository: resolved.canonicalRepository, requestedRef: resolved.requestedRef, resolvedCommit: resolved.resolvedCommit, acquisitionPolicy: resolved.acquisitionPolicy, cacheKey: resolved.cacheKey };
  if (resolved.type === "LOCAL_GIT_REPOSITORY") return { type: resolved.type, sourceId: resolved.sourceId, resolvedCommit: resolved.resolvedCommit };
  if (resolved.type === "ORDERED_ATTACHMENT_SET") return { type: resolved.type, sourceId: resolved.sourceId, members: resolved.files.map((item) => ({ sourceId: item.sourceId, memberIndex: item.memberIndex, safeLabel: item.safeLabel })) };
  return { type: resolved.type, sourceId: resolved.sourceId };
}

function readableSourceFile(file) {
  return /(?:^|\/)(?:README|CHANGELOG|Dockerfile|pom\.xml|package\.json|go\.mod|requirements[^/]*\.txt)$|\.(?:md|txt|json|ya?ml|toml|xml|java|kt|go|py|js|mjs|cjs|ts|tsx|rs|cs|sql|proto|docx|pptx|pdf)$/i.test(file);
}

function tokenize(text) {
  const separated = String(text).replace(/([\p{Ll}\d])([\p{Lu}])/gu, "$1 $2");
  return normalizeTerm(separated).split(/\s+/).flatMap(semanticTermVariants).filter((term) => term.length >= 2 && term.length <= 64).slice(0, 50_000);
}

function semanticTermVariants(term) {
  const result = [term];
  for (const match of term.matchAll(/\p{Script=Han}+/gu)) {
    const characters = [...match[0]];
    for (let size = 2; size <= Math.min(4, characters.length); size += 1) {
      for (let index = 0; index <= characters.length - size; index += 1) result.push(characters.slice(index, index + size).join(""));
    }
  }
  if (!SOURCE_STOPWORDS.has(term) && /^[a-z][a-z0-9]*[^s]s$/.test(term) && term.length > 3) result.push(term.slice(0, -1));
  return result;
}

function stratifiedSourceFiles(files, root, limit) {
  const buckets = new Map();
  for (const file of files) {
    const relative = path.relative(root, file);
    const bucket = relative.split(path.sep)[0] || "[root]";
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push(file);
  }
  const queues = [...buckets.entries()].sort(([left], [right]) => canonicalCompare(left, right)).map(([, values]) => diversifiedFileOrder(values));
  const selected = [];
  for (let index = 0; selected.length < limit && queues.some((queue) => index < queue.length); index += 1) {
    for (const queue of queues) {
      if (index < queue.length) selected.push(queue[index]);
      if (selected.length === limit) break;
    }
  }
  return selected;
}

function diversifiedFileOrder(files) {
  const sorted = [...files].sort(canonicalCompare);
  const priority = sorted.filter(isSourceOverviewFile);
  const ordinary = sorted.filter((file) => !isSourceOverviewFile(file));
  if (ordinary.length < 2) return [...priority, ...ordinary];
  const spread = [];
  const used = new Set();
  for (let denominator = 1; spread.length < ordinary.length; denominator *= 2) {
    for (let numerator = 1; numerator < denominator * 2; numerator += 2) {
      const index = Math.min(ordinary.length - 1, Math.floor(numerator * ordinary.length / (denominator * 2)));
      if (!used.has(index)) { used.add(index); spread.push(ordinary[index]); }
    }
    if (denominator > ordinary.length * 2) break;
  }
  for (let index = 0; index < ordinary.length; index += 1) if (!used.has(index)) spread.push(ordinary[index]);
  return [...priority, ...spread];
}

function isSourceOverviewFile(file) {
  return /(?:^|\/)(?:README(?:\.[^/]*)?|pom\.xml|package\.json|go\.mod|requirements[^/]*\.txt)$/i.test(file);
}

function isSemanticOverviewFile(file) {
  return /(?:^|\/)README(?:\.[^/]*)?$/i.test(file);
}

function isPlainTextOverview(file) {
  return /(?:^|\/)(?:README(?:\.(?:md|txt|rst|adoc))?|pom\.xml|package\.json|go\.mod|requirements[^/]*\.txt)$/i.test(file);
}

function isBoundedContainerDocument(file) {
  return /\.(?:docx|pptx|pdf)$/i.test(file);
}

function boundedRepresentativeExcerpt(text, maximumCharacters) {
  const value = String(text ?? "");
  if (value.length <= maximumCharacters) return value;
  const separator = "\n…\n";
  const segmentLength = Math.max(1, Math.floor((maximumCharacters - separator.length * 2) / 3));
  const middleStart = Math.max(0, Math.floor((value.length - segmentLength) / 2));
  return [value.slice(0, segmentLength), value.slice(middleStart, middleStart + segmentLength), value.slice(-segmentLength)].join(separator).slice(0, maximumCharacters);
}

function addSemanticOverviewEvidence({ citations, contradictions, termWeights, text, relative, fileDigest, lowTrust, redactionApplied }) {
  if (!text.trim()) return;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const historical = lines.filter(isNonCurrentStatement);
  for (const [index, excerpt] of historical.entries()) addNonCurrentEvidence({ citations, contradictions, relative, fileDigest, lowTrust, redactionApplied, excerpt, locator: `historical-line-${index}` });
  const meaningful = lines.filter((line) => !isOverviewBoilerplate(line) && !isNonCurrentStatement(line));
  const facets = [
    { family: "content-purpose", weight: 4, lines: meaningful.filter((line) => !isInventoryLine(line)).slice(0, 12) },
    { family: "content-inventory", weight: 3, lines: stratifiedOverviewLines(meaningful.filter(isInventoryLine), 12, 780) }
  ];
  for (const facet of facets) {
    const excerpt = redact(facet.lines.join("\n")).slice(0, 800);
    if (tokenize(excerpt).length < 3) continue;
    const family = lowTrust ? `low-trust-${facet.family}` : facet.family;
    const evidence = { evidenceId: evidenceId(family, relative, fileDigest), family, trust: lowTrust ? "LOW" : "NORMAL", sourceRef: relative, sourceDigest: fileDigest, excerpt, redactionApplied };
    citations.push(evidence);
    addTerms(termWeights, tokenize(excerpt), lowTrust ? 0.1 : facet.weight, family, evidence.evidenceId);
  }
}

function addStructuredResponsibilityEvidence({ structuredSignals, citations, contradictions, termWeights, text, relative, fileDigest, lowTrust, redactionApplied }) {
  let document;
  try { document = JSON.parse(text); } catch { return; }
  if (!document || typeof document !== "object" || Array.isArray(document)) return;
  let count = 0;
  for (const [key, values] of Object.entries(document).sort(([a], [b]) => canonicalCompare(a, b))) {
    const normalizedKey = normalizeTerm(key.replace(/([a-z])([A-Z])/g, "$1 $2"));
    const current = /^(?:(?:current|primary) )?(?:responsibilities|capabilities)$/.test(normalizedKey);
    const historical = /^(?:removed|deprecated|historical|previous|legacy) (?:responsibilities|capabilities|experiments)$/.test(normalizedKey);
    if ((!current && !historical) || !Array.isArray(values)) continue;
    for (const [index, value] of values.slice(0, 32).entries()) {
      if (count >= 32) return;
      if (typeof value !== "string" || value.length > 800) continue;
      const nonCurrent = historical || isNonCurrentStatement(value);
      if (tokenize(value).length < (nonCurrent ? 1 : 3)) continue;
      count += 1;
      const jsonPointer = `/${key.replace(/~/g, "~0").replace(/\//g, "~1")}/${index}`;
      if (nonCurrent) {
        addNonCurrentEvidence({ citations, contradictions, relative, fileDigest, lowTrust, redactionApplied, excerpt: value, locator: jsonPointer, jsonPointer });
        continue;
      }
      const family = lowTrust ? "low-trust-structured" : "structured";
      const signal = { family, trust: lowTrust ? "LOW" : "NORMAL", kind: "declared-responsibility", path: relative, sourceRef: relative, sourceDigest: fileDigest, jsonPointer, excerpt: value, redactionApplied, evidenceId: evidenceId(family, `${relative}#${jsonPointer}`, fileDigest) };
      structuredSignals.push(signal);
      // The lexical projection already carries these words. This signal adds
      // provenance, not another term-frequency vote for each array element.
      addTerms(termWeights, tokenize(value), 0, family, signal.evidenceId);
    }
  }
}

function isNonCurrentStatement(value) {
  const statement = String(value).replace(/^\s*#{1,6}\s+/, "");
  return /^\s*(?:previously\b|formerly\b|(?:historical|legacy|migration)\s+(?:notes?|experiments?|responsibilities|capabilities)\b|(?:removed|deprecated)\s+(?:experiments?|features?|responsibilities|capabilities)\b|for example\b|no longer\b|not\s+(?!only\b))/i.test(statement)
    || /\b(?:do(?:es)? not|did not|no longer)\s+(?:provide|support|perform|include|offer|describe)\b/i.test(statement);
}

function addNonCurrentEvidence({ citations, contradictions, relative, fileDigest, lowTrust, redactionApplied, excerpt, locator, jsonPointer }) {
  const item = { evidenceId: evidenceId("historical-content", `${relative}#${locator}`, fileDigest), family: "historical-content", trust: lowTrust ? "LOW" : "NORMAL", sourceRef: relative, sourceDigest: fileDigest, excerpt: excerpt.slice(0, 800), redactionApplied, ...(jsonPointer ? { jsonPointer } : {}) };
  citations.push(item);
  contradictions.push({ ...item, kind: "NON_CURRENT_SOURCE_CONTEXT", reason: "The Source explicitly marks this material as historical, removed, example, or negated; it is not a current responsibility." });
}

function isOverviewBoilerplate(line) {
  return /^\s*(?:<[^>]+>|!\[[^\]]*\]\([^)]*\)|\[!\[[^\]]*\]|[-_*]{3,}|table of contents\b|contents\b)/i.test(line);
}

function isInventoryLine(line) {
  return /^(?:#{2,6}\s+|[-*+]\s+|\d+[.)]\s+|<summary\b)/i.test(line);
}

function stratifiedOverviewLines(lines, maximumLines, maximumCharacters) {
  const contentsIndex = lines.findIndex((line) => /(?:table of )?contents\b/i.test(line));
  const candidates = contentsIndex >= 0 ? lines.slice(contentsIndex, contentsIndex + Math.max(maximumLines, 36)) : lines;
  if (contentsIndex >= 0) return candidates.slice(0, maximumLines).map((line) => line.slice(0, Math.max(1, Math.floor(maximumCharacters / maximumLines) - 1)));
  if (candidates.length <= maximumLines) return candidates.map((line) => line.slice(0, Math.max(1, Math.floor(maximumCharacters / Math.max(1, candidates.length)) - 1)));
  const selected = [];
  const charactersPerLine = Math.max(16, Math.floor(maximumCharacters / maximumLines) - 1);
  for (let index = 0; index < maximumLines; index += 1) {
    const sourceIndex = Math.round(index * (candidates.length - 1) / (maximumLines - 1));
    selected.push(candidates[sourceIndex].slice(0, charactersPerLine));
  }
  return selected;
}

function extractDependencies(file, text) {
  const values = [];
  if (/package\.json$/i.test(file)) {
    try { const parsed = JSON.parse(text); values.push(...Object.keys(parsed.dependencies ?? {}), ...Object.keys(parsed.devDependencies ?? {})); } catch { /* content remains lexical evidence */ }
  }
  if (/pom\.xml$/i.test(file)) values.push(...[...text.matchAll(/<artifactId>([^<]+)<\/artifactId>/g)].map((match) => match[1]));
  if (/requirements[^/]*\.txt$/i.test(file)) values.push(...text.split(/\r?\n/).map((line) => line.split(/[<>=~!]/)[0].trim()).filter((line) => line && !line.startsWith("#")));
  if (/go\.mod$/i.test(file)) values.push(...[...text.matchAll(/(?:require\s+|^\s*)([\w./-]+)\s+v\d/gm)].map((match) => match[1]));
  return [...new Set(values.map(normalizeTerm).filter(Boolean))].sort();
}

function addTerms(map, terms, weight, family, evidenceId) {
  for (const term of new Set(terms)) {
    if (!term || term.length < 2 || term.length > 64 || SOURCE_STOPWORDS.has(term)) continue;
    const current = map.get(term) ?? { weight: 0, families: new Set(), evidenceIds: new Set() };
    current.weight += weight;
    current.families.add(family);
    if (evidenceId) current.evidenceIds.add(evidenceId);
    map.set(term, current);
  }
}

function evidenceId(family, ref, sourceDigest) {
  return `evidence-${digest({ family, ref, sourceDigest }).slice(7, 23)}`;
}

function round(value) { return Math.round(value * 1000) / 1000; }

function sourceError(code, message) {
  const error = new Error(message); error.name = "SourceClassificationError"; error.code = code; error.nextAction = "select-readable-static-source"; return error;
}
