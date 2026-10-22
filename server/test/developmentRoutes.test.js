/**
 * BL-027A.1 — Development API integration tests (requires TEST_DATABASE_URL).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const request = require("supertest");
const createApp = require("../app");
const { pool, isDbConfigured } = require("../db");
const { prepareIntegrationTestDatabase } = require("./integrationTestSetup");
const { DEVELOPMENT_ID_PATTERN } = require("../services/developmentConstants");
const { createTestAuthAdapter } = require('../auth/authAdapters');
const { updateDevelopment } = require('../services/developmentRepository');
const { lockPlotMasterAuthority } = require('../services/plotMasterUpdateAuthority');

const app = createApp();
const MIGRATION_004 = path.join(__dirname, "..", "migrations", "004_developments.sql");

const testIds = [];
const testJobNumbers = [];

function trackDevelopment(id, jobNumber) {
  if (id) testIds.push(id);
  if (jobNumber) testJobNumbers.push(jobNumber);
}

async function ensureDevelopmentsTable() {
  const sql = fs.readFileSync(MIGRATION_004, "utf8");
  await pool.query(sql);
}

async function cleanupDevelopments() {
  if (testIds.length) {
    await pool.query("DELETE FROM developments WHERE id = ANY($1::text[])", [testIds]);
  }
}

async function getActiveClient() {
  const { rows } = await pool.query(
    "SELECT id, code, name FROM clients WHERE is_active = true LIMIT 1"
  );
  return rows[0] || null;
}

async function createSecondTenant() {
  const code = `TESTB_${Date.now()}`;
  const { rows } = await pool.query(
    `
      INSERT INTO clients (code, name, is_active)
      VALUES ($1, $2, false)
      RETURNING id, code, name
    `,
    [code, "Test Tenant B"]
  );
  return rows[0];
}

function createPlotManagerApp(clientId) {
  return createApp({ authAdapter: createTestAuthAdapter({
    clientId,
    userId: 'plot-manager-user',
    membershipId: 'plot-manager-membership',
    providerUserId: 'plot-manager-provider',
    displayName: 'Plot Manager',
    roleKey: 'qs',
    permissions: ['plot_master.manage'],
    memberships: [],
  }) });
}

if (!isDbConfigured()) {
  test("development routes skipped — TEST_DATABASE_URL not configured", () => {
    assert.ok(true);
  });
} else {
  test.before(async () => {
    await prepareIntegrationTestDatabase(pool);
    await ensureDevelopmentsTable();
  });

  test.after(async () => {
    await cleanupDevelopments();
  });

  test("POST creates a Development with server-generated dev-* id", async () => {
    const jobNumber = `DEV-T-${Date.now()}`;
    const res = await request(app)
      .post("/api/developments")
      .send({
        jobNumber,
        developmentName: "Server Created Development",
        status: "planning",
      });

    assert.equal(res.status, 201);
    assert.match(res.body.id, DEVELOPMENT_ID_PATTERN);
    assert.equal(res.body.jobNumber, jobNumber);
    assert.equal(res.body.developmentName, "Server Created Development");
    assert.equal(res.body.version, 1);
    assert.ok(Array.isArray(res.body.plotMaster.plots));
    trackDevelopment(res.body.id, jobNumber);
  });

  test("POST preserves supplied existing dev-* id exactly", async () => {
    // Use a run-unique dev-* id so this test does not collide with UAT/import
    // fixtures (e.g. Test Site 1 dev-1785599776666-zck5pl) in shared dev Postgres.
    const id = `dev-import-preserve-${Date.now()}`;
    const jobNumber = `DEV-IMPORT-${Date.now()}`;
    const res = await request(app)
      .post("/api/developments")
      .send({
        id,
        jobNumber,
        developmentName: "Imported Development",
        client: "Test Client",
        location: "Somewhere",
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.id, id);
    assert.equal(res.body.client, "Test Client");
    trackDevelopment(id, jobNumber);
  });

  test("POST rejects duplicate supplied id", async () => {
    const id = `dev-dup-id-${Date.now()}`;
    const first = await request(app)
      .post("/api/developments")
      .send({ id, jobNumber: `DEV-A-${Date.now()}`, developmentName: "First" });
    assert.equal(first.status, 201);
    trackDevelopment(id, first.body.jobNumber);

    const second = await request(app)
      .post("/api/developments")
      .send({
        id,
        jobNumber: `DEV-B-${Date.now()}`,
        developmentName: "Second",
      });

    assert.equal(second.status, 409);
  });

  test("POST validates required fields and status/date rules", async () => {
    const missingNumber = await request(app)
      .post("/api/developments")
      .send({ developmentName: "No Number" });
    assert.equal(missingNumber.status, 400);

    const missingName = await request(app)
      .post("/api/developments")
      .send({ jobNumber: `DEV-NONAME-${Date.now()}` });
    assert.equal(missingName.status, 400);

    const invalidStatus = await request(app)
      .post("/api/developments")
      .send({
        jobNumber: `DEV-BADSTATUS-${Date.now()}`,
        developmentName: "Bad Status",
        status: "invalid-status",
      });
    assert.equal(invalidStatus.status, 400);

    const invalidDates = await request(app)
      .post("/api/developments")
      .send({
        jobNumber: `DEV-BADDATE-${Date.now()}`,
        developmentName: "Bad Dates",
        startDate: "2026-06-01",
        targetCompletion: "2026-01-01",
      });
    assert.equal(invalidDates.status, 400);
  });

  test("POST duplicate jobNumber in same tenant returns 409", async () => {
    const jobNumber = `DEV-DUPNUM-${Date.now()}`;
    const first = await request(app)
      .post("/api/developments")
      .send({ jobNumber, developmentName: "First Dev" });
    assert.equal(first.status, 201);
    trackDevelopment(first.body.id, jobNumber);

    const second = await request(app)
      .post("/api/developments")
      .send({
        jobNumber,
        developmentName: "Second Dev",
      });
    assert.equal(second.status, 409);
  });

  test("same jobNumber allowed in different tenants", async () => {
    const active = await getActiveClient();
    assert.ok(active, "active client required");

    const tenantB = await createSecondTenant();
    const sharedJobNumber = `DEV-SHARED-${Date.now()}`;

    const resA = await request(app)
      .post("/api/developments")
      .send({ jobNumber: sharedJobNumber, developmentName: "Tenant A Dev" });
    assert.equal(resA.status, 201);
    trackDevelopment(resA.body.id, sharedJobNumber);

    await pool.query(
      `
        INSERT INTO developments (
          id, client_id, job_number, development_name, status, payload, version
        )
        VALUES ($1, $2, $3, $4, 'planning', '{}'::jsonb, 1)
      `,
      [`dev-tenantb-${Date.now()}`, tenantB.id, sharedJobNumber, "Tenant B Dev"]
    );

    const { rows } = await pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM developments
        WHERE lower(job_number) = lower($1)
      `,
      [sharedJobNumber]
    );
    assert.equal(rows[0].count, 2);

    await pool.query("DELETE FROM clients WHERE id = $1", [tenantB.id]);
  });

  test("GET list and GET by id are tenant-scoped", async () => {
    const active = await getActiveClient();
    assert.ok(active);

    const created = await request(app)
      .post("/api/developments")
      .send({
        jobNumber: `DEV-LIST-${Date.now()}`,
        developmentName: "List Dev",
      });
    assert.equal(created.status, 201);
    trackDevelopment(created.body.id, created.body.jobNumber);

    const list = await request(app).get("/api/developments");
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.body));
    assert.ok(list.body.some((item) => item.id === created.body.id));

    const byId = await request(app).get(`/api/developments/${created.body.id}`);
    assert.equal(byId.status, 200);
    assert.equal(byId.body.id, created.body.id);

    const tenantB = await createSecondTenant();
    const foreignId = `dev-foreign-${Date.now()}`;
    await pool.query(
      `
        INSERT INTO developments (
          id, client_id, job_number, development_name, status, payload, version
        )
        VALUES ($1, $2, $3, 'Foreign Dev', 'planning', '{}'::jsonb, 1)
      `,
      [foreignId, tenantB.id, `DEV-FOREIGN-${Date.now()}`]
    );

    const leak = await request(app).get(`/api/developments/${foreignId}`);
    assert.equal(leak.status, 404);

    await pool.query("DELETE FROM developments WHERE id = $1", [foreignId]);
    await pool.query("DELETE FROM clients WHERE id = $1", [tenantB.id]);
  });

  test("PUT updates, preserves id, increments version, and merges payload safely", async () => {
    const created = await request(app)
      .post("/api/developments")
      .send({
        jobNumber: `DEV-PUT-${Date.now()}`,
        developmentName: "PUT Dev",
        plotMaster: {
          plots: [
            {
              id: "plot-1",
              plotNumber: "1",
              houseType: "Detached",
              configuration: "Detached",
              status: "Active",
            },
          ],
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        customField: "round-trip",
      });
    assert.equal(created.status, 201);
    trackDevelopment(created.body.id, created.body.jobNumber);

    const updated = await request(app)
      .put(`/api/developments/${created.body.id}`)
      .send({
        version: created.body.version,
        startDate: "2026-03-01",
        targetCompletion: "2027-03-01",
        location: "Updated Location",
      });

    assert.equal(updated.status, 200);
    assert.equal(updated.body.id, created.body.id);
    assert.equal(updated.body.version, 2);
    assert.equal(updated.body.startDate, "2026-03-01");
    assert.equal(updated.body.location, "Updated Location");
    assert.equal(updated.body.plotMaster.plots.length, 1);
    assert.equal(updated.body.customField, "round-trip");

    const stale = await request(app)
      .put(`/api/developments/${created.body.id}`)
      .send({
        version: created.body.version,
        developmentName: "Stale Update",
      });
    assert.equal(stale.status, 409);

    const mismatch = await request(app)
      .put(`/api/developments/${created.body.id}`)
      .send({
        id: "dev-other-id",
        version: updated.body.version,
        developmentName: "Mismatch",
      });
    assert.equal(mismatch.status, 400);
  });

  test('Plot Master updates require authenticated tenant plot_master.manage authority', async () => {
    const active = await getActiveClient();
    const created = await request(app).post('/api/developments').send({
      jobNumber: `DEV-PLOT-AUTH-${Date.now()}`,
      developmentName: 'Plot Authority',
    });
    assert.equal(created.status, 201);
    trackDevelopment(created.body.id, created.body.jobNumber);
    const body = {
      version: created.body.version,
      plotMaster: { plots: [{ id: 'stable-1', plotNumber: '1', houseType: 'Ash' }] },
      clientId: 'forged-client',
    };
    const basePrincipal = {
      clientId: active.id,
      userId: 'plot-user',
      membershipId: 'plot-membership',
      providerUserId: 'plot-provider',
      displayName: 'Plot Reviewer',
      roleKey: 'qs',
      memberships: [],
    };
    const deniedApp = createApp({ authAdapter: createTestAuthAdapter({ ...basePrincipal, permissions: [] }) });
    assert.equal((await request(deniedApp).put(`/api/developments/${created.body.id}`).send(body)).status, 403);

    const foreignApp = createApp({ authAdapter: createTestAuthAdapter({
      ...basePrincipal,
      clientId: '00000000-0000-0000-0000-000000000099',
      permissions: ['plot_master.manage'],
    }) });
    assert.ok([403, 404].includes(
      (await request(foreignApp).put(`/api/developments/${created.body.id}`).send(body)).status
    ));

    const allowedApp = createApp({ authAdapter: createTestAuthAdapter({
      ...basePrincipal,
      permissions: ['plot_master.manage'],
    }) });
    const allowed = await request(allowedApp).put(`/api/developments/${created.body.id}`).send(body);
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.plotMaster.plots[0].id, 'stable-1');
  });

  test('Submitted monthly CVR blocks every unmarked Plot Master mutation but not an unchanged Plot Master', async () => {
    const active = await getActiveClient();
    const plotManagerApp = createPlotManagerApp(active.id);
    const created = await request(app).post('/api/developments').send({
      jobNumber: `DEV-PLOT-SUBMITTED-${Date.now()}`,
      developmentName: 'Submitted CVR Plot Guard',
      plotMaster: {
        plots: [{ id: 'stable-1', plotNumber: '1', houseType: 'Ash', gia: 900 }],
      },
    });
    assert.equal(created.status, 201);
    trackDevelopment(created.body.id, created.body.jobNumber);

    const inserted = await pool.query(
      `INSERT INTO cvr_periods (
         client_id, development_id, period_key, period_label, period_type,
         status, commentary, version, budget_source, submitted_at, submitted_by
       ) VALUES ($1, $2, 'P01', 'P01', 'monthly_cvr', 'submitted', '{}', 1,
         'legacy_cvr', NOW(), 'route-test')
       RETURNING id`,
      [active.id, created.body.id]
    );

    try {
      const mutationCases = [
        ['edit', [{ id: 'stable-1', plotNumber: '1', houseType: 'Oak', gia: 900 }]],
        ['add', [
          { id: 'stable-1', plotNumber: '1', houseType: 'Ash', gia: 900 },
          { id: 'stable-2', plotNumber: '2', houseType: 'Birch', gia: 850 },
        ]],
        ['delete', []],
        ['bulk update', [{ id: 'stable-1', plotNumber: '1', houseType: 'Ash', gia: 950 }]],
      ];
      for (const [label, plots] of mutationCases) {
        const blocked = await request(plotManagerApp)
          .put(`/api/developments/${created.body.id}`)
          .send({ version: created.body.version, plotMaster: { plots } });
        assert.equal(blocked.status, 409, label);
        assert.equal(blocked.body.code, 'PLOT_MASTER_UPDATE_BLOCKED_SUBMITTED_CVR', label);
      }

      const unchanged = await request(app).get(`/api/developments/${created.body.id}`);
      assert.equal(unchanged.status, 200);
      assert.equal(unchanged.body.version, created.body.version);
      assert.equal(unchanged.body.plotMaster.plots[0].houseType, 'Ash');
      assert.equal(unchanged.body.plotMaster.plots[0].gia, 900);

      const unrelated = await request(plotManagerApp)
        .put(`/api/developments/${created.body.id}`)
        .send({
          version: created.body.version,
          location: 'Updated without Plot Master mutation',
          plotMaster: created.body.plotMaster,
        });
      assert.equal(unrelated.status, 200);
      assert.equal(unrelated.body.version, created.body.version + 1);
      assert.equal(unrelated.body.location, 'Updated without Plot Master mutation');
    } finally {
      await pool.query('DELETE FROM cvr_periods WHERE id = $1', [inserted.rows[0].id]);
    }
  });

  test('Submitted Site Start blocks an unmarked Plot Master PUT without a partial write', async () => {
    const active = await getActiveClient();
    const plotManagerApp = createPlotManagerApp(active.id);
    const created = await request(app).post('/api/developments').send({
      jobNumber: `DEV-PLOT-SITE-START-${Date.now()}`,
      developmentName: 'Submitted Site Start Plot Guard',
      plotMaster: { plots: [{ id: 'stable-1', plotNumber: '1', houseType: 'Ash', gia: 900 }] },
    });
    assert.equal(created.status, 201);
    trackDevelopment(created.body.id, created.body.jobNumber);
    const inserted = await pool.query(
      `INSERT INTO cvr_periods (
         client_id, development_id, period_key, period_label, period_type,
         status, commentary, version, budget_source, forecast_as_at_month, submitted_at, submitted_by
       ) VALUES ($1, $2, 'SITE_START', 'Site Start', 'site_start', 'submitted', '{}', 1,
         'land_appraisal', '2026-01-01', NOW(), 'route-test') RETURNING id`,
      [active.id, created.body.id]
    );
    try {
      const blocked = await request(plotManagerApp)
        .put(`/api/developments/${created.body.id}`)
        .send({
          version: created.body.version,
          plotMaster: { plots: [{ id: 'stable-1', plotNumber: '1', houseType: 'Oak', gia: 950 }] },
        });
      assert.equal(blocked.status, 409);
      assert.equal(blocked.body.code, 'PLOT_MASTER_UPDATE_BLOCKED_SUBMITTED_CVR');
      const unchanged = await request(app).get(`/api/developments/${created.body.id}`);
      assert.equal(unchanged.body.version, created.body.version);
      assert.equal(unchanged.body.plotMaster.plots[0].houseType, 'Ash');
    } finally {
      await pool.query('DELETE FROM cvr_periods WHERE id = $1', [inserted.rows[0].id]);
    }
  });

  test('bulk Plot Master marker is stripped and Draft monthly CVRs do not trigger the Submitted guard', async () => {
    const active = await getActiveClient();
    const plotManagerApp = createPlotManagerApp(active.id);
    const created = await request(app).post('/api/developments').send({
      jobNumber: `DEV-PLOT-DRAFT-${Date.now()}`,
      developmentName: 'Draft CVR Plot Update',
      plotMaster: {
        plots: [{ id: 'stable-1', plotNumber: '1', houseType: 'Ash', gia: 900 }],
      },
    });
    assert.equal(created.status, 201);
    trackDevelopment(created.body.id, created.body.jobNumber);

    const inserted = await pool.query(
      `INSERT INTO cvr_periods (
         client_id, development_id, period_key, period_label, period_type,
         status, commentary, version, budget_source
       ) VALUES ($1, $2, 'P01', 'P01', 'monthly_cvr', 'draft', '{}', 1, 'legacy_cvr')
       RETURNING id`,
      [active.id, created.body.id]
    );

    try {
      const updated = await request(plotManagerApp)
        .put(`/api/developments/${created.body.id}`)
        .send({
          version: created.body.version,
          plotMasterUpdateMode: 'bulk_structural',
          plotMaster: {
            plots: [{ id: 'stable-1', plotNumber: '1', houseType: 'Oak', gia: 950 }],
          },
        });
      assert.equal(updated.status, 200);
      assert.equal(updated.body.plotMaster.plots[0].houseType, 'Oak');
      assert.equal(updated.body.plotMasterUpdateMode, undefined);
    } finally {
      await pool.query('DELETE FROM cvr_periods WHERE id = $1', [inserted.rows[0].id]);
    }
  });

  test('Submitted transition and Plot Master update serialize on one development authority lock', async () => {
    const active = await getActiveClient();
    const created = await request(app).post('/api/developments').send({
      jobNumber: `DEV-PLOT-RACE-${Date.now()}`,
      developmentName: 'Submit Race Guard',
      plotMaster: { plots: [{ id: 'stable-1', plotNumber: '1', houseType: 'Ash', gia: 900 }] },
    });
    assert.equal(created.status, 201);
    trackDevelopment(created.body.id, created.body.jobNumber);
    const inserted = await pool.query(
      `INSERT INTO cvr_periods (
         client_id, development_id, period_key, period_label, period_type,
         status, commentary, version, budget_source
       ) VALUES ($1, $2, 'P01', 'P01', 'monthly_cvr', 'draft', '{}', 1, 'legacy_cvr')
       RETURNING id`,
      [active.id, created.body.id]
    );
    const submitTx = await pool.connect();
    try {
      await submitTx.query('BEGIN');
      await lockPlotMasterAuthority(submitTx, active.id, created.body.id);
      await submitTx.query(
        `UPDATE cvr_periods SET status='submitted', submitted_at=NOW(), submitted_by='race-test'
          WHERE id=$1`,
        [inserted.rows[0].id]
      );
      let updateSettled = false;
      const updatePromise = updateDevelopment(
        active.id,
        created.body.id,
        { plotMaster: { plots: [{ id: 'stable-1', plotNumber: '1', houseType: 'Oak', gia: 950 }] } },
        created.body.version,
        { actor: 'race-test' }
      ).then((result) => { updateSettled = true; return result; });
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(updateSettled, false);
      await submitTx.query('COMMIT');
      const result = await updatePromise;
      assert.equal(result.ok, false);
      assert.equal(result.code, 'PLOT_MASTER_UPDATE_BLOCKED_SUBMITTED_CVR');
      const unchanged = await request(app).get(`/api/developments/${created.body.id}`);
      assert.equal(unchanged.body.version, created.body.version);
      assert.equal(unchanged.body.plotMaster.plots[0].houseType, 'Ash');
    } finally {
      try { await submitTx.query('ROLLBACK'); } catch { /* transaction already closed */ }
      submitTx.release();
      await pool.query('DELETE FROM cvr_periods WHERE id = $1', [inserted.rows[0].id]);
    }
  });

  test("no DELETE route is exposed", async () => {
    const res = await request(app).delete("/api/developments/dev-any");
    assert.equal(res.status, 404);
  });
}
