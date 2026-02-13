// server/services/activeClient.js
const { pool } = require("../db");

// returns active client row (or null)
async function getActiveClient() {
  const { rows } = await pool.query(
    `select id, name, code
     from clients
     where is_active = true
     order by id desc
     limit 1`
  );
  return rows[0] || null;
}

module.exports = { getActiveClient };
