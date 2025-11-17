// server/routes/jobRoutes.js
const express = require('express');
const { Pool } = require('pg');

const router = express.Router();

/* ------------------------------------------------------------
 * DB SETUP
 * ---------------------------------------------------------- */

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('[Jobs] DATABASE_URL not set – job routes will not persist data.');
}

const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false }, // OK for Render Postgres
    })
  : null;

async function initJobsTable() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id SERIAL PRIMARY KEY,
        job_code     TEXT,
        job_number   TEXT,
        name         TEXT,
        site_address TEXT,
        site_manager TEXT,
        site_phone   TEXT,
        notes        TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log('[Jobs] jobs table ready');
  } catch (err) {
    console.error('[Jobs] Failed to init jobs table:', err);
  }
}

// Kick off table init on startup
initJobsTable().catch((err) =>
  console.error('[Jobs] init error:', err)
);

/* ------------------------------------------------------------
 * HELPERS
 * ---------------------------------------------------------- */

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

/* ------------------------------------------------------------
 * ROUTES
 * ---------------------------------------------------------- */

/**
 * GET /api/jobs?q=...
 * List jobs (optionally filtered by free-text search)
 */
router.get('/', async (req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({ message: 'Database not configured' });
    }

    const q = (req.query.q || '').toString().trim().toLowerCase();
    let sql = 'SELECT * FROM jobs';
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

    sql += ' ORDER BY created_at DESC';

    const { rows } = await pool.query(sql, params);
    res.json(rows.map(mapRow));
  } catch (err) {
    console.error('[Jobs] list error:', err);
    res.status(500).json({ message: 'Failed to list jobs' });
  }
});

/**
 * POST /api/jobs
 * Create a new job
 */
router.post('/', async (req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({ message: 'Database not configured' });
    }

    const body = req.body || {};

    // Your form usually sends at least a name and/or job number
    const name = (body.name || '').toString().trim();
    const jobNumber = (
      body.jobNumber ||
      body.jobCode || // some older versions used this as the main identifier
      ''
    )
      .toString()
      .trim();

    if (!name && !jobNumber) {
      return res
        .status(400)
        .json({ message: 'Job name or number is required' });
    }

    const jobCode = (body.jobCode || '').toString().trim();
    const siteAddress = (body.siteAddress || '').toString();
    const siteManager = (body.siteManager || '').toString();
    const sitePhone = (body.sitePhone || '').toString();
    const notes = (body.notes || '').toString();

    const { rows } = await pool.query(
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
    console.error('[Jobs] create error:', err);
    res.status(500).json({ message: 'Failed to create job' });
  }
});

/**
 * GET /api/jobs/:id
 * Fetch a single job by ID
 */
router.get('/:id', async (req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({ message: 'Database not configured' });
    }

    const { rows } = await pool.query(
      'SELECT * FROM jobs WHERE id = $1',
      [req.params.id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Job not found' });
    }

    res.json(mapRow(rows[0]));
  } catch (err) {
    console.error('[Jobs] get error:', err);
    res.status(500).json({ message: 'Failed to load job' });
  }
});

module.exports = router;
