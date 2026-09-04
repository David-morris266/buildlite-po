const { CANONICAL_JSON_SHA256_V1, hashCanonicalJson, verifyJsonIntegrity } = require('./canonicalJsonIntegrity');
const { CALCULATION_VERSION, loadVariationExposureFacts } = require('./cvrVariationExposure');

const BLOCKING_EXCEPTIONS = new Set([
  'opposing_sign_exposure',
  'cost_code_mapping_ambiguous',
  'incomplete_source_provenance',
]);
const ACKNOWLEDGEABLE_EXCEPTIONS = new Set([
  'forecast_below_recognised_authority',
  'forecast_below_locked_certification',
  'certified_above_forecast',
]);

function acknowledgementRequirements(document) {
  return (document?.items || []).flatMap((item) => (item.exceptions || [])
    .filter((code) => ACKNOWLEDGEABLE_EXCEPTIONS.has(code))
    .map((code) => {
      const floor = code === 'forecast_below_recognised_authority'
        ? item.effectiveRecognisedAuthority
        : item.cumulativeLockedCertification;
      return {
        exceptionCode: code,
        variationAccountItemId: item.variationAccountItemId,
        reference: item.reference,
        qsForecast: Number(item.qsForecast),
        effectiveFloor: Number(floor),
        variance: Math.round((Number(floor) - Number(item.qsForecast)) * 100) / 100,
      };
    }));
}

async function listAcknowledgements(db, clientId, submissionId) {
  const { rows } = await db.query(`SELECT * FROM cvr_variation_exposure_acknowledgements
    WHERE client_id=$1 AND submission_id=$2 ORDER BY acknowledged_at,id`, [clientId, submissionId]);
  return rows.map((row) => ({
    id: row.id, exceptionCode: row.exception_code,
    variationAccountItemId: row.variation_account_item_id, reference: row.variation_reference,
    qsForecast: Number(row.qs_forecast), effectiveFloor: Number(row.effective_floor),
    variance: Number(row.variance), reason: row.reason || '',
    acknowledgedByUserId: row.acknowledged_by_user_id, membershipId: row.membership_id,
    roleKey: row.role_key, providerUserId: row.provider_user_id,
    acknowledgedAt: row.acknowledged_at instanceof Date ? row.acknowledged_at.toISOString() : row.acknowledged_at,
  }));
}

async function appendAcknowledgement(db, { clientId, developmentId, periodId, requirement, reason, auth }) {
  const submitted = await latestSubmittedVariationExposure(db, clientId, periodId);
  if (!submitted) return { ok: false, status: 409, message: 'This CVR has no submitted Variation exposure attempt.' };
  const required = acknowledgementRequirements(submitted.source_snapshot).find((entry) =>
    entry.variationAccountItemId === requirement.variationAccountItemId && entry.exceptionCode === requirement.exceptionCode);
  if (!required) return { ok: false, status: 409, message: 'This exception is not acknowledgeable for the current submitted attempt.' };
  const { rows } = await db.query(`INSERT INTO cvr_variation_exposure_acknowledgements
    (client_id,development_id,period_id,submission_id,variation_account_item_id,exception_code,variation_reference,qs_forecast,effective_floor,variance,reason,acknowledged_by_user_id,membership_id,role_key,provider_user_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    ON CONFLICT(client_id,submission_id,variation_account_item_id,exception_code) DO NOTHING RETURNING *`,
  [clientId,developmentId,periodId,submitted.id,required.variationAccountItemId,required.exceptionCode,required.reference,required.qsForecast,required.effectiveFloor,required.variance,String(reason||'').trim()||null,auth.userId,auth.membershipId,auth.roleKey,auth.providerUserId]);
  if (!rows[0]) return { ok: false, status: 409, message: 'This exception has already been acknowledged.' };
  return { ok: true, acknowledgement: (await listAcknowledgements(db, clientId, submitted.id)).find((entry) => entry.id === rows[0].id) };
}

function snapshotDocument(items) {
  // PostgreSQL JSONB stores JSON values, not JavaScript Date instances. Normalize
  // before hashing so the digest is reproducible from the persisted document.
  return JSON.parse(JSON.stringify({
    calculationVersion: CALCULATION_VERSION,
    items: [...(items || [])].sort((a, b) => String(a.variationAccountItemId).localeCompare(String(b.variationAccountItemId))),
  }));
}

function blockingExceptions(document) {
  return (document?.items || []).flatMap((item) =>
    (item.exceptions || []).filter((code) => BLOCKING_EXCEPTIONS.has(code)).map((code) => ({
      source: 'variationAccount',
      variationAccountItemId: item.variationAccountItemId,
      reference: item.reference,
      reason: code,
    }))
  );
}

async function buildLiveVariationExposure(db, clientId, developmentId, loadFacts = loadVariationExposureFacts) {
  const document = snapshotDocument(await loadFacts(db, clientId, developmentId));
  return {
    document,
    hashScheme: CANONICAL_JSON_SHA256_V1,
    hash: hashCanonicalJson(document),
    blockers: blockingExceptions(document),
  };
}

async function appendSubmittedVariationExposure(db, { clientId, developmentId, periodId, actor, loadFacts }) {
  const live = await buildLiveVariationExposure(db, clientId, developmentId, loadFacts);
  if (live.blockers.length) return { ok: false, blockers: live.blockers, live };
  const attempt = Number((await db.query(`SELECT COALESCE(MAX(attempt_number),0)+1 attempt FROM cvr_period_variation_exposure_submissions WHERE client_id=$1 AND period_id=$2`, [clientId, periodId])).rows[0].attempt);
  const row = (await db.query(`INSERT INTO cvr_period_variation_exposure_submissions
    (client_id,development_id,period_id,attempt_number,calculation_version,source_snapshot,source_snapshot_hash_scheme,source_snapshot_sha256,captured_by)
    VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9) RETURNING *`, [clientId, developmentId, periodId, attempt, CALCULATION_VERSION, JSON.stringify(live.document), live.hashScheme, live.hash, actor || null])).rows[0];
  return { ok: true, row, live };
}

async function latestSubmittedVariationExposure(db, clientId, periodId) {
  return (await db.query(`SELECT * FROM cvr_period_variation_exposure_submissions WHERE client_id=$1 AND period_id=$2 ORDER BY attempt_number DESC LIMIT 1`, [clientId, periodId])).rows[0] || null;
}

async function compareSubmittedVariationExposure(db, { clientId, developmentId, periodId, loadFacts }) {
  const submitted = await latestSubmittedVariationExposure(db, clientId, periodId);
  if (!submitted) return { captured: false, legacy: true, stale: false, staleReasons: [] };
  const live = await buildLiveVariationExposure(db, clientId, developmentId, loadFacts);
  const integrity = verifyJsonIntegrity(submitted.source_snapshot, submitted.source_snapshot_sha256, submitted.source_snapshot_hash_scheme);
  const staleReasons = [];
  if (!integrity.valid) staleReasons.push('submitted_snapshot_integrity_invalid');
  if (submitted.calculation_version !== CALCULATION_VERSION) staleReasons.push('calculation_version_changed');
  if (live.hash !== submitted.source_snapshot_sha256) staleReasons.push('variation_exposure_sources_changed');
  staleReasons.push(...live.blockers.map((blocker) => blocker.reason));
  return { captured: true, legacy: false, stale: staleReasons.length > 0, staleReasons: [...new Set(staleReasons)], submitted, live, integrity };
}

module.exports = {
  BLOCKING_EXCEPTIONS,
  ACKNOWLEDGEABLE_EXCEPTIONS,
  acknowledgementRequirements,
  listAcknowledgements,
  appendAcknowledgement,
  snapshotDocument,
  blockingExceptions,
  buildLiveVariationExposure,
  appendSubmittedVariationExposure,
  latestSubmittedVariationExposure,
  compareSubmittedVariationExposure,
};
