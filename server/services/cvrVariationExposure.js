const {
  buildProjection,
  mapAllocation,
  mapSubstitution,
  toPence,
  fromPence,
} = require('./variationAccountAuthorityRepository');

const CALCULATION_VERSION = 'va_expected_exposure_v1';

const EXCEPTIONS = Object.freeze({
  FORECAST_BELOW_RECOGNISED_AUTHORITY: 'forecast_below_recognised_authority',
  FORECAST_BELOW_LOCKED_CERTIFICATION: 'forecast_below_locked_certification',
  CERTIFIED_ABOVE_FORECAST: 'certified_above_forecast',
  OPPOSING_SIGN_EXPOSURE: 'opposing_sign_exposure',
  COST_CODE_MAPPING_AMBIGUOUS: 'cost_code_mapping_ambiguous',
  INCOMPLETE_SOURCE_PROVENANCE: 'incomplete_source_provenance',
});

function sameMaterialDirection(values) {
  const signs = new Set(values.map(toPence).filter(Boolean).map(Math.sign));
  return signs.size <= 1;
}

function belowInDirection(forecast, floor) {
  const floorPence = toPence(floor);
  if (floorPence > 0) return toPence(forecast) < floorPence;
  if (floorPence < 0) return toPence(forecast) > floorPence;
  return false;
}

function directionalEnvelope(values) {
  const pence = values.map(toPence);
  const material = pence.filter(Boolean);
  if (!material.length) return 0;
  if (!sameMaterialDirection(values)) return null;
  return fromPence(material[0] > 0 ? Math.max(...pence) : Math.min(...pence));
}

function unique(values) {
  return [...new Set(values)];
}

function calculateVariationExposure({
  item,
  packageCostCode,
  allocations = [],
  substitutions = [],
  lockedAssessments = [],
} = {}) {
  const exceptions = [];
  const itemCostCode = String(item?.costCode || '').trim();
  const canonicalPackageCostCode = String(packageCostCode || '').trim();
  if (!itemCostCode || !canonicalPackageCostCode || itemCostCode.toLowerCase() !== canonicalPackageCostCode.toLowerCase()) {
    exceptions.push(EXCEPTIONS.COST_CODE_MAPPING_AMBIGUOUS);
  }

  const incompleteAllocation = allocations.some((allocation) =>
    !allocation?.id || !allocation?.sourceType || allocation.allocatedAmount == null ||
    !allocation.sourceReference || !allocation.sourceStatus
  );
  const incompleteAssessment = lockedAssessments.some((assessment) =>
    !assessment?.id || !assessment?.certificateId || assessment.currentAssessment == null || !assessment.lockedAt
  );
  const allocationIds = new Set(allocations.map((allocation) => allocation?.id).filter(Boolean));
  const incompleteSubstitution = substitutions.some((substitution) =>
    !substitution?.id || substitution.substitutedAmount == null ||
    !allocationIds.has(substitution.predecessorAllocationId) ||
    !allocationIds.has(substitution.successorAllocationId)
  );
  if (!item?.id || item?.qsForecast == null || incompleteAllocation || incompleteAssessment || incompleteSubstitution) {
    exceptions.push(EXCEPTIONS.INCOMPLETE_SOURCE_PROVENANCE);
  }

  const projection = buildProjection({
    item: { id: item?.id, reference: item?.reference, qsForecast: item?.qsForecast },
    allocations,
    substitutions,
  });
  const forecastPence = toPence(item?.qsForecast);
  const recognisedPence = toPence(projection.effectiveRecognisedAuthority);
  const certifiedPence = lockedAssessments.reduce(
    (sum, assessment) => sum + toPence(assessment.currentAssessment),
    0
  );
  const facts = [forecastPence, recognisedPence, certifiedPence].map(fromPence);
  const opposingSigns = !sameMaterialDirection(facts);
  if (opposingSigns) exceptions.push(EXCEPTIONS.OPPOSING_SIGN_EXPOSURE);

  if (!opposingSigns && belowInDirection(fromPence(forecastPence), fromPence(recognisedPence))) {
    exceptions.push(EXCEPTIONS.FORECAST_BELOW_RECOGNISED_AUTHORITY);
  }
  if (!opposingSigns && belowInDirection(fromPence(forecastPence), fromPence(certifiedPence))) {
    exceptions.push(EXCEPTIONS.FORECAST_BELOW_LOCKED_CERTIFICATION);
    exceptions.push(EXCEPTIONS.CERTIFIED_ABOVE_FORECAST);
  }

  const cannotCalculate = opposingSigns || exceptions.includes(EXCEPTIONS.COST_CODE_MAPPING_AMBIGUOUS) ||
    exceptions.includes(EXCEPTIONS.INCOMPLETE_SOURCE_PROVENANCE);
  const effectiveExposure = cannotCalculate ? null : directionalEnvelope(facts);
  const effectiveById = new Map(projection.allocations.map((entry) => [entry.id, entry]));
  const authorityInCurrentContractPence = allocations.reduce((sum, allocation) => {
    if (!['commercial_event', 'variation_order_line'].includes(allocation.sourceType)) return sum;
    if (allocation.representedInCurrentContract === false) return sum;
    return sum + toPence(effectiveById.get(allocation.id)?.effectiveAmount);
  }, 0);

  return {
    calculationVersion: CALCULATION_VERSION,
    ready: !cannotCalculate,
    variationAccountItemId: item?.id || null,
    reference: item?.reference || null,
    status: item?.status || null,
    itemVersion: item?.version == null ? null : Number(item.version),
    developmentId: item?.developmentId || null,
    packageId: item?.packageId || null,
    costCode: itemCostCode || null,
    contractorValue: item?.contractorValue == null ? null : fromPence(toPence(item.contractorValue)),
    contractorClaim: item?.contractorClaim == null ? null : fromPence(toPence(item.contractorClaim)),
    qsForecast: fromPence(forecastPence),
    effectiveRecognisedAuthority: fromPence(recognisedPence),
    cumulativeLockedCertification: fromPence(certifiedPence),
    effectiveVaExposure: effectiveExposure,
    authorityAlreadyInCurrentContract: fromPence(authorityInCurrentContractPence),
    vaExposureUplift: effectiveExposure == null
      ? null
      : fromPence(toPence(effectiveExposure) - authorityInCurrentContractPence),
    remainingForecastExposure: effectiveExposure == null
      ? null
      : fromPence(toPence(effectiveExposure) - recognisedPence),
    authorityComposition: {
      effectiveCommercialEvent: projection.effectiveCeAuthority,
      effectiveVariationOrder: projection.effectiveVoAuthority,
      effectivePaymentAuthority: projection.effectivePaymentAuthority,
    },
    exceptions: unique(exceptions),
    sourceVersions: {
      variationAccountItemVersion: item?.version == null ? null : Number(item.version),
      allocationIds: allocations.map((entry) => entry.id),
      substitutionIds: substitutions.map((entry) => entry.id),
      lockedAssessmentIds: lockedAssessments.map((entry) => entry.id),
    },
    provenance: { allocations, substitutions, lockedAssessments },
  };
}

async function loadVariationExposureFacts(db, clientId, developmentId) {
  const { rows: itemRows } = await db.query(`
    SELECT va.*, p.cost_code AS package_cost_code
      FROM package_variation_account_items va
      JOIN packages p ON p.id=va.package_id AND p.client_id=va.client_id
     WHERE va.client_id=$1 AND va.development_id=$2 AND va.status<>'withdrawn'
     ORDER BY va.package_id,va.created_at,va.id`, [clientId, developmentId]);
  if (!itemRows.length) return [];
  const ids = itemRows.map((row) => row.id);
  const [{ rows: allocationRows }, { rows: substitutionRows }, { rows: assessmentRows }, { rows: claimRows }, { rows: supersededCeRows }] = await Promise.all([
    db.query(`SELECT * FROM package_variation_account_authority_allocations WHERE client_id=$1 AND variation_account_item_id=ANY($2::uuid[]) ORDER BY created_at,id`, [clientId, ids]),
    db.query(`SELECT * FROM package_variation_account_authority_substitutions WHERE client_id=$1 AND variation_account_item_id=ANY($2::uuid[]) ORDER BY created_at,id`, [clientId, ids]),
    db.query(`SELECT id,certificate_id,variation_account_item_id,application_variation_line_id,signed_current_assessment,previous_certified_at_lock,cumulative_certified_at_lock,source_authority_snapshot,locked_at,locked_by_user_id,version FROM package_variation_account_certificate_assessments WHERE client_id=$1 AND variation_account_item_id=ANY($2::uuid[]) AND status='locked' ORDER BY locked_at,id`, [clientId, ids]),
    db.query(`SELECT l.variation_account_item_id,COALESCE(SUM(l.current_claim),0) contractor_claim
      FROM subcontract_payment_application_variation_lines l
      JOIN subcontract_payment_applications app ON app.id=l.application_id AND app.client_id=l.client_id
     WHERE l.client_id=$1 AND l.variation_account_item_id=ANY($2::uuid[])
       AND l.reconciliation_state='matched' AND app.status='recorded'
     GROUP BY l.variation_account_item_id`, [clientId, ids]),
    db.query(`SELECT DISTINCT link.commercial_event_id
      FROM variation_order_line_commercial_event_allocations link
      JOIN variation_order_lines line ON line.id=link.variation_order_line_id AND line.client_id=link.client_id
      JOIN variation_orders vo ON vo.id=line.variation_order_id AND vo.client_id=line.client_id
     WHERE link.client_id=$1 AND vo.development_id=$2 AND vo.status='issued'`, [clientId, developmentId]),
  ]);
  const group = (rows, key) => rows.reduce((map, row) => {
    const id = row[key];
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(row);
    return map;
  }, new Map());
  const allocationsByItem = group(allocationRows, 'variation_account_item_id');
  const substitutionsByItem = group(substitutionRows, 'variation_account_item_id');
  const assessmentsByItem = group(assessmentRows, 'variation_account_item_id');
  const claims = new Map(claimRows.map((row) => [row.variation_account_item_id, row.contractor_claim]));
  const supersededCeIds = new Set(supersededCeRows.map((row) => String(row.commercial_event_id)));

  return itemRows.map((row) => calculateVariationExposure({
    item: {
      id: row.id,
      reference: row.variation_reference,
      status: row.status,
      version: row.version,
      developmentId: row.development_id,
      packageId: row.package_id,
      costCode: row.cost_code,
      contractorValue: row.current_contractor_value,
      contractorClaim: claims.get(row.id) ?? null,
      qsForecast: row.current_qs_forecast,
    },
    packageCostCode: row.package_cost_code,
    allocations: (allocationsByItem.get(row.id) || []).map((allocationRow) => ({
      ...mapAllocation(allocationRow),
      representedInCurrentContract: allocationRow.source_type !== 'commercial_event' ||
        !supersededCeIds.has(String(allocationRow.commercial_event_id)),
    })),
    substitutions: (substitutionsByItem.get(row.id) || []).map(mapSubstitution),
    lockedAssessments: (assessmentsByItem.get(row.id) || []).map((assessment) => ({
      id: assessment.id,
      certificateId: assessment.certificate_id,
      applicationVariationLineId: assessment.application_variation_line_id,
      currentAssessment: Number(assessment.signed_current_assessment),
      previousCertifiedAtLock: Number(assessment.previous_certified_at_lock),
      cumulativeCertifiedAtLock: Number(assessment.cumulative_certified_at_lock),
      sourceAuthoritySnapshot: assessment.source_authority_snapshot,
      lockedAt: assessment.locked_at,
      lockedByUserId: assessment.locked_by_user_id,
      version: Number(assessment.version),
    })),
  }));
}

module.exports = {
  CALCULATION_VERSION,
  EXCEPTIONS,
  calculateVariationExposure,
  directionalEnvelope,
  loadVariationExposureFacts,
};
