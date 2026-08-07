/**
 * BL-024A.1 — Compare effective assistant scope values.
 */

export function scopesEqual(left, right) {
  const normalizedLeft = normalizeScope(left);
  const normalizedRight = normalizeScope(right);

  return (
    normalizedLeft.developmentId === normalizedRight.developmentId &&
    normalizedLeft.packages === normalizedRight.packages &&
    normalizedLeft.onNavigate === normalizedRight.onNavigate
  );
}

export function normalizeScope(scope) {
  return {
    developmentId: scope?.developmentId || null,
    packages: Array.isArray(scope?.packages) ? scope.packages : [],
    onNavigate: typeof scope?.onNavigate === 'function' ? scope.onNavigate : null,
  };
}

export function isEmptyScope(scope) {
  const normalized = normalizeScope(scope);
  return (
    !normalized.developmentId &&
    normalized.packages.length === 0 &&
    !normalized.onNavigate
  );
}
