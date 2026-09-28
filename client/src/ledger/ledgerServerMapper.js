/**
 * BL-031B — Normalise purchase-ledger server documents into client store shape.
 */

function toNumberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toNumber(value, fallback = 0) {
  const n = toNumberOrNull(value);
  return n == null ? fallback : n;
}

export function normalizeServerLedgerBatch(document) {
  if (!document) return null;
  return {
    id: document.id,
    developmentId: document.developmentId,
    originalFileName: document.originalFileName || document.fileName || '',
    fileName: document.originalFileName || document.fileName || '',
    sourceProfile: document.sourceProfile || document.importProfile || '',
    importProfile: document.sourceProfile || document.importProfile || '',
    rowsImported: Number(document.rowsImported) || 0,
    rowsRejected: Number(document.rowsRejected) || 0,
    totalNet: toNumber(document.totalNet, 0),
    totalValue: toNumber(document.totalNet ?? document.totalValue, 0),
    metadata: document.metadata && typeof document.metadata === 'object' ? document.metadata : {},
    importedBy: document.importedBy ?? null,
    importedAt: document.importedAt || document.importDate || null,
    importDate: document.importedAt || document.importDate || null,
    createdAt: document.createdAt || null,
    importBatch: document.id,
  };
}

export function normalizeServerLedgerBatchList(documents) {
  return (Array.isArray(documents) ? documents : [])
    .map(normalizeServerLedgerBatch)
    .filter(Boolean)
    .sort((a, b) => new Date(b.importedAt || 0) - new Date(a.importedAt || 0));
}

export function normalizeServerLedgerTransaction(document) {
  if (!document) return null;
  return {
    id: document.id,
    developmentId: document.developmentId,
    supplier: document.supplier || '',
    supplierCode: document.supplierCode || '',
    sourceCostCodeKey: document.sourceCostCodeKey || document.costCode || '',
    costCode: document.costCodeKey || '',
    costCodeKey: document.costCodeKey || '',
    resolvedCostCodeId: document.resolvedCostCodeId || null,
    resolvedCostCodeDescription: document.resolvedCostCodeDescription || '',
    resolutionStatus: document.resolutionStatus || (document.costCodeKey ? 'resolved' : 'unresolved'),
    resolutionVersion: Number(document.resolutionVersion) || 1,
    resolvedAt: document.resolvedAt || null,
    resolvedBy: document.resolvedBy || null,
    transactionDate: document.transactionDate || '',
    invoiceNumber: document.invoiceNumber || '',
    description: document.description || '',
    netAmount: toNumber(document.netAmount, 0),
    vat: toNumberOrNull(document.vatAmount ?? document.vat),
    vatAmount: toNumberOrNull(document.vatAmount ?? document.vat),
    grossAmount: toNumberOrNull(document.grossAmount),
    source: document.source || '',
    documentType: document.documentType || '',
    reference: document.reference || '',
    importBatch: document.batchId || document.importBatch || '',
    batchId: document.batchId || null,
    fingerprint: document.fingerprint || '',
    reversesId: document.reversesId || null,
    createdAt: document.createdAt || null,
    importedBy: document.createdBy || document.importedBy || null,
  };
}

export function normalizeServerLedgerTransactionList(documents) {
  return (Array.isArray(documents) ? documents : [])
    .map(normalizeServerLedgerTransaction)
    .filter(Boolean)
    .sort((a, b) => new Date(b.transactionDate) - new Date(a.transactionDate));
}

export function normalizeServerLedgerTotals(document) {
  if (!document || typeof document !== 'object') {
    return {
      totalNet: 0,
      totalVat: 0,
      transactionCount: 0,
      actualCostByCostCode: {},
      sourceTotalNet: 0,
      allocatedTotalNet: 0,
      unresolvedTotalNet: 0,
      unresolvedCount: 0,
    };
  }
  return {
    totalNet: toNumber(document.totalNet, 0),
    sourceTotalNet: toNumber(document.sourceTotalNet ?? document.totalNet, 0),
    allocatedTotalNet: toNumber(document.allocatedTotalNet ?? document.totalNet, 0),
    unresolvedTotalNet: toNumber(document.unresolvedTotalNet, 0),
    unresolvedCount: Number(document.unresolvedCount) || 0,
    totalVat: toNumber(document.totalVat, 0),
    transactionCount: Number(document.transactionCount) || 0,
    actualCostByCostCode:
      document.actualCostByCostCode && typeof document.actualCostByCostCode === 'object'
        ? document.actualCostByCostCode
        : {},
  };
}
