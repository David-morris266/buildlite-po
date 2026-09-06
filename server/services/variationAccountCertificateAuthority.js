const { query } = require('../db');
const {
  buildProjection,
  mapAllocation,
  mapSubstitution,
  toPence,
  fromPence,
} = require('./variationAccountAuthorityRepository');

const run = (db, sql, params) => db ? db.query(sql, params) : query(sql, params);

function directionalPence(value, direction) {
  const pence = toPence(value);
  return Math.sign(pence) === direction ? Math.abs(pence) : 0;
}

function classifyVariationAssessmentAuthority({ assessment, projection, paymentAuthorityByAssessment = new Map(), priorSupportByAllocation = new Map() }) {
  const currentPence = toPence(assessment.currentAssessment);
  if (!currentPence) return { priorAuthority: 0, unapprovedAmount: 0, supportingSources: [] };
  const direction = Math.sign(currentPence);
  const previousMagnitude = directionalPence(assessment.previousCertified, direction);
  const priorPaymentAuthorityMagnitude = [...paymentAuthorityByAssessment.entries()]
    .filter(([assessmentId]) => assessmentId !== assessment.id)
    .reduce((sum, [, value]) => sum + directionalPence(value, direction), 0);
  const generalPence = toPence(projection.effectiveCeAuthority) + toPence(projection.effectiveVoAuthority);
  const generalMagnitude = Math.sign(generalPence) === direction ? Math.abs(generalPence) : 0;
  const priorGeneralConsumption = Math.max(0, previousMagnitude - Math.min(previousMagnitude, priorPaymentAuthorityMagnitude));
  const availableMagnitude = Math.max(0, generalMagnitude - priorGeneralConsumption);
  const supportedMagnitude = Math.min(Math.abs(currentPence), availableMagnitude);
  const supportedPence = direction * supportedMagnitude;
  const unapprovedPence = currentPence - supportedPence;

  let remaining = supportedMagnitude;
  const explicitPriorSupport = [...priorSupportByAllocation.values()].reduce((sum, value) => sum + directionalPence(value, direction), 0);
  let priorToConsume = Math.max(0, Math.min(generalMagnitude, priorGeneralConsumption) - Math.min(priorGeneralConsumption, explicitPriorSupport));
  let effectivePoolRemaining = generalMagnitude;
  const supportingSources = [];
  const candidates = (projection.allocations || [])
    .filter(item => ['commercial_event', 'variation_order_line'].includes(item.sourceType))
    .filter(item => directionalPence(item.effectiveAmount, direction) > 0)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id).localeCompare(String(b.id)));
  for (const source of candidates) {
    if (!remaining || !effectivePoolRemaining) break;
    let sourceAvailable = Math.min(effectivePoolRemaining, directionalPence(source.effectiveAmount, direction));
    effectivePoolRemaining -= sourceAvailable;
    sourceAvailable = Math.max(0, sourceAvailable - directionalPence(priorSupportByAllocation.get(source.id), direction));
    const priorApplied = Math.min(priorToConsume, sourceAvailable);
    priorToConsume -= priorApplied;
    sourceAvailable -= priorApplied;
    const applied = Math.min(remaining, sourceAvailable);
    if (!applied) continue;
    supportingSources.push({
      allocationId: source.id,
      sourceType: source.sourceType,
      sourceReference: source.sourceReference || null,
      effectiveAmount: fromPence(toPence(source.effectiveAmount)),
      appliedAmount: fromPence(direction * applied),
    });
    remaining -= applied;
  }

  return {
    calculationVersion: 'va_certificate_authority_v1',
    effectiveRecognisedAuthority: projection.effectiveRecognisedAuthority,
    effectiveCeAuthority: projection.effectiveCeAuthority,
    effectiveVoAuthority: projection.effectiveVoAuthority,
    effectivePaymentAuthority: projection.effectivePaymentAuthority,
    previousCertified: fromPence(toPence(assessment.previousCertified)),
    priorAssessmentPaymentAuthority: fromPence(direction * Math.min(previousMagnitude, priorPaymentAuthorityMagnitude)),
    priorGeneralAuthorityConsumption: fromPence(direction * Math.min(generalMagnitude, priorGeneralConsumption)),
    priorRecordedSupportUsages: [...priorSupportByAllocation.entries()].map(([allocationId, amount]) => ({ allocationId, amount: fromPence(toPence(amount)) })),
    authorityAvailableBeforeAssessment: fromPence(direction * availableMagnitude),
    priorAuthority: fromPence(supportedPence),
    unapprovedAmount: fromPence(unapprovedPence),
    supportingSources,
    projectionSourceIds: {
      allocationIds: (projection.allocations || []).map(item => item.id),
      substitutionIds: (projection.substitutions || []).map(item => item.id),
    },
    opposingSignAuthority: Boolean(generalPence && Math.sign(generalPence) !== direction),
  };
}

async function loadVariationAssessmentAuthority(clientId, packageId, certificateId, assessments, db = null) {
  if (!(assessments || []).length) return new Map();
  const itemIds = [...new Set(assessments.map(item => item.variationAccountItemId))];
  const [itemsResult, allocationsResult, substitutionsResult, priorAssessmentsResult, supportUsagesResult] = await Promise.all([
    run(db, `SELECT id,variation_reference,current_qs_forecast FROM package_variation_account_items WHERE client_id=$1 AND package_id=$2 AND id=ANY($3::uuid[])`, [clientId, packageId, itemIds]),
    run(db, `SELECT a.*,l.assessment_id payment_authority_assessment_id
      FROM package_variation_account_authority_allocations a
      LEFT JOIN payment_authority_decision_lines l ON l.client_id=a.client_id AND l.id=a.payment_authority_decision_line_id
      WHERE a.client_id=$1 AND a.package_id=$2 AND a.variation_account_item_id=ANY($3::uuid[])
      ORDER BY a.created_at,a.id`, [clientId, packageId, itemIds]),
    run(db, `SELECT * FROM package_variation_account_authority_substitutions WHERE client_id=$1 AND package_id=$2 AND variation_account_item_id=ANY($3::uuid[]) ORDER BY created_at,id`, [clientId, packageId, itemIds]),
    run(db, `SELECT a.id,a.variation_account_item_id
      FROM package_variation_account_certificate_assessments a
      JOIN package_payment_certificates prior ON prior.client_id=a.client_id AND prior.id=a.certificate_id
      JOIN package_payment_certificates current ON current.client_id=a.client_id AND current.id=$3
      WHERE a.client_id=$1 AND a.package_id=$2 AND a.variation_account_item_id=ANY($4::uuid[])
        AND a.status='locked' AND prior.certificate_number<current.certificate_number`, [clientId, packageId, certificateId, itemIds]),
    run(db, `SELECT l.variation_account_item_id,u.authority_allocation_id,u.signed_applied_amount,l.assessment_id
      FROM payment_authority_support_usages u
      JOIN payment_authority_decision_lines l ON l.client_id=u.client_id AND l.id=u.decision_line_id
      WHERE u.client_id=$1 AND l.package_id=$2 AND l.variation_account_item_id=ANY($3::uuid[])`, [clientId, packageId, itemIds]),
  ]);
  const byItem = values => values.reduce((map, value) => {
    const key = value.variation_account_item_id;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
    return map;
  }, new Map());
  const allocationsByItem = byItem(allocationsResult.rows);
  const substitutionsByItem = byItem(substitutionsResult.rows);
  const priorIds = new Set(priorAssessmentsResult.rows.map(row => row.id));
  const items = new Map(itemsResult.rows.map(row => [row.id, row]));
  const result = new Map();
  for (const assessment of assessments) {
    const rows = allocationsByItem.get(assessment.variationAccountItemId) || [];
    const allocations = rows.map(mapAllocation);
    const projection = buildProjection({
      item: {
        id: assessment.variationAccountItemId,
        reference: items.get(assessment.variationAccountItemId)?.variation_reference,
        qsForecast: Number(items.get(assessment.variationAccountItemId)?.current_qs_forecast || 0),
      },
      allocations,
      substitutions: (substitutionsByItem.get(assessment.variationAccountItemId) || []).map(mapSubstitution),
    });
    const effectiveById = new Map(projection.allocations.map(item => [item.id, item.effectiveAmount]));
    const paymentAuthorityByAssessment = new Map();
    for (const row of rows.filter(row => row.source_type === 'payment_authority' && priorIds.has(row.payment_authority_assessment_id))) {
      const amount = effectiveById.get(row.id) || 0;
      paymentAuthorityByAssessment.set(row.payment_authority_assessment_id, fromPence(toPence(paymentAuthorityByAssessment.get(row.payment_authority_assessment_id) || 0) + toPence(amount)));
    }
    const priorSupportByAllocation = new Map();
    for (const usage of supportUsagesResult.rows.filter(row => row.variation_account_item_id === assessment.variationAccountItemId && priorIds.has(row.assessment_id))) {
      priorSupportByAllocation.set(usage.authority_allocation_id, fromPence(toPence(priorSupportByAllocation.get(usage.authority_allocation_id) || 0) + toPence(usage.signed_applied_amount)));
    }
    result.set(assessment.id, classifyVariationAssessmentAuthority({ assessment, projection, paymentAuthorityByAssessment, priorSupportByAllocation }));
  }
  return result;
}

module.exports = { classifyVariationAssessmentAuthority, loadVariationAssessmentAuthority };
