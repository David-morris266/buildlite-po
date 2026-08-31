const { calculatePaymentDeadlines, CALCULATION_VERSION } = require('./paymentRulesV1');
const { snapshotForPackage } = require('./subcontractTermsRepository');
const { loadActiveApplicationForCertificate, mapRow: mapApplicationRow } = require('./paymentApplicationRepository');
const { query } = require('../db');

function runner(db) { return db || { query }; }

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  // PostgreSQL DATE values are local calendar facts, not UTC instants.
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function cycleInputs(row, application) {
  return {
    applicationReceivedAt: application?.receivedAt || null,
    applicationValuationDate: application?.valuationDate || null,
    certificateDate: dateOnly(row.certificate_date),
    contractualValuationDate: dateOnly(row.contractual_valuation_date),
  };
}

function mapSnapshot(row) {
  if (!row) return null;
  return {
    id: row.id,
    state: row.stage,
    attemptNumber: Number(row.attempt_number),
    certificateVersion: Number(row.certificate_version),
    readiness: row.readiness,
    calculationStatus: row.calculation_status,
    calculationVersion: row.calculation_version,
    rulesSchemaVersion: row.rules_schema_version == null ? null : Number(row.rules_schema_version),
    termsVersionId: row.terms_version_id || null,
    applicationId: row.application_id || null,
    applicationRevisionNumber: row.application_revision_number == null ? null : Number(row.application_revision_number),
    resolvedAnchor: row.anchor_type ? { type: row.anchor_type, value: dateOnly(row.anchor_value), sourceField: row.anchor_type } : null,
    contractualValuationDate: dateOnly(row.contractual_valuation_date),
    dates: row.due_date ? {
      dueDate: dateOnly(row.due_date),
      paymentNoticeDeadline: dateOnly(row.payment_notice_deadline),
      finalDateForPayment: dateOnly(row.final_date_for_payment),
      payLessNoticeDeadline: dateOnly(row.pay_less_notice_deadline),
    } : null,
    governingTermsSnapshot: row.governing_terms_snapshot || {},
    applicationSnapshot: row.application_snapshot || null,
    cycleInputs: row.cycle_inputs || {},
    reasons: Array.isArray(row.reasons) ? row.reasons : [],
    capturedBy: row.captured_by || null,
    capturedAt: row.captured_at ? new Date(row.captured_at).toISOString() : null,
  };
}

async function loadApplication(db, clientId, packageId, certificateId, { forUpdate = false } = {}) {
  const row = await loadActiveApplicationForCertificate(clientId, packageId, certificateId, db, { forUpdate });
  return row ? { row, document: await mapApplicationRow(clientId, row, null, db) } : { row: null, document: null };
}

async function composeLiveTimetable(db, clientId, packageId, certificateRow, frozen = null) {
  const terms = frozen?.terms || await snapshotForPackage(clientId, packageId, db);
  const applicationState = frozen?.applicationState || await loadApplication(db, clientId, packageId, certificateRow.id);
  const inputs = cycleInputs(certificateRow, applicationState.document);
  const result = calculatePaymentDeadlines({ rulesSnapshot: terms, cycleInputs: inputs });
  return {
    state: 'live',
    ...result,
    governingTermsSnapshot: terms,
    applicationSnapshot: applicationState.document ? {
      id: applicationState.document.id,
      revisionNumber: applicationState.document.revisionNumber,
      applicationReference: applicationState.document.applicationReference,
      receivedAt: applicationState.document.receivedAt,
      valuationDate: applicationState.document.valuationDate,
    } : null,
    cycleInputs: inputs,
    capturedAt: null,
  };
}

async function latestSnapshot(db, clientId, certificateId, stage) {
  const { rows } = await runner(db).query(`SELECT * FROM package_payment_certificate_deadline_snapshots
    WHERE client_id=$1 AND certificate_id=$2 AND stage=$3
    ORDER BY attempt_number DESC LIMIT 1`, [clientId, certificateId, stage]);
  return rows[0] || null;
}

async function timetableForRead(db, clientId, packageId, row) {
  if (row.status === 'draft') return composeLiveTimetable(db, clientId, packageId, row);
  const stage = row.status === 'locked' ? 'locked' : 'submission';
  const snapshot = await latestSnapshot(db, clientId, row.id, stage);
  if (snapshot) return mapSnapshot(snapshot);
  return { state: 'not_captured', readiness: 'not_captured', calculationStatus: 'unavailable', calculationVersion: CALCULATION_VERSION, reasons: ['Payment timetable was not captured for this historic certificate.'], dates: null, capturedAt: null };
}

async function insertSubmissionSnapshot(db, { clientId, packageId, developmentId, certificateRow, actor, terms, applicationState }) {
  const timetable = await composeLiveTimetable(db, clientId, packageId, certificateRow, { terms, applicationState });
  const { rows: attempts } = await db.query(`SELECT COALESCE(MAX(attempt_number),0)+1 AS next
    FROM package_payment_certificate_deadline_snapshots WHERE client_id=$1 AND certificate_id=$2 AND stage='submission'`, [clientId, certificateRow.id]);
  return insertSnapshot(db, { clientId, packageId, developmentId, certificateRow, actor, timetable, stage: 'submission', attemptNumber: Number(attempts[0].next) });
}

async function insertSnapshot(db, { clientId, packageId, developmentId, certificateRow, actor, timetable, stage, attemptNumber }) {
  const terms = timetable.governingTermsSnapshot || {};
  const app = timetable.applicationSnapshot;
  const dates = timetable.dates || {};
  const anchor = timetable.resolvedAnchor || {};
  const { rows } = await db.query(`INSERT INTO package_payment_certificate_deadline_snapshots(
    client_id,certificate_id,package_id,development_id,stage,attempt_number,certificate_version,
    readiness,calculation_status,calculation_version,rules_schema_version,terms_version_id,
    application_id,application_revision_number,anchor_type,anchor_value,contractual_valuation_date,
    due_date,payment_notice_deadline,final_date_for_payment,pay_less_notice_deadline,
    governing_terms_snapshot,application_snapshot,cycle_inputs,reasons,captured_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,$23::jsonb,$24::jsonb,$25::jsonb,$26)
    RETURNING *`, [clientId,certificateRow.id,packageId,developmentId,stage,attemptNumber,Number(certificateRow.version)+1,
      timetable.readiness,timetable.status || timetable.calculationStatus,timetable.calculationVersion,timetable.rulesSchemaVersion,
      terms.termsVersionId||null,app?.id||null,app?.revisionNumber||null,anchor.type||null,anchor.value||null,
      dateOnly(certificateRow.contractual_valuation_date),dates.dueDate||null,dates.paymentNoticeDeadline||null,
      dates.finalDateForPayment||null,dates.payLessNoticeDeadline||null,JSON.stringify(terms),app?JSON.stringify(app):null,
      JSON.stringify(timetable.cycleInputs||{}),JSON.stringify(timetable.reasons||[]),actor||null]);
  return mapSnapshot(rows[0]);
}

async function copyLatestSubmissionToLocked(db, { clientId, packageId, developmentId, certificateRow, actor }) {
  const source = await latestSnapshot(db, clientId, certificateRow.id, 'submission');
  if (!source) {
    return insertSnapshot(db, { clientId, packageId, developmentId, certificateRow, actor, stage:'locked', attemptNumber:1,
      timetable:{readiness:'not_captured',status:'unavailable',calculationVersion:CALCULATION_VERSION,rulesSchemaVersion:null,
        governingTermsSnapshot:{},applicationSnapshot:null,cycleInputs:{},reasons:['Submitted payment timetable was not captured for this pre-feature certificate.'],dates:null,resolvedAnchor:null} });
  }
  const timetable = mapSnapshot(source);
  return insertSnapshot(db, { clientId, packageId, developmentId, certificateRow, actor, timetable:{...timetable,status:timetable.calculationStatus}, stage:'locked', attemptNumber:timetable.attemptNumber });
}

async function hasSubmissionHistory(db, clientId, certificateId) {
  const { rows } = await runner(db).query(`SELECT (
    EXISTS(SELECT 1 FROM package_payment_certificate_deadline_snapshots WHERE client_id=$1 AND certificate_id=$2 AND stage='submission')
    OR EXISTS(SELECT 1 FROM package_payment_certificate_audit WHERE client_id=$1 AND certificate_id=$2 AND action='submitted')
  ) AS found`, [clientId, certificateId]);
  return Boolean(rows[0]?.found);
}

module.exports = { composeLiveTimetable, timetableForRead, insertSubmissionSnapshot, copyLatestSubmissionToLocked, hasSubmissionHistory, mapSnapshot, loadApplication, dateOnly };
