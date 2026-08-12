/**
 * BL-027B.2 — Materialise Test Site 1 packages only (UAT helper).
 *
 * Usage: node server/scripts/materialise-test-site-1-packages.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { pool, init } = require('../db');
const {
  materialisePackagesFromApprovedPos,
} = require('../services/packageMaterialisation');

const TEST_SITE_ID = 'dev-1785599776666-zck5pl';

async function main() {
  await init();

  const { rows: clients } = await pool.query(
    'SELECT id, code, name FROM clients WHERE is_active = true LIMIT 1'
  );
  const client = clients[0];
  if (!client) {
    throw new Error('No active client found.');
  }

  const { rows: developments } = await pool.query(
    'SELECT id, job_number, development_name FROM developments WHERE id = $1 AND client_id = $2 LIMIT 1',
    [TEST_SITE_ID, client.id]
  );
  if (!developments[0]) {
    throw new Error(`Development ${TEST_SITE_ID} not found for active client.`);
  }

  const result = await materialisePackagesFromApprovedPos(client.id, {
    developmentId: TEST_SITE_ID,
  });

  const packages = result.packages
    .filter((pkg) => pkg.developmentId === TEST_SITE_ID)
    .sort((a, b) => String(a.supplierLabel || '').localeCompare(String(b.supplierLabel || '')));

  console.log(JSON.stringify({
    developmentId: TEST_SITE_ID,
    developmentName: developments[0].development_name,
    summary: result.summary,
    packages: packages.map((pkg) => ({
      id: pkg.id,
      orderKey: pkg.orderKey,
      supplierId: pkg.supplierId,
      supplierLabel: pkg.supplierLabel,
      costCode: pkg.costCode,
      poNumbers: pkg.poNumbers,
    })),
    skipped: result.skipped,
  }, null, 2));

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
