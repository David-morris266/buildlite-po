// server/db.js
require("dotenv").config();
const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn(
    "[DB] DATABASE_URL not set. The API will not be able to persist data on Render."
  );
}

const pool = new Pool({
  connectionString,
  ssl: connectionString ? { rejectUnauthorized: false } : false,
});

// Helper so routes can call query(...)
function query(text, params) {
  return pool.query(text, params);
}

// Create tables if they don't exist
async function init() {
  if (!connectionString) {
    console.warn("[DB] Skipping init because DATABASE_URL is missing.");
    return;
  }

  /* ------------------------------------------------------------ *
   * CORE TABLES
   * ------------------------------------------------------------ */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id      TEXT PRIMARY KEY,
      name    TEXT NOT NULL,
      payload JSONB NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS purchase_orders (
      po_number TEXT PRIMARY KEY,
      payload   JSONB NOT NULL
    );
  `);

  /* ------------------------------------------------------------ *
   * PAYMENTS / CERTIFICATES
   * ------------------------------------------------------------ */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_certificates (
      id SERIAL PRIMARY KEY,
      job_id TEXT NOT NULL,
      supplier_id TEXT NOT NULL,
      certificate_number INTEGER NOT NULL,
      period_from DATE,
      period_to DATE,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_certificate_lines (
      id SERIAL PRIMARY KEY,
      certificate_id INTEGER NOT NULL 
        REFERENCES payment_certificates(id) 
        ON DELETE CASCADE,
      po_number TEXT NOT NULL,
      line_index INTEGER NOT NULL,
      cost_code TEXT,
      description TEXT,
      qty NUMERIC,
      rate NUMERIC,
      line_value NUMERIC,
      previous_certified NUMERIC NOT NULL DEFAULT 0,
      this_certified NUMERIC NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  console.log("✅ DB tables ready (core + payments)");
}

module.exports = {
  pool,
  query,
  init,
};
