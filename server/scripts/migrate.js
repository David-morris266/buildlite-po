#!/usr/bin/env node
/**
 * Applies pending SQL migrations in server/migrations/ (sorted by filename).
 * Records each applied file in schema_migrations.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs = require("fs");
const path = require("path");
const { pool } = require("../db");

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          SERIAL PRIMARY KEY,
      filename    TEXT NOT NULL UNIQUE,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getAppliedFilenames() {
  const { rows } = await pool.query(
    "SELECT filename FROM schema_migrations ORDER BY filename"
  );
  return new Set(rows.map((r) => r.filename));
}

async function applyMigration(filename, sql) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query(
      "INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING",
      [filename]
    );
    await client.query("COMMIT");
    console.log(`[migrate] Applied: ${filename}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[migrate] DATABASE_URL is not set.");
    process.exit(1);
  }

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error("[migrate] migrations directory not found:", MIGRATIONS_DIR);
    process.exit(1);
  }

  await ensureMigrationsTable();

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = await getAppliedFilenames();
  let pending = 0;

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`[migrate] Skip (already applied): ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    await applyMigration(file, sql);
    pending++;
  }

  if (pending === 0) {
    console.log("[migrate] No pending migrations.");
  } else {
    console.log(`[migrate] Applied ${pending} migration(s).`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error("[migrate] Failed:", err.message);
  process.exit(1);
});
