/**
 * BL-033D.x.3R — development Prelims TIME offset schema (buildlite_test only).
 * Does not touch buildlite_clone or Test Site 1.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { pool, isDbConfigured } = require("../db");
const { prepareIntegrationTestDatabase } = require("./integrationTestSetup");

const MIGRATION_015 = path.join(
  __dirname,
  "..",
  "migrations",
  "015_development_prelims_items.sql"
);
const MIGRATION_019 = path.join(
  __dirname,
  "..",
  "migrations",
  "019_development_prelims_time_offsets.sql"
);

if (!isDbConfigured()) {
  test("BL-033D.x.3R schema skipped — TEST_DATABASE_URL not configured", () => {
    assert.ok(true);
  });
} else {
  test.before(async () => {
    await prepareIntegrationTestDatabase(pool);
    const db = await pool.query("SELECT current_database() AS db");
    assert.equal(db.rows[0].db, "buildlite_test");
    assert.notEqual(db.rows[0].db, "buildlite_clone");
    await pool.query(fs.readFileSync(MIGRATION_015, "utf8"));
    await pool.query(fs.readFileSync(MIGRATION_019, "utf8"));
  });

  test("019 adds signed month offsets on development_prelims_items only", async () => {
    const sql = fs.readFileSync(MIGRATION_019, "utf8").replace(/--.*$/gm, "");
    assert.match(sql, /start_offset_months/);
    assert.match(sql, /end_offset_months/);
    assert.match(sql, /BETWEEN -60 AND 60/);
    assert.equal(/\bclient_prelims_template/.test(sql), false);
    assert.equal(/\bcvr_periods\b|\bcvr_period_snapshots\b/.test(sql), false);

    const cols = await pool.query(
      `
        SELECT column_name, column_default, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'development_prelims_items'
          AND column_name IN ('start_offset_months', 'end_offset_months')
        ORDER BY column_name
      `
    );
    assert.equal(cols.rows.length, 2);
    for (const row of cols.rows) {
      assert.equal(row.is_nullable, "NO");
      assert.match(String(row.column_default || ""), /0/);
    }
  });
}
