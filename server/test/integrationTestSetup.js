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

async function ensureDefaultTestPrincipal(pool, clientId) {
  const userId = '00000000-0000-0000-0000-000000000001';
  const membershipId = '00000000-0000-0000-0000-000000000002';
  await pool.query(`INSERT INTO buildlite_users(id,auth_provider,provider_user_id,email_snapshot,display_name)
    VALUES($1,'clerk','test-user','test@example.invalid','Test Commercial Manager')
    ON CONFLICT(id) DO NOTHING`, [userId]);
  const role = await pool.query("SELECT id FROM roles WHERE key='commercial_manager' LIMIT 1");
  if (role.rows[0]) {
    await pool.query(`INSERT INTO client_user_memberships(id,client_id,user_id,role_id,is_active)
      VALUES($1,$2,$3,$4,TRUE) ON CONFLICT(id) DO NOTHING`,
      [membershipId, clientId, userId, role.rows[0].id]);
  }
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
  const hasChangeExposureIdentity = await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name='package_variation_account_items' AND column_name='source_commercial_event_id'");
  if (!hasChangeExposureIdentity.rowCount) {
    await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '057_change_exposure_identity.sql'), 'utf8'));
  }
  const hasSiteStartBudget = await pool.query("SELECT 1 FROM information_schema.tables WHERE table_name='development_budget_milestones'");
  if (!hasSiteStartBudget.rowCount) {
    await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '058_site_start_budget_milestone.sql'), 'utf8'));
  }
  const hasTenantProvisioning = await pool.query("SELECT 1 FROM information_schema.tables WHERE table_name='tenant_provisioning_audit'");
  if (!hasTenantProvisioning.rowCount) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '059_secure_tenant_provisioning.sql'), 'utf8'));
  const hasCommercialDirectorStructureAuthority = await pool.query("SELECT 1 FROM role_permissions rp JOIN roles r ON r.id=rp.role_id WHERE r.key='commercial_director' AND rp.permission_key='commercial_structure.manage'");
  if (!hasCommercialDirectorStructureAuthority.rowCount) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '060_commercial_director_structure_authority.sql'), 'utf8'));
  const hasLedgerResolution = await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name='ledger_transactions' AND column_name='source_cost_code_key'");
  if (!hasLedgerResolution.rowCount) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '061_ledger_cost_code_resolution.sql'), 'utf8'));
  const hasMembershipCapabilities = await pool.query("SELECT 1 FROM information_schema.tables WHERE table_name='client_user_membership_capabilities'");
  const membershipMigration=fs.readFileSync(path.join(__dirname, '..', 'migrations', '063_tenant_membership_administration.sql'), 'utf8');
  if (!hasMembershipCapabilities.rowCount) await pool.query(membershipMigration);
  else {const actorGuard=membershipMigration.match(/CREATE OR REPLACE FUNCTION validate_payment_release_batch_actor\(\)[\s\S]*?\$\$ LANGUAGE plpgsql;/i)?.[0];if(actorGuard)await pool.query(actorGuard);}
  const cancellationAudit = await pool.query("SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conname='tenant_membership_authority_audit_operation_check'");
  if (!cancellationAudit.rows[0]?.definition?.includes('invitation_cancelled')) {
    await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '064_membership_invitation_cancellation_audit.sql'), 'utf8'));
  }
  const hasPlatformBootstrapAudit = await pool.query("SELECT 1 FROM information_schema.tables WHERE table_name='platform_identity_bootstrap_audit'");
  if (!hasPlatformBootstrapAudit.rowCount) {
    await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '065_first_platform_operator_bootstrap.sql'), 'utf8'));
  }
  const activeClientId = await ensureActiveTestClient(pool);
  await ensureDefaultTestPrincipal(pool, activeClientId);
}

module.exports = {
  ensureActiveTestClient,
  prepareIntegrationTestDatabase,
};
