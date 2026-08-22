/**
 * BL-033D.x.2A.1 — cost_codes tenant-master schema tests (buildlite_test only).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { pool, isDbConfigured } = require("../db");
const { prepareIntegrationTestDatabase } = require("./integrationTestSetup");

const MIGRATION_013 = path.join(__dirname, "..", "migrations", "013_cost_code_classifications.sql");
const MIGRATION_015 = path.join(
  __dirname,
  "..",
  "migrations",
  "015_development_prelims_items.sql"
);
const MIGRATION_016 = path.join(__dirname, "..", "migrations", "016_client_prelims_templates.sql");
const MIGRATION_017 = path.join(__dirname, "..", "migrations", "017_cost_codes_tenant_master.sql");

const testTenantIds = [];

async function ensureSchema() {
  await pool.query(fs.readFileSync(MIGRATION_017, "utf8"));
}

if (!isDbConfigured()) {
  test("BL-033D.x.2A.1 schema skipped — TEST_DATABASE_URL not configured", () => {
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
    if (testTenantIds.length) {
      await pool.query(`DELETE FROM cost_codes WHERE client_id = ANY($1::uuid[])`, [testTenantIds]);
      await pool.query(`DELETE FROM clients WHERE id = ANY($1::uuid[])`, [testTenantIds]);
    }
  });

  test("017 is additive on cost_codes and does not rewrite historic tables", async () => {
    const sql = fs.readFileSync(MIGRATION_017, "utf8").replace(/--.*$/gm, "");
    assert.match(sql, /ALTER TABLE cost_codes/);
    assert.equal(/\bALTER TABLE cost_code_classifications\b/.test(sql), false);
    assert.equal(/\bALTER TABLE development_prelims_items\b/.test(sql), false);
    assert.equal(/\bALTER TABLE client_prelims_templates\b/.test(sql), false);
    assert.equal(/\bALTER TABLE client_prelims_template_lines\b/.test(sql), false);
    assert.equal(/\bcvr_periods\b|\bcvr_period_snapshots\b|\bcvr_cost_code_inputs\b/.test(sql), false);
    assert.equal(/\bpurchase_orders\b|\bpackages\b|\bcommercial_events\b/.test(sql), false);
    assert.equal(/element\s*=/.test(sql), false);
    assert.equal(fs.readFileSync(MIGRATION_013, "utf8").includes("commercial_head"), false);
    assert.equal(fs.readFileSync(MIGRATION_015, "utf8").includes("commercial_head"), false);
    assert.equal(fs.readFileSync(MIGRATION_016, "utf8").includes("commercial_head"), false);

    const cols = await pool.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'cost_codes'
        ORDER BY ordinal_position
      `
    );
    const names = cols.rows.map((row) => row.column_name);
    for (const name of [
      "id",
      "client_id",
      "code",
      "sub_heading",
      "trade",
      "element",
      "is_active",
      "description",
      "commercial_head",
      "commercial_family",
      "reporting_group",
      "hierarchy_mode",
      "reporting_order",
      "default_vat_treatment",
      "default_order_type",
      "allow_budget",
      "allow_purchase_orders",
      "allow_ledger_import",
      "allow_forecast_adjustment",
      "notes",
      "import_metadata",
      "version",
      "created_at",
      "created_by",
      "updated_at",
      "updated_by",
    ]) {
      assert.ok(names.includes(name), `missing column ${name}`);
    }

    const indexes = (
      await pool.query(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'cost_codes' ORDER BY indexname`
      )
    ).rows.map((row) => row.indexname);
    assert.ok(indexes.includes("uq_cost_codes_client_code_lower"));
    assert.ok(indexes.includes("cost_codes_client_id_code_key"));
  });

  test("017 keeps existing cost_codes rows and does not copy element into description", async () => {
    const tenant = await pool.query(
      `INSERT INTO clients (code, name, is_active) VALUES ($1, $2, false) RETURNING id`,
      [`CC-SCHEMA-${Date.now()}`, "Cost code schema tenant"]
    );
    testTenantIds.push(tenant.rows[0].id);

    const inserted = await pool.query(
      `
        INSERT INTO cost_codes (client_id, code, sub_heading, trade, element, is_active)
        VALUES ($1, '5231', 'Plot & Housebuild Costs - 52', NULL, 'Cleaning', true)
        RETURNING code, element, description, version, is_active
      `,
      [tenant.rows[0].id]
    );
    assert.equal(inserted.rows[0].code, "5231");
    assert.equal(inserted.rows[0].element, "Cleaning");
    assert.equal(inserted.rows[0].description, null);
    assert.equal(inserted.rows[0].version, 1);
    assert.equal(inserted.rows[0].is_active, true);

    await pool.query(
      `
        INSERT INTO cost_codes (client_id, code, sub_heading, trade, element, is_active)
        VALUES ($1, 'P100-SM', 'Prelims', 'Site', 'Site Manager', true)
      `,
      [tenant.rows[0].id]
    );
    const preserved = await pool.query(
      `SELECT code FROM cost_codes WHERE client_id = $1 AND code = 'P100-SM'`,
      [tenant.rows[0].id]
    );
    assert.equal(preserved.rows[0].code, "P100-SM");

    await assert.rejects(
      () =>
        pool.query(
          `
            INSERT INTO cost_codes (client_id, code, is_active)
            VALUES ($1, 'p100-sm', true)
          `,
          [tenant.rows[0].id]
        ),
      /uq_cost_codes_client_code_lower|duplicate key/i
    );
  });
}
