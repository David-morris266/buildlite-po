/**
 * BL-031E.4 — Map server CVR snapshot documents into nested client camelCase.
 *
 * Server E.3 returns snapshot money fields flat on the header. The client
 * period document nests them under `snapshot.totals` so React never sees
 * snake_case or a mixed live/historic shape.
 */

function emptyCommentary() {
  return {
    keyCommercialIssues: '',
    commercialOpportunities: '',
    financialRisks: '',
    actionsBeforeNextCvr: '',
  };
}

function commentaryOf(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const base = emptyCommentary();
  return {
    keyCommercialIssues: String(source.keyCommercialIssues || base.keyCommercialIssues),
    commercialOpportunities: String(
      source.commercialOpportunities || base.commercialOpportunities
    ),
    financialRisks: String(source.financialRisks || base.financialRisks),
    actionsBeforeNextCvr: String(source.actionsBeforeNextCvr || base.actionsBeforeNextCvr),
  };
}

function sourceReadinessOf(raw) {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
}

function toNumberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toNumber(value, fallback = 0) {
  const n = toNumberOrNull(value);
  return n == null ? fallback : n;
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined) return value;
  }
  return undefined;
}

function moneyFrom(source, camelKey, snakeKey, fallback = 0) {
  if (!source || typeof source !== 'object') return fallback;
  return toNumber(firstDefined(source[camelKey], source[snakeKey]), fallback);
}

function nullableMoneyFrom(source, camelKey, snakeKey) {
  if (!source || typeof source !== 'object') return null;
  const value = firstDefined(source[camelKey], source[snakeKey]);
  return value === undefined ? null : toNumberOrNull(value);
}

function textFrom(source, camelKey, snakeKey, fallback = '') {
  if (!source || typeof source !== 'object') return fallback;
  const value = firstDefined(source[camelKey], source[snakeKey]);
  return value == null ? fallback : String(value);
}

export function normalizeCvrSnapshotTotals(source = {}) {
  const totalsSource =
    source.totals && typeof source.totals === 'object' ? source.totals : source;
  return {
    originalBudget: nullableMoneyFrom(totalsSource, 'originalBudget', 'original_budget'),
    currentBudget: moneyFrom(totalsSource, 'currentBudget', 'current_budget', 0),
    committed: moneyFrom(totalsSource, 'committed', 'committed', 0),
    certified: moneyFrom(totalsSource, 'certified', 'certified', 0),
    actualCost: moneyFrom(totalsSource, 'actualCost', 'actual_cost', 0),
    manualAccrual: moneyFrom(totalsSource, 'manualAccrual', 'manual_accrual', 0),
    currentCost: moneyFrom(totalsSource, 'currentCost', 'current_cost', 0),
    systemForecast: moneyFrom(totalsSource, 'systemForecast', 'system_forecast', 0),
    commercialAdjustment: moneyFrom(
      totalsSource,
      'commercialAdjustment',
      'commercial_adjustment',
      0
    ),
    finalForecast: moneyFrom(totalsSource, 'finalForecast', 'final_forecast', 0),
    costToComplete: moneyFrom(totalsSource, 'costToComplete', 'cost_to_complete', 0),
    outstandingCertified: moneyFrom(
      totalsSource,
      'outstandingCertified',
      'outstanding_certified',
      0
    ),
    variance: moneyFrom(totalsSource, 'variance', 'variance', 0),
  };
}

export function normalizeCvrSnapshotRow(document) {
  if (!document) return null;
  const metadataSource = firstDefined(document.displayMetadata, document.display_metadata);
  const metadata =
    metadataSource && typeof metadataSource === 'object' && !Array.isArray(metadataSource)
      ? metadataSource
      : {};
  const historySource = firstDefined(
    document.adjustmentHistory,
    document.adjustment_history,
    metadata.adjustmentHistory
  );
  const adjustmentHistory = Array.isArray(historySource) ? historySource : [];
  const adjustmentReason = textFrom(
    document,
    'adjustmentReason',
    'adjustment_reason',
    textFrom(document, 'commercialReason', 'commercial_reason')
  );
  const notes =
    textFrom(document, 'notes', 'notes') ||
    textFrom(document, 'commercialNotes', 'commercial_notes');

  return {
    id: firstDefined(document.id, null),
    snapshotId: firstDefined(document.snapshotId, document.snapshot_id, null),
    costCodeKey: textFrom(document, 'costCodeKey', 'cost_code_key'),
    costCodeLabel: textFrom(
      document,
      'costCodeLabel',
      'cost_code_label',
      textFrom(document, 'costCodeKey', 'cost_code_key')
    ),
    description: textFrom(document, 'description', 'description'),
    commercialHead: textFrom(document, 'commercialHead', 'commercial_head'),
    commercialFamily: textFrom(document, 'commercialFamily', 'commercial_family'),
    trade: textFrom(document, 'trade', 'trade'),
    active: document.active !== false,
    originalBudget: nullableMoneyFrom(document, 'originalBudget', 'original_budget'),
    currentBudget: nullableMoneyFrom(document, 'currentBudget', 'current_budget'),
    commercialAdjustment: moneyFrom(
      document,
      'commercialAdjustment',
      'commercial_adjustment',
      0
    ),
    commercialReason: adjustmentReason,
    adjustmentReason,
    manualAccrual: moneyFrom(document, 'manualAccrual', 'manual_accrual', 0),
    notes,
    commercialNotes: notes,
    committed: moneyFrom(document, 'committed', 'committed', 0),
    certified: moneyFrom(document, 'certified', 'certified', 0),
    actualCost: moneyFrom(document, 'actualCost', 'actual_cost', 0),
    currentCost: moneyFrom(document, 'currentCost', 'current_cost', 0),
    systemForecast: moneyFrom(document, 'systemForecast', 'system_forecast', 0),
    finalForecast: moneyFrom(document, 'finalForecast', 'final_forecast', 0),
    costToComplete: moneyFrom(document, 'costToComplete', 'cost_to_complete', 0),
    outstandingCertified: moneyFrom(
      document,
      'outstandingCertified',
      'outstanding_certified',
      0
    ),
    variance: moneyFrom(document, 'variance', 'variance', 0),
    displayMetadata: metadata,
    adjustmentHistory,
  };
}

export function normalizeServerCvrSnapshot(document) {
  if (!document || typeof document !== 'object') return null;
  const rowsSource = Array.isArray(document.rows) ? document.rows : [];
  return {
    id: firstDefined(document.id, null),
    clientId: firstDefined(document.clientId, document.client_id, null),
    developmentId: firstDefined(document.developmentId, document.development_id, null),
    periodId: firstDefined(document.periodId, document.period_id, null),
    periodKey: textFrom(document, 'periodKey', 'period_key'),
    schemaVersion: Number(firstDefined(document.schemaVersion, document.schema_version)) || 1,
    commentary: commentaryOf(document.commentary),
    sourceReadiness: sourceReadinessOf(
      firstDefined(document.sourceReadiness, document.source_readiness)
    ),
    createdAt: firstDefined(document.createdAt, document.created_at, null),
    createdBy: firstDefined(document.createdBy, document.created_by, null),
    totals: normalizeCvrSnapshotTotals(document),
    rows: rowsSource.map(normalizeCvrSnapshotRow).filter(Boolean),
  };
}
