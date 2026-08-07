/**
 * BL-024A.1 — Register default Commercial Assistant providers.
 */

import { registerRecommendationProvider, clearRecommendationProvidersForTests } from './recommendationEngine';
import { certificateRecommendationProvider } from './certificateRecommendationProvider';
import { commercialEventsRecommendationProvider } from './commercialEventsRecommendationProvider';

let registered = false;

export function ensureCommercialAssistantProvidersRegistered() {
  if (registered) return;
  registerRecommendationProvider(commercialEventsRecommendationProvider);
  registerRecommendationProvider(certificateRecommendationProvider);
  registered = true;
}

export function resetCommercialAssistantProvidersForTests() {
  registered = false;
  clearRecommendationProvidersForTests();
}
