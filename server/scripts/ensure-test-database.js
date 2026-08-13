#!/usr/bin/env node
/**
 * Creates buildlite_test (or TEST_DATABASE_URL target) and initialises schema + test tenant.
 * Does not modify DATABASE_URL / buildlite_clone data.
 */
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const dotenv = require("dotenv");

const serverRoot = path.join(__dirname, "..");
dotenv.config({ path: path.join(serverRoot, ".env") });
dotenv.config({ path: path.join(serverRoot, ".env.test.local") });

const { parseDatabaseUrl } = require("../utils/databaseUrl");
const { areEquivalentDatabaseTargets } = require("../utils/databaseUrl");

function deriveTestDatabaseUrl(devUrl) {
  const parsed = new URL(devUrl.replace(/^postgres:\/\//i, "postgresql://"));
  const currentDb = decodeURIComponent(
    (parsed.pathname || "").replace(/^\//, "").split("/")[0] || ""
  );
  const testDb = currentDb.endsWith("_test") ? currentDb : `${currentDb}_test`;
  parsed.pathname = `/${testDb}`;
  return parsed.toString();
}

function writeEnvTestLocal(testUrl) {
  const targetPath = path.join(serverRoot, ".env.test.local");
  if (fs.existsSync(targetPath)) {
    console.log("[ensure-test-db] server/.env.test.local already exists — not overwriting.");
    return;
  }
  fs.writeFileSync(
    targetPath,
    `# Local automated server test database (gitignored)\nTEST_DATABASE_URL=${testUrl}\n`,
    "utf8"
  );
  console.log("[ensure-test-db] Created server/.env.test.local");
}

async function ensureDatabaseExists(adminUrl, databaseName) {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const exists = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [databaseName]
    );
    if (exists.rowCount > 0) {
      console.log(`[ensure-test-db] Database already exists: ${databaseName}`);
      return false;
    }
    await client.query(`CREATE DATABASE ${quoteIdent(databaseName)}`);
    console.log(`[ensure-test-db] Created database: ${databaseName}`);
    return true;
  } finally {
    await client.end();
  }
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function buildAdminUrl(databaseUrl) {
  const parsed = new URL(databaseUrl.replace(/^postgres:\/\//i, "postgresql://"));
  parsed.pathname = "/postgres";
  return parsed.toString();
}

async function initialiseTestDatabase(testUrl) {
  process.env.BUILDLITE_SERVER_TEST = "1";
  process.env.TEST_DATABASE_URL = testUrl;

  const { pool, init } = require("../db");
  const { ensureActiveTestClient } = require("../test/integrationTestSetup");

  try {
    await init();
    await ensureActiveTestClient(pool);
    const { rows } = await pool.query("SELECT current_database() AS db");
    console.log(`[ensure-test-db] Initialised schema in ${rows[0].db}`);
  } finally {
    await pool.end();
  }
}

async function main() {
  const devUrl = process.env.DATABASE_URL;
  if (!devUrl) {
    console.error("[ensure-test-db] DATABASE_URL is not set in server/.env");
    process.exit(1);
  }

  let testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    testUrl = deriveTestDatabaseUrl(devUrl);
    writeEnvTestLocal(testUrl);
    process.env.TEST_DATABASE_URL = testUrl;
  }

  if (areEquivalentDatabaseTargets(testUrl, devUrl)) {
    console.error(
      "[ensure-test-db] TEST_DATABASE_URL must not resolve to the same database as DATABASE_URL."
    );
    process.exit(1);
  }

  const target = parseDatabaseUrl(testUrl);
  if (!target?.database) {
    console.error("[ensure-test-db] Could not parse TEST_DATABASE_URL.");
    process.exit(1);
  }

  const adminUrl = buildAdminUrl(testUrl);
  await ensureDatabaseExists(adminUrl, target.database);
  await initialiseTestDatabase(testUrl);
}

main().catch((err) => {
  console.error("[ensure-test-db] Failed:", err.message);
  process.exit(1);
});
