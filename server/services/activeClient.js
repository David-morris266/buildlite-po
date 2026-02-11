// server/services/activeClient.js
const db = require("../db");

async function getActiveClient() {
  const { rows } = await db.query(
    "select id, code, name from clients where is_active = true limit 1"
  );
  return rows[0] || null;
}

module.exports = { getActiveClient };
