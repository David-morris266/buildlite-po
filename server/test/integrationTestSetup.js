const { init } = require("../db");

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
  await init();
  await ensureActiveTestClient(pool);
}

module.exports = {
  ensureActiveTestClient,
  prepareIntegrationTestDatabase,
};
