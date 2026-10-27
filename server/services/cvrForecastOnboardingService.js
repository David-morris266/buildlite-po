const { randomUUID } = require('crypto');
const { pool } = require('../db');
const { assertServicePermission } = require('../auth/authorization');
const { PERMISSIONS } = require('../auth/permissions');
const { hashCanonicalJson } = require('./canonicalJsonIntegrity');
const { buildCvrCloseCandidate } = require('./cvrCloseEngine');
const { buildLiveVariationExposure } = require('./cvrVariationExposureSnapshot');
const hierarchy = require('./cvrCommercialHierarchySnapshot');
const { addDraftCvrCostCodeMember } = require('./cvrMembershipService');
const {
  getCvrPeriod,
  findPeriodRow,
  insertAudit,
  updateCostCodeInputCommercialFields,
} = require('./cvrPeriodRepository');
const { normaliseCostCodeKey } = require('./cvrPeriodValidation');
const { CVR_PERIOD_STATUSES, CVR_PERIOD_TYPES, isValidUuid } = require('./cvrPeriodConstants');

const SCHEMA_VERSION = 'cvr_forecast_onboarding_preview_v2';
const ERROR = Object.freeze({
  ROWS_REQUIRED: 'CVR_FORECAST_ROWS_REQUIRED',
  INVALID_ROW: 'CVR_FORECAST_INVALID_ROW',
  DUPLICATE_CODE: 'CVR_FORECAST_DUPLICATE_CODE',
  UNKNOWN_CODE: 'CVR_FORECAST_UNKNOWN_CODE',
  PERIOD_NOT_DRAFT: 'CVR_FORECAST_PERIOD_NOT_DRAFT',
  PERIOD_NOT_MONTHLY: 'CVR_FORECAST_PERIOD_NOT_MONTHLY',
  CLOSE_NOT_READY: 'CVR_FORECAST_CLOSE_NOT_READY',
  BELOW_FLOOR: 'CVR_FORECAST_BELOW_FLOOR',
  STALE_PREVIEW: 'CVR_FORECAST_STALE_PREVIEW',
  REASON_REQUIRED: 'CVR_FORECAST_REASON_REQUIRED',
  CONFIRMATION_REQUIRED: 'CVR_FORECAST_CONFIRMATION_REQUIRED',
  RECONCILIATION_FAILED: 'CVR_FORECAST_RECONCILIATION_FAILED',
});

const fail = (status, code, message, extra = {}) => ({ ok: false, status, code, message, ...extra });
const keyOf = value => normaliseCostCodeKey(value) || String(value || '').trim().toLowerCase();
const pounds = pence => Number(pence) / 100;

function exactPence(value) {
  const text = String(value ?? '').trim().replace(/,/g, '');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const negative = text.startsWith('-');
  const [whole, decimal = ''] = text.replace('-', '').split('.');
  const result = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  if (!Number.isSafeInteger(result)) return null;
  return negative ? -result : result;
}

function parseRows(body = {}) {
  if (!Array.isArray(body.rows) || !body.rows.length) {
    return fail(400, ERROR.ROWS_REQUIRED, 'At least one Cost Code and Target EFC row is required.');
  }
  const rows = [];
  const seen = new Map();
  const invalidRows = [];
  const duplicateCodes = [];
  body.rows.forEach((source, index) => {
    const sourceRowNumber = Number.isInteger(Number(source?.rowNumber)) && Number(source.rowNumber) > 0 ? Number(source.rowNumber) : index + 1;
    const costCode = String(source?.costCodeKey || source?.costCode || '').trim();
    const key = keyOf(costCode);
    const targetPence = exactPence(source?.targetEfc);
    if (!key || targetPence == null || targetPence < 0) {
      invalidRows.push({ rowNumber: sourceRowNumber, costCode, importedValue: source?.importedValue ?? source?.targetEfc ?? '', reason: !key ? 'Cost Code is required.' : 'Target EFC must be a non-negative amount with no more than two decimal places.' });
      return;
    }
    if (seen.has(key)) {
      duplicateCodes.push({ costCode, rowNumbers: [seen.get(key), sourceRowNumber] });
      return;
    }
    seen.set(key, sourceRowNumber);
    rows.push({ costCode, key, targetPence, rowNumber: sourceRowNumber, importedValue: source?.importedValue ?? source?.targetEfc ?? '' });
  });
  if (duplicateCodes.length) return fail(409, ERROR.DUPLICATE_CODE, 'Forecast import contains duplicate Cost Codes.', { duplicateCodes });
  if (invalidRows.length) return fail(400, ERROR.INVALID_ROW, invalidRows[0].reason, { invalidRows });
  return { ok: true, rows };
}

function parseSourceEvidence(body = {}) {
  const source = body.sourceEvidence || {};
  const fileName = String(source.fileName || '').trim();
  const worksheet = String(source.worksheet || '').trim();
  const sha256 = String(source.sha256 || '').trim().toLowerCase();
  if (!fileName || !worksheet || !/^[0-9a-f]{64}$/.test(sha256)) {
    return fail(400, ERROR.INVALID_ROW, 'Valid source filename, worksheet and SHA-256 fingerprint are required.');
  }
  const targetEfcColumn = String(source.targetEfcColumn || '').trim();
  const targetEfcHeading = String(source.targetEfcHeading || '').trim();
  if (!/^[A-Z]{1,3}$/.test(targetEfcColumn) || !targetEfcHeading) return fail(400, ERROR.INVALID_ROW, 'The reviewed Target EFC column identity is required.');
  return { ok: true, source: { fileName: fileName.slice(0, 255), worksheet: worksheet.slice(0, 255), sha256, targetEfcColumn, targetEfcHeading: targetEfcHeading.slice(0, 255) } };
}

function parseExcludedRows(body = {}) {
  if (!Array.isArray(body.excludedRows)) return { ok: true, rows: [] };
  const rows = [];
  for (const source of body.excludedRows) {
    const rowNumber = Number(source?.rowNumber);
    const monetaryPence = source?.monetaryValue == null ? null : exactPence(source.monetaryValue);
    if (!Number.isInteger(rowNumber) || rowNumber <= 0 || !String(source?.reason || '').trim() || (source?.monetaryValue != null && monetaryPence == null)) {
      return fail(400, ERROR.INVALID_ROW, 'Excluded-row evidence is incomplete or invalid.');
    }
    rows.push({ rowNumber, costCode: String(source.costCode || '').trim(), description: String(source.description || '').trim(), importedValue: String(source.importedValue ?? ''), monetaryPence, reason: String(source.reason).trim(), explicitlyExcluded: source.explicitlyExcluded === true });
  }
  return { ok: true, rows };
}

function deriveForecastPence({ targetPence, systemForecast, changeExposure, recognisedObligation, currentAdjustment, currentEfc }) {
  const systemPence = exactPence(systemForecast) ?? 0;
  const changePence = exactPence(changeExposure) ?? 0;
  const recognisedPence = exactPence(recognisedObligation) ?? 0;
  const currentAdjustmentPence = exactPence(currentAdjustment) ?? 0;
  const currentEfcPence = exactPence(currentEfc) ?? 0;
  return {
    systemPence,
    changePence,
    recognisedPence,
    currentAdjustmentPence,
    currentEfcPence,
    floorPence: recognisedPence + changePence,
    requiredAdjustmentPence: targetPence - systemPence - changePence,
  };
}

async function governedCandidate(db, clientId, developmentId, periodId) {
  const periodResult = await getCvrPeriod(clientId, developmentId, periodId, db);
  if (!periodResult.ok) return periodResult;
  const variation = await buildLiveVariationExposure(db, clientId, developmentId);
  if (variation.blockers.length) return fail(409, ERROR.CLOSE_NOT_READY, 'Current Change Exposure evidence is not ready.', { exceptions: variation.blockers });
  const hierarchyDocument = await hierarchy.liveDocument(db, clientId);
  const period = periodResult.period;
  const candidate = await buildCvrCloseCandidate({
    clientId,
    developmentId,
    periodId,
    dbClient: db,
    variationExposureDocument: variation.document,
    developmentBudgetDocument: period.budgetSource?.document || null,
    commercialHierarchyDocument: hierarchyDocument,
  });
  if (!candidate?.ready || !candidate?.complete || !candidate?.snapshot) {
    return fail(409, ERROR.CLOSE_NOT_READY, 'The live governed CVR is not ready for Forecast onboarding.', { blockers: candidate?.blockers || [] });
  }
  return { ok: true, period, candidate, variation, hierarchyDocument };
}

function previewEvidence({ clientId, developmentId, periodId, governed, targets, inputVersions, sourceEvidence, excludedRows }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    clientId,
    developmentId,
    periodId,
    periodVersion: governed.period.version,
    budgetSourceMode: governed.period.budgetSourceMode,
    budgetSource: governed.period.budgetSource?.document || null,
    variationExposure: governed.variation.document,
    commercialHierarchy: governed.hierarchyDocument,
    targets: targets.map(row => ({ costCodeKey: row.key, targetPence: row.targetPence })),
    sourceEvidence,
    excludedRows,
    inputVersions,
    closeRows: governed.candidate.snapshot.rows,
  };
}

async function buildPreview(db, clientId, developmentId, periodId, requestedRows, sourceEvidence, excludedRows) {
  const periodRow = await findPeriodRow(clientId, developmentId, periodId, db, { forUpdate: false });
  if (!periodRow) return fail(404, 'CVR_PERIOD_NOT_FOUND', 'CVR period not found.');
  if ((periodRow.period_type || CVR_PERIOD_TYPES.monthly) !== CVR_PERIOD_TYPES.monthly) return fail(409, ERROR.PERIOD_NOT_MONTHLY, 'Forecast onboarding is available only for monthly CVRs.');
  if (periodRow.status !== CVR_PERIOD_STATUSES.draft) return fail(409, ERROR.PERIOD_NOT_DRAFT, 'Forecast onboarding is available only while the monthly CVR is Draft.', { periodStatus: periodRow.status });

  const masterRows = (await db.query('SELECT code,description,is_active FROM cost_codes WHERE client_id=$1', [clientId])).rows;
  const masterByKey = new Map(masterRows.map(row => [keyOf(row.code), row]));
  const prohibitedExclusions = excludedRows.filter(row => row.costCode && masterByKey.get(keyOf(row.costCode))?.is_active !== false && masterByKey.has(keyOf(row.costCode)));
  if (prohibitedExclusions.length) return fail(400, ERROR.INVALID_ROW, 'An active recognised Cost Code cannot be excluded from Forecast onboarding.', { invalidRows: prohibitedExclusions.map(row => ({ ...row, reason: 'Active recognised Cost Code cannot be excluded.' })) });
  const unknownCodes = requestedRows.filter(row => !masterByKey.get(row.key) || masterByKey.get(row.key).is_active === false)
    .map(row => ({ costCodeKey: row.costCode, rowNumber: row.rowNumber, importedValue: row.importedValue, reason: 'Cost Code is not active in this company Cost Code Master.' }));
  if (unknownCodes.length) return fail(400, ERROR.UNKNOWN_CODE, 'Every imported Cost Code must be active in this company Cost Code Master.', { unknownCodes });

  const governed = await governedCandidate(db, clientId, developmentId, periodId);
  if (!governed.ok) return governed;
  const closeByKey = new Map(governed.candidate.snapshot.rows.map(row => [keyOf(row.costCodeKey), row]));
  const inputRows = (await db.query('SELECT id,cost_code_key,version,display_metadata FROM cvr_cost_code_inputs WHERE client_id=$1 AND period_id=$2 ORDER BY cost_code_key', [clientId, periodId])).rows;
  const inputByKey = new Map(inputRows.map(row => [keyOf(row.cost_code_key), row]));
  const exceptions = [];
  const rows = requestedRows.map(requested => {
    const current = closeByKey.get(requested.key);
    if (!current) {
      exceptions.push({ costCodeKey: requested.costCode, rowNumber: requested.rowNumber, importedValue: requested.importedValue, reason: 'Cost Code is not represented in the live governed CVR.' });
      return null;
    }
    const { systemPence, changePence, currentAdjustmentPence, currentEfcPence, floorPence, requiredAdjustmentPence } = deriveForecastPence({
      targetPence: requested.targetPence,
      systemForecast: current.systemForecast,
      changeExposure: current.changeExposure,
      recognisedObligation: current.recognisedObligation,
      currentAdjustment: current.commercialAdjustment,
      currentEfc: current.finalForecast,
    });
    if (requested.targetPence < floorPence) exceptions.push({ costCodeKey: requested.costCode, rowNumber: requested.rowNumber, importedValue: requested.importedValue, reason: 'Target EFC is below the governed forecast floor.', targetEfc: pounds(requested.targetPence), minimumEfc: pounds(floorPence) });
    const input = inputByKey.get(requested.key);
    return {
      costCodeKey: current.costCodeKey,
      description: current.description || masterByKey.get(requested.key)?.description || '',
      currentEfc: pounds(currentEfcPence),
      targetEfc: pounds(requested.targetPence),
      movement: pounds(requested.targetPence - currentEfcPence),
      systemForecast: pounds(systemPence),
      changeExposure: pounds(changePence),
      minimumEfc: pounds(floorPence),
      currentAdjustment: pounds(currentAdjustmentPence),
      requiredAdjustment: pounds(requiredAdjustmentPence),
      replacesExistingAdjustment: currentAdjustmentPence !== requiredAdjustmentPence && currentAdjustmentPence !== 0,
      inputId: input?.id || null,
      inputVersion: input?.version == null ? null : Number(input.version),
    };
  }).filter(Boolean);
  const inputVersions = inputRows.map(row => ({ costCodeKey: keyOf(row.cost_code_key), id: row.id, version: Number(row.version) }));
  const evidence = previewEvidence({ clientId, developmentId, periodId, governed, targets: requestedRows, inputVersions, sourceEvidence, excludedRows });
  const totals = rows.reduce((sum, row) => ({
    currentEfc: sum.currentEfc + exactPence(row.currentEfc),
    targetEfc: sum.targetEfc + exactPence(row.targetEfc),
    movement: sum.movement + exactPence(row.movement),
    requiredAdjustment: sum.requiredAdjustment + exactPence(row.requiredAdjustment),
  }), { currentEfc: 0, targetEfc: 0, movement: 0, requiredAdjustment: 0 });
  return {
    ok: true,
    preview: {
      schemaVersion: SCHEMA_VERSION,
      fingerprint: hashCanonicalJson(evidence),
      periodId,
      periodVersion: governed.period.version,
      sourceEvidence,
      excludedRows: excludedRows.map(row => ({ ...row, monetaryValue: row.monetaryPence == null ? null : pounds(row.monetaryPence) })),
      excludedMonetaryTotal: pounds(excludedRows.reduce((sum, row) => sum + (row.monetaryPence || 0), 0)),
      rows,
      exceptions,
      canApply: rows.length > 0 && exceptions.length === 0,
      totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, pounds(value)])),
    },
    governed,
  };
}

async function previewForecastOnboarding(clientId, developmentId, periodId, body = {}, { auth } = {}) {
  assertServicePermission(auth, PERMISSIONS.CVR_EDIT);
  if (!isValidUuid(periodId)) return fail(400, 'CVR_PERIOD_ID_INVALID', 'periodId must be a valid UUID.');
  const parsed = parseRows(body);
  if (!parsed.ok) return parsed;
  const source = parseSourceEvidence(body);
  if (!source.ok) return source;
  const excluded = parseExcludedRows(body);
  if (!excluded.ok) return excluded;
  const built = await buildPreview(pool, clientId, developmentId, periodId, parsed.rows, source.source, excluded.rows);
  return built.ok ? { ok: true, preview: built.preview } : built;
}

async function applyForecastOnboarding(clientId, developmentId, periodId, body = {}, { auth } = {}) {
  assertServicePermission(auth, PERMISSIONS.CVR_EDIT);
  if (!isValidUuid(periodId)) return fail(400, 'CVR_PERIOD_ID_INVALID', 'periodId must be a valid UUID.');
  const parsed = parseRows(body);
  if (!parsed.ok) return parsed;
  const source = parseSourceEvidence(body);
  if (!source.ok) return source;
  const excluded = parseExcludedRows(body);
  if (!excluded.ok) return excluded;
  const reason = String(body.reason || '').trim();
  if (!reason) return fail(400, ERROR.REASON_REQUIRED, 'A commercial reason is required for Forecast onboarding.');
  if (body.confirmed !== true) return fail(400, ERROR.CONFIRMATION_REQUIRED, 'Explicit confirmation is required before Forecast onboarding is applied.');
  if (!/^[0-9a-f]{64}$/.test(String(body.previewFingerprint || ''))) return fail(400, ERROR.STALE_PREVIEW, 'A valid reviewed preview fingerprint is required.');
  const actor = auth?.displayName || null;
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))`, [clientId, developmentId]);
    const locked = await findPeriodRow(clientId, developmentId, periodId, db, { forUpdate: true });
    if (!locked) { await db.query('ROLLBACK'); return fail(404, 'CVR_PERIOD_NOT_FOUND', 'CVR period not found.'); }
    const rebuilt = await buildPreview(db, clientId, developmentId, periodId, parsed.rows, source.source, excluded.rows);
    if (!rebuilt.ok) { await db.query('ROLLBACK'); return rebuilt; }
    if (rebuilt.preview.fingerprint !== body.previewFingerprint) {
      await db.query('ROLLBACK');
      return fail(409, ERROR.STALE_PREVIEW, 'The governed CVR evidence changed after preview. Generate and review a fresh preview.', { preview: rebuilt.preview });
    }
    if (!rebuilt.preview.canApply) { await db.query('ROLLBACK'); return fail(409, ERROR.BELOW_FLOOR, 'Forecast onboarding contains exceptions and cannot be applied.', { preview: rebuilt.preview, exceptions: rebuilt.preview.exceptions }); }

    const batchId = randomUUID();
    const lockedInputs = (await db.query('SELECT * FROM cvr_cost_code_inputs WHERE client_id=$1 AND period_id=$2 FOR UPDATE', [clientId, periodId])).rows;
    const lockedInputByKey = new Map(lockedInputs.map(input => [keyOf(input.cost_code_key), input]));
    for (const row of rebuilt.preview.rows) {
      let input = lockedInputByKey.get(keyOf(row.costCodeKey));
      if (!input) {
        const added = await addDraftCvrCostCodeMember(clientId, developmentId, periodId, { costCodeKey: row.costCodeKey }, { actor, auth, dbClient: db });
        if (!added.ok) { await db.query('ROLLBACK'); return added; }
        input = (await db.query('SELECT * FROM cvr_cost_code_inputs WHERE id=$1 AND client_id=$2 FOR UPDATE', [added.input.id, clientId])).rows[0];
        lockedInputByKey.set(keyOf(row.costCodeKey), input);
      }
      const metadata = input.display_metadata && typeof input.display_metadata === 'object' ? { ...input.display_metadata } : {};
      if (exactPence(input.commercial_adjustment) === exactPence(row.requiredAdjustment) && String(input.adjustment_reason || '') === reason) continue;
      const history = Array.isArray(metadata.adjustmentHistory) ? metadata.adjustmentHistory : [];
      metadata.adjustmentHistory = [...history, {
        id: `forecast-onboarding-${batchId}-${row.costCodeKey}`,
        source: 'forecast_onboarding_import',
        batchId,
        previousAdjustment: Number(input.commercial_adjustment || 0),
        newAdjustment: row.requiredAdjustment,
        previousReason: input.adjustment_reason || '',
        newReason: reason,
        reason,
        actor,
        timestamp: new Date().toISOString(),
        targetEfc: row.targetEfc,
        sourceEvidence: source.source,
        excludedRows: excluded.rows,
        previewFingerprint: body.previewFingerprint,
      }];
      const updated = await updateCostCodeInputCommercialFields(db, {
        clientId,
        inputId: input.id,
        expectedVersion: Number(input.version),
        commercialAdjustment: row.requiredAdjustment,
        adjustmentReason: reason,
        displayMetadata: metadata,
        actor,
      });
      if (!updated.ok) { await db.query('ROLLBACK'); return updated; }
    }

    const after = await governedCandidate(db, clientId, developmentId, periodId);
    if (!after.ok) { await db.query('ROLLBACK'); return after; }
    const afterByKey = new Map(after.candidate.snapshot.rows.map(row => [keyOf(row.costCodeKey), row]));
    const discrepancies = rebuilt.preview.rows.filter(row => exactPence(afterByKey.get(keyOf(row.costCodeKey))?.finalForecast) !== exactPence(row.targetEfc))
      .map(row => ({ costCodeKey: row.costCodeKey, targetEfc: row.targetEfc, actualEfc: afterByKey.get(keyOf(row.costCodeKey))?.finalForecast ?? null }));
    if (discrepancies.length) { await db.query('ROLLBACK'); return fail(409, ERROR.RECONCILIATION_FAILED, 'Applied adjustments did not reconcile exactly to the reviewed Target EFC values.', { discrepancies }); }
    await insertAudit(db, {
      clientId,
      periodId,
      action: 'forecast_onboarding_imported',
      actor,
      comment: `Forecast onboarding ${batchId}: ${rebuilt.preview.rows.length} Cost Code(s); excluded ${excluded.rows.length} row(s) / ${pounds(excluded.rows.reduce((sum, row) => sum + (row.monetaryPence || 0), 0))}; reason: ${reason}; source ${source.source.fileName} / ${source.source.worksheet} / ${source.source.targetEfcColumn} — ${source.source.targetEfcHeading} / sha256 ${source.source.sha256}; excluded evidence ${JSON.stringify(excluded.rows)}; preview ${body.previewFingerprint}`,
      priorStatus: CVR_PERIOD_STATUSES.draft,
      newStatus: CVR_PERIOD_STATUSES.draft,
    });
    await db.query('COMMIT');
    return { ok: true, result: { batchId, importedCount: rebuilt.preview.rows.length, previewFingerprint: body.previewFingerprint, sourceEvidence: source.source, reason, rows: rebuilt.preview.rows, totals: rebuilt.preview.totals, reconciled: true } };
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch { /* connection may have failed */ }
    throw error;
  } finally {
    db.release();
  }
}

module.exports = { ERROR, SCHEMA_VERSION, exactPence, parseRows, parseSourceEvidence, parseExcludedRows, deriveForecastPence, previewForecastOnboarding, applyForecastOnboarding };
