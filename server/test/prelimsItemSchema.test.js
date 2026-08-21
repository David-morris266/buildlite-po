/**
 * BL-033D.1 — development_prelims_items schema tests (buildlite_test only).
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
const MIGRATION_015 = path.join(
  __dirname,
  "..",
  "migrations",
  "015_development_prelims_items.sql"
);

if (!isDbConfigured()) {
  test("BL-033D.1 schema skipped — TEST_DATABASE_URL not configured", () => {
    assert.ok(true);
  });
} else {
  test.before(async () => {
    await prepareIntegrationTestDatabase(pool);
    const db = await pool.query("SELECT current_database() AS db");
    assert.equal(db.rows[0].db, "buildlite_test");
    assert.notEqual(db.rows[0].db, "buildlite_clone");
    await pool.query(fs.readFileSync(MIGRATION_004, "utf8"));
    await pool.query(fs.readFileSync(MIGRATION_015, "utf8"));
  });

  test("015 creates development_prelims_items and does not alter CVR, programme, or classification", async () => {
    const sql = fs.readFileSync(MIGRATION_015, "utf8").replace(/--.*$/gm, "");
    assert.equal(/\bcvr_periods\b|\bcvr_period_snapshots\b/.test(sql), false);
    assert.equal(/\bALTER TABLE development_programme\b/.test(sql), false);
    assert.equal(/\bALTER TABLE cost_code_classifications\b/.test(sql), false);
    assert.equal(/\btotal_months\b|\belapsed_months\b|\btotal_forecast\b/.test(sql), false);

    const classificationSql = fs.readFileSync(MIGRATION_013, "utf8");
    assert.equal(/development_prelims_items/.test(classificationSql), false);
    const programmeSql = fs.readFileSync(MIGRATION_014, "utf8");
    assert.equal(/development_prelims_items/.test(programmeSql), false);

    const cols = await pool.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'development_prelims_items'
        ORDER BY ordinal_position
      `
    );
    const names = cols.rows.map((row) => row.column_name);
    assert.deepEqual(names, [
      "id",
      "client_id",
      "development_id",
      "cost_code_key",
      "name",
      "forecast_driver",
      "status",
      "monthly_rate",
      "start_basis",
      "start_fixed_date",
      "end_basis",
      "end_fixed_date",
      "lump_sum_amount",
      "version",
      "created_at",
      "updated_at",
      "created_by",
      "updated_by",
    ]);
  });

  test("015 rejects STANDARD_CVR and does not require a cost-code master FK", async () => {
    const sql = fs.readFileSync(MIGRATION_015, "utf8");
    assert.match(sql, /CHECK \(forecast_driver IN \('TIME', 'LUMP_SUM'\)\)/);
    assert.equal(/REFERENCES cost_codes/.test(sql), false);
    const fks = await pool.query(
      `
        SELECT confrelid::regclass::text AS ref
        FROM pg_constraint
        WHERE conrelid = 'development_prelims_items'::regclass AND contype = 'f'
      `
    );
    const refs = fks.rows.map((row) => row.ref);
    assert.ok(refs.includes("clients"));
    assert.ok(refs.includes("developments"));
    assert.equal(refs.includes("cost_codes"), false);
    assert.equal(refs.includes("cost_code_classifications"), false);
  });
}
