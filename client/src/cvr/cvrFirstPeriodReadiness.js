export function firstCvrCreationState({ rowCount = 0, readiness, loading = false, error = '' } = {}) {
  const firstPeriod = rowCount === 0;
  return {
    firstPeriod,
    blocked: firstPeriod && (loading || Boolean(error) || !readiness || !readiness.canCreateFirstCvr),
  };
}
