// server/routes/poRoutes.js
const express = require("express");
const { randomUUID } = require("crypto");
const { pool } = require("../db"); // keep pool for consistency with your existing DB helper style
const { getActiveClient } = require("../services/activeClient");
const {
  materialisePackageFromPoNumber,
} = require("../services/packageMaterialisation");
const { isSubcontractPoType } = require("../services/packagePoExtract");
const {
  getBrandContextForClient,
} = require("../services/brandProfile");
const { isProduction } = require("../utils/env");
const { mapPOToContext, renderPOToPDF } = require("../services/pdf");
const { bindOnApproval, resolveForPo } = require("../services/subcontractTermsRepository");
const { requirePermission, requireAnyPermission, actorFromAuth } = require('../auth/authorization');
const { PERMISSIONS } = require('../auth/permissions');
const { asyncRoute } = require('../middleware/asyncRoute');
const {
  normaliseOrderType,
  insertPurchaseOrderWithNumber,
} = require('../services/purchaseOrderNumbering');

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
    "SELECT id, name, payload FROM suppliers WHERE client_id = $1 ORDER BY name ASC",
    [clientId]
  );
  return rows.map((r) => ({ ...r.payload, id: r.id, name: r.payload?.name || r.name }));
}

async function dbCreateSupplier(clientId, supplier) {
  try {
    await pool.query(
    `
    INSERT INTO suppliers (id, name, payload, client_id)
    VALUES ($1, $2, $3, $4)
    `,
    [supplier.id, supplier.name, supplier, clientId]
    );
  } catch (error) {
    if (error.code === '23505') return false;
    throw error;
  }
  return true;
}

async function dbUpdateSupplier(clientId, supplier, dbClient = pool) {
  const result = await dbClient.query(
    `UPDATE suppliers SET name=$1,payload=$2 WHERE client_id=$3 AND id=$4`,
    [supplier.name, supplier, clientId, supplier.id]
  );
  return result.rowCount === 1;
}

async function dbFindSupplierByName(clientId, name) {
  const { rows } = await pool.query(
    "SELECT id, name, payload FROM suppliers WHERE client_id = $1 AND lower(name) = lower($2) LIMIT 1",
    [clientId, name]
  );
  const row = rows[0];
  return row ? { ...row.payload, id: row.id, name: row.payload?.name || row.name } : null;
}

async function dbFindSupplierById(clientId, id, dbClient = pool, { forUpdate = false } = {}) {
  const lockClause = forUpdate === "keyShare"
    ? " FOR KEY SHARE"
    : forUpdate
      ? " FOR UPDATE"
      : "";
  const { rows } = await dbClient.query(
    `SELECT id, name, payload FROM suppliers WHERE client_id = $1 AND id = $2 LIMIT 1${lockClause}`,
    [clientId, id]
  );
  const row = rows[0];
  return row ? { ...row.payload, id: row.id, name: row.payload?.name || row.name } : null;
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

const SUPPLIER_IDENTITY_FIELDS = Object.freeze([
  "name", "address1", "address2", "city", "postcode", "vatNumber",
  "supplierType", "termsDays", "creditAccount", "cisStatus", "defaultVat", "vatStatus",
]);

function normaliseSupplierIdentityValue(field, value) {
  if (field === "termsDays") return Number(value || 30);
  if (field === "creditAccount") return Boolean(value);
  const effectiveValue = field === "supplierType" && (value == null || value === "")
    ? "other"
    : field === "defaultVat" && (value == null || value === "")
      ? "Standard"
      : value;
  const text = String(effectiveValue ?? "").trim();
  if (field === "vatNumber" || field === "postcode") {
    return text.replace(/\s+/g, "").toUpperCase();
  }
  return text.toLowerCase().replace(/\s+/g, " ");
}

function changedSupplierIdentityFields(before, after) {
  return SUPPLIER_IDENTITY_FIELDS.filter(
    (field) => normaliseSupplierIdentityValue(field, before?.[field])
      !== normaliseSupplierIdentityValue(field, after?.[field])
  );
}

function supplierApprovalState(supplier = {}) {
  const status = String(supplier.approvalStatus || "").trim().toLowerCase();
  if (!status && (supplier.approvedSupplier == null || supplier.approvedSupplier === true)) {
    return "legacy_approved";
  }
  if (status === "pending" && supplier.approvedSupplier !== true) return "pending";
  if (status === "approved" && supplier.approvedSupplier === true) return "approved";
  return "unknown";
}

function supplierField(base, body, field, createDefault, { isCreate = false } = {}) {
  if (Object.prototype.hasOwnProperty.call(body, field)) return body[field];
  if (Object.prototype.hasOwnProperty.call(base, field)) return base[field];
  return isCreate ? createDefault : undefined;
}

function resolveSupplierApprovalEvidence(base = {}, { isCreate = false } = {}) {
  if (isCreate) return { approvalStatus: "pending", approvedSupplier: false };
  const state = supplierApprovalState(base);
  if (state === "approved") return { approvalStatus: "approved", approvedSupplier: true };
  if (state === "pending") return { approvalStatus: "pending", approvedSupplier: false };
  // Ordinary edits must neither invent nor repair approval authority.
  return {
    approvalStatus: base.approvalStatus,
    approvedSupplier: base.approvedSupplier,
  };
}

function buildSupplierPayload(base = {}, body = {}, { isCreate = false } = {}) {
  const now = new Date().toISOString();
  const rawTermsDays = supplierField(base, body, "termsDays", 30, { isCreate });
  const termsDays = rawTermsDays == null ? undefined : Number(rawTermsDays || 30);
  const approvalEvidence = resolveSupplierApprovalEvidence(base, { isCreate });

  const payload = {
    ...base,
    id: base.id || `sup-${randomUUID()}`,
    name:
      body.name != null ? String(body.name).trim() : String(base.name || "").trim(),
    address1: supplierField(base, body, "address1", "", { isCreate }),
    address2: supplierField(base, body, "address2", "", { isCreate }),
    city: supplierField(base, body, "city", "", { isCreate }),
    postcode: supplierField(base, body, "postcode", "", { isCreate }),
    contactName: supplierField(base, body, "contactName", "", { isCreate }),
    contactEmail: supplierField(base, body, "contactEmail", "", { isCreate }),
    contactPhone: supplierField(base, body, "contactPhone", "", { isCreate }),
    vatNumber: supplierField(base, body, "vatNumber", "", { isCreate }),
    termsDays,
    supplierType: supplierField(base, body, "supplierType", "other", { isCreate }),
    notes: supplierField(base, body, "notes", "", { isCreate }),
    preferredTrade: supplierField(base, body, "preferredTrade", "", { isCreate }),
    preferredCommercialHead: supplierField(base, body, "preferredCommercialHead", "", { isCreate }),
    creditAccount: supplierField(base, body, "creditAccount", false, { isCreate }),
    cisStatus: supplierField(base, body, "cisStatus", "", { isCreate }),
    insuranceExpiry: supplierField(base, body, "insuranceExpiry", "", { isCreate }),
    approvalStatus: approvalEvidence.approvalStatus,
    approvedSupplier: approvalEvidence.approvedSupplier,
    defaultVat: supplierField(base, body, "defaultVat", "Standard", { isCreate }),
    vatStatus: supplierField(base, body, "vatStatus", "", { isCreate }),
    active: supplierField(base, body, "active", true, { isCreate }),
    bankDetailsPlaceholder: supplierField(base, body, "bankDetailsPlaceholder", "Future module", { isCreate }),
    creditLimitPlaceholder: supplierField(base, body, "creditLimitPlaceholder", "Future module", { isCreate }),
    approvalHistory: base.approvalHistory || [],
    createdAt: base.createdAt || now,
    updatedAt: now,
  };

  if (isCreate) {
    pushSupplierApprovalHistory(
      payload,
      "CREATED_PENDING",
      body.createdBy || "",
      body.createdFromPo
        ? "Created during Purchase Order entry"
        : "Created pending governed supplier approval"
    );
  }

  return payload;
}

async function resolveSupplierApprovalForPo(clientId, po, dbClient = pool, { lock = false } = {}) {
  const supplierId = po?.supplierId || po?.supplierSnapshot?.id;
  if (!supplierId) return { state: "missing_identity", supplier: null };

  const supplier = await dbFindSupplierById(
    clientId,
    String(supplierId),
    dbClient,
    { forUpdate: lock ? "keyShare" : false }
  );
  if (!supplier) return { state: "missing_record", supplier: null };
  if (supplier.active === false) return { state: "inactive", supplier };
  return { state: supplierApprovalState(supplier), supplier };
}

async function assertSupplierApprovedForPoApproval(clientId, po, dbClient = pool, options = {}) {
  const approval = await resolveSupplierApprovalForPo(clientId, po, dbClient, options);
  if (["approved", "legacy_approved"].includes(approval.state)) return null;

  return {
    message: approval.state === "pending"
      ? "This supplier is pending approval. Approve the supplier in Administration before approving this Purchase Order."
      : approval.state === "inactive"
        ? "This supplier is inactive and cannot be used to approve a Purchase Order."
      : "This Purchase Order must reference a valid tenant supplier before approval (missing-supplier-id).",
  };
}

async function assertSupplierApprovedForPoRequestApproval(clientId, po, dbClient = pool, options = {}) {
  const approval = await resolveSupplierApprovalForPo(clientId, po, dbClient, options);
  if (["approved", "legacy_approved"].includes(approval.state)) return null;

  return {
    message: approval.state === "pending"
      ? "The supplier must be approved before this order can be sent for approval."
      : approval.state === "inactive"
        ? "The supplier is inactive and cannot be used to send this order for approval."
      : "This Purchase Order must reference a valid tenant supplier before it can be sent for approval.",
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

async function dbGetPO(clientId, poNumber, dbClient = pool, { forUpdate = false } = {}) {
  const { rows } = await dbClient.query(
    `SELECT payload FROM purchase_orders WHERE client_id = $1 AND po_number = $2 LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [clientId, poNumber]
  );
  return rows[0]?.payload || null;
}

async function dbSavePOWithClient(dbClient, clientId, po) {
  const result=await dbClient.query(`UPDATE purchase_orders SET payload=$1 WHERE client_id=$2 AND po_number=$3`,[po,clientId,po.poNumber]);
  if(result.rowCount!==1)throw Object.assign(new Error('Purchase Order changed or is unavailable for this tenant.'),{status:409});
}

async function dbUpdatePO(clientId, po, dbClient = pool) {
  const result=await dbClient.query(`UPDATE purchase_orders SET payload=$1 WHERE client_id=$2 AND po_number=$3`,[po,clientId,po.poNumber]);
  return result.rowCount===1;
}

async function dbDeletePO(clientId, poNumber, dbClient = pool) {
  await dbClient.query(
    "DELETE FROM purchase_orders WHERE client_id = $1 AND po_number = $2",
    [clientId, poNumber]
  );
}

async function dbHasPoDependencies(clientId, poNumber, dbClient = pool) {
  const result=await dbClient.query(`
    SELECT EXISTS(
      SELECT 1 FROM package_purchase_orders WHERE client_id=$1 AND po_number=$2
      UNION ALL SELECT 1 FROM purchase_order_terms_overrides WHERE client_id=$1 AND po_number=$2
      UNION ALL SELECT 1 FROM purchase_order_terms_bindings WHERE client_id=$1 AND po_number=$2
      UNION ALL SELECT 1 FROM commercial_events WHERE client_id=$1 AND po_number=$2
      UNION ALL SELECT 1 FROM variation_orders WHERE client_id=$1 AND source_po_number=$2
    ) AS has_dependencies`,[clientId,poNumber]);
  return Boolean(result.rows[0]?.has_dependencies);
}

/* =========================================
 * SHARED HELPERS (unchanged logic)
 * ======================================= */

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

function hasApprovedHistory(po) {
  return (po?.approval?.history || []).some(
    (entry) => String(entry?.action || "").toUpperCase() === "APPROVED"
  );
}

function hasApprovedAuthority(po) {
  return String(po?.status || "").toLowerCase() === "approved"
    || String(po?.approval?.status || "").toLowerCase() === "approved"
    || hasApprovedHistory(po);
}

function routeError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function resolveAuthoritativeSupplier(
  clientId,
  body = {},
  fallbackPo = null,
  dbClient = pool,
  { lock = false } = {}
) {
  const bodySupplierId = String(body.supplierId || "").trim();
  const snapshotSupplierId = String(body.supplierSnapshot?.id || "").trim();
  if (bodySupplierId && snapshotSupplierId && bodySupplierId !== snapshotSupplierId) {
    throw routeError(400, "Supplier reference does not match the selected tenant supplier.");
  }
  const supplierId = bodySupplierId
    || snapshotSupplierId
    || String(fallbackPo?.supplierId || fallbackPo?.supplierSnapshot?.id || "").trim();
  if (!supplierId) {
    throw routeError(400, "A valid tenant supplier is required.");
  }
  const supplier = await dbFindSupplierById(clientId, supplierId, dbClient, {
    forUpdate: lock ? "keyShare" : false,
  });
  if (!supplier) {
    throw routeError(400, "The selected supplier is unavailable for this tenant.");
  }
  return { supplierId: supplier.id, supplierSnapshot: supplier };
}

async function rollbackQuietly(dbClient) {
  try { await dbClient.query("ROLLBACK"); } catch (_) { /* original error wins */ }
}

/* =========================================
 * ROUTES — DEBUG / LOOKUPS
 * ======================================= */

// Debug POs (disabled in production)
router.get("/po/_debug", asyncRoute(async (_req, res) => {
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
}));

// ✅ Cost codes from DB (active client)
router.get("/po/cost-codes", asyncRoute(async (_req, res) => {
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
}));

// Suppliers
router.get("/po/suppliers", asyncRoute(async (_req, res) => {
  const active = await getActiveClient();
  if (!active) return res.status(404).json({ error: "No active client set" });

  const suppliers = await dbReadSuppliers(active.id);
  res.json(suppliers);
}));

router.post("/po/suppliers", requireAnyPermission([PERMISSIONS.PO_CREATE,PERMISSIONS.TENANT_CONFIGURE]), asyncRoute(async (req, res) => {
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
  const authenticatedActor = actorFromAuth(req.buildliteAuth, req.requiredPermission).actor;
  const sup = buildSupplierPayload({}, { ...b, createdBy: authenticatedActor }, { isCreate: true });
  sup.createdAt = now;
  sup.updatedAt = now;

  if(!await dbCreateSupplier(active.id, sup))return res.status(409).json({message:'Supplier identity already exists.'});
  res.status(201).json(sup);
}));

router.put("/po/suppliers/:id", requireAnyPermission([PERMISSIONS.PO_EDIT,PERMISSIONS.TENANT_CONFIGURE]), asyncRoute(async (req, res) => {
  const active = await getActiveClient();
  if (!active) return res.status(404).json({ error: "No active client set" });

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const existing = await dbFindSupplierById(active.id, req.params.id, dbClient, { forUpdate: true });
    if (!existing) throw routeError(404, "Supplier not found");
    const sup = buildSupplierPayload(existing, req.body || {});
    if (!sup.name) throw routeError(400, "Field 'name' is required");

    const changedFields = changedSupplierIdentityFields(existing, sup);
    if (["approved", "legacy_approved"].includes(supplierApprovalState(existing)) && changedFields.length) {
      sup.approvalStatus = "pending";
      sup.approvedSupplier = false;
      pushSupplierApprovalHistory(
        sup,
        "IDENTITY_CHANGED_REAPPROVAL_REQUIRED",
        actorFromAuth(req.buildliteAuth, req.requiredPermission).actor,
        `Identity fields changed: ${changedFields.join(", ")}`
      );
    }
    if (!await dbUpdateSupplier(active.id, sup, dbClient)) {
      throw routeError(409, "Supplier changed or is unavailable for this tenant.");
    }
    await dbClient.query("COMMIT");
    res.json(sup);
  } catch (error) {
    await rollbackQuietly(dbClient);
    throw error;
  } finally {
    dbClient.release();
  }
}));

router.post("/po/suppliers/:id/approve", requireAnyPermission([PERMISSIONS.PO_APPROVE,PERMISSIONS.TENANT_CONFIGURE]), asyncRoute(async (req, res) => {
  const active = await getActiveClient();
  if (!active) return res.status(404).json({ error: "No active client set" });
  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const existing = await dbFindSupplierById(active.id, req.params.id, dbClient, { forUpdate: true });
    if (!existing) throw routeError(404, "Supplier not found");
    if (supplierApprovalState(existing) === "approved") {
      await dbClient.query("COMMIT");
      return res.json(existing);
    }
    if (!["pending", "legacy_approved"].includes(supplierApprovalState(existing))) {
      throw routeError(409, "Supplier approval state is invalid. Review the supplier before approval.");
    }
    if (existing.active === false) throw routeError(409, "Inactive suppliers cannot be approved.");

    const sup = buildSupplierPayload(existing, {});
    sup.approvalStatus = "approved";
    sup.approvedSupplier = true;
    pushSupplierApprovalHistory(
      sup,
      "APPROVED",
      actorFromAuth(req.buildliteAuth, req.requiredPermission).actor,
      req.body?.note || "Approved in Administration"
    );
    if (!await dbUpdateSupplier(active.id, sup, dbClient)) {
      throw routeError(409, "Supplier changed or is unavailable for this tenant.");
    }
    await dbClient.query("COMMIT");
    res.json(sup);
  } catch (error) {
    await rollbackQuietly(dbClient);
    throw error;
  } finally {
    dbClient.release();
  }
}));

/* =========================================
 * ROUTES — LIST
 * ======================================= */

router.get("/po", asyncRoute(async (req, res) => {
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
}));

/* =========================================
 * ROUTES — PDF
 * ======================================= */

router.get("/po/:poNumber/pdf", asyncRoute(async (req, res) => {
  try {
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const { poNumber } = req.params;
    const { download } = req.query;

    const po = await dbGetPO(active.id, poNumber);
    if (!po) {
      return res.status(404).type("text/plain").send(`PO ${poNumber} not found`);
    }

    const brandCtx = await getBrandContextForClient(active.id, active);
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
}));

/* =========================================
 * ROUTES — APPROVAL HISTORY
 * ======================================= */

router.get("/po/:poNumber/history", asyncRoute(async (req, res) => {
  const active = await getActiveClient();
  if (!active) return res.status(404).json({ error: "No active client set" });

  const po = await dbGetPO(active.id, req.params.poNumber);
  if (!po) return res.status(404).json({ message: "PO not found" });
  res.json(po.approval?.history || []);
}));

/* =========================================
 * ROUTES — CREATE
 * ======================================= */

router.post("/po", requirePermission(PERMISSIONS.PO_CREATE), asyncRoute(async (req, res) => {
  const active = await getActiveClient();
  if (!active) return res.status(404).json({ error: "No active client set" });

  const body = req.body || {};
  if (Object.prototype.hasOwnProperty.call(body, "poNumber")) {
    return res.status(400).json({
      message: "Purchase Order numbers are allocated by BuildLite and must not be supplied by the browser.",
    });
  }
  let type;
  try {
    type = normaliseOrderType(body.type || "M");
  } catch (error) {
    return res.status(error.status || 400).json({ message: error.message });
  }
  const now = new Date().toISOString();

  const status = "Draft";
  const approvalStatus = "Draft";

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const supplier = await resolveAuthoritativeSupplier(
      active.id,
      body,
      null,
      dbClient,
      { lock: true }
    );

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

    const po = await insertPurchaseOrderWithNumber(
      dbClient,
      active.id,
      type,
      (poNumber) => ({
        poNumber,
        type,

        supplierId: supplier.supplierId,
        supplierSnapshot: supplier.supplierSnapshot,

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

        createdBy: req.buildliteAuth.displayName,
        createdByEmail: req.buildliteAuth.email || "",
        createdByName: req.buildliteAuth.displayName,
        updatedBy: req.buildliteAuth.displayName,
        createdAt: now,
        updatedAt: now,
        archived: false,
      })
    );

    pushHistory(po, "CREATED", req.buildliteAuth.displayName, "Draft created");
    await dbClient.query(
      "UPDATE purchase_orders SET payload=$1 WHERE client_id=$2 AND po_number=$3",
      [po, active.id, po.poNumber]
    );

    await dbClient.query("COMMIT");
    res.status(201).json(po);
  } catch (error) {
    await rollbackQuietly(dbClient);
    if (error.code === "23505") {
      return res.status(409).json({
        message: "Purchase Order number could not be allocated safely. Please retry.",
      });
    }
    if (error.status) return res.status(error.status).json({ message: error.message });
    throw error;
  } finally {
    dbClient.release();
  }
}));

/* =========================================
 * ROUTES — UPDATE
 * ======================================= */

router.put("/po/:poNumber", requirePermission(PERMISSIONS.PO_EDIT), asyncRoute(async (req, res) => {
  const active = await getActiveClient();
  if (!active) return res.status(404).json({ error: "No active client set" });

  const body = req.body || {};
  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const po = await dbGetPO(active.id, req.params.poNumber, dbClient, { forUpdate: true });
    if (!po) throw routeError(404, "PO not found");
    const currentStatus = String(po.status || "").toLowerCase();
    if (!["draft", "rejected"].includes(currentStatus) || hasApprovedAuthority(po)) {
      throw routeError(409, "Approved Purchase Orders are immutable. Only a never-approved Draft or Rejected order can be changed.");
    }
    if (body.type != null) {
      const existingType = String(po.type || po.poNumber?.slice(0, 1) || "").trim().toUpperCase();
      const requestedType = String(body.type).trim().toUpperCase();
      if (requestedType !== existingType) {
        throw routeError(400, "Purchase Order type cannot be changed after its number has been allocated.");
      }
    }

    const supplier = await resolveAuthoritativeSupplier(active.id, body, po, dbClient);
    let items = po.items || [];
    if (Array.isArray(body.items)) {
      items = body.items.map((it) => ({
        description: it.description || "",
        uom: it.uom || it.unit || "nr",
        qty: Number(it.qty || it.quantity || 0),
        rate: Number(it.rate || it.unitRate || 0),
        amount: it.amount != null ? Number(it.amount) || 0 : Number(it.qty || 0) * Number(it.rate || 0),
        costCode: it.costCode || body.costRef?.costCode || po.costRef?.costCode || "",
      }));
    }
    const vatRateDefault = Number(body.vatRateDefault == null ? po.vatRateDefault == null ? 0.2 : po.vatRateDefault : body.vatRateDefault) || 0;
    const retentionRateDefault = Number(body.retentionRateDefault == null ? po.retentionRateDefault == null ? 0.05 : po.retentionRateDefault : body.retentionRateDefault) || 0;
    const totals = computeTotals(items, vatRateDefault);

    po.supplierId = supplier.supplierId;
    po.supplierSnapshot = supplier.supplierSnapshot;
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
    po.updatedBy = req.buildliteAuth.displayName;
    po.updatedAt = new Date().toISOString();
    pushHistory(po, "UPDATED", req.buildliteAuth.displayName, body.updateNote || "Draft/Rejected PO amended");
    if(!await dbUpdatePO(active.id, po, dbClient))throw routeError(409, 'Purchase Order changed or is unavailable for this tenant.');
    await dbClient.query("COMMIT");
    res.json(po);
  } catch (error) {
    await rollbackQuietly(dbClient);
    res.status(error.status || 500).json({ message: error.status ? error.message : "Failed to update Purchase Order." });
  } finally {
    dbClient.release();
  }
}));

/* =========================================
 * ROUTES — APPROVALS
 * ======================================= */

router.post("/po/:poNumber/request-approval", requirePermission(PERMISSIONS.PO_SUBMIT), asyncRoute(async (req, res) => {
  const active = await getActiveClient();
  if (!active) return res.status(404).json({ error: "No active client set" });
  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const po = await dbGetPO(active.id, req.params.poNumber, dbClient, { forUpdate: true });
    if (!po) throw routeError(404, "PO not found");
    if (hasApprovedAuthority(po)) {
      throw routeError(409, "Approved Purchase Orders are immutable. Use a governed correction workflow.");
    }
    if (po.archived) throw routeError(409, "Archived Purchase Orders cannot be sent for approval.");
    const currentStatus = String(po.status || "").toLowerCase();
    const currentApprovalStatus = String(po.approval?.status || "").toLowerCase();
    if (!["draft", "rejected"].includes(currentStatus)
      || !["draft", "rejected"].includes(currentApprovalStatus)) {
      throw routeError(409, "Only a Draft or Rejected Purchase Order can be sent for approval.");
    }
    const supplierError = await assertSupplierApprovedForPoRequestApproval(active.id, po, dbClient, { lock: true });
    if (supplierError) throw routeError(400, supplierError.message);
    const supplier = await resolveAuthoritativeSupplier(active.id, {}, po, dbClient, { lock: true });
    po.supplierId = supplier.supplierId;
    po.supplierSnapshot = supplier.supplierSnapshot;
    po.status = "Issued";
    po.approval = {
      ...(po.approval || {}),
      status: "Pending",
      approverMode: req.body?.approverMode || po.approval?.approverMode || "",
      approverName: req.body?.approverName || po.approval?.approverName || "",
      approverEmail: req.body?.approverEmail || po.approval?.approverEmail || "",
    };
    pushHistory(po, "SENT", actorFromAuth(req.buildliteAuth, PERMISSIONS.PO_SUBMIT).actor, req.body?.note || "");
    po.updatedAt = new Date().toISOString();
    if(!await dbUpdatePO(active.id, po, dbClient))throw routeError(409, 'Purchase Order changed or is unavailable for this tenant.');
    await dbClient.query("COMMIT");
    res.json(po);
  } catch (error) {
    await rollbackQuietly(dbClient);
    res.status(error.status || 500).json({ message: error.status ? error.message : "Failed to submit Purchase Order." });
  } finally {
    dbClient.release();
  }
}));

router.post("/po/:poNumber/approve", requirePermission(PERMISSIONS.PO_APPROVE), asyncRoute(async (req, res) => {
  const authenticatedActor = actorFromAuth(req.buildliteAuth, PERMISSIONS.PO_APPROVE).actor;
  const active = await getActiveClient();
  if (!active) return res.status(404).json({ error: "No active client set" });
  const { status = "Approved", note = "" } = req.body || {};
  const norm = String(status).toLowerCase();
  if (!["approved", "rejected"].includes(norm)) {
    return res.status(400).json({ message: "status must be 'Approved' or 'Rejected'" });
  }
  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const po = await dbGetPO(active.id, req.params.poNumber, dbClient, { forUpdate: true });
    if (!po) throw routeError(404, "PO not found");
    if (hasApprovedAuthority(po)) {
      if (norm === "approved" && String(po.status || "").toLowerCase() === "approved") {
        await dbClient.query("COMMIT");
        return res.json(po);
      }
      throw routeError(409, "Approved Purchase Orders are immutable. Use a governed correction workflow.");
    }
    if (po.archived) throw routeError(409, "Archived Purchase Orders cannot receive an approval decision.");
    if (String(po.status || "").toLowerCase() !== "issued"
      || String(po.approval?.status || "").toLowerCase() !== "pending") {
      throw routeError(409, "Only an Issued Purchase Order pending approval can receive an approval decision.");
    }

    let proposedTerms = null;
    if (norm === "approved") {
      const supplierError = await assertSupplierApprovedForPoApproval(active.id, po, dbClient, { lock: true });
      if (supplierError) throw routeError(400, supplierError.message);
      const supplier = await resolveAuthoritativeSupplier(active.id, {}, po, dbClient, { lock: true });
      po.supplierId = supplier.supplierId;
      po.supplierSnapshot = supplier.supplierSnapshot;
      proposedTerms = await resolveForPo(active.id, po.poNumber, dbClient);
    }

    const now = new Date().toISOString();
    po.status = norm === "approved" ? "Approved" : "Rejected";
    po.approval = {
      ...(po.approval || {}),
      status: po.status,
      approver: authenticatedActor,
      approverEmail: req.buildliteAuth.email || "",
      note,
      decidedAt: now,
    };
    pushHistory(po, norm === "approved" ? "APPROVED" : "REJECTED", authenticatedActor, note);
    po.updatedAt = now;
    const requiresPackageMaterialisation = norm === "approved" && isSubcontractPoType(po);
    await dbSavePOWithClient(dbClient, active.id, po);

    if (norm === "approved") {
      po.governingTerms = await bindOnApproval(active.id, po.poNumber, {
        dbClient,
        actor: authenticatedActor,
        resolvedTerms: proposedTerms,
      });
    }

    const materialiseResult = requiresPackageMaterialisation ? await materialisePackageFromPoNumber(active.id, po.poNumber, {
      dbClient,
      actor: authenticatedActor,
      requirePackage: true,
    }) : { ok: true };

    if (!materialiseResult.ok) {
      await dbClient.query("ROLLBACK");
      return res.status(materialiseResult.status || 400).json({
        message: materialiseResult.message,
        reason: materialiseResult.reason || null,
      });
    }

    await dbClient.query("COMMIT");
    res.json(po);
  } catch (err) {
    await rollbackQuietly(dbClient);
    if (!err.status) console.error("[PO] approve + package materialisation error:", err);
    res.status(err.status || 500).json({ message: err.status ? err.message : "Failed to approve PO and materialise package." });
  } finally {
    dbClient.release();
  }
}));

/* =========================================
 * ROUTES — READ & DELETE
 * ======================================= */

router.get("/po/:poNumber", asyncRoute(async (req, res) => {
  const active = await getActiveClient();
  if (!active) return res.status(404).json({ error: "No active client set" });

  const po = await dbGetPO(active.id, req.params.poNumber);
  if (!po) return res.status(404).json({ message: "PO not found" });
  po.governingTerms = await resolveForPo(active.id, po.poNumber);
  res.json(po);
}));

router.delete("/po/:poNumber", requirePermission(PERMISSIONS.PO_DELETE_DRAFT), asyncRoute(async (req, res) => {
  const active = await getActiveClient();
  if (!active) return res.status(404).json({ error: "No active client set" });
  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const po = await dbGetPO(active.id, req.params.poNumber, dbClient, { forUpdate: true });
    if (!po) throw routeError(404, "PO not found");
    if (String(po.status||'').toLowerCase() !== 'draft'
      || String(po.approval?.status || "").toLowerCase() !== 'draft'
      || hasApprovedAuthority(po)) {
      throw routeError(409, "Only a never-approved, never-submitted Draft Purchase Order can be deleted.");
    }
    if(await dbHasPoDependencies(active.id,req.params.poNumber,dbClient)) {
      throw routeError(409, 'Purchase Order has governed commercial dependencies and cannot be deleted.');
    }
    await dbDeletePO(active.id, req.params.poNumber, dbClient);
    await dbClient.query("COMMIT");
    res.json({ ok: true });
  } catch (error) {
    await rollbackQuietly(dbClient);
    res.status(error.status || 500).json({ message: error.status ? error.message : "Failed to delete Purchase Order." });
  } finally {
    dbClient.release();
  }
}));

module.exports = router;
