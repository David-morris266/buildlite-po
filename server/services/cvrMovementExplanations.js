function sameExplanation(left, right) {
  return left?.costCodeKey === right?.costCodeKey && left?.component === right?.component &&
    left?.fingerprint === right?.fingerprint && left?.reason === right?.reason &&
    Number(left?.unexplainedAmount) === Number(right?.unexplainedAmount);
}

function stampMovementExplanations(items, priorItems, { actor, auth, now = () => new Date().toISOString() } = {}) {
  const prior = Array.isArray(priorItems) ? priorItems : [];
  return (Array.isArray(items) ? items : []).map((item) => {
    const existing = prior.find((candidate) => sameExplanation(candidate, item));
    if (existing) return { ...existing, ...item };
    return {
      ...item,
      actor: auth?.displayName || actor || null,
      userId: auth?.userId || null,
      membershipId: auth?.membershipId || null,
      recordedAt: now(),
    };
  });
}

module.exports = { sameExplanation, stampMovementExplanations };
