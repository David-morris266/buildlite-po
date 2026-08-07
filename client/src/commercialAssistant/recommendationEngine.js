/**
 * BL-024A.1 — Central Commercial Assistant recommendation engine.
 */

import { listRecommendationDispositions } from './recommendationDispositionStore';
import {
  buildRecommendationBadgeCounts,
  dedupeDerivedRecommendations,
  filterVisibleRecommendations,
  mergeRecommendations,
  sortRecommendations,
} from './recommendationMerge';

const providers = [];

export function clearRecommendationProvidersForTests() {
  providers.length = 0;
}

export function registerRecommendationProvider(provider) {
  if (!provider?.id || typeof provider.getRecommendations !== 'function') {
    throw new Error('Recommendation provider must include id and getRecommendations()');
  }

  const existingIndex = providers.findIndex((item) => item.id === provider.id);
  if (existingIndex >= 0) {
    providers[existingIndex] = provider;
    return;
  }

  providers.push(provider);
}

export function listRegisteredRecommendationProviders() {
  return providers.map((provider) => provider.id);
}

export function collectDerivedRecommendations(context = {}) {
  const collected = [];

  for (const provider of providers) {
    try {
      const results = provider.getRecommendations(context) || [];
      if (Array.isArray(results)) {
        collected.push(...results);
      }
    } catch {
      // Provider failures are isolated — one malformed record must not break the Assistant.
    }
  }

  return dedupeDerivedRecommendations(collected);
}

export function buildDispositionLookup(dispositions = []) {
  return Object.fromEntries(
    (dispositions || [])
      .filter((item) => item?.fingerprint)
      .map((item) => [item.fingerprint, item])
  );
}

export function buildAssistantRecommendationSnapshot(context = {}, now = new Date()) {
  const derived = collectDerivedRecommendations(context);
  const dispositionLookup = buildDispositionLookup(listRecommendationDispositions());
  const merged = mergeRecommendations(derived, dispositionLookup, now);
  const visible = sortRecommendations(filterVisibleRecommendations(merged));

  return {
    derived,
    merged,
    visible,
    badgeCounts: buildRecommendationBadgeCounts(visible),
  };
}
