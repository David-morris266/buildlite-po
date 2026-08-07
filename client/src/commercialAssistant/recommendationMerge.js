/**
 * BL-024A.1 — Merge derived recommendations with persisted dispositions.
 *
 * Lifecycle rules:
 * 1. If the underlying condition no longer exists -> resolved (hidden from open list).
 * 2. If dismissed while condition persists -> dismissed (hidden).
 * 3. If deferred and now < deferUntil -> deferred (hidden).
 * 4. If deferred and deferUntil elapsed while condition persists -> open.
 * 5. Otherwise -> open.
 *
 * Disposition and audit records are retained when a recommendation resolves.
 */

import {
  DISPOSITION_STATUS,
  MERGED_RECOMMENDATION_STATUS,
  PRIORITY_ORDER,
} from './commercialAssistantTypes';

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function dedupeDerivedRecommendations(recommendations = []) {
  const seen = new Set();
  return (recommendations || []).filter((item) => {
    if (!item?.fingerprint || seen.has(item.fingerprint)) return false;
    seen.add(item.fingerprint);
    return true;
  });
}

export function isDeferralActive(disposition, now = new Date()) {
  if (!disposition || disposition.status !== DISPOSITION_STATUS.deferred) {
    return false;
  }

  if (!disposition.deferUntil) {
    return true;
  }

  const until = new Date(disposition.deferUntil);
  if (Number.isNaN(until.getTime())) {
    return true;
  }

  return now.getTime() < until.getTime();
}

export function resolveMergedRecommendationStatus(
  disposition,
  conditionExists,
  now = new Date()
) {
  if (!conditionExists) {
    return MERGED_RECOMMENDATION_STATUS.resolved;
  }

  if (disposition?.status === DISPOSITION_STATUS.dismissed) {
    return MERGED_RECOMMENDATION_STATUS.dismissed;
  }

  if (isDeferralActive(disposition, now)) {
    return MERGED_RECOMMENDATION_STATUS.deferred;
  }

  return MERGED_RECOMMENDATION_STATUS.open;
}

export function mergeRecommendations(
  derivedRecommendations = [],
  dispositionLookup = {},
  now = new Date()
) {
  const deduped = dedupeDerivedRecommendations(derivedRecommendations);

  return deduped.map((derived) => {
    const disposition = dispositionLookup[derived.fingerprint] || null;
    const status = resolveMergedRecommendationStatus(disposition, true, now);

    return {
      ...derived,
      status,
      disposition,
    };
  });
}

export function mergeRecommendationsWithResolution(
  derivedRecommendations = [],
  dispositionByFingerprint = {},
  now = new Date()
) {
  const deduped = dedupeDerivedRecommendations(derivedRecommendations);
  const derivedFingerprints = new Set(deduped.map((item) => item.fingerprint));
  const merged = mergeRecommendations(deduped, dispositionByFingerprint, now);

  for (const [fingerprint, disposition] of Object.entries(dispositionByFingerprint)) {
    if (derivedFingerprints.has(fingerprint)) continue;

    merged.push({
      fingerprint,
      status: MERGED_RECOMMENDATION_STATUS.resolved,
      disposition,
      resolvedOnly: true,
    });
  }

  return merged;
}

export function filterVisibleRecommendations(recommendations = []) {
  return recommendations.filter(
    (item) =>
      !item.resolvedOnly &&
      item.status !== MERGED_RECOMMENDATION_STATUS.resolved &&
      item.status !== MERGED_RECOMMENDATION_STATUS.dismissed &&
      item.status !== MERGED_RECOMMENDATION_STATUS.deferred
  );
}

export function sortRecommendations(recommendations = []) {
  return [...recommendations].sort((left, right) => {
    const priorityDelta =
      (PRIORITY_ORDER[left.priority] ?? 99) - (PRIORITY_ORDER[right.priority] ?? 99);
    if (priorityDelta !== 0) return priorityDelta;

    const impactDelta =
      Math.abs(toNumber(right.financialImpactValue)) -
      Math.abs(toNumber(left.financialImpactValue));
    if (impactDelta !== 0) return impactDelta;

    return new Date(right.observedAt || 0).getTime() - new Date(left.observedAt || 0).getTime();
  });
}

export function buildRecommendationBadgeCounts(recommendations = []) {
  return recommendations.reduce(
    (counts, item) => {
      if (item.category === 'actionRequired') counts.actionRequired += 1;
      if (item.category === 'warning') counts.warnings += 1;
      return counts;
    },
    { actionRequired: 0, warnings: 0 }
  );
}
