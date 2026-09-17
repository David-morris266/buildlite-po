/**
 * BL-032A — Normalise server revenue settings documents into BL-019 record shape.
 */

const LOCAL_RECORD_SCHEMA_VERSION = 3;

export function normalizeServerRevenueSettings(document, developmentId) {
  if (!document || typeof document !== 'object') return null;
  return {
    id: document.id || null,
    developmentId: document.developmentId || developmentId || null,
    exists: document.exists !== false && Boolean(document.id),
    recognitionPolicy: document.recognitionPolicy === 'exchange' ? 'exchange' : 'completion',
    revenueMode: document.revenueMode === 'summary' ? 'summary' : 'sales_register',
    summaryRevenueLines: Array.isArray(document.summaryRevenueLines) ? document.summaryRevenueLines : [],
    revenueStrategy: document.revenueStrategy || {},
    houseTypePricing: document.houseTypePricing || {},
    revenueAdjustments: Array.isArray(document.revenueAdjustments)
      ? document.revenueAdjustments
      : [],
    recognitionSettings:
      document.recognitionSettings && typeof document.recognitionSettings === 'object'
        ? document.recognitionSettings
        : {},
    version: Number.isInteger(Number(document.version)) ? Number(document.version) : 0,
    createdAt: document.createdAt || null,
    updatedAt: document.updatedAt || null,
    createdBy: document.createdBy ?? null,
    updatedBy: document.updatedBy ?? null,
    revenueAuthority:
      document.revenueAuthority && typeof document.revenueAuthority === 'object'
        ? document.revenueAuthority
        : null,
    metadata: {
      version: LOCAL_RECORD_SCHEMA_VERSION,
      createdAt: document.createdAt || document.metadata?.createdAt || null,
      updatedAt: document.updatedAt || document.metadata?.updatedAt || null,
    },
  };
}

export function toServerRevenueSettingsPayload(record = {}) {
  return {
    version: Number.isInteger(Number(record.version)) ? Number(record.version) : 0,
    recognitionPolicy: record.recognitionPolicy === 'exchange' ? 'exchange' : 'completion',
    revenueMode: record.revenueMode === 'summary' ? 'summary' : 'sales_register',
    summaryRevenueLines: Array.isArray(record.summaryRevenueLines) ? record.summaryRevenueLines : [],
    revenueStrategy: record.revenueStrategy || {},
    houseTypePricing: record.houseTypePricing || {},
    revenueAdjustments: Array.isArray(record.revenueAdjustments) ? record.revenueAdjustments : [],
    recognitionSettings:
      record.recognitionSettings && typeof record.recognitionSettings === 'object'
        ? record.recognitionSettings
        : {},
  };
}
