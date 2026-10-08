const { CANONICAL_JSON_SHA256_V1, hashCanonicalJson, verifyJsonIntegrity } = require('./canonicalJsonIntegrity');
const { getSnapshotForPeriod } = require('./cvrSnapshotRepository');

function pence(value) { return Math.round(Number(value || 0) * 100); }

async function authority(db, clientId, developmentId, sourceSnapshotId) {
  const milestone = (await db.query(`SELECT * FROM development_budget_milestones
    WHERE client_id=$1 AND development_id=$2 AND authority_version=2
      AND site_start_snapshot_id=$3 AND milestone_type='site_start_budget'`,
  [clientId, developmentId, sourceSnapshotId])).rows[0];
  if (!milestone || !verifyJsonIntegrity(milestone.evidence_snapshot, milestone.evidence_sha256, milestone.evidence_hash_scheme).valid) {
    const error = new Error('Approved Site Start Budget authority could not be verified.');
    error.status = 409; error.code = 'SITE_START_BUDGET_AUTHORITY_UNAVAILABLE'; throw error;
  }
  const snapshot = await getSnapshotForPeriod(clientId, milestone.site_start_period_id, db);
  if (!snapshot || snapshot.id !== sourceSnapshotId) {
    const error = new Error('Approved Site Start snapshot is unavailable.');
    error.status = 409; error.code = 'SITE_START_BUDGET_AUTHORITY_UNAVAILABLE'; throw error;
  }
  const frontier = Number(milestone.evidence_snapshot?.snapshot?.developmentBudgetEventFrontier);
  if (!Number.isInteger(frontier) || frontier < 0) {
    const error = new Error('Approved Site Start Budget has no verified Development Budget movement frontier.');
    error.status = 409; error.code = 'SITE_START_BUDGET_AUTHORITY_UNAVAILABLE'; throw error;
  }
  return { milestone, snapshot, frontier };
}

async function liveDocument(db, clientId, developmentId, sourceSnapshotId) {
  const { milestone, snapshot, frontier } = await authority(db, clientId, developmentId, sourceSnapshotId);
  const positions = new Map((snapshot.rows || []).map((row) => [String(row.costCodeKey).toLowerCase(), {
    costCodeId: row.displayMetadata?.commercialHierarchy?.costCodeId || null,
    costCode: row.costCodeKey, description: row.description || '',
    originalPence: pence(row.finalForecast), currentPence: pence(row.finalForecast),
  }]));
  const movements = (await db.query(`SELECT e.sequence_number,c.id cost_code_id,c.code,c.description,l.signed_amount
    FROM development_budget_events e
    JOIN development_budget_event_lines l ON l.event_id=e.id AND l.client_id=e.client_id
    JOIN cost_codes c ON c.id=l.cost_code_id AND c.client_id=l.client_id
    WHERE e.client_id=$1 AND e.development_id=$2 AND e.sequence_number>$3
    ORDER BY e.sequence_number,l.line_number`, [clientId, developmentId, frontier])).rows;
  for (const movement of movements) {
    const key = String(movement.code).toLowerCase();
    const position = positions.get(key) || { costCodeId: movement.cost_code_id, costCode: movement.code, description: movement.description || '', originalPence: 0, currentPence: 0 };
    position.currentPence += pence(movement.signed_amount);
    positions.set(key, position);
  }
  return JSON.parse(JSON.stringify({
    schemaVersion: 'cvr_site_start_budget_source_v1',
    siteStartMilestoneId: milestone.id,
    siteStartPeriodId: milestone.site_start_period_id,
    siteStartSnapshotId: sourceSnapshotId,
    siteStartSnapshotSchemaVersion: snapshot.schemaVersion,
    milestoneEvidenceSha256: milestone.evidence_sha256,
    developmentBudgetEventFrontier: frontier,
    developmentBudgetCurrentFrontier: movements.length ? Number(movements.at(-1).sequence_number) : frontier,
    absorbedChangeExposure: milestone.evidence_snapshot?.snapshot?.absorbedChangeExposure || [],
    positions: [...positions.values()].sort((a, b) => String(a.costCode).localeCompare(String(b.costCode))),
  }));
}

async function appendSubmission(db, { clientId, developmentId, periodId, sourceSnapshotId, actor }) {
  const document = await liveDocument(db, clientId, developmentId, sourceSnapshotId);
  const attempt = Number((await db.query('SELECT COALESCE(MAX(attempt_number),0)+1 n FROM cvr_period_budget_submissions WHERE client_id=$1 AND period_id=$2', [clientId, periodId])).rows[0].n);
  const hash = hashCanonicalJson(document);
  const row = (await db.query(`INSERT INTO cvr_period_budget_submissions(client_id,development_id,period_id,attempt_number,source_snapshot,source_snapshot_hash_scheme,source_snapshot_sha256,captured_by)
    VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8) RETURNING *`, [clientId, developmentId, periodId, attempt, JSON.stringify(document), CANONICAL_JSON_SHA256_V1, hash, actor || null])).rows[0];
  return { ok: true, row, document, hash };
}

async function compare(db, { clientId, developmentId, periodId, sourceSnapshotId }) {
  const submitted = (await db.query('SELECT * FROM cvr_period_budget_submissions WHERE client_id=$1 AND period_id=$2 ORDER BY attempt_number DESC LIMIT 1', [clientId, periodId])).rows[0];
  if (!submitted) return { captured: false, stale: false, reasons: [] };
  const live = await liveDocument(db, clientId, developmentId, sourceSnapshotId);
  const integrity = verifyJsonIntegrity(submitted.source_snapshot, submitted.source_snapshot_sha256, submitted.source_snapshot_hash_scheme);
  const reasons = [];
  if (!integrity.valid) reasons.push('submitted_site_start_budget_integrity_invalid');
  if (hashCanonicalJson(live) !== submitted.source_snapshot_sha256) reasons.push('site_start_budget_sources_changed');
  return { captured: true, stale: reasons.length > 0, reasons, submitted, live, integrity };
}

module.exports = { authority, liveDocument, appendSubmission, compare };
