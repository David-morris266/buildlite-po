const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  CVR_PERIOD_TYPES,
  SITE_START_PERIOD_KEY,
  nextPeriodKey,
  periodOrdinal,
  comparePeriods,
} = require('../services/cvrPeriodConstants');
const { validatePatchPeriodBody } = require('../services/cvrPeriodValidation');
const { pool, isDbConfigured } = require('../db');
const { prepareIntegrationTestDatabase } = require('./integrationTestSetup');
const { randomUUID } = require('node:crypto');
const { PERMISSIONS } = require('../auth/permissions');
const { captureLandAppraisal, getLandAppraisalAuthority, lineSetMatchesEvidence } = require('../services/landAppraisalRepository');
const {
  createSiteStartPeriod,
  createFirstCvrFromSiteStart,
  createCvrPeriod,
  patchCvrPeriod,
  submitCvrPeriod,
  approveCvrPeriod,
} = require('../services/cvrPeriodRepository');
const { buildCvrCloseCandidate } = require('../services/cvrCloseEngine');
const { sourceOk } = require('../services/cvrCloseSources');
const { buildPrelimsAdoptionReviewPreview } = require('../services/prelimsAdoptionPreviewService');
const { adoptPrelimsForecasts } = require('../services/prelimsAdoptionApplyService');
const { postEvent } = require('../services/developmentBudgetRepository');
const { hashCanonicalJson, CANONICAL_JSON_SHA256_V1 } = require('../services/canonicalJsonIntegrity');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '067_site_start_period_foundation.sql'),
  'utf8'
);

test.after(async () => {
  if (isDbConfigured()) await pool.end();
});

test('Site Start is an explicit non-P-number identity ordered before P01', () => {
  assert.equal(CVR_PERIOD_TYPES.siteStart, 'site_start');
  assert.equal(SITE_START_PERIOD_KEY, 'SITE_START');
  assert.equal(periodOrdinal({ periodType: 'site_start', periodKey: 'SITE_START' }), 0);
  assert.equal(periodOrdinal('P01'), 1);
  assert.equal(nextPeriodKey(['SITE_START']), 'P01');
  assert.deepEqual(
    [{ periodKey: 'P02' }, { periodKey: 'SITE_START', periodType: 'site_start' }, { periodKey: 'P01' }]
      .sort(comparePeriods)
      .map((period) => period.periodKey),
    ['SITE_START', 'P01', 'P02']
  );
});

test('forecast-as-at month uses strict existing month validation', () => {
  assert.deepEqual(validatePatchPeriodBody({ version: 3, forecastAsAtMonth: '2027-04' }), {
    ok: true,
    errors: [],
    value: { forecastAsAtMonth: '2027-04-01' },
    version: 3,
  });
  assert.equal(validatePatchPeriodBody({ version: 3, forecastAsAtMonth: 'April 2027' }).ok, false);
});

test('migration defines immutable tenant-scoped appraisal and constrained Site Start identity', () => {
  assert.match(migration, /UNIQUE\(client_id,development_id\)/i);
  assert.match(migration, /Land Purchase Appraisal history is append-only/i);
  assert.match(migration, /created_by_membership_id/i);
  assert.match(migration, /land_appraisal\.capture/i);
  assert.match(migration, /m\.client_id=NEW\.client_id AND m\.is_active/i);
  assert.match(migration, /d\.id=NEW\.development_id AND d\.client_id=NEW\.client_id/i);
  assert.match(migration, /active tenant Cost Code identity/i);
  assert.match(migration, /is_sealed BOOLEAN NOT NULL DEFAULT FALSE/i);
  assert.match(migration, /line creation is limited to the original capture transaction/i);
  assert.match(migration, /period_type IN\('monthly_cvr','site_start'\)/i);
  assert.match(migration, /period_key='SITE_START'/i);
  assert.match(migration, /reporting_month IS NULL/i);
  assert.match(migration, /uq_cvr_periods_single_site_start/i);
  assert.match(migration, /SELECT r\.id,'site_start\.manage'/i);
  assert.match(migration, /authority_version INTEGER NOT NULL DEFAULT 1/i);
  assert.match(migration, /site_start_snapshot_id UUID REFERENCES cvr_period_snapshots/i);
  assert.match(migration, /authority_version=2 AND created_permission_key='cvr\.lock'/i);
  assert.match(migration, /uq_development_budget_milestone_v2/i);
});

test('Land Appraisal line reconciliation detects appended or altered financial evidence', () => {
  const evidence = { lines: [{ lineNumber: 1, costCodeId: 'cc-1', costCode: '1000', description: 'Land', amountPence: 125000 }], totalPence: 125000 };
  const stored = [{ lineNumber: 1, costCodeId: 'cc-1', costCode: '1000', description: 'Land', amount: 1250 }];
  assert.equal(lineSetMatchesEvidence(evidence, stored), true);
  assert.equal(lineSetMatchesEvidence(evidence, [...stored, { lineNumber: 2, costCodeId: 'cc-2', costCode: '2000', description: 'Added later', amount: 1 }]), false);
  assert.equal(lineSetMatchesEvidence(evidence, [{ ...stored[0], amount: 1249 }]), false);
});

test('Land Appraisal hydration fails closed when stored lines diverge from hashed evidence', async () => {
  const evidence = { lines: [{ lineNumber: 1, costCodeId: 'cc-1', costCode: '1000', description: 'Land', amountPence: 125000 }], totalPence: 125000 };
  const row = {
    id: 'appraisal-1', development_id: 'dev-1', effective_date: '2027-01-01', reference: 'APP-1', approval_reason: 'Approved',
    evidence_snapshot: evidence, evidence_sha256: hashCanonicalJson(evidence), evidence_hash_scheme: CANONICAL_JSON_SHA256_V1,
    is_sealed: true, created_at: new Date('2027-01-01T00:00:00Z'), created_by_user_id: 'user-1', created_by_membership_id: 'membership-1',
    created_by_display_name: 'QS', created_role_key: 'qs', created_permission_key: 'land_appraisal.capture',
  };
  const db = { query: async sql => sql.includes('development_land_appraisal_lines')
    ? { rows: [{ line_number: 1, cost_code_id: 'cc-1', cost_code: '1000', description: 'Land', amount: '1249.00' }] }
    : { rows: [row] } };
  const result = await getLandAppraisalAuthority('client-1', 'dev-1', db);
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.code, 'LAND_APPRAISAL_INTEGRITY_FAILED');
  assert.equal(result.appraisal, null);
});

test('migration preserves existing periods as monthly and introduces no data rewrite', () => {
  assert.match(migration, /period_type TEXT NOT NULL DEFAULT 'monthly_cvr'/i);
  assert.doesNotMatch(migration, /UPDATE\s+cvr_periods/i);
  assert.doesNotMatch(migration, /UPDATE\s+cvr_period_snapshots/i);
});

test('guarded authority flow captures immutable appraisal and versions one Draft Site Start', async (t) => {
  if (!isDbConfigured()) return t.skip('Database not configured');
  await prepareIntegrationTestDatabase(pool);
  const suffix = randomUUID().slice(0, 8);
  const client = (await pool.query(
    `INSERT INTO clients(code,name,is_active) VALUES($1,$2,false) RETURNING *`,
    [`SS1_${suffix}`, `SS1 ${suffix}`]
  )).rows[0];
  const user = (await pool.query(
    `INSERT INTO buildlite_users(auth_provider,provider_user_id,email_snapshot,display_name,status)
     VALUES('clerk',$1,$2,'SS1 QS','active') RETURNING *`,
    [`ss1-${suffix}`, `ss1-${suffix}@test.invalid`]
  )).rows[0];
  const role = (await pool.query("SELECT id FROM roles WHERE key='qs'")).rows[0];
  const membership = (await pool.query(
    `INSERT INTO client_user_memberships(client_id,user_id,role_id,is_active)
     VALUES($1,$2,$3,true) RETURNING *`,
    [client.id, user.id, role.id]
  )).rows[0];
  const developmentId = `ss1-${randomUUID()}`;
  await pool.query(
    `INSERT INTO developments(id,client_id,job_number,development_name,status,payload)
     VALUES($1,$2,$3,'SS1 Development','live','{}')`,
    [developmentId, client.id, `SS1-${suffix}`]
  );
  const costCode = (await pool.query(
    `INSERT INTO cost_codes(client_id,code,description,is_active,version)
     VALUES($1,'5231','Site prelims',true,1) RETURNING *`,
    [client.id]
  )).rows[0];
  const auth = {
    clientId: client.id,
    userId: user.id,
    membershipId: membership.id,
    providerUserId: user.provider_user_id,
    displayName: user.display_name,
    roleKey: 'qs',
    permissions: [
      PERMISSIONS.COMMERCIAL_READ,
      PERMISSIONS.CVR_EDIT,
      PERMISSIONS.LAND_APPRAISAL_CAPTURE,
      PERMISSIONS.SITE_START_MANAGE,
      PERMISSIONS.DEVELOPMENT_BUDGET_POST,
    ],
  };
  const captured = await captureLandAppraisal(client.id, developmentId, {
    effectiveDate: '2027-01-15',
    reference: 'Board appraisal 1',
    approvalReason: 'Approved acquisition baseline',
    lines: [{ costCodeId: costCode.id, amount: '1250000.00' }],
  }, auth);
  assert.equal(captured.status, 201);
  assert.equal(captured.appraisal.totalCost, 1250000);
  assert.equal(captured.appraisal.lines[0].costCodeId, costCode.id);
  assert.equal(captured.appraisal.integrity.valid, true);
  assert.deepEqual(captured.appraisal.positions[0], {
    costCodeId: costCode.id,
    costCode: '5231',
    description: 'Site prelims',
    originalPence: 125000000,
    currentPence: 125000000,
  });

  const closeCandidate = await buildCvrCloseCandidate({
    clientId: client.id,
    developmentId,
    periodId: randomUUID(),
    loadSources: async () => ({
      ok: true,
      sources: {
        development: sourceOk({ id: developmentId }),
        period: sourceOk({
          periodKey: 'SITE_START',
          periodType: 'site_start',
          commentary: {},
          budgetSource: { state: 'land_appraisal', document: captured.appraisal },
        }),
        inputs: sourceOk([{
          costCodeKey: '5231',
          commercialAdjustment: 50000,
          adjustmentReason: 'Current acquisition forecast',
          manualAccrual: 0,
        }]),
        purchaseOrders: sourceOk([]),
        commercialEvents: sourceOk([]),
        variationOrders: sourceOk([]),
        certificates: sourceOk([]),
        ledger: sourceOk([]),
      },
    }),
  });
  assert.equal(closeCandidate.ready, true);
  assert.equal(closeCandidate.snapshot.rows[0].currentBudget, 1250000);
  assert.equal(closeCandidate.snapshot.rows[0].commercialAdjustment, 50000);
  assert.equal(closeCandidate.snapshot.rows[0].finalForecast, 1300000);
  assert.equal(closeCandidate.snapshot.rows[0].variance, -50000);
  assert.equal((await captureLandAppraisal(client.id, developmentId, {
    effectiveDate: '2027-01-15', reference: 'Duplicate', approvalReason: 'Duplicate',
    lines: [{ costCodeId: costCode.id, amount: '1.00' }],
  }, auth)).status, 409);
  await assert.rejects(
    pool.query('UPDATE development_land_appraisals SET reference=$1 WHERE id=$2', ['changed', captured.appraisal.id]),
    /append-only/
  );
  await assert.rejects(
    pool.query(
      `INSERT INTO development_land_appraisal_lines(client_id,development_id,appraisal_id,line_number,cost_code_id,cost_code,description,amount)
       VALUES($1,$2,$3,2,$4,'5231','Late append',1)`,
      [client.id, developmentId, captured.appraisal.id, costCode.id]
    ),
    /original capture transaction/
  );
  const rehydratedAppraisal = await getLandAppraisalAuthority(client.id, developmentId);
  assert.equal(rehydratedAppraisal.ok, true);
  assert.equal(rehydratedAppraisal.appraisal.integrity.lineSetValid, true);
  assert.equal(rehydratedAppraisal.appraisal.integrity.sealed, true);

  const created = await createSiteStartPeriod(client.id, developmentId, {
    forecastAsAtMonth: '2027-02',
  }, { actor: 'SS1 QS', auth });
  assert.equal(created.status, 201);
  assert.equal(created.period.periodKey, 'SITE_START');
  assert.equal(created.period.reportingMonth, null);
  assert.equal(created.period.forecastAsAtMonth, '2027-02-01');
  assert.equal(created.period.budgetSource.state, 'land_appraisal');
  assert.equal((await createSiteStartPeriod(client.id, developmentId, {
    forecastAsAtMonth: '2027-03',
  }, { actor: 'SS1 QS', auth })).status, 409);

  const changed = await patchCvrPeriod(client.id, developmentId, created.period.id, {
    version: 1,
    forecastAsAtMonth: '2027-03',
  }, { actor: 'SS1 QS' });
  assert.equal(changed.period.version, 2);
  assert.equal(changed.period.forecastAsAtMonth, '2027-03-01');
  assert.equal((await patchCvrPeriod(client.id, developmentId, created.period.id, {
    version: 1, forecastAsAtMonth: '2027-04',
  }, { actor: 'SS1 QS' })).status, 409);

  await pool.query(
    `INSERT INTO development_prelims_items(
       client_id,development_id,cost_code_key,name,forecast_driver,status,lump_sum_amount,version,created_by,updated_by
     ) VALUES($1,$2,'5231','Site establishment','LUMP_SUM','active',1300000,1,'SS3','SS3')`,
    [client.id, developmentId]
  );
  const liveCandidate = await buildCvrCloseCandidate({
    clientId: client.id,
    developmentId,
    periodId: created.period.id,
    developmentBudgetDocument: captured.appraisal,
  });
  assert.equal(liveCandidate.ready, true);
  assert.deepEqual(liveCandidate.snapshot.rows.map((row) => row.costCodeKey), ['5231']);
  const review = await buildPrelimsAdoptionReviewPreview(client.id, developmentId);
  assert.equal(review.ok, true);
  assert.equal(review.preview.periodType, 'site_start');
  assert.equal(review.preview.periodVersion, 2);
  assert.equal(review.preview.reportingMonth, '2027-03');
  assert.equal(review.preview.monthLabel, 'Forecast as at');
  const candidate = review.preview.candidates[0];
  assert.ok(candidate, JSON.stringify(review.preview));
  assert.equal(candidate.costCodeKey, '5231');
  assert.equal(candidate.inputVersion, null);

  const staleIntent = {
    expectedPeriodKey: 'SITE_START',
    expectedPeriodType: 'site_start',
    expectedPeriodVersion: review.preview.periodVersion,
    expectedReportingMonth: review.preview.reportingMonth,
    selections: [{
      costCodeKey: candidate.costCodeKey,
      proposalFingerprint: candidate.proposalFingerprint,
      expectedInputVersion: 0,
      expectedSystemForecast: candidate.systemForecast,
      expectedCurrentAdjustment: candidate.currentAdjustment,
      acknowledgeSupersededAdjustment: false,
      acknowledgeUnresolvedExcluded: false,
    }],
  };
  const moved = await patchCvrPeriod(client.id, developmentId, created.period.id, {
    version: 2,
    forecastAsAtMonth: '2027-04',
  }, { actor: 'SS1 QS' });
  assert.equal(moved.period.version, 3);
  const stale = await adoptPrelimsForecasts(client.id, developmentId, created.period.id, staleIntent, { actor: 'SS1 QS' });
  assert.equal(stale.status, 409);
  assert.equal(stale.code, 'PERIOD_VERSION_CHANGED');

  const freshReview = await buildPrelimsAdoptionReviewPreview(client.id, developmentId);
  const fresh = freshReview.preview.candidates[0];
  const adopted = await adoptPrelimsForecasts(client.id, developmentId, created.period.id, {
    expectedPeriodKey: 'SITE_START',
    expectedPeriodType: 'site_start',
    expectedPeriodVersion: freshReview.preview.periodVersion,
    expectedReportingMonth: freshReview.preview.reportingMonth,
    selections: [{
      costCodeKey: fresh.costCodeKey,
      proposalFingerprint: fresh.proposalFingerprint,
      expectedInputVersion: 0,
      expectedSystemForecast: fresh.systemForecast,
      expectedCurrentAdjustment: fresh.currentAdjustment,
      acknowledgeSupersededAdjustment: false,
      acknowledgeUnresolvedExcluded: false,
    }],
  }, { actor: 'SS1 QS' });
  assert.equal(adopted.ok, true);
  assert.equal(adopted.adoption.periodType, 'site_start');
  assert.equal(adopted.adoption.reportingMonth, '2027-04');
  assert.equal(adopted.adoption.adopted[0].newFinal, 1300000);
  const appraisalAfter = await pool.query(
    `SELECT a.evidence_sha256,l.amount FROM development_land_appraisals a
     JOIN development_land_appraisal_lines l ON l.appraisal_id=a.id WHERE a.id=$1`,
    [captured.appraisal.id]
  );
  assert.equal(appraisalAfter.rows[0].evidence_sha256, captured.appraisal.evidenceSha256);
  assert.equal(Number(appraisalAfter.rows[0].amount), 1250000);

  const approvedCandidate = await buildCvrCloseCandidate({
    clientId: client.id,
    developmentId,
    periodId: created.period.id,
    developmentBudgetDocument: captured.appraisal,
  });
  const wholeCandidate = async () => ({
    ready: true, complete: true, canLock: true, blockers: [],
    snapshot: {
      ...approvedCandidate.snapshot,
      schemaVersion: 3,
      forecastRevenue: 0, securedRevenue: 0, remainingForecastRevenue: 0,
      plotsSold: 0, plotsRemaining: 0, grossProfit: -approvedCandidate.snapshot.finalForecast,
      grossMarginPercent: null, revenueAssumptions: { revenueMode: 'sales_register' }, plots: [],
    },
  });
  const submitted = await submitCvrPeriod(client.id, developmentId, created.period.id, { version: 3 }, {
    actor: 'SS1 QS', auth, buildWholeCloseCandidate: wholeCandidate,
  });
  assert.equal(submitted.ok, true);
  assert.equal(submitted.period.status, 'submitted');
  assert.equal(submitted.period.forecastAsAtMonth, '2027-04-01');

  const directorRole = (await pool.query("SELECT id FROM roles WHERE key='commercial_director'")).rows[0];
  await pool.query('UPDATE client_user_memberships SET role_id=$1 WHERE id=$2', [directorRole.id, membership.id]);
  const approvalAuth = { ...auth, roleKey: 'commercial_director', permissions: [...auth.permissions, PERMISSIONS.CVR_LOCK] };
  await assert.rejects(approveCvrPeriod(client.id, developmentId, created.period.id, {
    version: submitted.period.version,
    approvalReference: 'BOARD-SS-ROLLBACK',
    comment: 'Forced atomic rollback',
  }, { actor: 'SS1 Director', auth: approvalAuth, buildWholeCloseCandidate: wholeCandidate, failAfter: 'period' }), /forced-period-update-failure/);
  assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM cvr_period_snapshots WHERE period_id=$1', [created.period.id])).rows[0].n), 0);
  assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM development_budget_milestones WHERE site_start_period_id=$1', [created.period.id])).rows[0].n), 0);
  assert.equal((await pool.query('SELECT status FROM cvr_periods WHERE id=$1', [created.period.id])).rows[0].status, 'submitted');
  const approved = await approveCvrPeriod(client.id, developmentId, created.period.id, {
    version: submitted.period.version,
    approvalReference: 'BOARD-SS-001',
    comment: 'Approved Site Start commercial baseline',
  }, { actor: 'SS1 Director', auth: approvalAuth, buildWholeCloseCandidate: wholeCandidate });
  assert.equal(approved.ok, true);
  assert.equal(approved.period.status, 'locked');
  assert.equal(approved.period.snapshot.rows[0].finalForecast, 1300000);
  const milestone = (await pool.query(
    `SELECT * FROM development_budget_milestones
     WHERE client_id=$1 AND development_id=$2 AND authority_version=2`,
    [client.id, developmentId]
  )).rows[0];
  assert.ok(milestone);
  assert.equal(milestone.site_start_period_id, created.period.id);
  assert.equal(milestone.site_start_snapshot_id, approved.period.snapshot.id);
  assert.equal(milestone.land_appraisal_id, captured.appraisal.id);
  assert.equal(milestone.reference, 'BOARD-SS-001');
  assert.equal(milestone.evidence_snapshot.schemaVersion, 'site_start_budget_milestone_v2');
  assert.equal(milestone.evidence_snapshot.snapshot.totalEfcPence, 130000000);
  assert.equal(milestone.evidence_snapshot.snapshot.rows[0].projectedAdjustmentPence, 5000000);
  assert.equal(milestone.evidence_snapshot.snapshot.developmentBudgetEventFrontier, 0);
  await assert.rejects(
    createFirstCvrFromSiteStart(client.id,developmentId,{reportingMonth:'2027-04',siteStartVersion:approved.period.version},{actor:'Unauthorised',auth:{...approvalAuth,permissions:[]},currentDate:new Date('2027-05-02T12:00:00Z')}),
    /permission/i
  );
  assert.equal((await createFirstCvrFromSiteStart(client.id,developmentId,{reportingMonth:'2027-06',siteStartVersion:approved.period.version},{actor:'SS1 Director',auth:approvalAuth,currentDate:new Date('2027-05-02T12:00:00Z')})).code,'CVR_REPORTING_PERIOD_NOT_CLOSED');
  assert.equal((await createFirstCvrFromSiteStart(client.id,developmentId,{reportingMonth:'2027-04',siteStartVersion:approved.period.version-1},{actor:'SS1 Director',auth:approvalAuth,currentDate:new Date('2027-05-02T12:00:00Z')})).status,409);
  const cutoverRequest = () => createFirstCvrFromSiteStart(client.id, developmentId, {
    reportingMonth: '2027-04', siteStartVersion: approved.period.version,
  }, { actor: 'SS1 Director', auth: approvalAuth, currentDate: new Date('2027-05-02T12:00:00Z') });
  const concurrentCutovers = await Promise.all([cutoverRequest(), cutoverRequest()]);
  assert.equal(concurrentCutovers.filter(result => result.ok).length, 1);
  assert.equal(concurrentCutovers.filter(result => result.status === 409).length, 1);
  const p01 = concurrentCutovers.find(result => result.ok);
  assert.equal(p01.ok, true);
  assert.equal(p01.period.periodKey, 'P01');
  assert.equal(p01.period.budgetSourceMode, 'site_start_budget');
  assert.equal(p01.period.siteStartSourceSnapshotId, approved.period.snapshot.id);
  assert.equal(p01.period.budgetSource.document.positions[0].originalPence, 130000000);
  assert.equal(p01.period.budgetSource.document.positions[0].currentPence, 130000000);
  assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM cvr_cost_code_inputs WHERE period_id=$1',[p01.period.id])).rows[0].n), 0);
  const p01Candidate = await buildCvrCloseCandidate({clientId:client.id,developmentId,periodId:p01.period.id,developmentBudgetDocument:p01.period.budgetSource.document});
  assert.equal(p01Candidate.snapshot.rows[0].originalBudget, 1300000);
  assert.equal(p01Candidate.snapshot.rows[0].currentBudget, 1300000);
  assert.equal(p01Candidate.snapshot.rows[0].commercialAdjustment, 0);
  assert.equal(p01Candidate.snapshot.rows[0].manualAccrual, 0);
  const movement = await postEvent(client.id,developmentId,{eventType:'addition',effectiveDate:'2027-04-30',reference:'POST-SS-001',reason:'Approved post-start movement',idempotencyKey:`post-ss-${suffix}`,lines:[{costCodeId:costCode.id,amount:'10000.00',explanation:'Post-start scope'}]},approvalAuth);
  assert.equal(movement.ok,true);
  const refreshed = await require('../services/cvrSiteStartBudgetSource').liveDocument(pool,client.id,developmentId,approved.period.snapshot.id);
  assert.equal(refreshed.positions[0].originalPence,130000000);
  assert.equal(refreshed.positions[0].currentPence,131000000);
  const movedCandidate = await buildCvrCloseCandidate({clientId:client.id,developmentId,periodId:p01.period.id,developmentBudgetDocument:refreshed});
  assert.equal(movedCandidate.snapshot.rows[0].originalBudget,1300000);
  assert.equal(movedCandidate.snapshot.rows[0].currentBudget,1310000);
  assert.equal(movedCandidate.snapshot.rows[0].finalForecast,1310000);
  const newCostCode = (await pool.query(
    `INSERT INTO cost_codes(client_id,code,description,is_active,version)
     VALUES($1,'6000','Post-start scope',true,1) RETURNING *`,
    [client.id]
  )).rows[0];
  assert.equal((await postEvent(client.id,developmentId,{eventType:'addition',effectiveDate:'2027-04-30',reference:'POST-SS-NEW-CC',reason:'New approved post-start scope',idempotencyKey:`post-ss-new-${suffix}`,lines:[{costCodeId:newCostCode.id,amount:'2500.00',explanation:'New Cost Code after Site Start'}]},approvalAuth)).ok,true);
  const withNewCode = await require('../services/cvrSiteStartBudgetSource').liveDocument(pool,client.id,developmentId,approved.period.snapshot.id);
  assert.deepEqual(withNewCode.positions.find(position=>position.costCode==='6000'),{costCodeId:newCostCode.id,costCode:'6000',description:'Post-start scope',originalPence:0,currentPence:250000});
  const newCodeCandidate = await buildCvrCloseCandidate({clientId:client.id,developmentId,periodId:p01.period.id,developmentBudgetDocument:withNewCode});
  assert.equal(newCodeCandidate.snapshot.rows.find(row=>row.costCodeKey==='6000').finalForecast,2500);
  assert.equal((await createFirstCvrFromSiteStart(client.id,developmentId,{reportingMonth:'2027-04',siteStartVersion:approved.period.version},{actor:'SS1 Director',auth:approvalAuth,currentDate:new Date('2027-05-02T12:00:00Z')})).status,409);
  await pool.query("UPDATE cvr_periods SET status='locked',submitted_at=NOW(),submitted_by='SS1 Director',approved_at=NOW(),approved_by='SS1 Director' WHERE id=$1",[p01.period.id]);
  const p02 = await createCvrPeriod(client.id,developmentId,{reportingMonth:'2027-05'},{actor:'SS1 Director',currentDate:new Date('2027-06-02T12:00:00Z'),loadReadiness:async()=>({ok:true,readiness:{canCreateFirstCvr:true,items:[],establishedLegacy:false}})});
  assert.equal(p02.ok,true);
  assert.equal(p02.period.periodKey,'P02');
  assert.equal(p02.period.budgetSourceMode,'site_start_budget');
  assert.equal(p02.period.siteStartSourceSnapshotId,approved.period.snapshot.id);
  assert.equal((await approveCvrPeriod(client.id, developmentId, created.period.id, {
    version: approved.period.version, approvalReference: 'DUPLICATE', comment: 'Duplicate',
  }, { actor: 'SS1 Director', auth: approvalAuth, buildWholeCloseCandidate: wholeCandidate })).status, 409);
  await assert.rejects(
    pool.query('UPDATE development_budget_milestones SET reference=$1 WHERE id=$2', ['changed', milestone.id]),
    /append-only/
  );
});
