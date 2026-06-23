const fs = require("fs");
const path = require("path");
const { isDbConfigured } = require("../utils/env");

const REQUIRED_TABLES = [
  "clients",
  "purchase_orders",
  "suppliers",
  "cost_codes",
  "jobs",
];

async function listPendingMigrations(pool) {
  const migDir = path.join(__dirname, "..", "migrations");
  if (!fs.existsSync(migDir)) return [];

  const files = fs
    .readdirSync(migDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let applied = new Set();
  try {
    const { rows } = await pool.query(
      "SELECT filename FROM schema_migrations"
    );
    applied = new Set(rows.map((r) => r.filename));
  } catch (_) {
    // schema_migrations may not exist yet on a brand-new database
  }

  return files.filter((f) => !applied.has(f));
}

async function getHealthStatus(pool) {
  const status = {
    ok: false,
    service: "Build Lite API",
    db: {
      connected: false,
      configured: isDbConfigured(),
      requiredTables: REQUIRED_TABLES,
      missingTables: [],
      migrationsPending: false,
      pendingMigrations: [],
    },
  };

  if (!isDbConfigured()) {
    status.db.error = "DATABASE_URL not configured";
    return status;
  }

  try {
    await pool.query("SELECT 1");
    status.db.connected = true;

    const missing = [];
    for (const table of REQUIRED_TABLES) {
      const { rows } = await pool.query(`SELECT to_regclass($1) AS name`, [
        `public.${table}`,
      ]);
      if (!rows[0]?.name) missing.push(table);
    }
    status.db.missingTables = missing;

    const pending = await listPendingMigrations(pool);
    status.db.pendingMigrations = pending;
    status.db.migrationsPending = pending.length > 0;

    status.ok =
      status.db.connected &&
      missing.length === 0 &&
      pending.length === 0;
  } catch (err) {
    status.db.error = err.message;
  }

  return status;
}

module.exports = { getHealthStatus, REQUIRED_TABLES };
