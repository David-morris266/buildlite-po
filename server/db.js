// server/db.js
require('dotenv').config();
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn(
    '[DB] DATABASE_URL not set. The API will not be able to persist data on Render.'
  );
}

const pool = new Pool({
  connectionString,
  ssl: connectionString
    ? { rejectUnauthorized: false }
    : false,
});

// Create tables if they don't exist
async function init() {
  if (!connectionString) {
    console.warn('[DB] Skipping init because DATABASE_URL is missing.');
    return;
  }

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

  console.log('✅ DB tables ready');
}

module.exports = {
  pool,
  init,
};
