// server/routes/jobRoutes.js
const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const DATA_DIR = path.join(__dirname, '..', 'data');
const JOBS_PATH = path.join(DATA_DIR, 'jobs.json');

function ensureFile(filePath, defaultJSON = '[]') {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, defaultJSON, 'utf8');
}
function readJSON(filePath, fallback = []) {
  ensureFile(filePath, JSON.stringify(fallback, null, 2));
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8') || '[]'); }
  catch { return Array.isArray(fallback) ? [] : fallback; }
}
function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// List jobs (optional text search ?q=)
router.get('/', (req, res) => {
  const { q } = req.query || {};
  const all = readJSON(JOBS_PATH, []);
  if (!q) return res.json(all);
  const t = String(q).toLowerCase();
  res.json(all.filter(j =>
    (j.jobCode||'').toLowerCase().includes(t) ||
    (j.jobNumber||'').toLowerCase().includes(t) ||
    (j.name||'').toLowerCase().includes(t) ||
    (j.siteAddress||'').toLowerCase().includes(t)
  ));
});

// Create job
router.post('/', (req, res) => {
  const body = req.body || {};
  const required = ['jobCode','name','siteAddress'];
  for (const f of required) {
    if (!body[f] || !String(body[f]).trim()) {
      return res.status(400).json({ message: `Field '${f}' is required` });
    }
  }
  const all = readJSON(JOBS_PATH, []);
  if (all.some(j => j.jobCode === body.jobCode)) {
    return res.status(409).json({ message: `Job ${body.jobCode} already exists` });
  }
  const job = {
    id: body.id || `job-${Date.now()}`,
    jobCode: String(body.jobCode),
    jobNumber: body.jobNumber || '',          // optional alternative code
    name: String(body.name),                  // e.g. “Martley Fields”
    siteAddress: String(body.siteAddress),
    siteManager: body.siteManager || '',
    sitePhone: body.sitePhone || '',
    client: body.client || '',                // optional
    notes: body.notes || '',
    active: body.active === false ? false : true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  all.push(job);
  writeJSON(JOBS_PATH, all);
  res.status(201).json(job);
});

// Update job
router.put('/:jobCode', (req, res) => {
  const { jobCode } = req.params;
  const all = readJSON(JOBS_PATH, []);
  const idx = all.findIndex(j => j.jobCode === jobCode);
  if (idx === -1) return res.status(404).json({ message: `Job ${jobCode} not found` });
  const cur = all[idx];
  const b = req.body || {};
  const updated = {
    ...cur,
    jobNumber: b.jobNumber ?? cur.jobNumber,
    name: b.name ?? cur.name,
    siteAddress: b.siteAddress ?? cur.siteAddress,
    siteManager: b.siteManager ?? cur.siteManager,
    sitePhone: b.sitePhone ?? cur.sitePhone,
    client: b.client ?? cur.client,
    notes: b.notes ?? cur.notes,
    active: b.active ?? cur.active,
    updatedAt: new Date().toISOString(),
  };
  all[idx] = updated;
  writeJSON(JOBS_PATH, all);
  res.json(updated);
});

// Delete job
router.delete('/:jobCode', (req, res) => {
  const { jobCode } = req.params;
  const all = readJSON(JOBS_PATH, []);
  const next = all.filter(j => j.jobCode !== jobCode);
  if (next.length === all.length) {
    return res.status(404).json({ message: `Job ${jobCode} not found` });
  }
  writeJSON(JOBS_PATH, next);
  res.json({ ok: true });
});

module.exports = router;
