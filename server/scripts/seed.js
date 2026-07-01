#!/usr/bin/env node
/**
 * Idempotent seed: default client, cost codes, brand profile, client_id backfill.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs = require("fs");
const path = require("path");
const { pool } = require("../db");

const DEFAULT_CLIENT = {
  code: "BUILDLITE",
  name: "BuildLite Homes",
};

const COST_CODES_PATH = path.join(__dirname, "..", "data", "cost_codes.json");

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

async function ensureDefaultClient(client) {
  const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM clients`);
  if (rows[0].n > 0) {
    const activeId = await getActiveClientId(client);
    if (!activeId) {
      await client.query(
        `UPDATE clients SET is_active = true
         WHERE id = (SELECT id FROM clients ORDER BY created_at ASC LIMIT 1)`
      );
      console.log("[seed] Activated first existing client.");
    }
    const id = await getActiveClientId(client);
    return id;
  }

  const inserted = await client.query(
    `INSERT INTO clients (code, name, is_active)
     VALUES ($1, $2, true)
     RETURNING id`,
    [DEFAULT_CLIENT.code, DEFAULT_CLIENT.name]
  );
  console.log(`[seed] Created default client (${DEFAULT_CLIENT.code}).`);
  return inserted.rows[0].id;
}

async function ensureBrandProfile(client, clientId) {
  await client.query(
    `INSERT INTO client_brand_profiles (client_id)
     VALUES ($1)
     ON CONFLICT (client_id) DO NOTHING`,
    [clientId]
  );
}

async function seedCostCodes(client, clientId) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n FROM cost_codes WHERE client_id = $1`,
    [clientId]
  );
  if (rows[0].n > 0) {
    console.log(`[seed] cost_codes already populated (${rows[0].n} rows).`);
    return rows[0].n;
  }

  if (!fs.existsSync(COST_CODES_PATH)) {
    console.warn("[seed] cost_codes.json not found — skipping cost code seed.");
    return 0;
  }

  const raw = JSON.parse(fs.readFileSync(COST_CODES_PATH, "utf8"));
  if (!Array.isArray(raw) || raw.length === 0) {
    console.warn("[seed] cost_codes.json empty — skipping.");
    return 0;
  }

  let inserted = 0;
  for (const row of raw) {
    const code = String(row["Cost Code"] ?? row.code ?? "").trim();
    if (!code) continue;

    await client.query(
      `INSERT INTO cost_codes (client_id, code, sub_heading, trade, element, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (client_id, code) DO NOTHING`,
      [
        clientId,
        code,
        row["Sub-Heading"] ?? row.sub_heading ?? null,
        row.Trade ?? row.trade ?? null,
        row.Element ?? row.element ?? null,
      ]
    );
    inserted++;
  }
  console.log(`[seed] Seeded ${inserted} cost codes.`);
  return inserted;
}

async function backfillClientIds(client, clientId) {
  const po = await client.query(
    `UPDATE purchase_orders SET client_id = $1 WHERE client_id IS NULL`,
    [clientId]
  );
  const sup = await client.query(
    `UPDATE suppliers SET client_id = $1 WHERE client_id IS NULL`,
    [clientId]
  );
  console.log(
    `[seed] Backfill client_id: purchase_orders=${po.rowCount}, suppliers=${sup.rowCount}`
  );
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
    console.log(`[seed] ${table}: ${rows[0].n}`);
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[seed] DATABASE_URL is not set.");
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const clientId = await ensureDefaultClient(client);
    await ensureBrandProfile(client, clientId);
    await seedCostCodes(client, clientId);
    await backfillClientIds(client, clientId);
    await client.query("COMMIT");
    await logCounts(client);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[seed] Failed:", err.message);
  process.exit(1);
});
