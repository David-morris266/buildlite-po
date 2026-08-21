/**
 * BL-033B — cost_code_classifications schema tests (buildlite_test only).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { pool, isDbConfigured } = require("../db");
const { prepareIntegrationTestDatabase } = require("./integrationTestSetup");
const { SEMANTIC_GROUPS, FORECAST_DRIVERS } = require("../services/costCodeClassificationConstants");

const MIGRATION_013 = path.join(__dirname, "..", "migrations", "013_cost_code_classifications.sql");

const testTenantIds = [];

async function ensureSchema() {
  await pool.query(fs.readFileSync(MIGRATION_013, "utf8"));
}

async function cleanup() {
  if (testTenantIds.length) {
    await pool.query(`DELETE FROM cost_code_classifications WHERE client_id = ANY($1::uuid[])`, [
      testTenantIds,
    ]);
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
  test("BL-033B schema skipped — TEST_DATABASE_URL not configured", () => {
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

  test("013 creates cost_code_classifications with unique key and no UNCLASSIFIED persist", async () => {
    const cols = await pool.query(
      `
        SELECT column_name, column_default, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'cost_code_classifications'
        ORDER BY ordinal_position
      `
    );
    const names = cols.rows.map((row) => row.column_name);
    for (const name of [
      "id",
      "client_id",
      "cost_code_key",
      "semantic_group",
      "forecast_driver",
      "version",
      "created_at",
      "updated_at",
      "created_by",
      "updated_by",
    ]) {
      assert.ok(names.includes(name), `missing column ${name}`);
    }
    const driver = cols.rows.find((row) => row.column_name === "forecast_driver");
    assert.match(String(driver.column_default || ""), /STANDARD_CVR/);

    const uniques = await pool.query(
      `
        SELECT pg_get_constraintdef(oid) AS def
        FROM pg_constraint
        WHERE conrelid = 'cost_code_classifications'::regclass
          AND contype IN ('u', 'c')
      `
    );
    assert.ok(
      uniques.rows.some((row) => /client_id.*cost_code_key|cost_code_key.*client_id/.test(row.def)),
      "expected UNIQUE(client_id, cost_code_key)"
    );
    assert.ok(
      uniques.rows.some((row) => /semantic_group/.test(row.def) && !/UNCLASSIFIED/.test(row.def)),
      "UNCLASSIFIED must not be a persisted semantic_group"
    );

    const active = await getActiveClient();
    await assert.rejects(
      () =>
        pool.query(
          `
            INSERT INTO cost_code_classifications (
              client_id, cost_code_key, semantic_group, forecast_driver
            )
            VALUES ($1, 'TEMP-UNCLASS', 'UNCLASSIFIED', 'STANDARD_CVR')
          `,
          [active.id]
        ),
      /chk_cost_code_classifications_group/
    );
    await assert.rejects(
      () =>
        pool.query(
          `
            INSERT INTO cost_code_classifications (
              client_id, cost_code_key, semantic_group, forecast_driver
            )
            VALUES ($1, 'TEMP-BAD-DRV', 'PRELIMS', 'HOURS')
          `,
          [active.id]
        ),
      /chk_cost_code_classifications_driver/
    );

    assert.equal(SEMANTIC_GROUPS.UNCLASSIFIED, "UNCLASSIFIED");
    assert.equal(FORECAST_DRIVERS.STANDARD_CVR, "STANDARD_CVR");
  });
}
