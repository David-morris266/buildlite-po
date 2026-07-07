const express = require("express");
const { isProduction } = require("../utils/env");
const { resetServerDemoData } = require("../services/devReset");

const router = express.Router();

/**
 * POST /api/developer/reset
 * Development-only — clears server-side demo transactional data.
 */
router.post("/reset", async (_req, res) => {
  if (isProduction()) {
    return res.status(404).json({ message: "Not found" });
  }

  try {
    const result = await resetServerDemoData();
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error("[developer/reset]", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Server reset failed.",
    });
  }
});

module.exports = router;
