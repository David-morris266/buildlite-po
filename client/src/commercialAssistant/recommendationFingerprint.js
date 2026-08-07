/**
 * BL-024A.1 — Deterministic recommendation fingerprints.
 */

export function buildRecommendationFingerprint(sourceModule, ruleId, sourceRecordId) {
  return `${String(sourceModule)}:${String(ruleId)}:${String(sourceRecordId)}`;
}
