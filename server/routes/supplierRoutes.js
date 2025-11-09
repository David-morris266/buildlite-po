// server/routes/supplierRoutes.js
const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const DATA_DIR = path.join(__dirname, '..', 'data');
const SUPPLIERS_PATH = path.join(DATA_DIR, 'suppliers.json');

// ---- helpers ----
function ensureFile(filePath, defaultJSON = '[]') {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, defaultJSON, 'utf8');
}
function readJSONSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8') || '';
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// support array or { items: [] }
function readSuppliers() {
  ensureFile(SUPPLIERS_PATH, JSON.stringify([], null, 2));
  const data = readJSONSafe(SUPPLIERS_PATH, []);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}
function writeSuppliers(items) {
  ensureFile(SUPPLIERS_PATH, JSON.stringify([], null, 2));
  const out = Array.isArray(items) ? items : [];
  fs.writeFileSync(SUPPLIERS_PATH, JSON.stringify(out, null, 2), 'utf8');
}

// ---- routes ----

// quick debug
router.get('/suppliers/_debug', (_req, res) => {
  const items = readSuppliers();
  res.json({ path: SUPPLIERS_PATH, count: items.length, first: items[0]?.name || null });
});

// list (optional ?q= filter)
router.get('/suppliers', (req, res) => {
  const { q = '' } = req.query || {};
  const t = String(q).trim().toLowerCase();
  let items = readSuppliers();
  if (t) {
    items = items.filter(s =>
      [s.name, s.address1, s.address2, s.city, s.postcode, s.contactName]
        .some(v => String(v || '').toLowerCase().includes(t))
    );
  }
  res.json(items);
});

// read one by id
router.get('/suppliers/:id', (req, res) => {
  const { id } = req.params;
  const items = readSuppliers();
  const s = items.find(x => String(x.id) === String(id));
  if (!s) return res.status(404).json({ message: 'Supplier not found' });
  res.json(s);
});

// (optional) create minimal supplier
router.post('/suppliers', (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) {
    return res.status(400).json({ message: "Field 'name' is required" });
  }
  const items = readSuppliers();
  const supplier = {
    id: b.id || `sup-${Date.now()}`,
    name: String(b.name),
    address1: b.address1 || '',
    address2: b.address2 || '',
    city: b.city || '',
    postcode: b.postcode || '',
    contactName: b.contactName || '',
    email: b.email || '',
    phone: b.phone || '',
    notes: b.notes || ''
  };
  items.push(supplier);
  writeSuppliers(items);
  res.status(201).json(supplier);
});

module.exports = router;
