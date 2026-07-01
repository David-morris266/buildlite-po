#!/usr/bin/env node
/**
 * BL-010A.02 — Reset local development transactional data.
 * Keeps clients, cost codes, brand profile shell, migrations.
 * Removes POs, suppliers, jobs, payment certificates, and legacy JSON fallbacks.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs = require("fs");
const path = require("path");
const { pool } = require("../db");

const DATA_DIR = path.join(__dirname, "..", "data");

const NEUTRAL_BRAND = {
  legal_name: "BuildLite Homes",
  trading_name: "BuildLite Homes",
  company_number: "12345678",
  vat_number: "GB123456789",
  address_line1: "Example Road",
  address_line2: "Construction Park",
  town: "Example Town",
  postcode: "AB1 2CD",
  phone: "01234 567890",
  email: "accounts@example.co.uk",
};

async function getActiveClientId(client) {
  const active = await client.query(
    `SELECT id FROM clients WHERE is_active = true ORDER BY created_at ASC LIMIT 1`
  );
  if (active.rows.length) return active.rows[0].id;

  const any = await client.query(
    `SELECT id FROM clients ORDER BY created_at ASC LIMIT 1`
  );
  return any.rows[0]?.id || null;
}

async function clearTransactionalData(client) {
  const tables = [
    "purchase_orders",
    "payment_certificates",
    "suppliers",
    "jobs",
  ];

  for (const table of tables) {
    const { rowCount } = await client.query(`DELETE FROM ${table}`);
    console.log(`[reset] Cleared ${table}: ${rowCount} row(s)`);
  }
}

async function applyNeutralBrand(client, clientId) {
  await client.query(
    `UPDATE clients SET name = $1 WHERE id = $2`,
    [NEUTRAL_BRAND.trading_name, clientId]
  );

  await client.query(
    `INSERT INTO client_brand_profiles (
      client_id, legal_name, trading_name, company_number, vat_number,
      address_line1, address_line2, town, postcode, phone, email, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
    ON CONFLICT (client_id) DO UPDATE SET
      legal_name = EXCLUDED.legal_name,
      trading_name = EXCLUDED.trading_name,
      company_number = EXCLUDED.company_number,
      vat_number = EXCLUDED.vat_number,
      address_line1 = EXCLUDED.address_line1,
      address_line2 = EXCLUDED.address_line2,
      town = EXCLUDED.town,
      postcode = EXCLUDED.postcode,
      phone = EXCLUDED.phone,
      email = EXCLUDED.email,
      updated_at = NOW()`,
    [
      clientId,
      NEUTRAL_BRAND.legal_name,
      NEUTRAL_BRAND.trading_name,
      NEUTRAL_BRAND.company_number,
      NEUTRAL_BRAND.vat_number,
      NEUTRAL_BRAND.address_line1,
      NEUTRAL_BRAND.address_line2,
      NEUTRAL_BRAND.town,
      NEUTRAL_BRAND.postcode,
      NEUTRAL_BRAND.phone,
      NEUTRAL_BRAND.email,
    ]
  );
  console.log("[reset] Applied neutral BuildLite brand profile.");
}

function clearLegacyJsonFiles() {
  const files = {
    "jobs.json": [],
    "pos.json": [],
    "suppliers.json": [],
    "po-data.json": { items: [] },
  };

  for (const [file, content] of Object.entries(files)) {
    const target = path.join(DATA_DIR, file);
    fs.writeFileSync(target, `${JSON.stringify(content, null, 2)}\n`, "utf8");
    console.log(`[reset] Wrote empty ${file}`);
  }
}

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

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const clientId = await getActiveClientId(client);
    if (!clientId) {
      throw new Error("No client row found — run npm run seed first.");
    }
    await clearTransactionalData(client);
    await applyNeutralBrand(client, clientId);
    await client.query("COMMIT");
    clearLegacyJsonFiles();
    await logCounts(client);
    console.log("[reset] Development database reset complete.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[reset] Failed:", err.message);
  process.exit(1);
});
