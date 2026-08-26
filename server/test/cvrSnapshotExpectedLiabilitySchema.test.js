/** BL-038E snapshot schema; buildlite_test only. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { pool, isDbConfigured } = require("../db");
const { prepareIntegrationTestDatabase } = require("./integrationTestSetup");

const migration = (name) =>
  fs.readFileSync(path.join(__dirname, "..", "migrations", name), "utf8");

if (!isDbConfigured()) {
  test("BL-038E schema skipped — TEST_DATABASE_URL not configured", () => assert.ok(true));
} else {
  test.before(async () => {
    await prepareIntegrationTestDatabase(pool);
    const db = await pool.query("SELECT current_database() AS db");
    assert.equal(db.rows[0].db, "buildlite_test");
    assert.notEqual(db.rows[0].db, "buildlite_clone");
    for (const name of [
      "004_developments.sql",
      "009_cvr_and_purchase_ledger.sql",
      "010_cvr_period_snapshots.sql",
      "012_cvr_period_snapshot_revenue.sql",
      "022_cvr_snapshot_expected_liability.sql",
    ]) {
      await pool.query(migration(name));
    }
  });

  test("022 adds nullable Expected fields and array provenance without a fake default", async () => {
    const columns = await pool.query(`
      SELECT table_name, column_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'cvr_period_snapshots' AND column_name = 'expected_liability')
          OR (table_name = 'cvr_period_snapshot_rows' AND column_name IN
            ('expected_liability', 'expected_liability_provenance'))
        )
      ORDER BY table_name, column_name
    `);
    assert.equal(columns.rows.length, 3);
    for (const column of columns.rows) {
      assert.equal(column.is_nullable, "YES");
      assert.equal(column.column_default, null);
    }
  });

  test("pre-038E snapshots remain Expected-unavailable rather than becoming known zero", async () => {
    const old = await pool.query(`
      SELECT COUNT(*)::int AS captured
      FROM cvr_period_snapshots
      WHERE schema_version < 3 AND expected_liability IS NOT NULL
    `);
    assert.equal(old.rows[0].captured, 0);
  });
}
