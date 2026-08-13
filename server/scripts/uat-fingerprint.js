#!/usr/bin/env node
/**
 * Read-only UAT fingerprint for buildlite_clone protection checks.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const { Client } = require("pg");
const { parseDatabaseUrl } = require("../utils/databaseUrl");

const TEST_SITE_1_DEV_ID = "dev-1785599776666-zck5pl";
const BUCKET_PLACE_DEV_ID = "dev-1785843994416-19t8ha";
const EXPECTED_POS = [
  "S0004",
  "S0005",
  "S0006",
  "S0007",
  "S0008",
  "S0009",
  "S0010",
  "S0011",
  "S0012",
  "S0013",
];

async function queryCounts(client) {
  const tables = [
    "developments",
    "purchase_orders",
    "packages",
    "commercial_events",
    "commercial_event_audit",
  ];
  const counts = {};
  for (const table of tables) {
    const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
    counts[table] = rows[0].n;
  }
  return counts;
}

async function main() {
  const devUrl = process.env.DATABASE_URL;
  if (!devUrl) {
    console.error("[uat-fingerprint] DATABASE_URL is not set.");
    process.exit(1);
  }

  const target = parseDatabaseUrl(devUrl);
  const client = new Client({ connectionString: devUrl });
  await client.connect();

  try {
    const { rows: dbRow } = await client.query("SELECT current_database() AS db");
    const counts = await queryCounts(client);

    const { rows: devRows } = await client.query(
      "SELECT id, development_name FROM developments ORDER BY id"
    );

    const { rows: testSite1 } = await client.query(
      `
        SELECT
          (SELECT COUNT(*)::int FROM jsonb_array_elements(payload->'plots')) AS plots
        FROM developments
        WHERE id = $1
      `,
      [TEST_SITE_1_DEV_ID]
    );

    const { rows: pos } = await client.query(
      "SELECT po_number FROM purchase_orders ORDER BY po_number"
    );

    const { rows: packageIds } = await client.query(
      `
        SELECT p.id::text
        FROM packages p
        JOIN developments d ON d.id = p.development_id
        WHERE d.id = $1
        ORDER BY p.id
      `,
      [TEST_SITE_1_DEV_ID]
    );

    const { rows: linkedPairs } = await client.query(
      `
        SELECT COUNT(*)::int AS n
        FROM commercial_events ce
        WHERE ce.linked_event_id IS NOT NULL
      `
    );

    const bucket = devRows.find((row) => row.id === BUCKET_PLACE_DEV_ID);

    const fingerprint = {
      database: dbRow[0].db,
      target: `${target.host}:${target.port}/${target.database}`,
      counts,
      developments: devRows,
      testSite1: {
        developmentId: TEST_SITE_1_DEV_ID,
        exists: devRows.some((row) => row.id === TEST_SITE_1_DEV_ID),
        plots: testSite1[0]?.plots ?? null,
        packageIds: packageIds.map((row) => row.id),
        packageCount: packageIds.length,
      },
      bucketPlace: {
        developmentId: BUCKET_PLACE_DEV_ID,
        exists: Boolean(bucket),
        name: bucket?.development_name ?? null,
      },
      purchaseOrders: pos.map((row) => row.po_number),
      linkedCePairs: linkedPairs[0].n,
      expectations: {
        totalDevelopments: 2,
        totalPos: 10,
        totalPackages: 10,
        totalCes: 19,
        totalAudit: 64,
        testSite1Plots: 31,
        testSite1Packages: 10,
        linkedCePairs: 5,
        pos: EXPECTED_POS,
      },
    };

    console.log(JSON.stringify(fingerprint, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[uat-fingerprint] Failed:", err.message);
  process.exit(1);
});
