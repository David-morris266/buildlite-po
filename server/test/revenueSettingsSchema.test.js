/**
 * BL-032A — development_revenue_settings schema tests (buildlite_test only).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { pool, isDbConfigured } = require("../db");
const { prepareIntegrationTestDatabase } = require("./integrationTestSetup");

const MIGRATION_004 = path.join(__dirname, "..", "migrations", "004_developments.sql");
const MIGRATION_011 = path.join(
  __dirname,
  "..",
  "migrations",
  "011_development_revenue_settings.sql"
);

const testDevelopmentIds = [];
const testTenantIds = [];

function trackDevelopment(id) {
  if (id && !testDevelopmentIds.includes(id)) testDevelopmentIds.push(id);
}

async function ensureSchema() {
  await pool.query(fs.readFileSync(MIGRATION_004, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_011, "utf8"));
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
  test("BL-032A schema skipped — TEST_DATABASE_URL not configured", () => {
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

  test("011 creates development_revenue_settings with required columns and unique", async () => {
    const cols = await pool.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'development_revenue_settings'
        ORDER BY ordinal_position
      `
    );
    const names = cols.rows.map((row) => row.column_name);
    for (const name of [
      "id",
      "client_id",
      "development_id",
      "recognition_policy",
      "strategy",
      "house_type_pricing",
      "revenue_adjustments",
      "recognition_settings",
      "version",
      "created_at",
      "updated_at",
      "created_by",
      "updated_by",
    ]) {
      assert.ok(names.includes(name), `missing column ${name}`);
    }

    const uniques = await pool.query(
      `
        SELECT pg_get_constraintdef(oid) AS def
        FROM pg_constraint
        WHERE conrelid = 'development_revenue_settings'::regclass
          AND contype = 'u'
      `
    );
    assert.ok(
      uniques.rows.some((row) =>
        /client_id.*development_id|development_id.*client_id/.test(row.def)
      ),
      "expected UNIQUE(client_id, development_id)"
    );

    const indexes = await pool.query(
      `
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'development_revenue_settings'
      `
    );
    assert.ok(
      indexes.rows.some((row) => row.indexname === "uq_development_revenue_settings_development_id"),
      "expected unique index on development_id"
    );

    const policyDefault = await pool.query(
      `
        SELECT column_default
        FROM information_schema.columns
        WHERE table_name = 'development_revenue_settings'
          AND column_name = 'recognition_policy'
      `
    );
    assert.match(String(policyDefault.rows[0].column_default), /completion/);
  });

  test("011 rejects invalid recognition_policy and duplicate development rows", async () => {
    const client = await getActiveClient();
    assert.ok(client);
    const developmentId = `dev-rev-schema-${Date.now()}`;
    await pool.query(
      `
        INSERT INTO developments (id, client_id, job_number, development_name, status)
        VALUES ($1, $2, $3, $4, 'live')
      `,
      [developmentId, client.id, `REV-SCH-${Date.now()}`, "Revenue schema test"]
    );
    trackDevelopment(developmentId);

    await assert.rejects(
      () =>
        pool.query(
          `
            INSERT INTO development_revenue_settings (
              client_id, development_id, recognition_policy
            )
            VALUES ($1, $2, 'reservation')
          `,
          [client.id, developmentId]
        ),
      /chk_development_revenue_settings_policy|violates check constraint/i
    );

    await pool.query(
      `
        INSERT INTO development_revenue_settings (client_id, development_id, recognition_policy)
        VALUES ($1, $2, 'completion')
      `,
      [client.id, developmentId]
    );

    await assert.rejects(
      () =>
        pool.query(
          `
            INSERT INTO development_revenue_settings (client_id, development_id)
            VALUES ($1, $2)
          `,
          [client.id, developmentId]
        ),
      /unique|duplicate/i
    );
  });

  test("011 cascades settings when the development is deleted", async () => {
    const client = await getActiveClient();
    const developmentId = `dev-rev-cascade-${Date.now()}`;
    await pool.query(
      `
        INSERT INTO developments (id, client_id, job_number, development_name, status)
        VALUES ($1, $2, $3, $4, 'live')
      `,
      [developmentId, client.id, `REV-CAS-${Date.now()}`, "Revenue cascade test"]
    );

    await pool.query(
      `
        INSERT INTO development_revenue_settings (client_id, development_id)
        VALUES ($1, $2)
      `,
      [client.id, developmentId]
    );

    await pool.query(`DELETE FROM developments WHERE id = $1`, [developmentId]);
    const leftover = await pool.query(
      `SELECT id FROM development_revenue_settings WHERE development_id = $1`,
      [developmentId]
    );
    assert.equal(leftover.rows.length, 0);
  });
}
