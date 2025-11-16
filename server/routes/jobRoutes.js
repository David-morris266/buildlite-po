// server/routes/jobRoutes.js
const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const DATA_DIR = path.join(__dirname, '..', 'data');
const JOBS_PATH = path.join(DATA_DIR, 'jobs.json');

function ensureFile(p) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, JSON.stringify([], null, 2), 'utf8');
  }
}

function readJSONSafe(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    const raw = fs.readFileSync(p, 'utf8') || '';
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function readJobs() {
  ensureFile(JOBS_PATH);
  const data = readJSONSafe(JOBS_PATH, []);
  return Array.isArray(data) ? data : [];
}

function writeJobs(items) {
  ensureFile(JOBS_PATH);
  fs.writeFileSync(
    JOBS_PATH,
    JSON.stringify(Array.isArray(items) ? items : [], null, 2),
    'utf8'
  );
}

/* =========================================
 * LIST + FILTER
 * ======================================= */

router.get('/', (req, res) => {
  const { q = '' } = req.query || {};
  const term = String(q).trim().toLowerCase();

  let jobs = readJobs();

  if (term) {
    jobs = jobs.filter(j => {
      const hay = [
        j.name,
        j.jobNumber,
        j.jobCode,
        j.siteAddress,
        j.client
      ];
      return hay.some(v =>
        String(v || '').toLowerCase().includes(term)
      );
    });
  }

  res.json(jobs);
});

/* =========================================
 * READ SINGLE
 * ======================================= */

router.get('/:id', (req, res) => {
  const jobs = readJobs();
  const job = jobs.find(j => String(j.id) === String(req.params.id));
  if (!job) return res.status(404).json({ message: 'Job not found' });
  res.json(job);
});

/* =========================================
 * CREATE
 * ======================================= */

router.post('/', (req, res) => {
  const b = req.body || {};
  const name = (b.name || '').trim();

  if (!name) {
    return res
      .status(400)
      .json({ message: "Field 'name' is required" });
  }

  const jobs = readJobs();

  const job = {
    id: b.id || `job-${Date.now()}`,
    name,
    jobNumber: b.jobNumber || '',
    jobCode: b.jobCode || '',
    siteAddress: b.siteAddress || '',
    siteManager: b.siteManager || '',
    sitePhone: b.sitePhone || '',
    client: b.client || '',
    notes: b.notes || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  writeJobs([job, ...jobs]);
  res.status(201).json(job);
});

module.exports = router;
