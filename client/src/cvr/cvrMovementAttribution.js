const COMPONENT_LABELS = {
  systemForecast: 'System Forecast',
  expectedLiability: 'Expected Liability',
  vaExposureUplift: 'VA Exposure',
  commercialAdjustment: 'Commercial Adjustment',
};

const toPence = (value) => Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) : 0;
const fromPence = (value) => value / 100;
const keyOf = (item, fields) => fields.map((field) => item?.[field]).find(Boolean) || null;

export function movementExplanationFingerprint({ previousPeriod, row, component }) {
  const snapshotId = previousPeriod?.snapshot?.id || previousPeriod?.snapshotId || 'no-snapshot';
  return [previousPeriod?.id || previousPeriod?.periodKey || 'no-period', snapshotId,
    row.costCodeKey, component.key, toPence(component.movement)].join('|');
}

function ceAttributions(component, current, previous) {
  const prior = new Map((previous?.expectedLiabilityProvenance || []).map((item) => [item.ceId, item]));
  const now = new Map((current?.expectedLiabilityProvenance || []).map((item) => [item.ceId, item]));
  const entries = [];
  for (const id of new Set([...prior.keys(), ...now.keys()])) {
    if (!id) continue;
    const before = prior.get(id);
    const after = now.get(id);
    const delta = toPence(after?.effectiveExpectedAmount) - toPence(before?.effectiveExpectedAmount);
    if (!delta) continue;
    const evidence = after || before;
    const transitioned = !after && current?.commercialEventEvidence?.find((event) =>
      event.ceId === id && (event.status === 'approved' || event.issuedVariationOrderId));
    entries.push({
      sourceType: 'commercial_event', sourceId: id,
      reference: evidence.ceReference || evidence.eventNumber || id,
      description: evidence.reason || (before && !after
        ? 'No longer carried as Expected Liability'
        : before ? 'Expected Liability treatment or value changed' : 'New eligible Expected Liability'),
      amountPence: delta,
      evidenceBasis: 'Stable Commercial Event identity and frozen Expected Liability provenance',
      drillThrough: { type: 'commercial_event', id },
      transitionGroupId: transitioned ? `ce-authority-transition:${id}` : null,
    });
  }
  return capAttributions(entries, toPence(component.movement));
}

function systemTransitionAttributions(component, current, previous) {
  const currentEvidence = new Map((current?.commercialEventEvidence || []).map((item) => [item.ceId, item]));
  const entries = [];
  for (const before of previous?.expectedLiabilityProvenance || []) {
    const event = currentEvidence.get(before.ceId);
    if (!event || !(event.status === 'approved' || event.issuedVariationOrderId)) continue;
    const amountPence = toPence(before.effectiveExpectedAmount);
    if (!amountPence) continue;
    entries.push({
      sourceType: event.issuedVariationOrderId ? 'ce_to_issued_vo' : 'ce_to_approved_commitment',
      sourceId: before.ceId,
      reference: before.ceReference || before.eventNumber || before.ceId,
      description: event.issuedVariationOrderId
        ? 'Moved from Expected Liability into Issued VO authority — net forecast movement £0'
        : 'Moved from Expected Liability into approved commitment — net forecast movement £0',
      amountPence,
      evidenceBasis: 'Stable Commercial Event identity and explicit approved/Issued VO relationship',
      drillThrough: { type: 'commercial_event', id: before.ceId },
      transitionGroupId: `ce-authority-transition:${before.ceId}`,
    });
  }
  return capAttributions(entries, toPence(component.movement));
}

function vaAttributions(component, current, previous) {
  const fields = ['variationAccountItemId', 'id', 'vaId'];
  const prior = new Map((previous?.variationExposureItems || []).map((item) => [keyOf(item, fields), item]).filter(([id]) => id));
  const now = new Map((current?.variationExposureItems || []).map((item) => [keyOf(item, fields), item]).filter(([id]) => id));
  const entries = [];
  for (const id of new Set([...prior.keys(), ...now.keys()])) {
    const before = prior.get(id);
    const after = now.get(id);
    if (!before || !after) continue;
    const beforeVersion = Number(before.itemVersion ?? before?.sourceVersions?.variationAccountItemVersion);
    const afterVersion = Number(after.itemVersion ?? after?.sourceVersions?.variationAccountItemVersion);
    if (!Number.isInteger(beforeVersion) || !Number.isInteger(afterVersion) || afterVersion <= beforeVersion) continue;
    const byVersion = new Map();
    let invalid = false;
    for (const history of after.forecastHistory || []) {
      const version = Number(history?.itemVersion);
      if (!Number.isInteger(version) || version <= beforeVersion || version > afterVersion) continue;
      if (byVersion.has(version)) invalid = true;
      byVersion.set(version, history);
    }
    if (invalid || byVersion.size !== afterVersion - beforeVersion) continue;
    const history = [];
    let forecastPence = toPence(before.qsForecast);
    for (let version = beforeVersion + 1; version <= afterVersion; version += 1) {
      const transition = byVersion.get(version);
      if (!transition || toPence(transition.priorValue) !== forecastPence) {
        invalid = true;
        break;
      }
      forecastPence = toPence(transition.newValue);
      history.push(transition);
    }
    if (invalid || forecastPence !== toPence(after.qsForecast)) continue;
    const delta = toPence(after.vaExposureUplift) - toPence(before.vaExposureUplift);
    if (!delta) continue;
    const beforeExposure = toPence(before.effectiveVaExposure);
    const afterExposure = toPence(after.effectiveVaExposure);
    const beforeAuthority = toPence(before.authorityAlreadyInCurrentContract);
    const afterAuthority = toPence(after.authorityAlreadyInCurrentContract);
    if (beforeExposure - beforeAuthority !== toPence(before.vaExposureUplift) ||
        afterExposure - afterAuthority !== toPence(after.vaExposureUplift) ||
        beforeAuthority !== afterAuthority || afterExposure - beforeExposure !== delta) continue;
    const reasons = history.map((entry) => String(entry.reason || '').trim()).filter(Boolean);
    if (reasons.length !== history.length) continue;
    entries.push({
      sourceType: 'variation_account', sourceId: id,
      reference: [after.reference || after.vaReference || id, after.description].filter(Boolean).join(' — '),
      description: reasons.length === 1 ? reasons[0] : reasons.join('; '),
      amountPence: delta,
      evidenceBasis: `Immutable QS Forecast history bridges item versions ${beforeVersion}–${afterVersion}; captured exposure and Current Contract authority reconcile exactly`,
      evidence: history.map((entry) => ({ ...entry })),
      drillThrough: { type: 'variation_account', id },
    });
  }
  return entries.reduce((sum, entry) => sum + entry.amountPence, 0) === toPence(component.movement)
    ? entries
    : [];
}

function adjustmentAttributions(component, current, previous) {
  const movementPence = toPence(component.movement);
  if (!movementPence) return [];
  const history = Array.isArray(current?.adjustmentHistory) ? current.adjustmentHistory : [];
  const matching = [...history].reverse().find((entry) =>
    toPence(entry.previousAdjustment ?? previous?.commercialAdjustment) + movementPence ===
      toPence(entry.newAdjustment ?? current?.commercialAdjustment));
  const reason = matching?.reason || current?.adjustmentReason || current?.commercialReason || '';
  if (!String(reason).trim()) return [];
  return [{
    sourceType: matching?.source || 'commercial_adjustment',
    sourceId: matching?.id || `${current?.costCodeKey || 'cost-code'}:adjustment`,
    reference: matching?.source === 'prelims_adoption' ? 'Prelims adoption'
      : matching?.source === 'selling_costs_adoption' ? 'Selling Costs adoption' : 'Commercial Adjustment',
    description: String(reason).trim(), amountPence: movementPence,
    evidenceBasis: matching ? 'Recorded adjustment adoption/history' : 'Current mandatory Commercial Adjustment reason',
    drillThrough: null,
  }];
}

function capAttributions(entries, movementPence) {
  let remaining = movementPence;
  const result = [];
  for (const entry of entries) {
    if (!remaining || Math.sign(entry.amountPence) !== Math.sign(remaining)) continue;
    const amountPence = Math.sign(remaining) * Math.min(Math.abs(entry.amountPence), Math.abs(remaining));
    result.push({ ...entry, amountPence });
    remaining -= amountPence;
  }
  return result;
}

function supportingActivity(current, previous) {
  const entries = [];
  const certified = toPence(current?.certified) - toPence(previous?.certified);
  const actual = toPence(current?.actualCost) - toPence(previous?.actualCost);
  if (certified) entries.push({ sourceType: 'certificate_activity', amountPence: certified, description: 'Certified value changed during the period', causal: false });
  if (actual) entries.push({ sourceType: 'ledger_activity', amountPence: actual, description: 'Ledger actual changed during the period', causal: false });
  return entries;
}

export function attributeCvrMovementRow({ row, current, previous, currentPeriod, previousPeriod }) {
  const explanations = currentPeriod?.commercialCommentary?.movementExplanations || [];
  const components = row.components.map((component) => {
    let attributions = [];
    if (component.available && component.key === 'systemForecast') attributions = systemTransitionAttributions(component, current, previous);
    if (component.available && component.key === 'expectedLiability') attributions = ceAttributions(component, current, previous);
    if (component.available && component.key === 'vaExposureUplift') attributions = vaAttributions(component, current, previous);
    if (component.available && component.key === 'commercialAdjustment') attributions = adjustmentAttributions(component, current, previous);
    const attributedPence = attributions.reduce((sum, item) => sum + item.amountPence, 0);
    const movementPence = component.available ? toPence(component.movement) : 0;
    const unattributedPence = movementPence - attributedPence;
    const fingerprint = movementExplanationFingerprint({ previousPeriod, row, component });
    const saved = explanations.find((item) => item.costCodeKey === row.costCodeKey && item.component === component.key);
    const explanation = saved ? { ...saved, stale: saved.fingerprint !== fingerprint || toPence(saved.unexplainedAmount) !== unattributedPence } : null;
    return { ...component, label: COMPONENT_LABELS[component.key] || component.label,
      attributions: attributions.map((item) => ({ ...item, amount: fromPence(item.amountPence) })),
      attributed: fromPence(attributedPence), unattributed: fromPence(unattributedPence), fingerprint, explanation,
      requiresExplanation: unattributedPence !== 0 && (!explanation || explanation.stale) };
  });
  const automaticallyAttributedPence = components.reduce((sum, item) => sum + toPence(item.attributed), 0);
  const qsExplainedPence = components.reduce((sum, item) => sum + (
    item.unattributed && item.explanation && !item.explanation.stale
      ? toPence(item.unattributed)
      : 0
  ), 0);
  const bridgeResidualPence = toPence(row.residual);
  const awaitingExplanationPence = components.reduce((sum, item) => sum + (
    item.requiresExplanation ? toPence(item.unattributed) : 0
  ), bridgeResidualPence);
  const awaitingExplanationMagnitudePence = components.reduce((sum, item) => sum + (
    item.requiresExplanation ? Math.abs(toPence(item.unattributed)) : 0
  ), Math.abs(bridgeResidualPence));
  const managementMovementPence = automaticallyAttributedPence + qsExplainedPence + awaitingExplanationPence;
  const rowMovementPence = toPence(row.movement);
  return { ...row, components, supportingActivity: supportingActivity(current, previous),
    automaticallyAttributed: fromPence(automaticallyAttributedPence),
    qsExplained: fromPence(qsExplainedPence),
    awaitingExplanation: fromPence(awaitingExplanationPence),
    awaitingExplanationMagnitude: fromPence(awaitingExplanationMagnitudePence),
    managementMovement: fromPence(managementMovementPence),
    managementReconciles: managementMovementPence === rowMovementPence };
}
