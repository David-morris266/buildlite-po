// server/routes/poRoutes.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const { pool } = require('../db');
const { mapPOToContext, renderPOToPDF } = require('../services/pdf');

const router = express.Router();

/* =========================================
 * COST CODES (still from JSON file)
 * ======================================= */

const DATA_DIR       = path.join(__dirname, '..', 'data');
const COSTCODES_PATH = path.join(DATA_DIR, 'cost_codes.json');

function ensureCostCodesFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(COSTCODES_PATH)) {
    fs.writeFileSync(COSTCODES_PATH, JSON.stringify([], null, 2), 'utf8');
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

function readCostCodes() {
  ensureCostCodesFile();
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

/* =========================================
 * DB HELPERS (POs + Suppliers in Postgres)
 * ======================================= */

// Suppliers

async function dbReadSuppliers() {
  const { rows } = await pool.query(
    'SELECT payload FROM suppliers ORDER BY name ASC'
  );
  return rows.map((r) => r.payload);
}

async function dbCreateSupplier(supplier) {
  await pool.query(
    `
    INSERT INTO suppliers (id, name, payload)
    VALUES ($1, $2, $3)
    ON CONFLICT (id)
    DO UPDATE SET name = EXCLUDED.name, payload = EXCLUDED.payload
    `,
    [supplier.id, supplier.name, supplier]
  );
}

async function dbFindSupplierByName(name) {
  const { rows } = await pool.query(
    'SELECT payload FROM suppliers WHERE lower(name) = lower($1) LIMIT 1',
    [name]
  );
  return rows[0]?.payload || null;
}

async function dbFindSupplierById(id) {
  const { rows } = await pool.query(
    'SELECT payload FROM suppliers WHERE id = $1 LIMIT 1',
    [id]
  );
  return rows[0]?.payload || null;
}

// POs

async function dbReadPOs() {
  const { rows } = await pool.query(
    'SELECT payload FROM purchase_orders'
  );
  return rows.map((r) => r.payload);
}

async function dbGetPO(poNumber) {
  const { rows } = await pool.query(
    'SELECT payload FROM purchase_orders WHERE po_number = $1 LIMIT 1',
    [poNumber]
  );
  return rows[0]?.payload || null;
}

async function dbSavePO(po) {
  await pool.query(
    `
    INSERT INTO purchase_orders (po_number, payload)
    VALUES ($1, $2)
    ON CONFLICT (po_number)
    DO UPDATE SET payload = EXCLUDED.payload
    `,
    [po.poNumber, po]
  );
}

async function dbDeletePO(poNumber) {
  await pool.query(
    'DELETE FROM purchase_orders WHERE po_number = $1',
    [poNumber]
  );
}

/* =========================================
 * SHARED HELPERS (unchanged logic)
 * ======================================= */

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
 * ROUTES — DEBUG / LOOKUPS
 * ======================================= */

// Debug POs
router.get('/po/_debug', async (_req, res) => {
  const items = await dbReadPOs();
  res.json({
    source: 'postgres',
    count: items.length,
    first: items[0]?.poNumber || null,
  });
});

// Cost codes from file
router.get('/po/cost-codes', (_req, res) => {
  res.json(readCostCodes());
});

// Suppliers
router.get('/po/suppliers', async (_req, res) => {
  const suppliers = await dbReadSuppliers();
  res.json(suppliers);
});

router.post('/po/suppliers', async (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) {
    return res.status(400).json({ message: "Field 'name' is required" });
  }

  const existing = await dbFindSupplierByName(String(b.name).trim());
  if (existing) {
    return res.status(409).json({ message: 'Supplier already exists' });
  }

  const now = new Date().toISOString();
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
    createdAt: now,
    updatedAt: now,
  };

  await dbCreateSupplier(sup);
  res.status(201).json(sup);
});

/* =========================================
 * ROUTES — LIST
 * ======================================= */

router.get('/po', async (req, res) => {
  const {
    q = '',
    job = '',
    type = '',
    supplier = '',
    archived = 'false',
  } = req.query || {};

  const all = await dbReadPOs();

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
      // Make job search more forgiving:
      // - job name  (e.g. "Blossom Green – Martley")
      // - job number (e.g. "0754")
      // - job code (from job snapshot or costRef)
      // - job id (db id or costRef)
      const jobName    = (p.job?.name || '').toLowerCase();
      const jobNumber  = (p.job?.jobNumber || '').toLowerCase();
      const jobCode    = (
        p.job?.jobCode ||
        p.costRef?.jobCode ||
        ''
      ).toLowerCase();
      const jobId      = (
        String(p.job?.id || '') ||
        p.costRef?.jobId ||
        ''
      ).toLowerCase();

      const haystack = [jobName, jobNumber, jobCode, jobId];

      if (!haystack.some((v) => v && v.includes(j))) {
        return false;
      }
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
 * ROUTES — PDF
 * ======================================= */

router.get('/po/:poNumber/pdf', async (req, res) => {
  try {
    const { poNumber } = req.params;
    const { download } = req.query;

    const po = await dbGetPO(poNumber);
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
 * ROUTES — APPROVAL HISTORY
 * ======================================= */

router.get('/po/:poNumber/history', async (req, res) => {
  const po = await dbGetPO(req.params.poNumber);
  if (!po) return res.status(404).json({ message: 'PO not found' });
  res.json(po.approval?.history || []);
});

/* =========================================
 * ROUTES — CREATE
 * ======================================= */

router.post('/po', async (req, res) => {
  const body = req.body || {};
  const all  = await dbReadPOs();

  const type     = (body.type || 'M').toUpperCase();
  const poNumber = body.poNumber || nextNumberForType(all, type);
  const now      = new Date().toISOString();

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
    status = 'Issued';
    approvalStatus = 'Pending';
  }

  // --- supplier snapshot ---
  let supplierSnapshot = body.supplierSnapshot || null;
  let supplierId = body.supplierId || '';
  if (supplierId) {
    const found = await dbFindSupplierById(String(supplierId));
    supplierSnapshot =
      found ||
      supplierSnapshot ||
      { id: supplierId, name: body.supplierName || String(supplierId) };
  }

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
  const clauses = body.clauses || {};

  const po = {
    poNumber,
    type,

    supplierId,
    supplierSnapshot,

    costRef: {
      jobId:   body.costRef?.jobId   || '',
      jobCode: body.costRef?.jobCode || '',
      costCode: body.costRef?.costCode || '',
      element: body.costRef?.element || '',
    },

    job: body.job || null,

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

  await dbSavePO(po);
  res.status(201).json(po);
});

/* =========================================
 * ROUTES — UPDATE
 * ======================================= */

router.put('/po/:poNumber', async (req, res) => {
  const body = req.body || {};
  const po = await dbGetPO(req.params.poNumber);
  if (!po) {
    return res.status(404).json({ message: 'PO not found' });
  }

  const currentStatus = String(po.status || '').toLowerCase();
  const editableStatuses = ['draft', 'rejected'];

  if (!editableStatuses.includes(currentStatus)) {
    return res.status(400).json({
      message: `Cannot edit a PO with status '${po.status}'. Only Draft or Rejected can be changed.`,
    });
  }

  const now = new Date().toISOString();

  // supplier snapshot
  let supplierId = po.supplierId;
  let supplierSnapshot = po.supplierSnapshot;

  if (body.supplierId || body.supplierSnapshot) {
    supplierId = body.supplierId || supplierId;
    if (body.supplierSnapshot) {
      supplierSnapshot = body.supplierSnapshot;
    } else if (supplierId) {
      const found = await dbFindSupplierById(String(supplierId));
      supplierSnapshot =
        found ||
        supplierSnapshot ||
        { id: supplierId, name: body.supplierName || String(supplierId) };
    }
  }

  // items
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
      costCode:
        it.costCode || body.costRef?.costCode || po.costRef?.costCode || '',
    }));
  }

  const vatRateDefault =
    Number(
      body.vatRateDefault == null
        ? (po.vatRateDefault == null ? 0.2 : po.vatRateDefault)
        : body.vatRateDefault
    ) || 0;

  const totals = computeTotals(items, vatRateDefault);

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

  await dbSavePO(po);
  res.json(po);
});

/* =========================================
 * ROUTES — APPROVALS
 * ======================================= */

router.post('/po/:poNumber/request-approval', async (req, res) => {
  const po = await dbGetPO(req.params.poNumber);
  if (!po) return res.status(404).json({ message: 'PO not found' });

  if (String(po.status || '').toLowerCase() === 'approved') {
    return res
      .status(400)
      .json({ message: 'Cannot request approval for an Approved PO' });
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

  await dbSavePO(po);
  res.json(po);
});

router.post('/po/:poNumber/approve', async (req, res) => {
  const po = await dbGetPO(req.params.poNumber);
  if (!po) return res.status(404).json({ message: 'PO not found' });

  const { status = 'Approved', approver = '', note = '' } = req.body || {};
  const norm = String(status).toLowerCase();
  if (!['approved', 'rejected'].includes(norm)) {
    return res
      .status(400)
      .json({ message: "status must be 'Approved' or 'Rejected'" });
  }

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

  await dbSavePO(po);
  res.json(po);
});

/* =========================================
 * ROUTES — READ & DELETE
 * ======================================= */

router.get('/po/:poNumber', async (req, res) => {
  const po = await dbGetPO(req.params.poNumber);
  if (!po) return res.status(404).json({ message: 'PO not found' });
  res.json(po);
});

router.delete('/po/:poNumber', async (req, res) => {
  const po = await dbGetPO(req.params.poNumber);
  if (!po) return res.status(404).json({ message: 'PO not found' });

  if ((po.approval?.status || '').toLowerCase() === 'approved') {
    return res
      .status(400)
      .json({ message: 'Cannot delete an Approved PO' });
  }

  await dbDeletePO(req.params.poNumber);
  res.json({ ok: true });
});

module.exports = router;
