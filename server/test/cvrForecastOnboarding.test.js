const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { pool } = require('../db');
const { prepareIntegrationTestDatabase } = require('./integrationTestSetup');
const budget = require('../services/developmentBudgetRepository');
const periods = require('../services/cvrPeriodRepository');
const service = require('../services/cvrForecastOnboardingService');
const { PERMISSIONS } = require('../auth/permissions');

let fixture;
const sourceEvidence = { fileName: 'Matt CVR.xlsx', worksheet: 'CVR Reconciliation', sha256: 'a'.repeat(64), targetEfcColumn: 'F', targetEfcHeading: 'ESO' };
test.before(async () => {
  await prepareIntegrationTestDatabase(pool);
  const client = (await pool.query("INSERT INTO clients(code,name,is_active) VALUES($1,'Forecast onboarding',false) RETURNING *", [`FORECAST_${randomUUID().slice(0, 8)}`])).rows[0];
  const user = (await pool.query("INSERT INTO buildlite_users(auth_provider,provider_user_id,email_snapshot,display_name,status) VALUES('clerk',$1,'forecast@test','Forecast QS','active') RETURNING *", [`forecast-${randomUUID()}`])).rows[0];
  const role = (await pool.query("SELECT id FROM roles WHERE key='qs'")).rows[0];
  const membership = (await pool.query('INSERT INTO client_user_memberships(client_id,user_id,role_id,is_active) VALUES($1,$2,$3,true) RETURNING *', [client.id, user.id, role.id])).rows[0];
  const auth = { userId: user.id, membershipId: membership.id, providerUserId: user.provider_user_id, displayName: user.display_name, roleKey: 'qs', permissions: [PERMISSIONS.COMMERCIAL_READ, PERMISSIONS.DEVELOPMENT_BUDGET_POST, PERMISSIONS.CVR_EDIT] };
  const codes = {};
  for (const [code, description] of [['1000', 'Land'], ['2000', 'Groundworks'], ['5003', 'Zero-value active code'], ['5403', 'Landscaping']]) codes[code] = (await pool.query('INSERT INTO cost_codes(client_id,code,description,is_active) VALUES($1,$2,$3,true) RETURNING *', [client.id, code, description])).rows[0];
  fixture = { client, auth, codes };
});
test.after(async () => pool.end());

async function draft(label = 'Forecast import') {
  const developmentId = `dev-${randomUUID()}`;
  await pool.query("INSERT INTO developments(id,client_id,job_number,development_name,status,payload) VALUES($1,$2,$3,$3,'live','{}')", [developmentId, fixture.client.id, label]);
  await budget.postEvent(fixture.client.id, developmentId, { eventType: 'opening_budget', effectiveDate: '2026-09-01', reference: `OPEN-${randomUUID()}`, reason: 'Opening budget', idempotencyKey: randomUUID(), lines: [{ costCodeId: fixture.codes['1000'].id, amount: '1000.00' }, { costCodeId: fixture.codes['2000'].id, amount: '2000.00' }] }, fixture.auth);
  await budget.confirmSiteStartBudget(fixture.client.id, developmentId, { approvedEffectiveDate: '2026-09-01', reference: 'SS', approvalReason: 'Approved' }, fixture.auth);
  const created = await periods.createCvrPeriod(fixture.client.id, developmentId, { reportingMonth: '2026-10' }, { actor: fixture.auth.displayName, currentDate: new Date('2026-10-20T12:00:00Z') });
  assert.equal(created.ok, true, created.message);
  return { developmentId, period: created.period };
}

test('Forecast onboarding previews and atomically reconciles exact Target EFC while preserving omitted Cost Codes', async () => {
  const item = await draft();
  const existing = await periods.createCostCodeInput(fixture.client.id, item.developmentId, item.period.id, { costCodeKey: '1000', commercialAdjustment: '50.00', adjustmentReason: 'Earlier QS view' }, { actor: fixture.auth.displayName, auth: fixture.auth });
  assert.equal(existing.ok, true, existing.message);
  const requested = { sourceEvidence, rows: [{ costCodeKey: '1000', targetEfc: '1234.56', rowNumber: 7, importedValue: '£1,234.56' }], excludedRows: [{ rowNumber: 15, costCode: '', description: 'Section subtotal', importedValue: '1,234.56', monetaryValue: '1234.56', reason: 'Explicitly excluded by QS: Financial value has no Cost Code', explicitlyExcluded: true }] };
  const previewed = await service.previewForecastOnboarding(fixture.client.id, item.developmentId, item.period.id, requested, { auth: fixture.auth });
  assert.equal(previewed.ok, true, previewed.message);
  assert.equal(previewed.preview.rows[0].systemForecast, 1000);
  assert.equal(previewed.preview.rows[0].requiredAdjustment, 234.56);
  assert.equal(previewed.preview.rows[0].replacesExistingAdjustment, true);
  assert.deepEqual(previewed.preview.totals, { actualCost: 0, commitments: 0, systemForecast: 1000, changeExposure: 0, currentEfc: 1050, targetEfc: 1234.56, movement: 184.56, requiredAdjustment: 234.56 });
  assert.deepEqual(previewed.preview.reconciliation, { completeMappedTarget: 1234.56, governedPreviewTarget: 1234.56, missingTargetValue: 0, exceptionalTargetValue: 0, exactlyReconciled: true });
  const applied = await service.applyForecastOnboarding(fixture.client.id, item.developmentId, item.period.id, { ...requested, previewFingerprint: previewed.preview.fingerprint, reason: 'Matt October CVR onboarding', confirmed: true }, { auth: fixture.auth });
  assert.equal(applied.ok, true, applied.message);
  assert.equal(applied.result.reconciled, true);
  const inputs = await periods.listCostCodeInputs(fixture.client.id, item.developmentId, item.period.id);
  assert.equal(inputs.inputs.find(row => row.costCodeKey === '1000').commercialAdjustment, 234.56);
  assert.equal(inputs.inputs.find(row => row.costCodeKey === '1000').adjustmentHistory.at(-1).source, 'forecast_onboarding_import');
  assert.equal(inputs.inputs.find(row => row.costCodeKey === '1000').adjustmentHistory.at(-1).previousAdjustment, 50);
  assert.equal(inputs.inputs.some(row => row.costCodeKey === '2000'), false, 'omitted governed Budget row is not mutated into an overlay');
  const audit = (await pool.query("SELECT actor,action,comment FROM cvr_period_audit WHERE period_id=$1 AND action='forecast_onboarding_imported'", [item.period.id])).rows[0];
  assert.equal(audit.actor, fixture.auth.displayName); assert.match(audit.comment, /Matt October CVR onboarding/);
  assert.match(audit.comment, /Matt CVR\.xlsx \/ CVR Reconciliation \/ F — ESO \/ sha256 a{64}/);
  assert.match(audit.comment, /excluded 1 row\(s\) \/ 1234\.56/);
  assert.deepEqual(applied.result.sourceEvidence, sourceEvidence);
  const repeatedPreview = await service.previewForecastOnboarding(fixture.client.id, item.developmentId, item.period.id, requested, { auth: fixture.auth });
  assert.equal(repeatedPreview.preview.rows[0].movement, 0);
});

test('Forecast onboarding previews and atomically creates missing active Draft memberships', async () => {
  const item = await draft('Missing active membership');
  const requested = { sourceEvidence, rows: [
    { costCodeKey: '5003', targetEfc: '0.00', rowNumber: 9, importedValue: '0' },
    { costCodeKey: '5403', targetEfc: '4540.00', rowNumber: 142, importedValue: '4540' },
  ] };
  const previewed = await service.previewForecastOnboarding(fixture.client.id, item.developmentId, item.period.id, requested, { auth: fixture.auth });
  assert.equal(previewed.ok, true, previewed.message);
  assert.equal(previewed.preview.canApply, true);
  assert.deepEqual(previewed.preview.rows.map(row => [row.costCodeKey, row.requiresMembershipCreation, row.systemForecast, row.targetEfc]), [
    ['5003', true, 0, 0], ['5403', true, 0, 4540],
  ]);
  assert.deepEqual(previewed.preview.reconciliation, { completeMappedTarget: 4540, governedPreviewTarget: 4540, missingTargetValue: 0, exceptionalTargetValue: 0, exactlyReconciled: true });
  const applied = await service.applyForecastOnboarding(fixture.client.id, item.developmentId, item.period.id, { ...requested, previewFingerprint: previewed.preview.fingerprint, reason: 'Add active workbook codes', confirmed: true }, { auth: fixture.auth });
  assert.equal(applied.ok, true, applied.message);
  const inputs = await periods.listCostCodeInputs(fixture.client.id, item.developmentId, item.period.id);
  assert.equal(inputs.inputs.find(row => row.costCodeKey === '5003').commercialAdjustment, 0);
  assert.equal(inputs.inputs.find(row => row.costCodeKey === '5403').commercialAdjustment, 4540);
});

test('Forecast onboarding rejects malformed, duplicate, unknown and below-floor rows', async () => {
  assert.deepEqual(service.deriveForecastPence({ targetPence: 150000, systemForecast: 1000, changeExposure: 200, recognisedObligation: 900, currentAdjustment: 0, currentEfc: 1200 }), {
    systemPence: 100000, changePence: 20000, recognisedPence: 90000, currentAdjustmentPence: 0, currentEfcPence: 120000, floorPence: 110000, requiredAdjustmentPence: 30000,
  });
  assert.equal(service.parseRows({ rows: [{ costCodeKey: '1000', targetEfc: '1.001' }] }).code, service.ERROR.INVALID_ROW);
  assert.equal(service.parseRows({ rows: [{ costCodeKey: '1000', targetEfc: '1' }, { costCodeKey: '1000', targetEfc: '2' }] }).code, service.ERROR.DUPLICATE_CODE);
  const item = await draft('Exceptions');
  const unknown = await service.previewForecastOnboarding(fixture.client.id, item.developmentId, item.period.id, { sourceEvidence, rows: [{ costCodeKey: '9999', targetEfc: '1', rowNumber: 44, importedValue: '1.00' }] }, { auth: fixture.auth });
  assert.equal(unknown.code, service.ERROR.UNKNOWN_CODE);
  assert.deepEqual(unknown.unknownCodes[0], { costCodeKey: '9999', rowNumber: 44, importedValue: '1.00', reason: 'Cost Code is not active in this company Cost Code Master.' });
  const excludedActive = await service.previewForecastOnboarding(fixture.client.id, item.developmentId, item.period.id, { sourceEvidence, rows: [{ costCodeKey: '2000', targetEfc: '2000' }], excludedRows: [{ rowNumber: 7, costCode: '1000', description: 'Land', importedValue: '1,000', monetaryValue: 1000, reason: 'QS exclusion', explicitlyExcluded: true }] }, { auth: fixture.auth });
  assert.equal(excludedActive.ok, false); assert.equal(excludedActive.invalidRows[0].reason, 'Active recognised Cost Code cannot be excluded.');
  await pool.query("INSERT INTO ledger_transactions(client_id,development_id,transaction_date,cost_code_key,source_cost_code_key,resolved_cost_code_id,resolution_status,net_amount,supplier,reference,description,fingerprint,created_by) VALUES($1,$2,'2026-10-01','1000','1000',$3,'resolved',1500,'Test supplier','J1','Actual','forecast-floor-'||$2,'test')", [fixture.client.id, item.developmentId, fixture.codes['1000'].id]);
  await pool.query('INSERT INTO purchase_orders(po_number,payload,client_id) VALUES($1,$2,$3)', [`PO-${randomUUID()}`, { poNumber: 'PO-COMMIT', type: 'S', status: 'approved', supplierId: 'supplier-1', developmentId: item.developmentId, costRef: { developmentId: item.developmentId, costCode: '1000' }, subtotal: 1600 }, fixture.client.id]);
  const below = await service.previewForecastOnboarding(fixture.client.id, item.developmentId, item.period.id, { sourceEvidence, rows: [{ costCodeKey: '1000', targetEfc: '1599.99', rowNumber: 45, importedValue: '1,599.99' }] }, { auth: fixture.auth });
  assert.equal(below.ok, true); assert.equal(below.preview.canApply, false); assert.equal(below.preview.exceptions[0].reason, 'Target EFC is below the governed forecast floor.');
  assert.equal(below.preview.rows[0].actualCost, 1500);
  assert.equal(below.preview.rows[0].commitments, 1600);
  assert.equal(below.preview.totals.actualCost, 1500);
  assert.equal(below.preview.totals.commitments, 1600);
  assert.equal(below.preview.reconciliation.exceptionalTargetValue, 1599.99);
});

test('Forecast onboarding fails stale previews and rejects Submitted periods without partial writes', async () => {
  const item = await draft('Stale');
  const request = { sourceEvidence, rows: [{ costCodeKey: '1000', targetEfc: '1100' }] };
  const previewed = await service.previewForecastOnboarding(fixture.client.id, item.developmentId, item.period.id, request, { auth: fixture.auth });
  await budget.postEvent(fixture.client.id, item.developmentId, { eventType: 'addition', effectiveDate: '2026-10-02', reference: 'MOVE', reason: 'Changed evidence', idempotencyKey: randomUUID(), lines: [{ costCodeId: fixture.codes['1000'].id, amount: '1.00' }] }, fixture.auth);
  const stale = await service.applyForecastOnboarding(fixture.client.id, item.developmentId, item.period.id, { ...request, previewFingerprint: previewed.preview.fingerprint, reason: 'Stale attempt', confirmed: true }, { auth: fixture.auth });
  assert.equal(stale.code, service.ERROR.STALE_PREVIEW);
  assert.equal((await periods.listCostCodeInputs(fixture.client.id, item.developmentId, item.period.id)).inputs.length, 0);
  await pool.query("UPDATE cvr_periods SET status='submitted',submitted_at=NOW(),submitted_by='test' WHERE id=$1", [item.period.id]);
  const submitted = await service.previewForecastOnboarding(fixture.client.id, item.developmentId, item.period.id, request, { auth: fixture.auth });
  assert.equal(submitted.code, service.ERROR.PERIOD_NOT_DRAFT);
});

test('Forecast onboarding enforces permission and tenant/development scope', async () => {
  const item = await draft('Authority');
  await assert.rejects(service.previewForecastOnboarding(fixture.client.id, item.developmentId, item.period.id, { sourceEvidence, rows: [{ costCodeKey: '1000', targetEfc: '1000' }] }, { auth: { ...fixture.auth, permissions: [] } }), /cvr\.edit/);
  const other = (await pool.query("INSERT INTO clients(code,name,is_active) VALUES($1,'Other',false) RETURNING *", [`OTHER_${randomUUID().slice(0, 8)}`])).rows[0];
  const scoped = await service.previewForecastOnboarding(other.id, item.developmentId, item.period.id, { sourceEvidence, rows: [{ costCodeKey: '1000', targetEfc: '1000' }] }, { auth: fixture.auth });
  assert.equal(scoped.status, 404);
});
