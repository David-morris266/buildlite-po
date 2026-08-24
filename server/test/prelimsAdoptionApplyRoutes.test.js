/**
 * BL-033D.x.4C.1 — Prelims → Draft CVR adoption command (buildlite_test only).
 * Never mutates buildlite_clone / Test Site 1.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const request = require("supertest");
const createApp = require("../app");
const { pool, isDbConfigured } = require("../db");
const { prepareIntegrationTestDatabase } = require("./integrationTestSetup");
const {
  PRELIMS_ADOPTION_ERROR_CODES,
  buildAdoptionReason,
  parseSelections,
} = require("../services/prelimsAdoptionApplyService");

const app = createApp();
const ROOT = path.join(__dirname, "..");
const MIGRATION_004 = path.join(ROOT, "migrations", "004_developments.sql");
const MIGRATION_009 = path.join(ROOT, "migrations", "009_cvr_and_purchase_ledger.sql");
const MIGRATION_010 = path.join(ROOT, "migrations", "010_cvr_period_snapshots.sql");
const MIGRATION_013 = path.join(ROOT, "migrations", "013_cost_code_classifications.sql");
const MIGRATION_014 = path.join(ROOT, "migrations", "014_development_programme.sql");
const MIGRATION_015 = path.join(ROOT, "migrations", "015_development_prelims_items.sql");
const MIGRATION_019 = path.join(ROOT, "migrations", "019_development_prelims_time_offsets.sql");

const testDevelopmentIds = [];

function trackDevelopment(id) {
  if (id && !testDevelopmentIds.includes(id)) testDevelopmentIds.push(id);
}

async function ensureSchema() {
  await pool.query(fs.readFileSync(MIGRATION_004, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_009, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_010, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_013, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_014, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_015, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_019, "utf8"));
}

async function cleanup() {
  if (!testDevelopmentIds.length) return;
  await pool.query(
    `DELETE FROM cvr_period_snapshot_rows WHERE snapshot_id IN (
       SELECT id FROM cvr_period_snapshots WHERE development_id = ANY($1::text[])
     )`,
    [testDevelopmentIds]
  ).catch(() => {});
  await pool.query(`DELETE FROM cvr_period_snapshots WHERE development_id = ANY($1::text[])`, [
    testDevelopmentIds,
  ]).catch(() => {});
  await pool.query(`DELETE FROM development_prelims_items WHERE development_id = ANY($1::text[])`, [
    testDevelopmentIds,
  ]);
  await pool.query(`DELETE FROM development_programme WHERE development_id = ANY($1::text[])`, [
    testDevelopmentIds,
  ]);
  await pool.query(
    `DELETE FROM cvr_cost_code_inputs WHERE period_id IN (
       SELECT id FROM cvr_periods WHERE development_id = ANY($1::text[])
     )`,
    [testDevelopmentIds]
  );
  await pool.query(
    `DELETE FROM cvr_period_audit WHERE period_id IN (
       SELECT id FROM cvr_periods WHERE development_id = ANY($1::text[])
     )`,
    [testDevelopmentIds]
  );
  await pool.query(`DELETE FROM cvr_periods WHERE development_id = ANY($1::text[])`, [
    testDevelopmentIds,
  ]);
  await pool.query(`DELETE FROM developments WHERE id = ANY($1::text[])`, [testDevelopmentIds]);
}

async function getActiveClient() {
  const { rows } = await pool.query(
    "SELECT id, code, name FROM clients WHERE is_active = true LIMIT 1"
  );
  return rows[0] || null;
}

async function createDevelopment(active, suffix = "adopt") {
  const id = `dev-prelims-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await pool.query(
    `
      INSERT INTO developments (id, client_id, job_number, development_name, status, payload)
      VALUES ($1, $2, $3, $4, 'live', $5::jsonb)
    `,
    [
      id,
      active.id,
      `PRELIMS-ADOPT-${id}`,
      "Prelims adoption test",
      JSON.stringify({
        startDate: "2026-09-01",
        targetCompletion: "2029-10-01",
        plotCount: 31,
      }),
    ]
  );
  trackDevelopment(id);
  return id;
}

async function seedProgramme(developmentId) {
  const res = await request(app).put(`/api/developments/${developmentId}/programme`).send({
    version: 0,
    siteStart: "2026-09-01",
    finalCompletion: "2029-10-01",
    totalPlots: 31,
  });
  assert.ok([200, 201].includes(res.status), res.body?.message || JSON.stringify(res.body));
  return res.body;
}

async function seedDraftPeriod(developmentId, { periodKey = "P04", reportingMonth = "2026-08-01" } = {}) {
  const period = await request(app)
    .post(`/api/developments/${developmentId}/cvr/periods`)
    .send({ reportingMonth, periodKey, actor: "QS" });
  assert.equal(period.status, 201, period.body?.message || JSON.stringify(period.body));
  return period.body;
}

async function seedInputs(developmentId, periodId, inputs) {
  const res = await request(app)
    .put(`/api/developments/${developmentId}/cvr/periods/${periodId}/inputs`)
    .send({ actor: "QS", inputs });
  assert.equal(res.status, 200, res.body?.message || JSON.stringify(res.body));
  return res.body.inputs;
}

async function seedPrelim(developmentId, body) {
  const res = await request(app)
    .post(`/api/developments/${developmentId}/prelims-items`)
    .send({ version: 0, status: "active", ...body });
  assert.ok([200, 201].includes(res.status), res.body?.message || JSON.stringify(res.body));
  return res.body.item || res.body;
}

async function seed5231Site(active, { includeUnresolved = true, includeMissing = true } = {}) {
  const developmentId = await createDevelopment(active);
  await seedProgramme(developmentId);
  const period = await seedDraftPeriod(developmentId);
  const inputs = await seedInputs(developmentId, period.id, [
    {
      costCodeKey: "5231",
      costCodeLabel: "Site Prelims",
      currentBudget: 50280,
      originalBudget: 50280,
      commercialAdjustment: 520,
      adjustmentReason: "P04 controlled adjustment",
      manualAccrual: 120,
    },
  ]);
  const input5231 = (Array.isArray(inputs) ? inputs : []).find((row) => row.costCodeKey === "5231");

  await seedPrelim(developmentId, {
    costCodeKey: "5231",
    name: "Lump",
    forecastDriver: "LUMP_SUM",
    lumpSumAmount: 20000,
  });
  await seedPrelim(developmentId, {
    costCodeKey: "5231",
    name: "Time resolved",
    forecastDriver: "TIME",
    monthlyRate: 1000,
    startBasis: "SITE_START",
    endBasis: "FINAL_COMPLETION",
    reportingMonth: "2026-08",
  });
  if (includeUnresolved) {
    await seedPrelim(developmentId, {
      costCodeKey: "5231",
      name: "Unresolved first completion",
      forecastDriver: "TIME",
      monthlyRate: 1000,
      startBasis: "FIRST_COMPLETION",
      endBasis: "FINAL_COMPLETION",
      reportingMonth: "2026-08",
    });
  }
  if (includeMissing) {
    await seedPrelim(developmentId, {
      costCodeKey: "UAT-CC-001",
      name: "No CVR target",
      forecastDriver: "LUMP_SUM",
      lumpSumAmount: 1000,
    });
  }

  return { developmentId, period, input5231 };
}

async function loadPreview(developmentId) {
  const preview = await request(app).get(
    `/api/developments/${developmentId}/prelims-adoption/preview`
  );
  assert.equal(preview.status, 200, preview.body?.message || JSON.stringify(preview.body));
  return preview.body;
}

function selectionFromPreview(preview, costCodeKey, inputVersion, extras = {}) {
  const row = (preview.candidates || []).find((item) => item.costCodeKey === costCodeKey);
  assert.ok(row, `preview missing ${costCodeKey}`);
  return {
    costCodeKey,
    proposalFingerprint: row.proposalFingerprint,
    expectedInputVersion: inputVersion,
    expectedSystemForecast: row.systemForecast,
    expectedCurrentAdjustment: row.currentAdjustment,
    acknowledgeUnresolvedExcluded: Boolean(row.unresolvedCount > 0),
    ...extras,
  };
}

function adoptUrl(developmentId, periodId) {
  return `/api/developments/${developmentId}/cvr/periods/${periodId}/prelims-adoption`;
}

async function postAdopt(developmentId, periodId, body) {
  return request(app)
    .post(adoptUrl(developmentId, periodId))
    .send({ actor: "QS", ...body });
}

async function readInput(periodId, costCodeKey) {
  const { rows } = await pool.query(
    `
      SELECT *
      FROM cvr_cost_code_inputs
      WHERE period_id = $1 AND cost_code_key = $2
    `,
    [periodId, costCodeKey]
  );
  return rows[0] || null;
}

test("x.4C.1 pure helpers: reason + ignore proposedAdjustment authority", () => {
  assert.equal(buildAdoptionReason("2026-08"), "Prelims forecast adopted — 2026-08");
  const parsed = parseSelections({
    selections: [
      {
        costCodeKey: "5231",
        proposalFingerprint: "fp",
        expectedInputVersion: 1,
        expectedSystemForecast: 50280,
        expectedCurrentAdjustment: 520,
        proposedAdjustment: 999999,
      },
    ],
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.selections[0].proposedAdjustmentIgnored, 999999);

  const empty = parseSelections({ selections: [] });
  assert.equal(empty.ok, false);
  assert.equal(empty.code, PRELIMS_ADOPTION_ERROR_CODES.SELECTION_REQUIRED);

  const dup = parseSelections({
    selections: [
      {
        costCodeKey: "5231",
        proposalFingerprint: "fp",
        expectedInputVersion: 1,
        expectedSystemForecast: 50280,
        expectedCurrentAdjustment: 520,
      },
      {
        costCodeKey: "5231",
        proposalFingerprint: "fp2",
        expectedInputVersion: 1,
        expectedSystemForecast: 50280,
        expectedCurrentAdjustment: 520,
      },
    ],
  });
  assert.equal(dup.ok, false);
  assert.equal(dup.code, PRELIMS_ADOPTION_ERROR_CODES.DUPLICATE_COST_CODE);
});

if (!isDbConfigured()) {
  test("BL-033D.x.4C.1 routes skipped — TEST_DATABASE_URL not configured", () => {
    assert.ok(true);
  });
} else {
  test.before(async () => {
    await prepareIntegrationTestDatabase(pool);
    const db = await pool.query("SELECT current_database() AS db");
    assert.equal(db.rows[0].db, "buildlite_test");
    assert.notEqual(db.rows[0].db, "buildlite_clone");
    await ensureSchema();
  });

  test.after(async () => {
    await cleanup();
  });

  test("happy-path single-code 5231 replacement maths (not additive)", async () => {
    const active = await getActiveClient();
    const { developmentId, period, input5231 } = await seed5231Site(active);
    const preview = await loadPreview(developmentId);
    const row = preview.candidates.find((item) => item.costCodeKey === "5231");
    assert.equal(row.proposedAdjustment, 7720);
    assert.equal(row.systemForecast + 520, 50800);
    assert.notEqual(row.proposedAdjustment, 520 + 7720);

    const res = await postAdopt(developmentId, period.id, {
      expectedPeriodKey: preview.periodKey,
      expectedReportingMonth: preview.reportingMonth,
      selections: [
        selectionFromPreview(preview, "5231", input5231.version, {
          proposedAdjustment: 999999,
          acknowledgeUnresolvedExcluded: true,
        }),
      ],
    });
    assert.equal(res.status, 200, res.body?.message || JSON.stringify(res.body));
    assert.equal(res.body.adopted.length, 1);
    const adopted = res.body.adopted[0];
    assert.equal(adopted.oldAdjustment, 520);
    assert.equal(adopted.newAdjustment, 7720);
    assert.equal(adopted.oldFinal, 50800);
    assert.equal(adopted.newFinal, 58000);
    assert.equal(adopted.inputVersion, input5231.version + 1);
    assert.equal(adopted.manualAccrual, 120);

    const dbRow = await readInput(period.id, "5231");
    assert.equal(Number(dbRow.commercial_adjustment), 7720);
    assert.equal(Number(dbRow.manual_accrual), 120);
    assert.equal(dbRow.adjustment_reason, "Prelims forecast adopted — 2026-08");
    assert.equal(dbRow.display_metadata.prelimsAdoption.adoptedTargetFinal, 58000);
    assert.equal(dbRow.display_metadata.prelimsAdoption.adoptedAdjustment, 7720);
    assert.equal(dbRow.display_metadata.prelimsAdoption.systemForecastAtAdoption, 50280);
    assert.equal(dbRow.display_metadata.prelimsAdoption.previousAdjustment, 520);
    assert.equal(dbRow.display_metadata.prelimsAdoption.previousFinalForecast, 50800);
    assert.equal(dbRow.display_metadata.prelimsAdoption.superseded, false);
    assert.ok(Array.isArray(dbRow.display_metadata.adjustmentHistory));
    assert.equal(dbRow.display_metadata.adjustmentHistory.length, 1);
    assert.equal(dbRow.display_metadata.adjustmentHistory[0].source, "prelims_adoption");
    assert.equal(dbRow.display_metadata.adjustmentHistory[0].previousAdjustment, 520);
    assert.equal(dbRow.display_metadata.adjustmentHistory[0].newAdjustment, 7720);
    assert.equal(dbRow.display_metadata.adjustmentHistory[0].previousReason, "P04 controlled adjustment");
  });

  test("negative and zero replacement adjustments", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active, "neg");
    await seedProgramme(developmentId);
    const period = await seedDraftPeriod(developmentId);
    const inputs = await seedInputs(developmentId, period.id, [
      {
        costCodeKey: "5231",
        costCodeLabel: "Site Prelims",
        currentBudget: 50280,
        originalBudget: 50280,
        commercialAdjustment: 100,
        adjustmentReason: "seed",
        manualAccrual: 0,
      },
    ]);
    await seedPrelim(developmentId, {
      costCodeKey: "5231",
      name: "Below system",
      forecastDriver: "LUMP_SUM",
      lumpSumAmount: 40000,
    });
    let preview = await loadPreview(developmentId);
    let row = preview.candidates.find((item) => item.costCodeKey === "5231");
    assert.equal(row.proposedAdjustment, -10280);
    let res = await postAdopt(developmentId, period.id, {
      expectedPeriodKey: preview.periodKey,
      expectedReportingMonth: preview.reportingMonth,
      selections: [selectionFromPreview(preview, "5231", inputs[0].version)],
    });
    assert.equal(res.status, 200, res.body?.message || JSON.stringify(res.body));
    assert.equal(res.body.adopted[0].newAdjustment, -10280);

    // Zero replacement: set proposal = system via SQL-safe prelims rewrite + fresh period inputs
    const developmentId2 = await createDevelopment(active, "zero");
    await seedProgramme(developmentId2);
    const period2 = await seedDraftPeriod(developmentId2);
    const inputs2 = await seedInputs(developmentId2, period2.id, [
      {
        costCodeKey: "5231",
        costCodeLabel: "Site Prelims",
        currentBudget: 50280,
        originalBudget: 50280,
        commercialAdjustment: 50,
        adjustmentReason: "seed",
      },
    ]);
    await seedPrelim(developmentId2, {
      costCodeKey: "5231",
      name: "Equals system",
      forecastDriver: "LUMP_SUM",
      lumpSumAmount: 50280,
    });
    preview = await loadPreview(developmentId2);
    row = preview.candidates.find((item) => item.costCodeKey === "5231");
    assert.equal(row.proposedAdjustment, 0);
    res = await postAdopt(developmentId2, period2.id, {
      expectedPeriodKey: preview.periodKey,
      expectedReportingMonth: preview.reportingMonth,
      selections: [selectionFromPreview(preview, "5231", inputs2[0].version)],
    });
    assert.equal(res.status, 200, res.body?.message || JSON.stringify(res.body));
    assert.equal(res.body.adopted[0].newAdjustment, 0);
    const dbRow = await readInput(period2.id, "5231");
    assert.equal(dbRow.adjustment_reason, "Prelims forecast adopted — 2026-08");
  });

  test("side-effects stay closed: accrual, prelims, programme, classification, CCM, snapshots, historic, no P05", async () => {
    const active = await getActiveClient();
    const { developmentId, period, input5231 } = await seed5231Site(active);

    const historicId = crypto.randomUUID();
    await pool.query(
      `
        INSERT INTO cvr_periods (
          id, client_id, development_id, period_key, period_label, status, version,
          submitted_at, submitted_by, approved_at, approved_by
        ) VALUES (
          $1, $2, $3, 'P01', 'P01', 'locked', 1,
          NOW(), 'QS', NOW(), 'QS'
        )
      `,
      [historicId, active.id, developmentId]
    );
    await pool.query(
      `
        INSERT INTO cvr_cost_code_inputs (
          client_id, period_id, cost_code_key, cost_code_label,
          commercial_adjustment, adjustment_reason, manual_accrual, version
        ) VALUES ($1, $2, '5231', 'Historic', 111, 'historic', 5, 1)
      `,
      [active.id, historicId]
    );
    const snap = await pool.query(
      `
        INSERT INTO cvr_period_snapshots (
          client_id, development_id, period_id, period_key, schema_version, created_by
        ) VALUES ($1, $2, $3, 'P01', 1, 'QS')
        RETURNING id
      `,
      [active.id, developmentId, historicId]
    );

    await pool.query(
      `
        INSERT INTO cost_code_classifications (
          client_id, cost_code_key, semantic_group, forecast_driver, version, created_by, updated_by
        ) VALUES ($1, '5231', 'PRELIMS', 'STANDARD_CVR', 1, 'QS', 'QS')
        ON CONFLICT (client_id, cost_code_key) DO NOTHING
      `,
      [active.id]
    ).catch(async () => {
      // unique may be (client_id, lower(cost_code_key)) depending on migration flavour
      await pool.query(
        `
          INSERT INTO cost_code_classifications (
            client_id, cost_code_key, semantic_group, forecast_driver, version, created_by, updated_by
          ) VALUES ($1, '5231', 'PRELIMS', 'STANDARD_CVR', 1, 'QS', 'QS')
          ON CONFLICT DO NOTHING
        `,
        [active.id]
      );
    });

    const classBefore = await pool.query(
      `SELECT semantic_group, forecast_driver, version FROM cost_code_classifications
       WHERE client_id = $1 AND lower(cost_code_key) = '5231'`,
      [active.id]
    );
    const ccmBefore = await pool.query(
      `SELECT COUNT(*)::int AS n FROM cost_codes WHERE client_id = $1 AND code = '5231'`,
      [active.id]
    );
    if (ccmBefore.rows[0].n === 0) {
      await pool.query(
        `INSERT INTO cost_codes (client_id, code, sub_heading, trade, element, is_active)
         VALUES ($1, '5231', 'Site Prelims', 'Prelims', 'Prelims', true)`,
        [active.id]
      );
    }
    const ccmRowBefore = await pool.query(
      `SELECT * FROM cost_codes WHERE client_id = $1 AND code = '5231'`,
      [active.id]
    );
    const programmeBefore = await request(app).get(`/api/developments/${developmentId}/programme`);
    const prelimsBefore = await pool.query(
      `SELECT id, version, lump_sum_amount::float8 AS lump, monthly_rate::float8 AS rate
       FROM development_prelims_items WHERE development_id = $1 ORDER BY id`,
      [developmentId]
    );
    const periodsBefore = await pool.query(
      `SELECT period_key, status FROM cvr_periods WHERE development_id = $1 ORDER BY period_key`,
      [developmentId]
    );
    const snapBefore = await pool.query(
      `SELECT COUNT(*)::int AS n FROM cvr_period_snapshots WHERE development_id = $1`,
      [developmentId]
    );
    const historicBefore = await readInput(historicId, "5231");

    const preview = await loadPreview(developmentId);
    const res = await postAdopt(developmentId, period.id, {
      expectedPeriodKey: preview.periodKey,
      expectedReportingMonth: preview.reportingMonth,
      selections: [
        selectionFromPreview(preview, "5231", input5231.version, {
          acknowledgeUnresolvedExcluded: true,
        }),
      ],
    });
    assert.equal(res.status, 200, res.body?.message || JSON.stringify(res.body));

    const dbRow = await readInput(period.id, "5231");
    assert.equal(Number(dbRow.manual_accrual), 120);

    const prelimsAfter = await pool.query(
      `SELECT id, version, lump_sum_amount::float8 AS lump, monthly_rate::float8 AS rate
       FROM development_prelims_items WHERE development_id = $1 ORDER BY id`,
      [developmentId]
    );
    assert.deepEqual(prelimsAfter.rows, prelimsBefore.rows);

    const programmeAfter = await request(app).get(`/api/developments/${developmentId}/programme`);
    assert.equal(programmeAfter.body.version, programmeBefore.body.version);

    const classAfter = await pool.query(
      `SELECT semantic_group, forecast_driver, version FROM cost_code_classifications
       WHERE client_id = $1 AND lower(cost_code_key) = '5231'`,
      [active.id]
    );
    assert.deepEqual(classAfter.rows, classBefore.rows);

    const ccmRowAfter = await pool.query(
      `SELECT * FROM cost_codes WHERE client_id = $1 AND code = '5231'`,
      [active.id]
    );
    assert.deepEqual(ccmRowAfter.rows[0], ccmRowBefore.rows[0]);

    const snapAfter = await pool.query(
      `SELECT COUNT(*)::int AS n FROM cvr_period_snapshots WHERE development_id = $1`,
      [developmentId]
    );
    assert.equal(snapAfter.rows[0].n, snapBefore.rows[0].n);
    assert.equal(snapAfter.rows[0].n, 1);
    assert.equal(snap.rows[0].id != null, true);

    const historicAfter = await readInput(historicId, "5231");
    assert.equal(Number(historicAfter.commercial_adjustment), Number(historicBefore.commercial_adjustment));
    assert.equal(historicAfter.version, historicBefore.version);

    const periodsAfter = await pool.query(
      `SELECT period_key, status FROM cvr_periods WHERE development_id = $1 ORDER BY period_key`,
      [developmentId]
    );
    assert.deepEqual(periodsAfter.rows, periodsBefore.rows);
    assert.equal(periodsAfter.rows.some((row) => row.period_key === "P05"), false);
  });

  test("rejects non-draft / submitted / locked periods", async () => {
    const active = await getActiveClient();
    const { developmentId, period, input5231 } = await seed5231Site(active);
    const preview = await loadPreview(developmentId);
    const baseBody = {
      expectedPeriodKey: preview.periodKey,
      expectedReportingMonth: preview.reportingMonth,
      selections: [
        selectionFromPreview(preview, "5231", input5231.version, {
          acknowledgeUnresolvedExcluded: true,
        }),
      ],
    };

    await pool.query(
      `UPDATE cvr_periods SET status = 'submitted', submitted_at = NOW(), submitted_by = 'QS' WHERE id = $1`,
      [period.id]
    );
    let res = await postAdopt(developmentId, period.id, baseBody);
    assert.equal(res.status, 409);
    assert.equal(res.body.code, PRELIMS_ADOPTION_ERROR_CODES.PERIOD_NOT_DRAFT);

    await pool.query(
      `
        UPDATE cvr_periods
        SET status = 'locked', approved_at = NOW(), approved_by = 'QS'
        WHERE id = $1
      `,
      [period.id]
    );
    res = await postAdopt(developmentId, period.id, baseBody);
    assert.equal(res.status, 409);
    assert.equal(res.body.code, PRELIMS_ADOPTION_ERROR_CODES.PERIOD_NOT_DRAFT);
  });

  test("stale / drift protections return machine-readable 409 codes", async () => {
    const active = await getActiveClient();
    const { developmentId, period, input5231 } = await seed5231Site(active);
    const preview = await loadPreview(developmentId);
    const selection = selectionFromPreview(preview, "5231", input5231.version, {
      acknowledgeUnresolvedExcluded: true,
    });

    let res = await postAdopt(developmentId, period.id, {
      expectedPeriodKey: preview.periodKey,
      expectedReportingMonth: preview.reportingMonth,
      selections: [{ ...selection, expectedInputVersion: input5231.version + 5 }],
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, PRELIMS_ADOPTION_ERROR_CODES.CVR_INPUT_CONFLICT);

    res = await postAdopt(developmentId, period.id, {
      expectedPeriodKey: preview.periodKey,
      expectedReportingMonth: preview.reportingMonth,
      selections: [{ ...selection, proposalFingerprint: "stale-fingerprint" }],
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, PRELIMS_ADOPTION_ERROR_CODES.PROPOSAL_STALE);

    res = await postAdopt(developmentId, period.id, {
      expectedPeriodKey: preview.periodKey,
      expectedReportingMonth: preview.reportingMonth,
      selections: [{ ...selection, expectedSystemForecast: 1 }],
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, PRELIMS_ADOPTION_ERROR_CODES.SYSTEM_FORECAST_DRIFT);

    res = await postAdopt(developmentId, period.id, {
      expectedPeriodKey: preview.periodKey,
      expectedReportingMonth: preview.reportingMonth,
      selections: [{ ...selection, expectedCurrentAdjustment: 1 }],
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, PRELIMS_ADOPTION_ERROR_CODES.CURRENT_ADJUSTMENT_DRIFT);

    res = await postAdopt(developmentId, period.id, {
      expectedPeriodKey: preview.periodKey,
      expectedReportingMonth: "2026-07",
      selections: [selection],
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, PRELIMS_ADOPTION_ERROR_CODES.REPORTING_MONTH_CHANGED);
  });

  test("unresolved acknowledgement gate", async () => {
    const active = await getActiveClient();
    const { developmentId, period, input5231 } = await seed5231Site(active);
    const preview = await loadPreview(developmentId);
    const selection = selectionFromPreview(preview, "5231", input5231.version, {
      acknowledgeUnresolvedExcluded: false,
    });
    let res = await postAdopt(developmentId, period.id, {
      expectedPeriodKey: preview.periodKey,
      expectedReportingMonth: preview.reportingMonth,
      selections: [selection],
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, PRELIMS_ADOPTION_ERROR_CODES.UNRESOLVED_ACK_REQUIRED);

    res = await postAdopt(developmentId, period.id, {
      expectedPeriodKey: preview.periodKey,
      expectedReportingMonth: preview.reportingMonth,
      selections: [{ ...selection, acknowledgeUnresolvedExcluded: true }],
    });
    assert.equal(res.status, 200, res.body?.message || JSON.stringify(res.body));
    assert.equal(res.body.adopted[0].newFinal, 58000);
    const meta = (await readInput(period.id, "5231")).display_metadata.prelimsAdoption;
    assert.ok(meta.excludedUnresolvedLineIds.length >= 1);
  });

  test("cost code missing from CVR fails closed", async () => {
    const active = await getActiveClient();
    const { developmentId, period, input5231 } = await seed5231Site(active);
    const preview = await loadPreview(developmentId);
    const missing = (preview.missingFromCvr || []).find((item) => item.costCodeKey === "UAT-CC-001");
    assert.ok(missing);
    const res = await postAdopt(developmentId, period.id, {
      expectedPeriodKey: preview.periodKey,
      expectedReportingMonth: preview.reportingMonth,
      selections: [
        {
          costCodeKey: "UAT-CC-001",
          proposalFingerprint: missing.proposalFingerprint,
          expectedInputVersion: 1,
          expectedSystemForecast: 0,
          expectedCurrentAdjustment: 0,
        },
      ],
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, PRELIMS_ADOPTION_ERROR_CODES.COST_CODE_NOT_ON_CVR);
    const still = await readInput(period.id, "5231");
    assert.equal(Number(still.commercial_adjustment), 520);
    assert.equal(still.version, input5231.version);
  });

  test("multi-code atomic success and rollback on one stale code", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active, "multi");
    await seedProgramme(developmentId);
    const period = await seedDraftPeriod(developmentId);
    const inputs = await seedInputs(developmentId, period.id, [
      {
        costCodeKey: "5231",
        costCodeLabel: "Site Prelims",
        currentBudget: 50280,
        originalBudget: 50280,
        commercialAdjustment: 520,
        adjustmentReason: "a",
        manualAccrual: 120,
      },
      {
        costCodeKey: "5232",
        costCodeLabel: "Other Prelims",
        currentBudget: 10000,
        originalBudget: 10000,
        commercialAdjustment: 0,
        adjustmentReason: "",
      },
    ]);
    await seedPrelim(developmentId, {
      costCodeKey: "5231",
      name: "Lump 5231",
      forecastDriver: "LUMP_SUM",
      lumpSumAmount: 58000,
    });
    await seedPrelim(developmentId, {
      costCodeKey: "5232",
      name: "Lump 5232",
      forecastDriver: "LUMP_SUM",
      lumpSumAmount: 12000,
    });
    const preview = await loadPreview(developmentId);
    const input5231 = inputs.find((row) => row.costCodeKey === "5231");
    const input5232 = inputs.find((row) => row.costCodeKey === "5232");

    let res = await postAdopt(developmentId, period.id, {
      expectedPeriodKey: preview.periodKey,
      expectedReportingMonth: preview.reportingMonth,
      selections: [
        selectionFromPreview(preview, "5231", input5231.version),
        selectionFromPreview(preview, "5232", input5232.version),
      ],
    });
    assert.equal(res.status, 200, res.body?.message || JSON.stringify(res.body));
    assert.equal(res.body.adopted.length, 2);
    assert.equal((await readInput(period.id, "5231")).version, input5231.version + 1);
    assert.equal((await readInput(period.id, "5232")).version, input5232.version + 1);

    // Second request: one stale version → none written
    const preview2 = await loadPreview(developmentId);
    const row5231 = await readInput(period.id, "5231");
    const row5232 = await readInput(period.id, "5232");
    res = await postAdopt(developmentId, period.id, {
      expectedPeriodKey: preview2.periodKey,
      expectedReportingMonth: preview2.reportingMonth,
      selections: [
        selectionFromPreview(preview2, "5231", row5231.version, {
          acknowledgeUnresolvedExcluded: false,
        }),
        selectionFromPreview(preview2, "5232", row5232.version - 1),
      ],
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, PRELIMS_ADOPTION_ERROR_CODES.CVR_INPUT_CONFLICT);
    assert.equal((await readInput(period.id, "5231")).version, row5231.version);
    assert.equal((await readInput(period.id, "5232")).version, row5232.version);
  });

  test("re-adoption up_to_date no-op; proposal change; superseded ack", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active, "readopt");
    await seedProgramme(developmentId);
    const period = await seedDraftPeriod(developmentId);
    const inputs = await seedInputs(developmentId, period.id, [
      {
        costCodeKey: "5231",
        costCodeLabel: "Site Prelims",
        currentBudget: 50280,
        originalBudget: 50280,
        commercialAdjustment: 520,
        adjustmentReason: "seed",
      },
    ]);
    await seedPrelim(developmentId, {
      costCodeKey: "5231",
      name: "Single lump",
      forecastDriver: "LUMP_SUM",
      lumpSumAmount: 58000,
    });
    const input5231 = inputs[0];

    let preview = await loadPreview(developmentId);
    let res = await postAdopt(developmentId, period.id, {
      expectedPeriodKey: preview.periodKey,
      expectedReportingMonth: preview.reportingMonth,
      selections: [selectionFromPreview(preview, "5231", input5231.version)],
    });
    assert.equal(res.status, 200, res.body?.message || JSON.stringify(res.body));
    const afterFirst = await readInput(period.id, "5231");
    assert.equal(afterFirst.version, input5231.version + 1);

    preview = await loadPreview(developmentId);
    res = await postAdopt(developmentId, period.id, {
      expectedPeriodKey: preview.periodKey,
      expectedReportingMonth: preview.reportingMonth,
      selections: [selectionFromPreview(preview, "5231", afterFirst.version)],
    });
    assert.equal(res.status, 200, res.body?.message || JSON.stringify(res.body));
    assert.equal(res.body.adopted.length, 0);
    assert.equal(res.body.unchanged.length, 1);
    assert.equal(res.body.unchanged[0].result, "already_up_to_date");
    assert.equal((await readInput(period.id, "5231")).version, afterFirst.version);

    // Proposal changed — bump lump sum
    const items = await pool.query(
      `SELECT id, version FROM development_prelims_items WHERE development_id = $1`,
      [developmentId]
    );
    await pool.query(
      `UPDATE development_prelims_items SET lump_sum_amount = 60000, version = version + 1 WHERE id = $1`,
      [items.rows[0].id]
    );
    preview = await loadPreview(developmentId);
    const current = await readInput(period.id, "5231");
    res = await postAdopt(developmentId, period.id, {
      expectedPeriodKey: preview.periodKey,
      expectedReportingMonth: preview.reportingMonth,
      selections: [selectionFromPreview(preview, "5231", current.version)],
    });
    assert.equal(res.status, 200, res.body?.message || JSON.stringify(res.body));
    assert.equal(res.body.adopted[0].newFinal, 60000);
    const afterProposal = await readInput(period.id, "5231");

    // Manual override → superseded
    await pool.query(
      `
        UPDATE cvr_cost_code_inputs
        SET commercial_adjustment = 9000, adjustment_reason = 'manual QS'
        WHERE id = $1
      `,
      [afterProposal.id]
    );
    preview = await loadPreview(developmentId);
    const supersededRow = preview.candidates.find((item) => item.costCodeKey === "5231");
    assert.equal(supersededRow.driftState, "adoption_superseded");
    const current2 = await readInput(period.id, "5231");
    res = await postAdopt(developmentId, period.id, {
      expectedPeriodKey: preview.periodKey,
      expectedReportingMonth: preview.reportingMonth,
      selections: [
        selectionFromPreview(preview, "5231", current2.version, {
          acknowledgeSupersededAdjustment: false,
        }),
      ],
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, PRELIMS_ADOPTION_ERROR_CODES.SUPERSEDED_ACK_REQUIRED);

    res = await postAdopt(developmentId, period.id, {
      expectedPeriodKey: preview.periodKey,
      expectedReportingMonth: preview.reportingMonth,
      selections: [
        selectionFromPreview(preview, "5231", current2.version, {
          acknowledgeSupersededAdjustment: true,
        }),
      ],
    });
    assert.equal(res.status, 200, res.body?.message || JSON.stringify(res.body));
    assert.equal(res.body.adopted[0].newAdjustment, 60000 - 50280);
  });

  test("tenant / development isolation", async () => {
    const active = await getActiveClient();
    const siteA = await seed5231Site(active, { includeUnresolved: false, includeMissing: false });
    const siteB = await createDevelopment(active, "iso");
    const preview = await loadPreview(siteA.developmentId);
    const res = await postAdopt(siteB, siteA.period.id, {
      expectedPeriodKey: preview.periodKey,
      expectedReportingMonth: preview.reportingMonth,
      selections: [selectionFromPreview(preview, "5231", siteA.input5231.version)],
    });
    assert.equal(res.status, 404);
    const untouched = await readInput(siteA.period.id, "5231");
    assert.equal(Number(untouched.commercial_adjustment), 520);
  });

  test("duplicate selections and empty selections fail closed before write", async () => {
    const active = await getActiveClient();
    const { developmentId, period, input5231 } = await seed5231Site(active, {
      includeUnresolved: false,
      includeMissing: false,
    });
    const preview = await loadPreview(developmentId);
    const selection = selectionFromPreview(preview, "5231", input5231.version);

    let res = await postAdopt(developmentId, period.id, {
      expectedPeriodKey: preview.periodKey,
      expectedReportingMonth: preview.reportingMonth,
      selections: [selection, { ...selection }],
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, PRELIMS_ADOPTION_ERROR_CODES.DUPLICATE_COST_CODE);
    assert.equal(Number((await readInput(period.id, "5231")).commercial_adjustment), 520);

    res = await postAdopt(developmentId, period.id, {
      expectedPeriodKey: preview.periodKey,
      expectedReportingMonth: preview.reportingMonth,
      selections: [],
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, PRELIMS_ADOPTION_ERROR_CODES.SELECTION_REQUIRED);
    assert.equal((await readInput(period.id, "5231")).version, input5231.version);
  });

  test("mixed up-to-date + changed adopts only the changed code", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active, "mixed");
    await seedProgramme(developmentId);
    const period = await seedDraftPeriod(developmentId);
    const inputs = await seedInputs(developmentId, period.id, [
      {
        costCodeKey: "5231",
        costCodeLabel: "Site Prelims",
        currentBudget: 50280,
        originalBudget: 50280,
        commercialAdjustment: 520,
        adjustmentReason: "seed",
      },
      {
        costCodeKey: "5232",
        costCodeLabel: "Other Prelims",
        currentBudget: 10000,
        originalBudget: 10000,
        commercialAdjustment: 0,
        adjustmentReason: "",
      },
    ]);
    await seedPrelim(developmentId, {
      costCodeKey: "5231",
      name: "Lump 5231",
      forecastDriver: "LUMP_SUM",
      lumpSumAmount: 58000,
    });
    await seedPrelim(developmentId, {
      costCodeKey: "5232",
      name: "Lump 5232",
      forecastDriver: "LUMP_SUM",
      lumpSumAmount: 12000,
    });

    let preview = await loadPreview(developmentId);
    let res = await postAdopt(developmentId, period.id, {
      expectedPeriodKey: preview.periodKey,
      expectedReportingMonth: preview.reportingMonth,
      selections: [
        selectionFromPreview(preview, "5231", inputs.find((r) => r.costCodeKey === "5231").version),
        selectionFromPreview(preview, "5232", inputs.find((r) => r.costCodeKey === "5232").version),
      ],
    });
    assert.equal(res.status, 200, res.body?.message || JSON.stringify(res.body));

    const afterFirst5231 = await readInput(period.id, "5231");
    const afterFirst5232 = await readInput(period.id, "5232");
    await pool.query(
      `UPDATE development_prelims_items SET lump_sum_amount = 15000, version = version + 1
       WHERE development_id = $1 AND cost_code_key = '5232'`,
      [developmentId]
    );

    preview = await loadPreview(developmentId);
    res = await postAdopt(developmentId, period.id, {
      expectedPeriodKey: preview.periodKey,
      expectedReportingMonth: preview.reportingMonth,
      selections: [
        selectionFromPreview(preview, "5231", afterFirst5231.version),
        selectionFromPreview(preview, "5232", afterFirst5232.version),
      ],
    });
    assert.equal(res.status, 200, res.body?.message || JSON.stringify(res.body));
    assert.equal(res.body.unchanged.length, 1);
    assert.equal(res.body.unchanged[0].costCodeKey, "5231");
    assert.equal(res.body.unchanged[0].result, "already_up_to_date");
    assert.equal(res.body.adopted.length, 1);
    assert.equal(res.body.adopted[0].costCodeKey, "5232");
    assert.equal(res.body.adopted[0].newFinal, 15000);

    const final5231 = await readInput(period.id, "5231");
    const final5232 = await readInput(period.id, "5232");
    assert.equal(final5231.version, afterFirst5231.version);
    assert.equal(
      (final5231.display_metadata.adjustmentHistory || []).length,
      (afterFirst5231.display_metadata.adjustmentHistory || []).length
    );
    assert.equal(final5232.version, afterFirst5232.version + 1);
    assert.equal((final5232.display_metadata.adjustmentHistory || []).length, 2);
  });

  test("unrelated display_metadata keys survive adoption merge", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active, "meta");
    await seedProgramme(developmentId);
    const period = await seedDraftPeriod(developmentId);
    const inputs = await seedInputs(developmentId, period.id, [
      {
        costCodeKey: "5231",
        costCodeLabel: "Site Prelims",
        currentBudget: 50280,
        originalBudget: 50280,
        commercialAdjustment: 520,
        adjustmentReason: "seed",
        displayMetadata: {
          customMarker: "keep-me",
          nested: { note: "preserve" },
          adjustmentHistory: [{ id: "prior-1", reason: "earlier", source: "manual" }],
        },
      },
    ]);
    await seedPrelim(developmentId, {
      costCodeKey: "5231",
      name: "Lump",
      forecastDriver: "LUMP_SUM",
      lumpSumAmount: 58000,
    });
    const preview = await loadPreview(developmentId);
    const res = await postAdopt(developmentId, period.id, {
      expectedPeriodKey: preview.periodKey,
      expectedReportingMonth: preview.reportingMonth,
      selections: [selectionFromPreview(preview, "5231", inputs[0].version)],
    });
    assert.equal(res.status, 200, res.body?.message || JSON.stringify(res.body));
    const dbRow = await readInput(period.id, "5231");
    assert.equal(dbRow.display_metadata.customMarker, "keep-me");
    assert.deepEqual(dbRow.display_metadata.nested, { note: "preserve" });
    assert.equal(dbRow.display_metadata.adjustmentHistory[0].id, "prior-1");
    assert.equal(dbRow.display_metadata.adjustmentHistory.length, 2);
    assert.equal(dbRow.display_metadata.adjustmentHistory[1].source, "prelims_adoption");
    assert.ok(dbRow.display_metadata.prelimsAdoption);
  });

  test("adoption loads Prelims/programme/classifications on the locked transaction connection", async () => {
    const active = await getActiveClient();
    const { listPrelimsItems } = require("../services/prelimsItemRepository");
    const { listClassifications } = require("../services/costCodeClassificationRepository");

    const developmentId = await createDevelopment(active, "txlock");
    await seedProgramme(developmentId);
    await seedPrelim(developmentId, {
      costCodeKey: "5231",
      name: "Locked lump",
      forecastDriver: "LUMP_SUM",
      lumpSumAmount: 1000,
    });

    const dbClient = await pool.connect();
    try {
      await dbClient.query("BEGIN");
      // Prove FOR UPDATE SQL is accepted on the shared transaction client and
      // classification list also participates on the same connection.
      const listed = await listPrelimsItems(active.id, developmentId, {
        reportingMonth: "2026-08",
        dbClient,
        forUpdate: true,
      });
      assert.equal(listed.ok, true);
      assert.equal(listed.collection.items.length, 1);
      assert.equal(listed.collection.programme.exists, true);

      const classes = await listClassifications(active.id, dbClient);
      assert.equal(classes.ok, true);

      // Concurrent write must wait while this transaction holds FOR UPDATE locks.
      const rival = await pool.connect();
      try {
        await rival.query("BEGIN");
        await rival.query("SET LOCAL lock_timeout = '300ms'");
        let blocked = false;
        try {
          await rival.query(
            `UPDATE development_prelims_items SET version = version WHERE development_id = $1`,
            [developmentId]
          );
        } catch (err) {
          blocked = /lock timeout|canceling statement due to lock timeout/i.test(String(err.message));
          if (!blocked) throw err;
        }
        assert.equal(blocked, true, "expected rival Prelims UPDATE to hit lock timeout");
        await rival.query("ROLLBACK");

        await rival.query("BEGIN");
        await rival.query("SET LOCAL lock_timeout = '300ms'");
        blocked = false;
        try {
          await rival.query(
            `UPDATE development_programme SET version = version WHERE development_id = $1`,
            [developmentId]
          );
        } catch (err) {
          blocked = /lock timeout|canceling statement due to lock timeout/i.test(String(err.message));
          if (!blocked) throw err;
        }
        assert.equal(blocked, true, "expected rival programme UPDATE to hit lock timeout");
        await rival.query("ROLLBACK");
      } finally {
        rival.release();
      }

      await dbClient.query("ROLLBACK");
    } finally {
      dbClient.release();
    }
  });
}
