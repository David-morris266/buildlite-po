/**
 * BL-033D.x.3 — development Prelims template provenance schema (buildlite_test only).
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
const MIGRATION_018 = path.join(
  __dirname,
  "..",
  "migrations",
  "018_development_prelims_item_provenance.sql"
);

if (!isDbConfigured()) {
  test("BL-033D.x.3 schema skipped — TEST_DATABASE_URL not configured", () => {
    assert.ok(true);
  });
} else {
  test.before(async () => {
    await prepareIntegrationTestDatabase(pool);
    const db = await pool.query("SELECT current_database() AS db");
    assert.equal(db.rows[0].db, "buildlite_test");
    assert.notEqual(db.rows[0].db, "buildlite_clone");
    await pool.query(fs.readFileSync(MIGRATION_015, "utf8"));
    await pool.query(fs.readFileSync(MIGRATION_018, "utf8"));
  });

  test("018 adds nullable provenance and a partial unique key, not cost_code uniqueness", async () => {
    const sql = fs.readFileSync(MIGRATION_018, "utf8").replace(/--.*$/gm, "");
    assert.match(sql, /ALTER TABLE development_prelims_items/);
    assert.match(sql, /source_template_id/);
    assert.match(sql, /source_template_key/);
    assert.equal(/\bcvr_periods\b|\bcvr_period_snapshots\b/.test(sql), false);
    assert.equal(/\bALTER TABLE client_prelims_templates\b/.test(sql), false);
    assert.equal(/\bALTER TABLE cost_code_classifications\b/.test(sql), false);
    assert.equal(/\bUNIQUE \(.*cost_code_key/.test(sql), false);
    assert.equal(fs.readFileSync(MIGRATION_015, "utf8").includes("source_template_id"), false);

    const cols = await pool.query(
      `
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'development_prelims_items'
      `
    );
    const byName = Object.fromEntries(cols.rows.map((row) => [row.column_name, row.is_nullable]));
    assert.equal(byName.source_template_id, "YES");
    assert.equal(byName.source_template_version, "YES");
    assert.equal(byName.source_template_line_id, "YES");
    assert.equal(byName.source_template_key, "YES");

    const indexes = await pool.query(
      `
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'development_prelims_items'
      `
    );
    const provenance = indexes.rows.find(
      (row) => row.indexname === "uq_development_prelims_items_template_provenance"
    );
    assert.ok(provenance);
    assert.match(provenance.indexdef, /UNIQUE/);
    assert.match(provenance.indexdef, /development_id/);
    assert.match(provenance.indexdef, /source_template_id/);
    assert.match(provenance.indexdef, /source_template_key/);
    assert.equal(
      indexes.rows.some(
        (row) =>
          /UNIQUE/.test(row.indexdef) &&
          /cost_code_key/.test(row.indexdef) &&
          !/source_template/.test(row.indexdef)
      ),
      false
    );
  });
}
