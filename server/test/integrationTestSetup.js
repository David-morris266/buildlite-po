const { init } = require("../db");
const { assertActiveTestDatabase } = require("../utils/testDatabaseGuard");
const fs = require('node:fs');
const path = require('node:path');

async function ensureActiveTestClient(pool) {
  const { rows } = await pool.query(
    "SELECT id FROM clients WHERE is_active = true LIMIT 1"
  );
  if (rows.length) {
    return rows[0].id;
  }

  const inserted = await pool.query(
    `
      INSERT INTO clients (code, name, is_active)
      VALUES ($1, $2, true)
      RETURNING id
    `,
    ["BUILDLITE_TEST", "BuildLite Test Tenant"]
  );
  return inserted.rows[0].id;
}

async function prepareIntegrationTestDatabase(pool) {
  await assertActiveTestDatabase(pool);
  await init();
  const hasBudgetSource = await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name='cvr_periods' AND column_name='budget_source'");
  if (!hasBudgetSource.rowCount) {
    await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '045_cvr_development_budget_source.sql'), 'utf8'));
  }
  const hasOnboardingReview = await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name='cost_codes' AND column_name='hierarchy_review_disposition'");
  if (!hasOnboardingReview.rowCount) {
    await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '048_cost_code_onboarding_review.sql'), 'utf8'));
  }
  const hasSummaryRevenue = await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name='development_revenue_settings' AND column_name='revenue_mode'");
  if (!hasSummaryRevenue.rowCount) {
    await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '049_summary_revenue_mode.sql'), 'utf8'));
  }
  await ensureActiveTestClient(pool);
}

module.exports = {
  ensureActiveTestClient,
  prepareIntegrationTestDatabase,
};
