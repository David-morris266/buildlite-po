/**
 * BL-032D — Snapshot revenue schema tests for migration 012 (buildlite_test only).
 * Does not backfill v1. Does not touch buildlite_clone.
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
const MIGRATION_012 = path.join(
  __dirname,
  "..",
  "migrations",
  "012_cvr_period_snapshot_revenue.sql"
);

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
  await pool.query(fs.readFileSync(MIGRATION_012, "utf8"));
}

async function cleanup() {
  if (testSnapshotIds.length) {
    await pool.query(`DELETE FROM cvr_period_snapshots WHERE id = ANY($1::uuid[])`, [
      testSnapshotIds,
    ]);
  }
  if (testDevelopmentIds.length) {
    await pool.query(`DELETE FROM cvr_periods WHERE development_id = ANY($1::text[])`, [
      testDevelopmentIds,
    ]);
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

async function insertPeriod(clientId, developmentId) {
  await pool.query(
    `
      INSERT INTO developments (id, client_id, job_number, development_name, status)
      VALUES ($1, $2, $3, $4, 'live')
    `,
    [developmentId, clientId, `REV-${Date.now()}`, "012 schema test"]
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
    [clientId, developmentId]
  );
  return period.rows[0].id;
}

if (!isDbConfigured()) {
  test("BL-032D schema skipped — TEST_DATABASE_URL not configured", () => {
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

  test("012 adds nullable Revenue columns with no default 0", async () => {
    const cols = await pool.query(
      `
        SELECT column_name, column_default, is_nullable, numeric_precision, numeric_scale
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'cvr_period_snapshots'
          AND column_name IN (
            'forecast_revenue', 'secured_revenue', 'remaining_forecast_revenue',
            'plots_sold', 'plots_remaining', 'gross_profit', 'gross_margin_percent',
            'revenue_assumptions', 'revenue_settings_id', 'revenue_settings_version'
          )
      `
    );
    const byName = new Map(cols.rows.map((row) => [row.column_name, row]));
    for (const name of [
      "forecast_revenue",
      "secured_revenue",
      "remaining_forecast_revenue",
      "gross_profit",
    ]) {
      assert.equal(byName.get(name).is_nullable, "YES");
      assert.equal(byName.get(name).column_default, null);
      assert.equal(Number(byName.get(name).numeric_precision), 14);
      assert.equal(Number(byName.get(name).numeric_scale), 2);
    }
    assert.equal(byName.get("gross_margin_percent").numeric_precision, 8);
    assert.equal(byName.get("gross_margin_percent").numeric_scale, 4);
    assert.equal(byName.get("revenue_settings_id").is_nullable, "YES");
  });

  test("existing v1 snapshot insert leaves Revenue NULL and rejects £0 backfill", async () => {
    const client = await getActiveClient();
    const developmentId = `dev-012-v1-${Date.now()}`;
    const periodId = await insertPeriod(client.id, developmentId);
    const inserted = await pool.query(
      `
        INSERT INTO cvr_period_snapshots (
          client_id, development_id, period_id, period_key, schema_version, created_by
        )
        VALUES ($1, $2, $3, 'P01', 1, 'schema-test')
        RETURNING id, forecast_revenue, secured_revenue, remaining_forecast_revenue,
                  plots_sold, plots_remaining, gross_profit, gross_margin_percent
      `,
      [client.id, developmentId, periodId]
    );
    trackSnapshot(inserted.rows[0].id);
    const row = inserted.rows[0];
    assert.equal(row.forecast_revenue, null);
    assert.equal(row.secured_revenue, null);
    assert.equal(row.remaining_forecast_revenue, null);
    assert.equal(row.plots_sold, null);
    assert.equal(row.gross_profit, null);
    assert.equal(row.gross_margin_percent, null);

    await assert.rejects(
      () =>
        pool.query(
          `UPDATE cvr_period_snapshots SET forecast_revenue = 0 WHERE id = $1`,
          [row.id]
        ),
      /chk_cvr_snapshot_revenue_presence|violates check/i
    );
  });

  test("schema v2 insert stores Revenue totals and plot rows with unique plot_id", async () => {
    const client = await getActiveClient();
    const developmentId = `dev-012-v2-${Date.now()}`;
    const periodId = await insertPeriod(client.id, developmentId);
    const header = await pool.query(
      `
        INSERT INTO cvr_period_snapshots (
          client_id, development_id, period_id, period_key, schema_version,
          forecast_revenue, secured_revenue, remaining_forecast_revenue,
          plots_sold, plots_remaining, gross_profit, gross_margin_percent,
          revenue_assumptions, created_by
        )
        VALUES (
          $1, $2, $3, 'P01', 2,
          10444608, 0, 10444608,
          0, 31, 8079185, 77.3512,
          '{"recognitionPolicy":"completion"}'::jsonb, 'schema-test'
        )
        RETURNING id
      `,
      [client.id, developmentId, periodId]
    );
    const snapshotId = header.rows[0].id;
    trackSnapshot(snapshotId);

    await pool.query(
      `
        INSERT INTO cvr_period_snapshot_plots (
          client_id, snapshot_id, plot_id, plot_number, forecast_revenue
        )
        VALUES ($1, $2, 'plot-31', '31', 255100)
      `,
      [client.id, snapshotId]
    );

    await assert.rejects(
      () =>
        pool.query(
          `
            INSERT INTO cvr_period_snapshot_plots (
              client_id, snapshot_id, plot_id, plot_number
            )
            VALUES ($1, $2, 'plot-31', '31')
          `,
          [client.id, snapshotId]
        ),
      /unique|duplicate/i
    );

    await assert.rejects(
      () =>
        pool.query(
          `
            INSERT INTO cvr_period_snapshots (
              client_id, development_id, period_id, period_key, schema_version, created_by
            )
            VALUES ($1, $2, $3, 'P99', 2, 'schema-test')
          `,
          [client.id, developmentId, periodId]
        ),
      /chk_cvr_snapshot_revenue_presence|unique|duplicate/i
    );
  });

  test("plot rows cascade when the snapshot header is deleted", async () => {
    const client = await getActiveClient();
    const developmentId = `dev-012-cas-${Date.now()}`;
    const periodId = await insertPeriod(client.id, developmentId);
    const header = await pool.query(
      `
        INSERT INTO cvr_period_snapshots (
          client_id, development_id, period_id, period_key, schema_version,
          forecast_revenue, secured_revenue, remaining_forecast_revenue,
          plots_sold, plots_remaining, gross_profit, revenue_assumptions
        )
        VALUES ($1, $2, $3, 'P01', 2, 0, 0, 0, 0, 0, 0, '{}'::jsonb)
        RETURNING id
      `,
      [client.id, developmentId, periodId]
    );
    const snapshotId = header.rows[0].id;
    await pool.query(
      `
        INSERT INTO cvr_period_snapshot_plots (client_id, snapshot_id, plot_id, plot_number)
        VALUES ($1, $2, 'plot-1', '1')
      `,
      [client.id, snapshotId]
    );
    await pool.query(`DELETE FROM cvr_period_snapshots WHERE id = $1`, [snapshotId]);
    const leftover = await pool.query(
      `SELECT COUNT(*)::int AS n FROM cvr_period_snapshot_plots WHERE snapshot_id = $1`,
      [snapshotId]
    );
    assert.equal(leftover.rows[0].n, 0);
  });
}
