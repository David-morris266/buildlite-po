const express = require("express");
const router = express.Router();
const db = require("../db");

// Get active client
router.get("/active", async (req, res) => {
  const { rows } = await db.query(
    `select id, code, name from clients where is_active = true limit 1`
  );
  if (!rows[0]) return res.status(404).json({ error: "No active client set" });
  res.json(rows[0]);
});

// Switch active client by code (admin utility)
router.post("/active", async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "code required" });

  await db.query(`update clients set is_active = false`);
  const { rows } = await db.query(
    `update clients set is_active = true where code = $1 returning id, code, name`,
    [code]
  );
  if (!rows[0]) return res.status(404).json({ error: "Client not found" });
  res.json(rows[0]);
});

module.exports = router;
