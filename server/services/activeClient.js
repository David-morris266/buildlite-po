// server/services/activeClient.js
const { pool } = require("../db");
const { currentAuth } = require('../auth/requestContext');

// returns active client row (or null)
async function getActiveClient() {
  const auth = currentAuth();
  if (auth?.clientId) {
    const scoped = await pool.query(`select id, name, code from clients where id = $1`, [auth.clientId]);
    return scoped.rows[0] || null;
  }
  if (process.env.BUILDLITE_SERVER_TEST !== '1' && process.env.NODE_ENV !== 'test') {
    throw new Error('Authenticated tenant context is required.');
  }
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
