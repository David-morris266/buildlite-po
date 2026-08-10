// server/routes/poRoutes.js
const express = require("express");
const { pool } = require("../db"); // keep pool for consistency with your existing DB helper style
const { getActiveClient } = require("../services/activeClient");
const {
  getBrandProfileForClient,
  mapBrandToPdfContext,
} = require("../services/brandProfile");
const { isProduction } = require("../utils/env");
const { mapPOToContext, renderPOToPDF } = require("../services/pdf");

const router = express.Router();

/* =========================================
 * DB HELPERS (POs + Suppliers in Postgres)
 * NOW CLIENT-SCOPED
 * ======================================= */

// --------------------
// Suppliers
// --------------------

async function dbReadSuppliers(clientId) {
  const { rows } = await pool.query(
    "SELECT payload FROM suppliers WHERE client_id = $1 ORDER BY name ASC",
    [clientId]
  );
  return rows.map((r) => r.payload);
}

async function dbCreateSupplier(clientId, supplier) {
  await pool.query(
    `
    INSERT INTO suppliers (id, name, payload, client_id)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (id)
    DO UPDATE SET name = EXCLUDED.name, payload = EXCLUDED.payload, client_id = EXCLUDED.client_id
    `,
    [supplier.id, supplier.name, supplier, clientId]
  );
}

async function dbFindSupplierByName(clientId, name) {
  const { rows } = await pool.query(
    "SELECT payload FROM suppliers WHERE client_id = $1 AND lower(name) = lower($2) LIMIT 1",
    [clientId, name]
  );
  return rows[0]?.payload || null;
}

async function dbFindSupplierById(clientId, id) {
  const { rows } = await pool.query(
    "SELECT payload FROM suppliers WHERE client_id = $1 AND id = $2 LIMIT 1",
    [clientId, id]
  );
  return rows[0]?.payload || null;
}

function pushSupplierApprovalHistory(supplier, action, by = "", note = "") {
  if (!Array.isArray(supplier.approvalHistory)) supplier.approvalHistory = [];
  supplier.approvalHistory.push({
    at: new Date().toISOString(),
    by: String(by || "").trim(),
    action,
    note: String(note || "").trim(),
  });
}

function resolveSupplierApprovalStatus(base = {}, body = {}, { isCreate = false } = {}) {
  if (body.approvalStatus) return String(body.approvalStatus);
  if (body.pendingApproval || body.createdFromPo) return "pending";
  if (body.approvedSupplier === true) return "approved";
  if (body.approvedSupplier === false) return "pending";
  if (base.approvalStatus) return base.approvalStatus;
  if (base.approvedSupplier === false) return "pending";
  return isCreate ? "approved" : base.approvalStatus || "approved";
}

function buildSupplierPayload(base = {}, body = {}, { isCreate = false } = {}) {
  const now = new Date().toISOString();
  const termsDays =
    body.termsDays != null ? Number(body.termsDays || 30) : Number(base.termsDays || 30);
  const approvalStatus = resolveSupplierApprovalStatus(base, body, { isCreate });
  const approvedSupplier = approvalStatus === "approved";

  const payload = {
    ...base,
    id: base.id || body.id || `sup-${Date.now()}`,
    name:
      body.name != null ? String(body.name).trim() : String(base.name || "").trim(),
    address1: body.address1 ?? base.address1 ?? "",
    address2: body.address2 ?? base.address2 ?? "",
    city: body.city ?? base.city ?? "",
    postcode: body.postcode ?? base.postcode ?? "",
    contactName: body.contactName ?? base.contactName ?? "",
    contactEmail: body.contactEmail ?? base.contactEmail ?? "",
    contactPhone: body.contactPhone ?? base.contactPhone ?? "",
    vatNumber: body.vatNumber ?? base.vatNumber ?? "",
    termsDays,
    supplierType: body.supplierType ?? base.supplierType ?? "other",
    notes: body.notes ?? base.notes ?? "",
    preferredTrade: body.preferredTrade ?? base.preferredTrade ?? "",
    preferredCommercialHead:
      body.preferredCommercialHead ?? base.preferredCommercialHead ?? "",
    creditAccount:
      body.creditAccount != null ? Boolean(body.creditAccount) : Boolean(base.creditAccount),
    cisStatus: body.cisStatus ?? base.cisStatus ?? "",
    insuranceExpiry: body.insuranceExpiry ?? base.insuranceExpiry ?? "",
    approvalStatus,
    approvedSupplier,
    defaultVat: body.defaultVat ?? base.defaultVat ?? "Standard",
    vatStatus: body.vatStatus ?? base.vatStatus ?? "",
    active: body.active != null ? body.active !== false : base.active !== false,
    bankDetailsPlaceholder:
      body.bankDetailsPlaceholder ?? base.bankDetailsPlaceholder ?? "Future module",
    creditLimitPlaceholder:
      body.creditLimitPlaceholder ?? base.creditLimitPlaceholder ?? "Future module",
    approvalHistory: Array.isArray(body.approvalHistory)
      ? body.approvalHistory
      : base.approvalHistory || [],
    createdAt: base.createdAt || now,
    updatedAt: now,
  };

  if (isCreate && (body.pendingApproval || body.createdFromPo)) {
    pushSupplierApprovalHistory(
      payload,
      "CREATED_PENDING",
      body.createdBy || "",
      "Created during Purchase Order entry"
    );
  }

  return payload;
}

async function findPendingSupplierForPo(clientId, po) {
  const supplierId = po?.supplierId || po?.supplierSnapshot?.id;
  if (!supplierId) return null;

  const supplier = await dbFindSupplierById(clientId, String(supplierId));
  if (!supplier) return null;

  const pending =
    supplier.approvalStatus === "pending" || supplier.approvedSupplier === false;
  return pending ? supplier : null;
}

async function assertSupplierApprovedForPoApproval(clientId, po) {
  const pending = await findPendingSupplierForPo(clientId, po);
  if (!pending) return null;

  return {
    message:
      "This supplier is pending approval. Approve the supplier in Administration before approving this Purchase Order.",
  };
}

async function assertSupplierApprovedForPoRequestApproval(clientId, po) {
  const pending = await findPendingSupplierForPo(clientId, po);
  if (!pending) return null;

  return {
    message:
      "The supplier must be approved before this order can be sent for approval.",
  };
}

// --------------------
// POs
// --------------------

async function dbReadPOs(clientId) {
  const { rows } = await pool.query(
    "SELECT payload FROM purchase_orders WHERE client_id = $1",
    [clientId]
  );
  return rows.map((r) => r.payload);
}

async function dbGetPO(clientId, poNumber) {
  const { rows } = await pool.query(
    "SELECT payload FROM purchase_orders WHERE client_id = $1 AND po_number = $2 LIMIT 1",
    [clientId, poNumber]
  );
  return rows[0]?.payload || null;
}

async function dbSavePO(clientId, po) {
  await pool.query(
    `
    INSERT INTO purchase_orders (po_number, payload, client_id)
    VALUES ($1, $2, $3)
    ON CONFLICT (po_number)
    DO UPDATE SET payload = EXCLUDED.payload, client_id = EXCLUDED.client_id
    `,
    [po.poNumber, po, clientId]
  );
}

async function dbDeletePO(clientId, poNumber) {
  await pool.query(
    "DELETE FROM purchase_orders WHERE client_id = $1 AND po_number = $2",
    [clientId, poNumber]
  );
}

/* =========================================
 * SHARED HELPERS (unchanged logic)
 * ======================================= */

function nextNumberForType(all, type) {
  const prefix = String(type || "M").toUpperCase();
  const nums = all
    .filter(
      (p) =>
        (p.type || "").toUpperCase() === prefix &&
        typeof p.poNumber === "string"
    )
    .map((p) => parseInt((p.poNumber || "").replace(/\D+/g, ""), 10))
    .filter(Number.isFinite);

  const max = nums.length ? Math.max(...nums) : 0;
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

function computeTotals(items = [], vatRateDefault = 0.2) {
  const net = items.reduce((sum, it) => {
    const amt =
      it.amount != null
        ? Number(it.amount) || 0
        : Number(it.qty || it.quantity || 0) * Number(it.rate || it.unitRate || 0);
    return sum + (amt || 0);
  }, 0);

  const vatRate = Number(vatRateDefault) || 0;
  const vat = +(net * vatRate).toFixed(2);
  const gross = +(net + vat).toFixed(2);
  return { net, vat, gross, vatRate };
}

function pushHistory(po, action, by = "", note = "") {
  const now = new Date().toISOString();
  if (!po.approval) po.approval = {};
  if (!Array.isArray(po.approval.history)) po.approval.history = [];
  po.approval.history.push({ at: now, by, action, note });
}

/* =========================================
 * ROUTES — DEBUG / LOOKUPS
 * ======================================= */

// Debug POs (disabled in production)
router.get("/po/_debug", async (_req, res) => {
  if (isProduction()) {
    return res.status(404).json({ message: "Not found" });
  }

  const active = await getActiveClient();
  if (!active) return res.status(404).json({ error: "No active client set" });

  const items = await dbReadPOs(active.id);
  res.json({
    source: "postgres",
    client: active.code,
    count: items.length,
    first: items[0]?.poNumber || null,
  });
});

// ✅ Cost codes from DB (active client)
router.get("/po/cost-codes", async (_req, res) => {
  try {
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const { rows } = await pool.query(
      `
      SELECT code, sub_heading, trade, element
      FROM cost_codes
      WHERE client_id = $1 AND is_active = true
      ORDER BY code
      `,
      [active.id]
    );

    // Keep frontend compatibility: include label like you used to
    const out = rows.map((r) => {
      const code = r.code || "";
      const subHeading = r.sub_heading || "";
      const trade = r.trade || "";
      const element = r.element || "";
      const label = [code, trade, element || subHeading].filter(Boolean).join(" — ");
      return { code, subHeading, trade, element, label };
    });

    res.json(out);
  } catch (err) {
    console.error("GET /po/cost-codes failed:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Suppliers
router.get("/po/suppliers", async (_req, res) => {
  const active = await getActiveClient();
  if (!active) return res.status(404).json({ error: "No active client set" });

  const suppliers = await dbReadSuppliers(active.id);
  res.json(suppliers);
});

router.post("/po/suppliers", async (req, res) => {
  const active = await getActiveClient();
  if (!active) return res.status(404).json({ error: "No active client set" });

  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) {
    return res.status(400).json({ message: "Field 'name' is required" });
  }

  const existing = await dbFindSupplierByName(active.id, String(b.name).trim());
  if (existing) {
    return res.status(409).json({ message: "Supplier already exists" });
  }

  const now = new Date().toISOString();
  const sup = buildSupplierPayload({}, b, { isCreate: true });
  sup.createdAt = now;
  sup.updatedAt = now;

  await dbCreateSupplier(active.id, sup);
  res.status(201).json(sup);
});

router.put("/po/suppliers/:id", async (req, res) => {
  const active = await getActiveClient();
  if (!active) return res.status(404).json({ error: "No active client set" });

  const existing = await dbFindSupplierById(active.id, req.params.id);
  if (!existing) return res.status(404).json({ message: "Supplier not found" });

  const b = req.body || {};
  const sup = buildSupplierPayload(existing, b);

  if (!sup.name) {
    return res.status(400).json({ message: "Field 'name' is required" });
  }

  await dbCreateSupplier(active.id, sup);
  res.json(sup);
});

router.post("/po/suppliers/:id/approve", async (req, res) => {
  const active = await getActiveClient();
  if (!active) return res.status(404).json({ error: "No active client set" });

  const existing = await dbFindSupplierById(active.id, req.params.id);
  if (!existing) return res.status(404).json({ message: "Supplier not found" });

  const sup = buildSupplierPayload(existing, {
    approvedSupplier: true,
    approvalStatus: "approved",
  });
  pushSupplierApprovalHistory(
    sup,
    "APPROVED",
    req.body?.by || req.body?.approverName || "",
    req.body?.note || "Approved in Administration"
  );

  await dbCreateSupplier(active.id, sup);
  res.json(sup);
});

/* =========================================
 * ROUTES — LIST
 * ======================================= */

router.get("/po", async (req, res) => {
  const active = await getActiveClient();
  if (!active) return res.status(404).json({ error: "No active client set" });

  const { q = "", job = "", type = "", supplier = "", archived = "false" } =
    req.query || {};

  const all = await dbReadPOs(active.id);

  const t = String(q).trim().toLowerCase();
  const j = String(job).trim().toLowerCase();
  const ty = String(type).trim().toUpperCase();
  const s = String(supplier).trim().toLowerCase();
  const incArchived = String(archived).toLowerCase() === "true";

  const items = all.filter((p) => {
    if (!incArchived && p.archived) return false;
    if (ty && String(p.type || "").toUpperCase() !== ty) return false;

    if (s) {
      const sup = (
        p.supplierSnapshot?.name ||
        p.supplierName ||
        p.supplier ||
        ""
      ).toLowerCase();
      if (!sup.includes(s)) return false;
    }

    if (j) {
      const jobName = (p.job?.name || "").toLowerCase();
      const jobNumber = (p.job?.jobNumber || "").toLowerCase();
      const jobCode = (p.job?.jobCode || p.costRef?.jobCode || "").toLowerCase();
      const jobId = (String(p.job?.id || "") || p.costRef?.jobId || "").toLowerCase();
      const haystack = [jobName, jobNumber, jobCode, jobId];

      if (!haystack.some((v) => v && v.includes(j))) return false;
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
      ].concat((p.items || []).map((it) => it.description || ""));

      if (!hay.some((v) => String(v || "").toLowerCase().includes(t))) return false;
    }

    return true;
  });

  res.json({ items });
});

/* =========================================
 * ROUTES — PDF
 * ======================================= */

router.get("/po/:poNumber/pdf", async (req, res) => {
  try {
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const { poNumber } = req.params;
    const { download } = req.query;

    const po = await dbGetPO(active.id, poNumber);
    if (!po) {
      return res.status(404).type("text/plain").send(`PO ${poNumber} not found`);
    }

    const brandRow = await getBrandProfileForClient(active.id);
    const brandCtx = mapBrandToPdfContext(brandRow, active);
    const ctx = mapPOToContext(po, brandCtx);
    const pdfBuffer = await renderPOToPDF(ctx);

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition":
        String(download) === "1"
          ? `attachment; filename="${poNumber}.pdf"`
          : `inline; filename="${poNumber}.pdf"`,
      "Cache-Control": "no-store",
    });
    res.end(pdfBuffer);
  } catch (err) {
    console.error("PDF failed:", err);
    res.status(500).type("text/plain").send(`PDF failed: ${err.message || err}`);
  }
});

/* =========================================
 * ROUTES — APPROVAL HISTORY
 * ======================================= */

router.get("/po/:poNumber/history", async (req, res) => {
  const active = await getActiveClient();
  if (!active) return res.status(404).json({ error: "No active client set" });

  const po = await dbGetPO(active.id, req.params.poNumber);
  if (!po) return res.status(404).json({ message: "PO not found" });
  res.json(po.approval?.history || []);
});

/* =========================================
 * ROUTES — CREATE
 * ======================================= */

router.post("/po", async (req, res) => {
  const active = await getActiveClient();
  if (!active) return res.status(404).json({ error: "No active client set" });

  const body = req.body || {};
  const all = await dbReadPOs(active.id);

  const type = (body.type || "M").toUpperCase();
  const poNumber = body.poNumber || nextNumberForType(all, type);
  const now = new Date().toISOString();

  let status = body.status || "Draft";
  const statusLc = String(status).toLowerCase();

  let approvalStatus;
  if (statusLc === "draft") {
    approvalStatus = "Draft";
  } else if (statusLc === "rejected") {
    approvalStatus = "Rejected";
  } else if (statusLc === "approved") {
    approvalStatus = "Approved";
  } else {
    status = "Issued";
    approvalStatus = "Pending";
  }

  // --- supplier snapshot ---
  let supplierSnapshot = body.supplierSnapshot || null;
  let supplierId = body.supplierId || "";
  if (supplierId) {
    const found = await dbFindSupplierById(active.id, String(supplierId));
    supplierSnapshot =
      found ||
      supplierSnapshot ||
      { id: supplierId, name: body.supplierName || String(supplierId) };
  }

  const items = Array.isArray(body.items)
    ? body.items.map((it) => ({
        description: it.description || "",
        uom: it.uom || it.unit || "nr",
        qty: Number(it.qty || it.quantity || 0),
        rate: Number(it.rate || it.unitRate || 0),
        amount:
          it.amount != null
            ? Number(it.amount) || 0
            : Number(it.qty || 0) * Number(it.rate || 0),
        costCode: it.costCode || body.costRef?.costCode || "",
      }))
    : [];

  const vatRateDefault = Number(body.vatRateDefault == null ? 0.2 : body.vatRateDefault) || 0;
  const retentionRateDefault =
    Number(body.retentionRateDefault == null ? 0.05 : body.retentionRateDefault) || 0;
  const totals = computeTotals(items, vatRateDefault);
  const clauses = body.clauses || {};

  const po = {
    poNumber,
    type,

    supplierId,
    supplierSnapshot,

    costRef: {
      jobId: body.costRef?.jobId || "",
      developmentId: body.costRef?.developmentId || "",
      jobCode: body.costRef?.jobCode || "",
      costCode: body.costRef?.costCode || "",
      element: body.costRef?.element || "",
    },

    developmentId: body.developmentId || "",
    developmentNumber: body.developmentNumber || "",
    developmentName: body.developmentName || "",
    developmentStatus: body.developmentStatus || "",
    development: body.development || null,

    job: body.job || null,

    title: body.title || "",
    clauses,

    items,
    subtotal: totals.net,
    vatRateDefault: totals.vatRate,
    retentionRateDefault,
    totals,

    approval: { status: approvalStatus, history: [] },
    status,
    requiredBy: body.requiredBy || "",
    notes: body.notes || "",

    createdBy: body.createdBy || "system",
    createdByEmail: body.createdByEmail || "",
    createdByName: body.createdByName || "",
    updatedBy: body.createdBy || "system",
    createdAt: now,
    updatedAt: now,
    archived: false,
  };

  pushHistory(
    po,
    "CREATED",
    body.createdByName || body.createdByEmail || "system",
    status === "Draft" ? "Draft created" : `Created with status ${status}`
  );

  await dbSavePO(active.id, po);
  res.status(201).json(po);
});

/* =========================================
 * ROUTES — UPDATE
 * ======================================= */

router.put("/po/:poNumber", async (req, res) => {
  const active = await getActiveClient();
  if (!active) return res.status(404).json({ error: "No active client set" });

  const body = req.body || {};
  const po = await dbGetPO(active.id, req.params.poNumber);
  if (!po) return res.status(404).json({ message: "PO not found" });

  const currentStatus = String(po.status || "").toLowerCase();
  const editableStatuses = ["draft", "rejected"];

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
      const found = await dbFindSupplierById(active.id, String(supplierId));
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
      description: it.description || "",
      uom: it.uom || it.unit || "nr",
      qty: Number(it.qty || it.quantity || 0),
      rate: Number(it.rate || it.unitRate || 0),
      amount:
        it.amount != null
          ? Number(it.amount) || 0
          : Number(it.qty || 0) * Number(it.rate || 0),
      costCode: it.costCode || body.costRef?.costCode || po.costRef?.costCode || "",
    }));
  }

  const vatRateDefault =
    Number(
      body.vatRateDefault == null
        ? po.vatRateDefault == null
          ? 0.2
          : po.vatRateDefault
        : body.vatRateDefault
    ) || 0;

  const retentionRateDefault =
    Number(
      body.retentionRateDefault == null
        ? po.retentionRateDefault == null
          ? 0.05
          : po.retentionRateDefault
        : body.retentionRateDefault
    ) || 0;

  const totals = computeTotals(items, vatRateDefault);

  po.supplierId = supplierId;
  po.supplierSnapshot = supplierSnapshot;

  if (body.type) {
    po.type = String(body.type).toUpperCase();
  }

  po.costRef = {
    jobId: body.costRef?.jobId ?? po.costRef?.jobId ?? "",
    developmentId: body.costRef?.developmentId ?? po.costRef?.developmentId ?? "",
    jobCode: body.costRef?.jobCode ?? po.costRef?.jobCode ?? "",
    costCode: body.costRef?.costCode ?? po.costRef?.costCode ?? "",
    element: body.costRef?.element ?? po.costRef?.element ?? "",
  };

  po.developmentId = body.developmentId ?? po.developmentId ?? "";
  po.developmentNumber = body.developmentNumber ?? po.developmentNumber ?? "";
  po.developmentName = body.developmentName ?? po.developmentName ?? "";
  po.developmentStatus = body.developmentStatus ?? po.developmentStatus ?? "";
  po.development = body.development ?? po.development ?? null;

  po.job = body.job ?? po.job ?? null;
  po.title = body.title ?? po.title ?? "";
  po.clauses = body.clauses ?? po.clauses ?? {};

  po.items = items;
  po.subtotal = totals.net;
  po.vatRateDefault = totals.vatRate;
  po.retentionRateDefault = retentionRateDefault;
  po.totals = totals;

  po.requiredBy = body.requiredBy ?? po.requiredBy ?? "";
  po.notes = body.notes ?? po.notes ?? "";

  const updatedBy =
    body.updatedBy || body.updatedByEmail || body.updatedByName || body.createdBy || "system";

  po.updatedBy = updatedBy;
  po.updatedAt = now;

  pushHistory(po, "UPDATED", updatedBy, body.updateNote || "Draft/Rejected PO amended");

  await dbSavePO(active.id, po);
  res.json(po);
});

/* =========================================
 * ROUTES — APPROVALS
 * ======================================= */

router.post("/po/:poNumber/request-approval", async (req, res) => {
  const active = await getActiveClient();
  if (!active) return res.status(404).json({ error: "No active client set" });

  const po = await dbGetPO(active.id, req.params.poNumber);
  if (!po) return res.status(404).json({ message: "PO not found" });

  if (String(po.status || "").toLowerCase() === "approved") {
    return res.status(400).json({ message: "Cannot request approval for an Approved PO" });
  }

  const supplierError = await assertSupplierApprovedForPoRequestApproval(active.id, po);
  if (supplierError) {
    return res.status(400).json(supplierError);
  }

  po.status = "Issued";
  po.approval = {
    ...(po.approval || {}),
    status: "Pending",
    approverMode: req.body?.approverMode || po.approval?.approverMode || "",
    approverName: req.body?.approverName || po.approval?.approverName || "",
    approverEmail: req.body?.approverEmail || po.approval?.approverEmail || "",
  };
  pushHistory(po, "SENT", req.body?.by || req.body?.approverName || "", req.body?.note || "");
  po.updatedAt = new Date().toISOString();

  await dbSavePO(active.id, po);
  res.json(po);
});

router.post("/po/:poNumber/approve", async (req, res) => {
  const active = await getActiveClient();
  if (!active) return res.status(404).json({ error: "No active client set" });

  const po = await dbGetPO(active.id, req.params.poNumber);
  if (!po) return res.status(404).json({ message: "PO not found" });

  const { status = "Approved", approver = "", note = "" } = req.body || {};
  const norm = String(status).toLowerCase();
  if (!["approved", "rejected"].includes(norm)) {
    return res.status(400).json({ message: "status must be 'Approved' or 'Rejected'" });
  }

  if (norm === "approved") {
    const supplierError = await assertSupplierApprovedForPoApproval(active.id, po);
    if (supplierError) {
      return res.status(400).json(supplierError);
    }
  }

  const now = new Date().toISOString();

  po.status = norm === "approved" ? "Approved" : "Rejected";
  po.approval = {
    ...(po.approval || {}),
    status: po.status,
    approver,
    approverEmail: req.body?.approverEmail || po.approval?.approverEmail || "",
    note,
    decidedAt: now,
  };
  pushHistory(po, norm === "approved" ? "APPROVED" : "REJECTED", approver, note);
  po.updatedAt = now;

  await dbSavePO(active.id, po);
  res.json(po);
});

/* =========================================
 * ROUTES — READ & DELETE
 * ======================================= */

router.get("/po/:poNumber", async (req, res) => {
  const active = await getActiveClient();
  if (!active) return res.status(404).json({ error: "No active client set" });

  const po = await dbGetPO(active.id, req.params.poNumber);
  if (!po) return res.status(404).json({ message: "PO not found" });
  res.json(po);
});

router.delete("/po/:poNumber", async (req, res) => {
  const active = await getActiveClient();
  if (!active) return res.status(404).json({ error: "No active client set" });

  const po = await dbGetPO(active.id, req.params.poNumber);
  if (!po) return res.status(404).json({ message: "PO not found" });

  if ((po.approval?.status || "").toLowerCase() === "approved") {
    return res.status(400).json({ message: "Cannot delete an Approved PO" });
  }

  await dbDeletePO(active.id, req.params.poNumber);
  res.json({ ok: true });
});

module.exports = router;
