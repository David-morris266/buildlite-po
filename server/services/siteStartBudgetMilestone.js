const { PERMISSIONS } = require('../auth/permissions');
const { CANONICAL_JSON_SHA256_V1, hashCanonicalJson } = require('./canonicalJsonIntegrity');

function text(value) { return String(value ?? '').trim(); }
function pence(value) { return Math.round(Number(value || 0) * 100); }
function dateOnly(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function actor(auth) {
  return [auth.userId, auth.membershipId, auth.providerUserId, auth.displayName, auth.roleKey, PERMISSIONS.CVR_LOCK];
}

function commercialHeads(rows) {
  const totals = new Map();
  for (const row of rows || []) {
    const key = text(row.commercialHead) || 'Unallocated';
    totals.set(key, (totals.get(key) || 0) + pence(row.finalForecast));
  }
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([commercialHead, efcPence]) => ({ commercialHead, efcPence }));
}

function exposureIdentity(item) {
  const ceId = item?.commercialEvent?.id || item?.va?.sourceCommercialEventId;
  if (ceId) return `ce:${ceId}`;
  const vaId = item?.va?.variationAccountItemId;
  return vaId ? `va:${vaId}` : null;
}

function absorbedChangeExposure(rows) {
  const entries = [];
  for (const row of rows || []) {
    for (const item of row.changeExposureEvidence || []) {
      const identity = exposureIdentity(item);
      if (!identity) continue;
      entries.push({
        identity,
        costCodeKey: row.costCodeKey,
        amountPence: pence(item.resultingExposure),
        commercialEventId: item?.commercialEvent?.id || item?.va?.sourceCommercialEventId || null,
        variationAccountItemId: item?.va?.variationAccountItemId || null,
      });
    }
  }
  return entries.sort((a, b) => a.identity.localeCompare(b.identity));
}

async function createV2SiteStartMilestone(db, {
  clientId, developmentId, periodRow, persistedSnapshot, appraisal, approvalReference, approvalReason, auth,
}) {
  if (periodRow.period_type !== 'site_start') return null;
  const reference = text(approvalReference);
  const reason = text(approvalReason);
  if (!reference) throw Object.assign(new Error('An approval reference is required to approve and lock Site Start.'), { status: 400 });
  if (!reason) throw Object.assign(new Error('An approval reason is required to approve and lock Site Start.'), { status: 400 });
  if (!appraisal?.id || appraisal.integrity?.valid !== true) throw new Error('Verified Land Purchase Appraisal authority is required to lock Site Start.');
  const approvedAt = new Date().toISOString();
  const budgetEventFrontier = Number((await db.query(
    'SELECT COALESCE(MAX(sequence_number),0) AS sequence_number FROM development_budget_events WHERE client_id=$1 AND development_id=$2',
    [clientId, developmentId]
  )).rows[0].sequence_number);
  const rows = (persistedSnapshot?.rows || []).map((row) => ({
    costCodeKey: row.costCodeKey,
    costCodeLabel: row.costCodeLabel,
    description: row.description || '',
    commercialHead: row.commercialHead || '',
    efcPence: pence(row.finalForecast),
    systemForecastPence: pence(row.systemForecast),
    expectedLiabilityPence: pence(row.expectedLiability),
    changeExposurePence: pence(row.changeExposure),
    projectedAdjustmentPence: pence(row.commercialAdjustment),
    adjustmentReason: row.adjustmentReason || '',
    adjustmentHistory: row.adjustmentHistory || [],
    currentCostPence: pence(row.currentCost),
    committedPence: pence(row.committed),
    actualCostPence: pence(row.actualCost),
  }));
  const evidence = {
    schemaVersion: 'site_start_budget_milestone_v2',
    clientId,
    developmentId,
    period: { id: periodRow.id, key: periodRow.period_key, type: periodRow.period_type, forecastAsAtMonth: dateOnly(periodRow.forecast_as_at_month) },
    landAppraisal: { id: appraisal.id, reference: appraisal.reference, evidenceSha256: appraisal.evidenceSha256 },
    snapshot: {
      id: persistedSnapshot.id,
      schemaVersion: persistedSnapshot.schemaVersion,
      rows,
      totalEfcPence: rows.reduce((sum, row) => sum + row.efcPence, 0),
      commercialHeads: commercialHeads(persistedSnapshot.rows),
      sourceReadiness: persistedSnapshot.sourceReadiness,
      commentary: persistedSnapshot.commentary,
      variationExposure: persistedSnapshot.variationExposure,
      absorbedChangeExposure: absorbedChangeExposure(persistedSnapshot.rows),
      developmentBudgetEventFrontier: budgetEventFrontier,
      revenue: {
        forecastRevenuePence: pence(persistedSnapshot.forecastRevenue),
        securedRevenuePence: pence(persistedSnapshot.securedRevenue),
        grossProfitPence: pence(persistedSnapshot.grossProfit),
        grossMarginPercent: persistedSnapshot.grossMarginPercent,
        assumptions: persistedSnapshot.revenueAssumptions,
      },
    },
    approval: { reference, reason, approvedAt, userId: auth.userId, membershipId: auth.membershipId, displayName: auth.displayName, roleKey: auth.roleKey },
  };
  const canonicalEvidence = JSON.parse(JSON.stringify(evidence));
  const digest = hashCanonicalJson(canonicalEvidence);
  const inserted = await db.query(
    `INSERT INTO development_budget_milestones(
       client_id,development_id,milestone_type,opening_budget_event_id,approved_effective_date,
       reference,approval_reason,evidence_snapshot,evidence_hash_scheme,evidence_sha256,
       created_by_user_id,created_by_membership_id,created_by_provider_user_id,created_by_display_name,
       created_role_key,created_permission_key,authority_version,site_start_period_id,site_start_snapshot_id,land_appraisal_id,created_at
     ) VALUES($1,$2,'site_start_budget',NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,2,$15,$16,$17,$18) RETURNING id`,
    [clientId, developmentId, dateOnly(periodRow.forecast_as_at_month), reference, reason,
      JSON.stringify(canonicalEvidence), CANONICAL_JSON_SHA256_V1, digest, ...actor(auth), periodRow.id, persistedSnapshot.id, appraisal.id, approvedAt]
  );
  return { id: inserted.rows[0].id, evidence: canonicalEvidence, evidenceSha256: digest };
}

module.exports = { createV2SiteStartMilestone };
