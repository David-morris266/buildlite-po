const express = require("express");
const router = express.Router();
const db = require("../db");

router.get("/active", async (req, res) => {
  const { rows } = await db.query(
    `select id, code, name from clients where id = $1 limit 1`,
    [req.buildliteAuth.clientId]
  );
  if (!rows[0]) return res.status(404).json({ error: "No active client set" });
  res.json(rows[0]);
});

router.post("/active", async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "code required" });

  const { rows } = await db.query(
    `select c.id, c.code, c.name from clients c
       join client_user_memberships m on m.client_id=c.id
      where c.code=$1 and m.user_id=$2 and m.is_active=true`,
    [code, req.buildliteAuth.userId]
  );
  if (!rows[0]) return res.status(403).json({ error: "No active membership for that client" });
  res.json({ ...rows[0], selectionHeader: "X-BuildLite-Client-Id" });
});

module.exports = router;
