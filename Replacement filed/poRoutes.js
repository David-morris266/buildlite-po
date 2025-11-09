// server/routes/poRoutes.js
const express = require('express');
const fs = require('fs');
const path = require('path');

const { sendMail, getApproverList } = require('../mail');              // optional emails
const { mapPOToContext, renderPOToPDF } = require('../services/pdf');  // PDF render

const router = express.Router();

/* ------------------------------------------------------------------ *
 * Paths
 * ------------------------------------------------------------------ */
const DATA_DIR = path.join(__dirname, '..', 'data');
const PO_DATA_PATH = path.join(DATA_DIR, 'po-data.json');
const COST_CODES_PATH = path.join(DATA_DIR, 'cost_codes.json');
const SUPPLIERS_PATH = path.join(DATA_DIR, 'suppliers.json');

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */
function ensureFile(filePath, defaultJSON = '[]') {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, defaultJSON, 'utf8');
}
function readJSON(filePath, fallback = []) {
  ensureFile(filePath, JSON.stringify(fallback, null, 2));
  const raw = fs.readFileSync(filePath, 'utf8');
  try { return JSON.parse(raw || '[]'); }
  catch { return Array.isArray(fallback) ? [] : fallback; }
}
function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

const TYPE_MAP = { M: 'M', S: 'S', P: 'P', Materials: 'M', Subcontract: 'S', Plant: 'P' };
function getNextPONumber(poList, prefix) {
  const nums = poList
    .filter(po => po.poNumber && po.poNumber.startsWith(prefix))
    .map(po => parseInt(po.poNumber.slice(1), 10))
    .filter(n => Number.isFinite(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

/* ------------------------------------------------------------------ *
 * Health
 * ------------------------------------------------------------------ */
router.get('/health', (_req, res) => res.json({ ok: true }));

/* ================================================================== *
 * SUPPLIERS API
 * ================================================================== */
router.get('/suppliers', (_req, res) => {
  try {
    ensureFile(SUPPLIERS_PATH, '[]');
    return res.json(readJSON(SUPPLIERS_PATH, []));
  } catch (err) {
    res.status(500).json({ message: 'Error reading suppliers', error: err.message });
  }
});

router.post('/suppliers', (req, res) => {
  try {
    ensureFile(SUPPLIERS_PATH, '[]');
    const all = readJSON(SUPPLIERS_PATH, []);
    const body = req.body || {};
    if (!body.name || !String(body.name).trim()) {
      return res.status(400).json({ message: 'Supplier name is required' });
    }
    const id = body.id || `sup-${Date.now()}`;
    all.push({
      id,
      name: String(body.name),
      address1: body.address1 || '',
      address2: body.address2 || '',
      city: body.city || '',
      postcode: body.postcode || '',
      contactName: body.contactName || '',
      contactEmail: body.contactEmail || '',
      contactPhone: body.contactPhone || '',
      vatNumber: body.vatNumber || '',
      termsDays: Number(body.termsDays) || 30,
      notes: body.notes || ''
    });
    writeJSON(SUPPLIERS_PATH, all);
    res.status(201).json(all.at(-1));
  } catch (err) {
    res.status(500).json({ message: 'Error saving supplier', error: err.message });
  }
});

router.put('/suppliers/:id', (req, res) => {
  try {
    ensureFile(SUPPLIERS_PATH, '[]');
    const all = readJSON(SUPPLIERS_PATH, []);
    const { id } = req.params;
    const idx = all.findIndex(s => s.id === id);
    if (idx === -1) return res.status(404).json({ message: `Supplier ${id} not found` });
    const cur = all[idx];
    const b = req.body || {};
    all[idx] = {
      ...cur,
      name: b.name ?? cur.name,
      address1: b.address1 ?? cur.address1,
      address2: b.address2 ?? cur.address2,
      city: b.city ?? cur.city,
      postcode: b.postcode ?? cur.postcode,
      contactName: b.contactName ?? cur.contactName,
      contactEmail: b.contactEmail ?? cur.contactEmail,
      contactPhone: b.contactPhone ?? cur.contactPhone,
      vatNumber: b.vatNumber ?? cur.vatNumber,
      termsDays: Number(b.termsDays ?? cur.termsDays) || 0,
      notes: b.notes ?? cur.notes,
    };
    writeJSON(SUPPLIERS_PATH, all);
    res.json(all[idx]);
  } catch (err) {
    res.status(500).json({ message: 'Error updating supplier', error: err.message });
  }
});

router.delete('/suppliers/:id', (req, res) => {
  try {
    ensureFile(SUPPLIERS_PATH, '[]');
    const all = readJSON(SUPPLIERS_PATH, []);
    const { id } = req.params;
    const next = all.filter(s => s.id !== id);
    if (next.length === all.length) {
      return res.status(404).json({ message: `Supplier ${id} not found` });
    }
    writeJSON(SUPPLIERS_PATH, next);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: 'Error deleting supplier', error: err.message });
  }
});

/* ================================================================== *
 * COST CODES (simple normaliser)
 * ================================================================== */
router.get('/cost-codes', (_req, res) => {
  try {
    ensureFile(COST_CODES_PATH, '[]');
    const raw = readJSON(COST_CODES_PATH, []);
    const rows = [];
    for (const item of raw) {
      if (item && typeof item === 'object') {
        const cc = item['Cost Code'] ?? item.costCode ?? item.code ?? null;
        if (!cc) continue;
        rows.push({
          jobCode: null,
          costCode: String(cc),
          name: item['Element'] || item.name || '',
          trade: item['Trade'] || '',
          subHeading: item['Sub-Heading'] || '',
        });
      } else if (typeof item === 'string') {
        rows.push({ jobCode: null, costCode: item, name: '' });
      }
    }
    const seen = new Set();
    const uniq = rows.filter(r => (seen.has(r.costCode) ? false : (seen.add(r.costCode), true)));
    res.json(uniq);
  } catch (err) {
    res.status(500).json({ message: 'Error reading cost codes', error: err.message });
  }
});

/* ================================================================== *
 * PURCHASE ORDERS
 * ================================================================== */

// CREATE PO
router.post('/', (req, res) => {
  try {
    const body = req.body || {};
    const supplierId = body.supplierId || body.supplier;
    if (!supplierId) return res.status(400).json({ message: 'Supplier required' });

    ensureFile(SUPPLIERS_PATH, '[]');
    const suppliers = readJSON(SUPPLIERS_PATH, []);
    const supplierObj = suppliers.find(s => s.id === supplierId) || {};

    const type = TYPE_MAP[body.type] || body.type;
    if (!['M', 'S', 'P'].includes(type)) return res.status(400).json({ message: 'Invalid type' });

    ensureFile(PO_DATA_PATH, '[]');
    const all = readJSON(PO_DATA_PATH, []);

    const poNumber = getNextPONumber(all, type);
    const items = Array.isArray(body.items) ? body.items : [];
    const subtotal = Number(
      body.subtotal ??
      body.amount ??
      items.reduce((s, i) => s + (Number(i.amount ?? (Number(i.qty)||0)*(Number(i.rate)||0)) || 0), 0)
    ) || 0;

    const vatRateDefault = Number(body.vatRateDefault ?? 0.2);
    const totals = {
      net: subtotal,
      vatRate: vatRateDefault,
      gross: +(subtotal * (1 + vatRateDefault)).toFixed(2)
    };

    const now = new Date().toISOString();
    const po = {
      poNumber,
      type,
      supplierId,
      supplierSnapshot: supplierObj,
      costRef: {
        jobId: body.costRef?.jobId || '',
        jobCode: body.costRef?.jobCode || '',
        costCode: body.costRef?.costCode || '',
        element: body.costRef?.element || '',
      },
      title: body.title || '',
      items,
      subtotal,
      vatRateDefault,
      totals,
      approval: { status: 'Pending' },
      status: 'Issued',
      requiredBy: body.requiredBy || '',
      notes: body.notes || '',
      createdBy: body.createdBy || 'system',
      createdByEmail: body.createdByEmail || '',
      createdByName: body.createdByName || '',
      updatedBy: body.createdBy || 'system',
      createdAt: now,
      updatedAt: now,
      archived: false
    };

    all.push(po);
    writeJSON(PO_DATA_PATH, all);
    res.status(201).json(po);
  } catch (err) {
    res.status(500).json({ message: 'Error saving PO', error: err.message });
  }
});

/**
 * LIST (basic filters supported)
 */
router.get('/', (req, res) => {
  try {
    ensureFile(PO_DATA_PATH, '[]');
    const list = readJSON(PO_DATA_PATH, []);
    const { type, supplier, archived, q, flat } = req.query || {};
    let rows = list;
    if (type) {
      const t = TYPE_MAP[type] || type;
      rows = rows.filter(p => p.type === t);
    }
    if (supplier) {
      const s = String(supplier).toLowerCase();
      rows = rows.filter(p =>
        String(p.supplierId || '').toLowerCase().includes(s) ||
        String(p.supplierSnapshot?.name || '').toLowerCase().includes(s)
      );
    }
    if (archived === 'true') rows = rows.filter(p => p.archived === true);
    if (archived === 'false') rows = rows.filter(p => p.archived !== true);
    if (q) {
      const t = String(q).toLowerCase();
      rows = rows.filter(p =>
        (p.poNumber || '').toLowerCase().includes(t) ||
        (p.title || '').toLowerCase().includes(t) ||
        (p.supplierSnapshot?.name || '').toLowerCase().includes(t) ||
        (p.items || []).some(i => (i.description || '').toLowerCase().includes(t))
      );
    }
    return res.json(flat === '1' ? rows : { data: rows, meta: { total: rows.length } });
  } catch (err) {
    res.status(500).json({ message: 'Error reading POs', error: err.message });
  }
});

/* ================================================================== *
 * PDF (place BEFORE the catch-all :poNumber GET)
 * ================================================================== */

// PDF (binary)
router.get('/:poNumber/pdf', async (req, res) => {
  try {
    const { poNumber } = req.params;
    ensureFile(PO_DATA_PATH, '[]');
    const all = readJSON(PO_DATA_PATH, []);
    const po = all.find(p => String(p.poNumber) === String(poNumber));
    if (!po) return res.status(404).type('text/plain').send('PO not found');

    const ctx = mapPOToContext(po);
    const pdfBuffer = await renderPOToPDF(ctx);

    console.log(`[PDF] ${poNumber} bytes:`, pdfBuffer.length);

    res.status(200);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${poNumber}.pdf"`,
      'Content-Length': pdfBuffer.length,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    return res.end(pdfBuffer);
  } catch (err) {
    console.error('[PO PDF ERROR]', err.stack || err.message);
    res.status(500).type('text/plain').send(`PDF failed:\n${err.stack || err.message}`);
  }
});

// PDF diagnostics
router.get('/:poNumber/pdf.debug', async (req, res) => {
  try {
    const { poNumber } = req.params;
    ensureFile(PO_DATA_PATH, '[]');
    const all = readJSON(PO_DATA_PATH, []);
    const po = all.find(p => String(p.poNumber) === String(poNumber));
    if (!po) return res.status(404).type('text/plain').send('PO not found');

    const templatePath = path.join(__dirname, '..', 'templates', 'po.hbs');
    const exists = fs.existsSync(templatePath);
    const size = exists ? fs.statSync(templatePath).size : 0;

    let pdfLen = 0, renderErr = null;
    try {
      const buf = await renderPOToPDF(mapPOToContext(po));
      pdfLen = buf.length;
    } catch (e) {
      renderErr = e.stack || e.message;
    }

    res.type('text/plain').send([
      `PO: ${poNumber}`,
      `Items: ${(po.items || []).length}`,
      `Template exists: ${exists}`,
      `Template size: ${size}`,
      `PDF length: ${pdfLen}`,
      `Render error: ${renderErr || '(none)'}`,
    ].join('\n'));
  } catch (err) {
    res.status(500).type('text/plain').send(err.stack || err.message);
  }
});

/* ================================================================== *
 * APPROVAL WORKFLOW (place BEFORE catch-all :poNumber GET)
 * ================================================================== */

// Temp test POST to prove routing
router.post('/__approve-test', (req, res) => {
  console.log('HIT __approve-test', req.body);
  res.json({ ok: true, got: req.body || null });
});

// Request approval (emails approvers, sets Pending)
router.post('/:poNumber/request-approval', async (req, res) => {
  try {
    const { poNumber } = req.params;
    ensureFile(PO_DATA_PATH, '[]');
    const list = readJSON(PO_DATA_PATH, []);
    const idx = list.findIndex(p => p.poNumber === poNumber);
    if (idx === -1) return res.status(404).json({ message: `PO ${poNumber} not found` });

    const now = new Date().toISOString();
    const po = list[idx];

    po.createdByEmail = po.createdByEmail || req.body?.requestedBy || '';
    po.createdByName  = po.createdByName  || req.body?.requestedByName || '';

    po.status = 'Issued';
    po.approval = { ...(po.approval || {}), status: 'Pending', requestedAt: now, requestedBy: po.createdByEmail || 'unknown' };
    po.updatedAt = now;

    list[idx] = po;
    writeJSON(PO_DATA_PATH, list);

    const approvers = (typeof getApproverList === 'function') ? getApproverList() : [];
    if (approvers.length && typeof sendMail === 'function') {
      const supplier = po.supplierSnapshot?.name || po.supplierName || po.supplier || '';
      const net = (po.subtotal ?? po.totals?.net ?? 0).toLocaleString();
      await sendMail({
        to: approvers.join(','),
        subject: `[Build Lite] Approval requested: ${po.poNumber}`,
        text:
`A purchase order needs your approval.

PO: ${po.poNumber}
Type: ${po.type}
Supplier: ${supplier}
Net: £${net}

Requested by: ${po.createdByName || po.createdByEmail || 'Unknown'}
Open Build Lite to approve or reject.`,
      });
    }

    res.json(po);
  } catch (e) {
    console.error('request-approval error:', e);
    res.status(500).json({ message: 'Error requesting approval', error: e.message });
  }
});

// Approve / Reject
router.post('/:poNumber/approve', async (req, res) => {
  try {
    const { poNumber } = req.params;
    const { status, approver, note } = req.body || {};
    if (!['Approved', 'Rejected'].includes(status)) {
      return res.status(400).json({ message: 'status must be Approved or Rejected' });
    }

    ensureFile(PO_DATA_PATH, '[]');
    const all = readJSON(PO_DATA_PATH, []);
    const idx = all.findIndex(p => p.poNumber === poNumber);
    if (idx === -1) return res.status(404).json({ message: `PO ${poNumber} not found` });

    const now = new Date().toISOString();
    const po = all[idx];
    po.approval = {
      ...(po.approval || {}),
      status,
      approver: approver || 'Approver',
      decidedAt: now,
      note: note || '',
    };
    po.status = status;
    po.updatedAt = now;

    all[idx] = po;
    writeJSON(PO_DATA_PATH, all);

    // email requester (optional)
    const requester = po.createdByEmail;
    if (requester && typeof sendMail === 'function') {
      const supplier = po.supplierSnapshot?.name || po.supplierName || po.supplier || '';
      const net = (po.subtotal ?? po.totals?.net ?? 0).toLocaleString();
      await sendMail({
        to: requester,
        subject: `[Build Lite] PO ${po.poNumber} ${status}`,
        text:
`Your purchase order has been ${status.toLowerCase()}.

PO: ${po.poNumber}
Type: ${po.type}
Supplier: ${supplier}
Net: £${net}

Decision by: ${po.approval.approver}
Note: ${po.approval.note || '-'}

Time: ${new Date(now).toLocaleString()}`,
      });
    }

    return res.json(po);
  } catch (err) {
    console.error('approve error:', err);
    return res.status(500).json({ message: 'Error updating approval', error: err.message });
  }
});

/* ================================================================== *
 * ARCHIVE / DELETE (before catch-all GET)
 * ================================================================== */
router.patch('/:poNumber/archive', (req, res) => {
  try {
    const { poNumber } = req.params;
    const { archived } = req.body || {};
    ensureFile(PO_DATA_PATH, '[]');
    const all = readJSON(PO_DATA_PATH, []);
    const idx = all.findIndex(p => p.poNumber === poNumber);
    if (idx === -1) return res.status(404).json({ message: `PO ${poNumber} not found` });

    all[idx].archived = !!archived;
    all[idx].updatedAt = new Date().toISOString();

    writeJSON(PO_DATA_PATH, all);
    return res.json(all[idx]);
  } catch (err) {
    return res.status(500).json({ message: 'Error updating archive flag', error: err.message });
  }
});

router.delete('/:poNumber', (req, res) => {
  try {
    const { poNumber } = req.params;
    ensureFile(PO_DATA_PATH, '[]');
    const all = readJSON(PO_DATA_PATH, []);
    const next = all.filter(p => p.poNumber !== poNumber);
    if (next.length === all.length) {
      return res.status(404).json({ message: `PO ${poNumber} not found` });
    }
    writeJSON(PO_DATA_PATH, next);
    return res.json({ message: `PO ${poNumber} deleted successfully` });
  } catch (err) {
    return res.status(500).json({ message: 'Error deleting PO', error: err.message });
  }
});

/* ================================================================== *
 * CATCH-ALL: READ single PO (keep LAST)
 * ================================================================== */
router.get('/:poNumber', (req, res) => {
  try {
    const { poNumber } = req.params;
    ensureFile(PO_DATA_PATH, '[]');
    const list = readJSON(PO_DATA_PATH, []);
    const po = list.find(p => String(p.poNumber) === String(poNumber));
    if (!po) return res.status(404).json({ message: `PO ${poNumber} not found` });
    res.json(po);
  } catch (err) {
    res.status(500).json({ message: 'Error reading PO', error: err.message });
  }
});

module.exports = router;


