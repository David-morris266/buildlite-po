/**
 * BL-033B — BuildLite semantic classification helpers (client).
 * Engine keys are stable. Commercial Head remains the tenant reporting hierarchy.
 * Unmapped = UNCLASSIFIED + STANDARD_CVR. OTHER is explicit only.
 */

export const SEMANTIC_GROUPS = {
  UNCLASSIFIED: 'UNCLASSIFIED',
  LAND: 'LAND',
  FEES: 'FEES',
  INFRASTRUCTURE: 'INFRASTRUCTURE',
  BUILD: 'BUILD',
  PRELIMS: 'PRELIMS',
  SELLING: 'SELLING',
  OTHER: 'OTHER',
};

export const SEMANTIC_GROUP_KEYS = Object.values(SEMANTIC_GROUPS);

export const FORECAST_DRIVERS = {
  STANDARD_CVR: 'STANDARD_CVR',
  TIME: 'TIME',
  LUMP_SUM: 'LUMP_SUM',
  QUANTITY: 'QUANTITY',
  MILESTONE: 'MILESTONE',
  PERCENTAGE: 'PERCENTAGE',
  MANUAL: 'MANUAL',
};

export const FORECAST_DRIVER_KEYS = Object.values(FORECAST_DRIVERS);

export const DEFAULT_SEMANTIC_GROUP = SEMANTIC_GROUPS.UNCLASSIFIED;
export const DEFAULT_FORECAST_DRIVER = FORECAST_DRIVERS.STANDARD_CVR;

export const SEMANTIC_GROUP_LABELS = {
  UNCLASSIFIED: 'Unclassified',
  LAND: 'Land',
  FEES: 'Fees',
  INFRASTRUCTURE: 'Infrastructure',
  BUILD: 'Build',
  PRELIMS: 'Prelims',
  SELLING: 'Selling',
  OTHER: 'Other',
};

export const FORECAST_DRIVER_LABELS = {
  STANDARD_CVR: 'Standard CVR',
  TIME: 'Time',
  LUMP_SUM: 'Lump sum',
  QUANTITY: 'Quantity',
  MILESTONE: 'Milestone',
  PERCENTAGE: 'Percentage',
  MANUAL: 'Manual',
};

const MAX_COST_CODE_KEY_LENGTH = 64;

export function normalizeCostCodeKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let codePart = raw.split('—')[0].split(' – ')[0];
  const spacedHyphen = codePart.split(' - ');
  if (spacedHyphen.length > 1) codePart = spacedHyphen[0];
  return codePart.replace(/\s+/g, '').trim().slice(0, MAX_COST_CODE_KEY_LENGTH);
}

export function unmappedClassification(costCodeKey = '') {
  return {
    id: null,
    costCodeKey: costCodeKey || '',
    exists: false,
    semanticGroup: DEFAULT_SEMANTIC_GROUP,
    forecastDriver: DEFAULT_FORECAST_DRIVER,
    version: 0,
  };
}

export function resolveClassification(record, costCodeKey = '') {
  if (!record || record.exists === false) {
    return unmappedClassification(normalizeCostCodeKey(costCodeKey || record?.costCodeKey));
  }
  return {
    id: record.id || null,
    costCodeKey: record.costCodeKey || normalizeCostCodeKey(costCodeKey),
    exists: true,
    semanticGroup: record.semanticGroup,
    forecastDriver: record.forecastDriver || DEFAULT_FORECAST_DRIVER,
    version: Number(record.version) || 1,
  };
}

export function indexClassificationsByKey(classifications = []) {
  const map = new Map();
  for (const row of classifications) {
    const key = normalizeCostCodeKey(row?.costCodeKey).toLowerCase();
    if (!key) continue;
    map.set(key, resolveClassification(row, row.costCodeKey));
  }
  return map;
}

export function lookupClassification(byKey, costCodeKey) {
  const key = normalizeCostCodeKey(costCodeKey);
  if (!key) return unmappedClassification('');
  return byKey.get(key.toLowerCase()) || unmappedClassification(key);
}

export function semanticGroupLabel(group) {
  return SEMANTIC_GROUP_LABELS[group] || SEMANTIC_GROUP_LABELS.UNCLASSIFIED;
}

export function forecastDriverLabel(driver) {
  return FORECAST_DRIVER_LABELS[driver] || FORECAST_DRIVER_LABELS.STANDARD_CVR;
}
