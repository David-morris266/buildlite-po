/**
 * BL-024A.1 — Commercial Assistant canonical types.
 */

export const RECOMMENDATION_CATEGORY = {
  actionRequired: 'actionRequired',
  warning: 'warning',
  information: 'information',
  opportunity: 'opportunity',
};

export const RECOMMENDATION_PRIORITY = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
};

export const RECOMMENDATION_SOURCE_MODULE = {
  commercialEvents: 'commercialEvents',
  certificates: 'certificates',
};

export const RECOMMENDATION_GENERATED_BY = {
  rule: 'rule',
  ai: 'ai',
  user: 'user',
};

export const DISPOSITION_STATUS = {
  dismissed: 'dismissed',
  deferred: 'deferred',
};

export const MERGED_RECOMMENDATION_STATUS = {
  open: 'open',
  dismissed: 'dismissed',
  deferred: 'deferred',
  resolved: 'resolved',
};

export const COMMERCIAL_ASSISTANT_NAVIGATION_KIND = {
  developmentCommercialEvent: 'developmentCommercialEvent',
  packageCertificates: 'packageCertificates',
  packageCommercialEvents: 'packageCommercialEvents',
};

export const PRIORITY_ORDER = {
  [RECOMMENDATION_PRIORITY.critical]: 0,
  [RECOMMENDATION_PRIORITY.high]: 1,
  [RECOMMENDATION_PRIORITY.medium]: 2,
  [RECOMMENDATION_PRIORITY.low]: 3,
};

export const BADGE_CATEGORIES = new Set([
  RECOMMENDATION_CATEGORY.actionRequired,
  RECOMMENDATION_CATEGORY.warning,
]);
