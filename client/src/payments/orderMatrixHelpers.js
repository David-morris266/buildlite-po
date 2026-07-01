/**
 * BL-011B.02 — Order Matrix editor helpers (validation, row normalisation).
 */

export function normalizeMatrixRow(row) {
  return {
    id: row.id,
    description: String(row.description || '').trim(),
    orderValue: Number(row.orderValue) || 0,
    notes: String(row.notes || '').trim(),
  };
}

export function normalizeMatrixRows(rows) {
  return (rows || []).map(normalizeMatrixRow);
}

export function cloneMatrixRows(rows) {
  return (rows || []).map((row) => ({ ...row }));
}

export function matrixRowsSnapshot(rows) {
  return JSON.stringify(normalizeMatrixRows(rows));
}

export function rowsAreEqual(a, b) {
  return matrixRowsSnapshot(a) === matrixRowsSnapshot(b);
}

export function getMatrixValidation(summary) {
  const { allocated, remaining, isBalanced } = summary;

  if (isBalanced) {
    return {
      modifier: 'balanced',
      prefix: '✓',
      headline: 'Fully allocated',
      detail: `${allocated}`,
      detailKind: 'allocated',
    };
  }

  if (remaining > 0.005) {
    return {
      modifier: 'under',
      prefix: '',
      headline: `${remaining}`,
      detail: 'remaining',
      detailKind: 'remaining',
    };
  }

  return {
    modifier: 'over',
    prefix: '',
    headline: `${Math.abs(remaining)}`,
    detail: 'over allocated',
    detailKind: 'over',
  };
}

export function getAllocationStatus(summary) {
  if (summary.isBalanced) {
    return { label: 'Fully allocated', modifier: 'balanced' };
  }
  if (summary.remaining > 0.005) {
    return { label: 'Under allocated', modifier: 'under' };
  }
  return { label: 'Over allocated', modifier: 'over' };
}

export function createEmptyMatrixRow(id) {
  return {
    id,
    description: '',
    orderValue: '',
    notes: '',
  };
}
