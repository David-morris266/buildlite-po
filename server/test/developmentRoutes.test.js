/**
 * BL-027A.1 — Development API integration tests (requires DATABASE_URL).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const request = require("supertest");
const createApp = require("../app");
const { pool, init, isDbConfigured } = require("../db");
const { DEVELOPMENT_ID_PATTERN } = require("../services/developmentConstants");

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

if (!isDbConfigured()) {
  test("development routes skipped — DATABASE_URL not configured", () => {
    assert.ok(true);
  });
} else {
  test.before(async () => {
    await init();
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

  test("no DELETE route is exposed", async () => {
    const res = await request(app).delete("/api/developments/dev-any");
    assert.equal(res.status, 404);
  });
}
