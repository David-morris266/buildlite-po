// server/routes/jobRoutes.js
const express = require("express");
const { query, isDbConfigured } = require("../db");

const router = express.Router();

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    jobCode: row.job_code,
    jobNumber: row.job_number,
    name: row.name,
    siteAddress: row.site_address,
    siteManager: row.site_manager,
    sitePhone: row.site_phone,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

router.get("/", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }

    const q = (req.query.q || "").toString().trim().toLowerCase();
    let sql = "SELECT * FROM jobs";
    const params = [];

    if (q) {
      sql += `
        WHERE
          LOWER(COALESCE(job_code,   '')) LIKE $1 OR
          LOWER(COALESCE(job_number, '')) LIKE $1 OR
          LOWER(COALESCE(name,       '')) LIKE $1
      `;
      params.push(`%${q}%`);
    }

    sql += " ORDER BY created_at DESC";

    const { rows } = await query(sql, params);
    res.json(rows.map(mapRow));
  } catch (err) {
    console.error("[Jobs] list error:", err);
    res.status(500).json({ message: "Failed to list jobs" });
  }
});

router.post("/", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }

    const body = req.body || {};
    const name = (body.name || "").toString().trim();
    const jobNumber = (
      body.jobNumber ||
      body.jobCode ||
      ""
    )
      .toString()
      .trim();

    if (!name && !jobNumber) {
      return res
        .status(400)
        .json({ message: "Job name or number is required" });
    }

    const jobCode = (body.jobCode || "").toString().trim();
    const siteAddress = (body.siteAddress || "").toString();
    const siteManager = (body.siteManager || "").toString();
    const sitePhone = (body.sitePhone || "").toString();
    const notes = (body.notes || "").toString();

    const { rows } = await query(
      `
        INSERT INTO jobs
        (job_code, job_number, name, site_address, site_manager, site_phone, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *;
      `,
      [jobCode, jobNumber, name, siteAddress, siteManager, sitePhone, notes]
    );

    res.status(201).json(mapRow(rows[0]));
  } catch (err) {
    console.error("[Jobs] create error:", err);
    res.status(500).json({ message: "Failed to create job" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }

    const { rows } = await query("SELECT * FROM jobs WHERE id = $1", [
      req.params.id,
    ]);

    if (!rows.length) {
      return res.status(404).json({ message: "Job not found" });
    }

    res.json(mapRow(rows[0]));
  } catch (err) {
    console.error("[Jobs] get error:", err);
    res.status(500).json({ message: "Failed to load job" });
  }
});

module.exports = router;
