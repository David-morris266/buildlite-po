/**
 * BL-033C — development_programme schema tests (buildlite_test only).
 * Does not touch buildlite_clone or Test Site 1.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { pool, isDbConfigured } = require("../db");
const { prepareIntegrationTestDatabase } = require("./integrationTestSetup");

const MIGRATION_004 = path.join(__dirname, "..", "migrations", "004_developments.sql");
const MIGRATION_013 = path.join(
  __dirname,
  "..",
  "migrations",
  "013_cost_code_classifications.sql"
);
const MIGRATION_014 = path.join(__dirname, "..", "migrations", "014_development_programme.sql");

const testDevelopmentIds = [];
const testTenantIds = [];

function trackDevelopment(id) {
  if (id && !testDevelopmentIds.includes(id)) testDevelopmentIds.push(id);
}

async function ensureSchema() {
  await pool.query(fs.readFileSync(MIGRATION_004, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_014, "utf8"));
}

async function cleanup() {
  if (testDevelopmentIds.length) {
    await pool.query(`DELETE FROM developments WHERE id = ANY($1::text[])`, [
      testDevelopmentIds,
    ]);
  }
  if (testTenantIds.length) {
    await pool.query(`DELETE FROM clients WHERE id = ANY($1::uuid[])`, [testTenantIds]);
  }
}

async function getActiveClient() {
  const { rows } = await pool.query(
    "SELECT id, code, name FROM clients WHERE is_active = true LIMIT 1"
  );
  return rows[0] || null;
}

if (!isDbConfigured()) {
  test("BL-033C schema skipped — TEST_DATABASE_URL not configured", () => {
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

  test("014 creates development_programme and does not alter classification or CVR tables", async () => {
    const sql = fs.readFileSync(MIGRATION_014, "utf8").replace(/--.*$/gm, "");
    assert.equal(/\bcvr_periods\b|\bcvr_period_snapshots\b|\bcost_code_classifications\b/.test(sql), false);
    const classificationSql = fs.readFileSync(MIGRATION_013, "utf8");
    assert.match(classificationSql, /cost_code_classifications/);
    assert.equal(/development_programme/.test(classificationSql), false);

    const cols = await pool.query(
      `
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'development_programme'
        ORDER BY ordinal_position
      `
    );
    const names = cols.rows.map((row) => row.column_name);
    for (const name of [
      "id",
      "client_id",
      "development_id",
      "site_start",
      "first_completion",
      "final_completion",
      "total_plots",
      "version",
      "created_at",
      "updated_at",
      "created_by",
      "updated_by",
    ]) {
      assert.ok(names.includes(name), `missing column ${name}`);
    }
    const first = cols.rows.find((row) => row.column_name === "first_completion");
    assert.equal(first.is_nullable, "YES");
  });

  test("database rejects inverted chronology and firstCompletion outside bounds", async () => {
    const active = await getActiveClient();
    const developmentId = `dev-prog-schema-${Date.now()}`;
    await pool.query(
      `
        INSERT INTO developments (id, client_id, job_number, development_name, status)
        VALUES ($1, $2, $3, $4, 'live')
      `,
      [developmentId, active.id, `PROG-SCH-${Date.now()}`, "Programme schema"]
    );
    trackDevelopment(developmentId);

    await assert.rejects(
      () =>
        pool.query(
          `
            INSERT INTO development_programme (
              client_id, development_id, site_start, final_completion, total_plots
            ) VALUES ($1, $2, '2029-10-01', '2026-09-01', 31)
          `,
          [active.id, developmentId]
        ),
      /chk_development_programme_span/
    );

    await assert.rejects(
      () =>
        pool.query(
          `
            INSERT INTO development_programme (
              client_id, development_id, site_start, first_completion, final_completion, total_plots
            ) VALUES ($1, $2, '2026-09-01', '2026-08-01', '2029-10-01', 31)
          `,
          [active.id, developmentId]
        ),
      /chk_development_programme_first_completion/
    );
  });
}
