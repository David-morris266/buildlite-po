// server/routes/poRoutes.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const { mapPOToContext, renderPOToPDF } = require('../services/pdf');

const router = express.Router();

/* =========================================
 * STORAGE + HELPERS
 * ======================================= */

const DATA_DIR       = path.join(__dirname, '..', 'data');
const PO_PATH        = path.join(DATA_DIR, 'po-data.json');
const SUPPLIERS_PATH = path.join(DATA_DIR, 'suppliers.json');
const COSTCODES_PATH = path.join(DATA_DIR, 'cost_codes.json');

function ensureFile(p, def = JSON.stringify({ items: [] }, null, 2)) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(p)) fs.writeFileSync(p, def, 'utf8');
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

/* ----- POs: support [] or { items: [] } ----- */
function readPOs() {
  ensureFile(PO_PATH);
  const data = readJSONSafe(PO_PATH, { items: [] });
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

function writePOs(items) {
  ensureFile(PO_PATH);
  const out = { items: Array.isArray(items) ? items : [] };
  fs.writeFileSync(PO_PATH, JSON.stringify(out, null, 2), 'utf8');
}

/* ----- Suppliers: always an array ----- */
function readSuppliers() {
  ensureFile(SUPPLIERS_PATH, JSON.stringify([], null, 2));
  const data = readJSONSafe(SUPPLIERS_PATH, []);
  return Array.isArray(data) ? data : [];
}

function writeSuppliers(items) {
  ensureFile(SUPPLIERS_PATH, JSON.stringify([], null, 2));
  fs.writeFileSync(
    SUPPLIERS_PATH,
    JSON.stringify(Array.isArray(items) ? items : [], null, 2),
    'utf8'
  );
}

/* ----- Cost codes ----- */
function readCostCodes() {
  ensureFile(COSTCODES_PATH, JSON.stringify([], null, 2));
  const data = readJSONSafe(COSTCODES_PATH, []);
  return (Array.isArray(data) ? data : []).map((row) => {
    const code    = row.code || row.Code || row['Cost Code'] || '';
    const sub     = row.subHeading || row['Sub-Heading'] || row.SubHeading || '';
    const trade   = row.trade || row.Trade || '';
    const element = row.element || row.Element || '';
    const label   = [code, trade, element || sub].filter(Boolean).join(' — ');
    return { code, subHeading: sub, trade, element, label };
  });
}

/* ----- Misc helpers ----- */
function nextNumberForType(all, type) {
  const prefix = String(type || 'M').toUpperCase();
  const nums = all
    .filter(
      (p) =>
        (p.type || '').toUpperCase() === prefix &&
        typeof p.poNumber === 'string'
    )
    .map((p) => parseInt((p.poNumber || '').replace(/\D+/g, ''), 10))
    .filter(Number.isFinite);

  const max = nums.length ? Math.max(...nums) : 0;
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

function computeTotals(items = [], vatRateDefault = 0.2) {
  const net = items.reduce((sum, it) => {
    const amt =
      it.amount != null
        ? Number(it.amount) || 0
        : (Number(it.qty || it.quantity || 0) *
           Number(it.rate || it.unitRate || 0));
    return sum + (amt || 0);
  }, 0);

  const vatRate = Number(vatRateDefault) || 0;
  const vat = +(net * vatRate).toFixed(2);
  const gross = +(net + vat).toFixed(2);
  return { net, vat, gross, vatRate };
}

function pushHistory(po, action, by = '', note = '') {
  const now = new Date().toISOString();
  if (!po.approval) po.approval = {};
  if (!Array.isArray(po.approval.history)) po.approval.history = [];
  po.approval.history.push({ at: now, by, action, note });
}

/* =========================================
 * ROUTES — DEBUG / LOOKUPS (BEFORE :poNumber)
 * ======================================= */

// Debug POs
router.get('/po/_debug', (_req, res) => {
  const items = readPOs();
  res.json({
    path: PO_PATH,
    count: items.length,
    first: items[0]?.poNumber || null,
  });
});

// Cost codes
router.get('/po/cost-codes', (_req, res) => {
  res.json(readCostCodes());
});

// Suppliers
router.get('/po/suppliers', (_req, res) => {
  res.json(readSuppliers());
});

router.post('/po/suppliers', (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) {
    return res.status(400).json({ message: "Field 'name' is required" });
  }

  const all = readSuppliers();
  const exists = all.find(
    (s) => s.name.trim().toLowerCase() === String(b.name).trim().toLowerCase()
  );
  if (exists) {
    return res.status(409).json({ message: 'Supplier already exists' });
  }

  const sup = {
    id: b.id || `sup-${Date.now()}`,
    name: String(b.name).trim(),
    address1: b.address1 || '',
    address2: b.address2 || '',
    city: b.city || '',
    postcode: b.postcode || '',
    contactName: b.contactName || '',
    contactEmail: b.contactEmail || '',
    contactPhone: b.contactPhone || '',
    vatNumber: b.vatNumber || '',
    termsDays: Number(b.termsDays || 30),
    notes: b.notes || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  writeSuppliers([sup, ...all]);
  res.status(201).json(sup);
});

/* =========================================
 * ROUTES — LIST
 * ======================================= */

router.get('/po', (req, res) => {
  const {
    q = '',
    job = '',
    type = '',
    supplier = '',
    archived = 'false',
  } = req.query || {};

  const all = readPOs();

  const t  = String(q).trim().toLowerCase();
  const j  = String(job).trim().toLowerCase();
  const ty = String(type).trim().toUpperCase();
  const s  = String(supplier).trim().toLowerCase();
  const incArchived = String(archived).toLowerCase() === 'true';

  const items = all.filter((p) => {
    if (!incArchived && p.archived) return false;
    if (ty && String(p.type || '').toUpperCase() !== ty) return false;

    if (s) {
      const sup = (
        p.supplierSnapshot?.name ||
        p.supplierName ||
        p.supplier ||
        ''
      ).toLowerCase();
      if (!sup.includes(s)) return false;
    }

    if (j) {
      const jobCode = (p.costRef?.jobCode || '').toLowerCase();
      const jobId   = (p.costRef?.jobId   || '').toLowerCase();
      const label   = (p.job?.name || '').toLowerCase();
      if (![jobCode, jobId, label].some((x) => x.includes(j))) return false;
    }

    if (t) {
      const hay = [
        p.poNumber,
        p.title,
        p.notes,
        p.status,
        p.costRef?.costCode,
        p.costRef?.element,
        p.supplierSnapshot?.name,
        p.supplierName,
      ].concat((p.items || []).map((it) => it.description || ''));

      if (!hay.some((v) => String(v || '').toLowerCase().includes(t))) {
        return false;
      }
    }

    return true;
  });

  res.json({ items });
});

/* =========================================
 * ROUTES — PDF (BEFORE /:poNumber)
 * ======================================= */

router.get('/po/:poNumber/pdf', async (req, res) => {
  try {
    const { poNumber } = req.params;
    const { download } = req.query;

    const all = readPOs();
    const po = all.find((p) => p.poNumber === poNumber);
    if (!po) {
      return res
        .status(404)
        .type('text/plain')
        .send(`PO ${poNumber} not found`);
    }

    const ctx = mapPOToContext(po);
    const pdfBuffer = await renderPOToPDF(ctx);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition':
        String(download) === '1'
          ? `attachment; filename="${poNumber}.pdf"`
          : `inline; filename="${poNumber}.pdf"`,
      'Cache-Control': 'no-store',
    });
    res.end(pdfBuffer);
  } catch (err) {
    console.error('PDF failed:', err);
    res
      .status(500)
      .type('text/plain')
      .send(`PDF failed: ${err.message || err}`);
  }
});

/* =========================================
 * ROUTES — APPROVAL HISTORY (BEFORE /:poNumber)
 * ======================================= */

router.get('/po/:poNumber/history', (req, res) => {
  const all = readPOs();
  const po = all.find((p) => p.poNumber === req.params.poNumber);
  if (!po) return res.status(404).json({ message: 'PO not found' });
  res.json(po.approval?.history || []);
});

/* =========================================
 * ROUTES — CREATE
 * ======================================= */

router.post('/po', (req, res) => {
  const body = req.body || {};
  const all  = readPOs();

  const type     = (body.type || 'M').toUpperCase();
  const poNumber = body.poNumber || nextNumberForType(all, type);
  const now      = new Date().toISOString();

  // Decide initial status (default to Draft)
  let status = body.status || 'Draft';
  const statusLc = String(status).toLowerCase();

  let approvalStatus;
  if (statusLc === 'draft') {
    approvalStatus = 'Draft';
  } else if (statusLc === 'rejected') {
    approvalStatus = 'Rejected';
  } else if (statusLc === 'approved') {
    approvalStatus = 'Approved';
  } else {
    // Issued / anything else
    status = 'Issued';
    approvalStatus = 'Pending';
  }

  // --- supplier snapshot ---
  let supplierSnapshot = body.supplierSnapshot || null;
  let supplierId = body.supplierId || '';
  if (supplierId) {
    const suppliers = readSuppliers();
    const found = suppliers.find(
      (s) => String(s.id) === String(supplierId)
    );
    supplierSnapshot =
      found ||
      supplierSnapshot ||
      { id: supplierId, name: body.supplierName || String(supplierId) };
  }

  // --- line items ---
  const items = Array.isArray(body.items)
    ? body.items.map((it) => ({
        description: it.description || '',
        uom: it.uom || it.unit || 'nr',
        qty: Number(it.qty || it.quantity || 0),
        rate: Number(it.rate || it.unitRate || 0),
        amount:
          it.amount != null
            ? Number(it.amount) || 0
            : Number(it.qty || 0) * Number(it.rate || 0),
        costCode: it.costCode || body.costRef?.costCode || '',
      }))
    : [];

  const vatRateDefault =
    Number(
      body.vatRateDefault == null ? 0.2 : body.vatRateDefault
    ) || 0;

  const totals = computeTotals(items, vatRateDefault);

  // Clauses / references from the form (for PDF)
  const clauses = body.clauses || {};

  const po = {
    poNumber,
    type,

    supplierId: supplierId,
    supplierSnapshot,

    costRef: {
      jobId:   body.costRef?.jobId   || '',
      jobCode: body.costRef?.jobCode || '',
      costCode: body.costRef?.costCode || '',
      element: body.costRef?.element || '',
    },

    job: body.job || null, // full job snapshot

    title: body.title || '',
    clauses,

    items,
    subtotal: totals.net,
    vatRateDefault: totals.vatRate,
    totals,

    approval: { status: approvalStatus, history: [] },
    status,
    requiredBy: body.requiredBy || '',
    notes: body.notes || '',

    createdBy: body.createdBy || 'system',
    createdByEmail: body.createdByEmail || '',
    createdByName: body.createdByName || '',
    updatedBy: body.createdBy || 'system',
    createdAt: now,
    updatedAt: now,
    archived: false,
  };

  pushHistory(
    po,
    'CREATED',
    body.createdByName || body.createdByEmail || 'system',
    status === 'Draft' ? 'Draft created' : `Created with status ${status}`
  );

  writePOs([po, ...all]);
  res.status(201).json(po);
});

/* =========================================
 * ROUTES — UPDATE (EDIT DRAFT / REJECTED)
 * ======================================= */

router.put('/po/:poNumber', (req, res) => {
  const body = req.body || {};
  const all = readPOs();
  const idx = all.findIndex((p) => p.poNumber === req.params.poNumber);
  if (idx === -1) {
    return res.status(404).json({ message: 'PO not found' });
  }

  const po = all[idx];
  const currentStatus = String(po.status || '').toLowerCase();
  const editableStatuses = ['draft', 'rejected'];

  if (!editableStatuses.includes(currentStatus)) {
    return res.status(400).json({
      message: `Cannot edit a PO with status '${po.status}'. Only Draft or Rejected can be changed.`,
    });
  }

  const now = new Date().toISOString();

  // --- supplier snapshot (allow update) ---
  let supplierId = po.supplierId;
  let supplierSnapshot = po.supplierSnapshot;

  if (body.supplierId || body.supplierSnapshot) {
    supplierId = body.supplierId || supplierId;
    if (body.supplierSnapshot) {
      supplierSnapshot = body.supplierSnapshot;
    } else if (supplierId) {
      const suppliers = readSuppliers();
      const found = suppliers.find(
        (s) => String(s.id) === String(supplierId)
      );
      supplierSnapshot =
        found ||
        supplierSnapshot ||
        { id: supplierId, name: body.supplierName || String(supplierId) };
    }
  }

  // --- line items ---
  let items = po.items || [];
  if (Array.isArray(body.items)) {
    items = body.items.map((it) => ({
      description: it.description || '',
      uom: it.uom || it.unit || 'nr',
      qty: Number(it.qty || it.quantity || 0),
      rate: Number(it.rate || it.unitRate || 0),
      amount:
        it.amount != null
          ? Number(it.amount) || 0
          : Number(it.qty || 0) * Number(it.rate || 0),
      costCode: it.costCode || body.costRef?.costCode || po.costRef?.costCode || '',
    }));
  }

  const vatRateDefault =
    Number(
      body.vatRateDefault == null
        ? (po.vatRateDefault == null ? 0.2 : po.vatRateDefault)
        : body.vatRateDefault
    ) || 0;

  const totals = computeTotals(items, vatRateDefault);

  // --- apply updates (keeping existing where not supplied) ---
  po.supplierId = supplierId;
  po.supplierSnapshot = supplierSnapshot;

  po.costRef = {
    jobId:   body.costRef?.jobId   ?? po.costRef?.jobId   ?? '',
    jobCode: body.costRef?.jobCode ?? po.costRef?.jobCode ?? '',
    costCode: body.costRef?.costCode ?? po.costRef?.costCode ?? '',
    element: body.costRef?.element ?? po.costRef?.element ?? '',
  };

  po.job = body.job ?? po.job ?? null;

  po.title = body.title ?? po.title ?? '';
  po.clauses = body.clauses ?? po.clauses ?? {};

  po.items = items;
  po.subtotal = totals.net;
  po.vatRateDefault = totals.vatRate;
  po.totals = totals;

  po.requiredBy = body.requiredBy ?? po.requiredBy ?? '';
  po.notes = body.notes ?? po.notes ?? '';

  const updatedBy =
    body.updatedBy ||
    body.updatedByEmail ||
    body.updatedByName ||
    body.createdBy ||
    'system';

  po.updatedBy = updatedBy;
  po.updatedAt = now;

  pushHistory(
    po,
    'UPDATED',
    updatedBy,
    body.updateNote || 'Draft/Rejected PO amended'
  );

  all[idx] = po;
  writePOs(all);
  res.json(po);
});

/* =========================================
 * ROUTES — APPROVALS
 * ======================================= */

router.post('/po/:poNumber/request-approval', (req, res) => {
  const all = readPOs();
  const idx = all.findIndex((p) => p.poNumber === req.params.poNumber);
  if (idx === -1) return res.status(404).json({ message: 'PO not found' });

  const po = all[idx];

  // Prevent sending already approved POs back for approval
  if (String(po.status || '').toLowerCase() === 'approved') {
    return res.status(400).json({ message: 'Cannot request approval for an Approved PO' });
  }

  po.status = 'Issued';
  po.approval = { ...(po.approval || {}), status: 'Pending' };
  pushHistory(
    po,
    'SENT',
    req.body?.by || '',
    req.body?.note || ''
  );
  po.updatedAt = new Date().toISOString();

  all[idx] = po;
  writePOs(all);
  res.json(po);
});

router.post('/po/:poNumber/approve', (req, res) => {
  const all = readPOs();
  const idx = all.findIndex((p) => p.poNumber === req.params.poNumber);
  if (idx === -1) return res.status(404).json({ message: 'PO not found' });

  const { status = 'Approved', approver = '', note = '' } = req.body || {};
  const norm = String(status).toLowerCase();
  if (!['approved', 'rejected'].includes(norm)) {
    return res
      .status(400)
      .json({ message: "status must be 'Approved' or 'Rejected'" });
  }

  const po  = all[idx];
  const now = new Date().toISOString();

  po.status = norm === 'approved' ? 'Approved' : 'Rejected';
  po.approval = {
    ...(po.approval || {}),
    status: po.status,
    approver,
    note,
    decidedAt: now,
  };
  pushHistory(
    po,
    norm === 'approved' ? 'APPROVED' : 'REJECTED',
    approver,
    note
  );
  po.updatedAt = now;

  all[idx] = po;
  writePOs(all);
  res.json(po);
});

/* =========================================
 * ROUTES — READ & DELETE (catch-all at end)
 * ======================================= */

router.get('/po/:poNumber', (req, res) => {
  const all = readPOs();
  const po = all.find((p) => p.poNumber === req.params.poNumber);
  if (!po) return res.status(404).json({ message: 'PO not found' });
  res.json(po);
});

router.delete('/po/:poNumber', (req, res) => {
  const all = readPOs();
  const idx = all.findIndex((p) => p.poNumber === req.params.poNumber);
  if (idx === -1) return res.status(404).json({ message: 'PO not found' });

  if ((all[idx].approval?.status || '').toLowerCase() === 'approved') {
    return res
      .status(400)
      .json({ message: 'Cannot delete an Approved PO' });
  }

  all.splice(idx, 1);
  writePOs(all);
  res.json({ ok: true });
});

module.exports = router;
