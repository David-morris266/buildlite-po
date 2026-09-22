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
  const hasSellingCostsTemplates = await pool.query("SELECT 1 FROM information_schema.tables WHERE table_name='client_selling_cost_templates'");
  if (!hasSellingCostsTemplates.rowCount) {
    await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '020_development_selling_costs_settings.sql'), 'utf8'));
    await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '050_selling_costs_company_templates.sql'), 'utf8'));
  }
  const hasCommercialTemplateAuthority = await pool.query("SELECT 1 FROM permissions WHERE key='commercial_templates.manage'");
  if (!hasCommercialTemplateAuthority.rowCount) {
    await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '051_commercial_template_authority.sql'), 'utf8'));
  }
  const hasDetailedSellingCosts = await pool.query("SELECT 1 FROM information_schema.tables WHERE table_name='development_selling_cost_line_assumptions'");
  if (!hasDetailedSellingCosts.rowCount) {
    await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '052_detailed_selling_costs_development_setup.sql'), 'utf8'));
  }
  const hasSellingCostQuantitySource = await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name='client_selling_cost_template_lines' AND column_name='default_quantity_source'");
  if (!hasSellingCostQuantitySource.rowCount) {
    await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '053_selling_costs_quantity_sources.sql'), 'utf8'));
  }
  const hasClassificationAuthority = await pool.query("SELECT 1 FROM permissions WHERE key='cost_code_classifications.manage'");
  if (!hasClassificationAuthority.rowCount) {
    await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '054_cost_code_classification_authority.sql'), 'utf8'));
  }
  const hasCommercialHeadCategory = await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name='commercial_structure_heads' AND column_name='buildlite_category'");
  if (!hasCommercialHeadCategory.rowCount) {
    await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '055_commercial_head_buildlite_category.sql'), 'utf8'));
  }
  const hasPlotMasterAuthority = await pool.query("SELECT 1 FROM permissions WHERE key='plot_master.manage'");
  if (!hasPlotMasterAuthority.rowCount) {
    await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '056_plot_master_tenure_review.sql'), 'utf8'));
  }
  await ensureActiveTestClient(pool);
}

module.exports = {
  ensureActiveTestClient,
  prepareIntegrationTestDatabase,
};
