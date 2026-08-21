/**
 * BL-033D.x.1 — client_prelims_templates schema tests (buildlite_test only).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { pool, isDbConfigured } = require("../db");
const { prepareIntegrationTestDatabase } = require("./integrationTestSetup");

const MIGRATION_013 = path.join(__dirname, "..", "migrations", "013_cost_code_classifications.sql");
const MIGRATION_014 = path.join(__dirname, "..", "migrations", "014_development_programme.sql");
const MIGRATION_015 = path.join(
  __dirname,
  "..",
  "migrations",
  "015_development_prelims_items.sql"
);
const MIGRATION_016 = path.join(__dirname, "..", "migrations", "016_client_prelims_templates.sql");

if (!isDbConfigured()) {
  test("BL-033D.x.1 schema skipped — TEST_DATABASE_URL not configured", () => {
    assert.ok(true);
  });
} else {
  test.before(async () => {
    await prepareIntegrationTestDatabase(pool);
    const db = await pool.query("SELECT current_database() AS db");
    assert.equal(db.rows[0].db, "buildlite_test");
    await pool.query(fs.readFileSync(MIGRATION_016, "utf8"));
  });

  test("016 creates company templates and does not alter 013–015 or CVR", async () => {
    const sql = fs.readFileSync(MIGRATION_016, "utf8").replace(/--.*$/gm, "");
    assert.equal(/\bALTER TABLE cost_code_classifications\b/.test(sql), false);
    assert.equal(/\bALTER TABLE development_programme\b/.test(sql), false);
    assert.equal(/\bALTER TABLE development_prelims_items\b/.test(sql), false);
    assert.equal(/\bcvr_periods\b|\bcvr_period_snapshots\b/.test(sql), false);
    assert.equal(/REFERENCES cost_codes/.test(sql), false);

    const prior = [
      fs.readFileSync(MIGRATION_013, "utf8"),
      fs.readFileSync(MIGRATION_014, "utf8"),
      fs.readFileSync(MIGRATION_015, "utf8"),
    ].join("\n");
    assert.equal(/client_prelims_templates/.test(prior), false);

    const indexes = (
      await pool.query(`
        SELECT indexname
        FROM pg_indexes
        WHERE tablename IN ('client_prelims_templates', 'client_prelims_template_lines')
        ORDER BY indexname
      `)
    ).rows.map((row) => row.indexname);
    assert.ok(indexes.includes("uq_client_prelims_templates_one_default"));
    assert.ok(indexes.includes("uq_client_prelims_templates_client_name"));
    assert.ok(indexes.includes("uq_client_prelims_template_lines_key"));
  });

  test("016 allows many lines per cost code and rejects a second default", async () => {
    const client = (
      await pool.query(`INSERT INTO clients (code, name, is_active) VALUES ($1, $2, false) RETURNING id`, [
        `TPL-SCHEMA-${Date.now()}`,
        "Template schema tenant",
      ])
    ).rows[0];
    try {
      const first = await pool.query(
        `
          INSERT INTO client_prelims_templates (client_id, name, origin, is_default)
          VALUES ($1, 'A', 'blank', true)
          RETURNING id
        `,
        [client.id]
      );
      await pool.query(
        `
          INSERT INTO client_prelims_template_lines (
            client_id, template_id, template_key, name, forecast_driver, cost_code_key
          )
          VALUES
            ($1, $2, 'k1', 'One', 'TIME', '5231'),
            ($1, $2, 'k2', 'Two', 'LUMP_SUM', '5231')
        `,
        [client.id, first.rows[0].id]
      );

      await assert.rejects(
        () =>
          pool.query(
            `
              INSERT INTO client_prelims_templates (client_id, name, origin, is_default)
              VALUES ($1, 'B', 'blank', true)
            `,
            [client.id]
          ),
        /uq_client_prelims_templates_one_default|duplicate key/
      );
    } finally {
      await pool.query(`DELETE FROM client_prelims_templates WHERE client_id = $1`, [client.id]);
      await pool.query(`DELETE FROM clients WHERE id = $1`, [client.id]);
    }
  });
}
