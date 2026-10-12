import { digest } from "../../v3/utils.mjs";

export const CLASSIFICATION_EVALUATION_SCHEMA = "evopilot-harness-classification-evaluation-report/v1";
export const CLASSIFICATION_EVALUATION_THRESHOLDS = Object.freeze({
  minimumCases: 48,
  minimumKnownMatches: 12,
  minimumSemanticKnownMatches: 6,
  minimumSchemeGaps: 8,
  minimumEvidenceInsufficient: 8,
  minimumAmbiguous: 8,
  minimumMisleadingNegatives: 12,
  minimumMixedAxisCases: 8,
  expectedOutcomeRate: 1,
  hierarchyCorrectnessRate: 1,
  replayRate: 1,
  maximumFalseBroadOrSyntheticMatches: 0
});

export function createClassificationEvaluationReport({ goldManifest, observations, scorerVersion = "classification-gold-scorer/v1" }) {
  validateGoldManifest(goldManifest);
  const byId = new Map(observations.map((item) => [item.caseId, item]));
  if (byId.size !== observations.length) throw evaluationError("CLASSIFICATION_EVALUATION_DUPLICATE_OBSERVATION", "Classification observations must have unique caseId values.");
  const cases = goldManifest.cases.map((gold) => scoreCase(gold, byId.get(gold.id)));
  const composition = compositionOf(goldManifest.cases);
  const correct = cases.filter((item) => item.expectedOutcome).length;
  const hierarchyCorrect = cases.filter((item) => item.hierarchyCorrect).length;
  const replayExact = cases.filter((item) => item.replayExact).length;
  const falseBroadOrSyntheticMatches = cases.filter((item) => item.falseBroadOrSyntheticMatch).length;
  const metrics = {
    expectedOutcomeRate: ratio(correct, cases.length),
    hierarchyCorrectnessRate: ratio(hierarchyCorrect, cases.length),
    replayRate: ratio(replayExact, cases.length),
    gapHandlingRate: stratumRate(cases, "SCHEME_GAP"),
    insufficientHandlingRate: stratumRate(cases, "EVIDENCE_INSUFFICIENT"),
    ambiguityHandlingRate: stratumRate(cases, "AMBIGUOUS"),
    falseBroadOrSyntheticMatches
  };
  const status = metrics.expectedOutcomeRate === 1 && metrics.hierarchyCorrectnessRate === 1 && metrics.replayRate === 1 && metrics.gapHandlingRate === 1 && metrics.insufficientHandlingRate === 1 && metrics.ambiguityHandlingRate === 1 && falseBroadOrSyntheticMatches === 0 ? "PASS" : "FAIL";
  const core = {
    schema: CLASSIFICATION_EVALUATION_SCHEMA,
    status,
    goldManifestDigest: digest(goldManifest),
    caseCount: cases.length,
    composition,
    bindings: {
      taxonomyDigests: unique(observations.map((item) => item.taxonomyDigest)),
      sourceSnapshotDigests: unique(observations.map((item) => item.sourceSnapshotDigest)),
      retrievalConfigDigests: unique(observations.map((item) => item.retrievalConfigDigest)),
      algorithmDigests: unique(observations.map((item) => item.algorithmDigest)),
      policyDigests: unique(observations.map((item) => item.policyDigest)),
      advisorBindings: unique(observations.map((item) => item.advisorBindingDigest)),
      scorerVersion
    },
    cases,
    metrics,
    thresholds: CLASSIFICATION_EVALUATION_THRESHOLDS,
    authority: { boundedFixtureOnly: true, generalProductionAccuracyClaim: false, mayActivatePolicy: false, mayChangeThresholds: false, mayApprove: false, mayPublish: false }
  };
  core.reportDigest = digest(core);
  return core;
}

export function validateGoldManifest(manifest) {
  if (manifest?.schema !== "evopilot-harness-classification-gold-manifest/v1" || !Array.isArray(manifest.cases)) throw evaluationError("CLASSIFICATION_GOLD_MANIFEST_INVALID", "A versioned classification Gold manifest is required.");
  const ids = new Set(manifest.cases.map((item) => item.id));
  if (ids.size !== manifest.cases.length) throw evaluationError("CLASSIFICATION_GOLD_CASE_ID_CONFLICT", "Gold case ids must be unique.");
  const composition = compositionOf(manifest.cases);
  for (const [field, minimum] of [["caseCount", 48], ["knownMatches", 12], ["semanticKnownMatches", 6], ["schemeGaps", 8], ["evidenceInsufficient", 8], ["ambiguous", 8], ["misleadingNegatives", 12], ["mixedAxisCases", 8]]) {
    if (composition[field] < minimum) throw evaluationError("CLASSIFICATION_GOLD_COMPOSITION_INSUFFICIENT", `Gold composition ${field}=${composition[field]} is below ${minimum}.`);
  }
  return composition;
}

function scoreCase(gold, observation) {
  if (!observation) return { caseId: gold.id, stratum: gold.stratum, expectedOutcome: false, hierarchyCorrect: false, replayExact: false, falseBroadOrSyntheticMatch: false, reason: "MISSING_OBSERVATION" };
  const axesCorrect = ["domain", "product"].every((axis) => observation.axes?.[axis] === gold.expectedAxes[axis]);
  const aggregateCorrect = observation.aggregate === gold.expectedAggregate;
  return {
    caseId: gold.id,
    stratum: gold.stratum,
    expectedOutcome: axesCorrect && aggregateCorrect,
    hierarchyCorrect: observation.hierarchyCorrect === true,
    replayExact: observation.replayExact === true,
    falseBroadOrSyntheticMatch: observation.falseBroadOrSyntheticMatch === true,
    resultDigest: observation.resultDigest,
    sourceSnapshotDigest: observation.sourceSnapshotDigest,
    taxonomyDigest: observation.taxonomyDigest
  };
}

function compositionOf(cases) {
  const count = (stratum) => cases.filter((item) => item.stratum === stratum).length;
  return {
    caseCount: cases.length,
    knownMatches: count("KNOWN_MATCH"),
    semanticKnownMatches: cases.filter((item) => item.stratum === "KNOWN_MATCH" && item.literalSelectedVocabularyPresent === false).length,
    schemeGaps: count("SCHEME_GAP"),
    evidenceInsufficient: count("EVIDENCE_INSUFFICIENT"),
    ambiguous: count("AMBIGUOUS"),
    misleadingNegatives: count("MISLEADING_NEGATIVE"),
    mixedAxisCases: cases.filter((item) => item.mixedAxis === true).length
  };
}

function stratumRate(cases, stratum) { const selected = cases.filter((item) => item.stratum === stratum); return ratio(selected.filter((item) => item.expectedOutcome).length, selected.length); }
function ratio(numerator, denominator) { return denominator ? Math.round((numerator / denominator) * 1_000_000) / 1_000_000 : 0; }
function unique(values) { return [...new Set(values.filter(Boolean))].sort(); }
function evaluationError(code, message) { const error = new Error(message); error.name = "ClassificationEvaluationError"; error.code = code; error.nextAction = "repair-gold-manifest-or-observations"; return error; }
