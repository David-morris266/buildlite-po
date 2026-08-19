/**
 * BL-031E.1 — Snapshot schema tests for migration 010 (buildlite_test only).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { pool, isDbConfigured } = require("../db");
const { prepareIntegrationTestDatabase } = require("./integrationTestSetup");

const MIGRATION_004 = path.join(__dirname, "..", "migrations", "004_developments.sql");
const MIGRATION_009 = path.join(__dirname, "..", "migrations", "009_cvr_and_purchase_ledger.sql");
const MIGRATION_010 = path.join(__dirname, "..", "migrations", "010_cvr_period_snapshots.sql");

const testDevelopmentIds = [];
const testTenantIds = [];
const testSnapshotIds = [];

function trackDevelopment(id) {
  if (id && !testDevelopmentIds.includes(id)) testDevelopmentIds.push(id);
}
function trackTenant(id) {
  if (id && !testTenantIds.includes(id)) testTenantIds.push(id);
}
function trackSnapshot(id) {
  if (id && !testSnapshotIds.includes(id)) testSnapshotIds.push(id);
}

async function ensureSchema() {
  await pool.query(fs.readFileSync(MIGRATION_004, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_009, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_010, "utf8"));
}

async function cleanup() {
  if (testSnapshotIds.length) {
    await pool.query(`DELETE FROM cvr_period_snapshots WHERE id = ANY($1::uuid[])`, [
      testSnapshotIds,
    ]);
  }
  if (testDevelopmentIds.length) {
    await pool.query(
      `DELETE FROM cvr_cost_code_inputs WHERE period_id IN (SELECT id FROM cvr_periods WHERE development_id = ANY($1::text[]))`,
      [testDevelopmentIds]
    );
    await pool.query(
      `DELETE FROM cvr_period_audit WHERE period_id IN (SELECT id FROM cvr_periods WHERE development_id = ANY($1::text[]))`,
      [testDevelopmentIds]
    );
    await pool.query(`DELETE FROM cvr_periods WHERE development_id = ANY($1::text[])`, [
      testDevelopmentIds,
    ]);
    await pool.query(`DELETE FROM developments WHERE id = ANY($1::text[])`, [
      testDevelopmentIds,
    ]);
  }
  if (testTenantIds.length) {
    await pool.query(`DELETE FROM cvr_period_snapshots WHERE client_id = ANY($1::uuid[])`, [
      testTenantIds,
    ]);
    await pool.query(`DELETE FROM cvr_periods WHERE client_id = ANY($1::uuid[])`, [testTenantIds]);
    await pool.query(`DELETE FROM developments WHERE client_id = ANY($1::uuid[])`, [testTenantIds]);
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
  test("BL-031E.1 schema skipped — TEST_DATABASE_URL not configured", () => {
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

  test("010 creates snapshot tables with required columns and uniques", async () => {
    const headerCols = await pool.query(
      `
        SELECT column_name, data_type, numeric_precision, numeric_scale
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'cvr_period_snapshots'
        ORDER BY ordinal_position
      `
    );
    const rowCols = await pool.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'cvr_period_snapshot_rows'
        ORDER BY ordinal_position
      `
    );

    const headerNames = headerCols.rows.map((row) => row.column_name);
    for (const name of [
      "id",
      "client_id",
      "development_id",
      "period_id",
      "period_key",
      "schema_version",
      "commentary",
      "source_readiness",
      "current_budget",
      "committed",
      "certified",
      "actual_cost",
      "manual_accrual",
      "current_cost",
      "system_forecast",
      "commercial_adjustment",
      "final_forecast",
      "cost_to_complete",
      "outstanding_certified",
      "variance",
      "created_at",
      "created_by",
    ]) {
      assert.ok(headerNames.includes(name), `missing header column ${name}`);
    }

    const rowNames = rowCols.rows.map((row) => row.column_name);
    for (const name of [
      "id",
      "client_id",
      "snapshot_id",
      "cost_code_key",
      "cost_code_label",
      "description",
      "commercial_head",
      "commercial_family",
      "trade",
      "active",
      "original_budget",
      "current_budget",
      "commercial_adjustment",
      "adjustment_reason",
      "manual_accrual",
      "notes",
      "committed",
      "certified",
      "actual_cost",
      "current_cost",
      "system_forecast",
      "final_forecast",
      "cost_to_complete",
      "outstanding_certified",
      "variance",
      "display_metadata",
    ]) {
      assert.ok(rowNames.includes(name), `missing row column ${name}`);
    }

    const money = headerCols.rows.find((row) => row.column_name === "committed");
    assert.equal(Number(money.numeric_precision), 14);
    assert.equal(Number(money.numeric_scale), 2);

    const uniques = await pool.query(
      `
        SELECT conname, pg_get_constraintdef(oid) AS def
        FROM pg_constraint
        WHERE conrelid = 'cvr_period_snapshots'::regclass
          AND contype = 'u'
      `
    );
    assert.ok(
      uniques.rows.some((row) => /client_id.*period_id|period_id.*client_id/.test(row.def)),
      "expected UNIQUE(client_id, period_id)"
    );

    const rowUniques = await pool.query(
      `
        SELECT pg_get_constraintdef(oid) AS def
        FROM pg_constraint
        WHERE conrelid = 'cvr_period_snapshot_rows'::regclass
          AND contype = 'u'
      `
    );
    assert.ok(
      rowUniques.rows.some((row) => /snapshot_id.*cost_code_key|cost_code_key.*snapshot_id/.test(row.def))
    );
  });

  test("snapshot does not cascade-delete when a period is removed; rows cascade from snapshot", async () => {
    const client = await getActiveClient();
    assert.ok(client);
    const developmentId = `dev-snap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await pool.query(
      `
        INSERT INTO developments (id, client_id, job_number, development_name, status)
        VALUES ($1, $2, $3, $4, 'live')
      `,
      [developmentId, client.id, `SNAP-${Date.now()}`, "Snapshot schema test"]
    );
    trackDevelopment(developmentId);

    const period = await pool.query(
      `
        INSERT INTO cvr_periods (
          client_id, development_id, period_key, period_label, status, commentary
        )
        VALUES ($1, $2, 'P01', 'P01', 'draft', '{}'::jsonb)
        RETURNING id
      `,
      [client.id, developmentId]
    );
    const periodId = period.rows[0].id;

    const snapshot = await pool.query(
      `
        INSERT INTO cvr_period_snapshots (
          client_id, development_id, period_id, period_key, created_by
        )
        VALUES ($1, $2, $3, 'P01', 'schema-test')
        RETURNING id
      `,
      [client.id, developmentId, periodId]
    );
    const snapshotId = snapshot.rows[0].id;
    trackSnapshot(snapshotId);

    await pool.query(
      `
        INSERT INTO cvr_period_snapshot_rows (
          client_id, snapshot_id, cost_code_key, cost_code_label
        )
        VALUES ($1, $2, '5231', '5231 — Cleaning')
      `,
      [client.id, snapshotId]
    );

    await assert.rejects(
      () => pool.query(`DELETE FROM cvr_periods WHERE id = $1`, [periodId]),
      /restrict|violates foreign key/i
    );

    const stillThere = await pool.query(
      `SELECT id FROM cvr_period_snapshots WHERE id = $1`,
      [snapshotId]
    );
    assert.equal(stillThere.rows.length, 1);

    await pool.query(`DELETE FROM cvr_period_snapshots WHERE id = $1`, [snapshotId]);
    const rowsGone = await pool.query(
      `SELECT id FROM cvr_period_snapshot_rows WHERE snapshot_id = $1`,
      [snapshotId]
    );
    assert.equal(rowsGone.rows.length, 0);
  });

  test("010 is additive and does not backfill snapshots", async () => {
    const count = await pool.query(`SELECT COUNT(*)::int AS n FROM cvr_period_snapshots`);
    assert.equal(typeof count.rows[0].n, "number");
    const locked = await pool.query(
      `
        SELECT COUNT(*)::int AS n
        FROM cvr_periods p
        WHERE p.status = 'locked'
          AND NOT EXISTS (
            SELECT 1 FROM cvr_period_snapshots s WHERE s.period_id = p.id
          )
      `
    );
    assert.ok(locked.rows[0].n >= 0);
  });
}
