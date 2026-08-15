#!/usr/bin/env node
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
require("dotenv").config({
  path: require("path").join(__dirname, "..", ".env.test.local"),
});
process.env.BUILDLITE_SERVER_TEST = "1";

const { pool } = require("../db");

async function count(table) {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
  return rows[0].n;
}

async function main() {
  const { rows: dbRow } = await pool.query("SELECT current_database() AS db");
  const residualDevs = await pool.query(
    `
      SELECT id, development_name
      FROM developments
      WHERE id LIKE 'dev-pkg-%'
         OR id LIKE 'dev-ce-%'
         OR id LIKE 'dev-poappr-%'
         OR id LIKE 'dev-mx-%'
         OR id LIKE 'DEV-T-%'
         OR development_name IN (
           'Package Test Dev',
           'Dev A',
           'Dev B',
           'PO Approval Dev',
           'Server Created Development',
           'Matrix Test Dev'
         )
      ORDER BY id
    `
  );
  const residualPos = await pool.query(
    `
      SELECT po_number
      FROM purchase_orders
      WHERE po_number LIKE 'S-PKG-%'
         OR po_number LIKE 'S-CE-%'
         OR po_number LIKE 'S-APPR-%'
         OR po_number LIKE 'S-DRAFT-%'
         OR po_number LIKE 'S-MX-%'
      ORDER BY po_number
    `
  );

  console.log(
    JSON.stringify(
      {
        database: dbRow[0].db,
        counts: {
          clients: await count("clients"),
          developments: await count("developments"),
          purchase_orders: await count("purchase_orders"),
          packages: await count("packages"),
          commercial_events: await count("commercial_events"),
          commercial_event_audit: await count("commercial_event_audit"),
          package_order_matrices: await count("package_order_matrices"),
        },
        residualFixtureDevelopments: residualDevs.rows,
        residualFixturePos: residualPos.rows,
      },
      null,
      2
    )
  );
  await pool.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
