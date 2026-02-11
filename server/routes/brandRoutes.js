const express = require("express");
const router = express.Router();
const { pool } = require("../db");
const { getActiveClient } = require("../services/activeClient");

// GET /api/brand/active
router.get("/active", async (_req, res) => {
  try {
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const { rows } = await pool.query(
      "select * from client_brand_profiles where client_id = $1",
      [active.id]
    );

    res.json({ client: active, brand: rows[0] || {} });
  } catch (err) {
    console.error("GET /brand/active failed:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
