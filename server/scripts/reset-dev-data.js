#!/usr/bin/env node
/**
 * BL-010A.02 — Reset local development transactional data.
 * Keeps clients, cost codes, brand profile shell, migrations.
 * Removes POs, suppliers, jobs, payment certificates, and legacy JSON fallbacks.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const { pool } = require("../db");
const { resetServerDemoData } = require("../services/devReset");

async function logCounts(client) {
  const tables = [
    "clients",
    "client_brand_profiles",
    "cost_codes",
    "jobs",
    "suppliers",
    "purchase_orders",
    "payment_certificates",
  ];
  for (const table of tables) {
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n FROM ${table}`
    );
    console.log(`[reset] ${table}: ${rows[0].n}`);
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[reset] DATABASE_URL is not set.");
    process.exit(1);
  }

  const result = await resetServerDemoData();
  console.log("[reset] Cleared tables:", result.clearedTables);
  console.log("[reset] Cleared files:", result.clearedFiles);

  const client = await pool.connect();
  try {
    await logCounts(client);
    console.log("[reset] Development database reset complete.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[reset] Failed:", err.message);
  process.exit(1);
});
