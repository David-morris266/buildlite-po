/**
 * BL-027B.1 — Extract package grouping fields from PO payloads.
 * Mirrors client subcontractOrders.js eligibility semantics.
 */

const { buildSubcontractOrderKey, normaliseCostCode } = require("./packageKey");

function isApprovedSubcontractPo(po) {
  if (!po || po.archived === true) return false;
  const type = String(po.type || "").toUpperCase();
  if (type !== "S") return false;

  const approval = String(po.approval?.status || "").toLowerCase();
  const status = String(po.status || "").toLowerCase();
  return approval === "approved" || status === "approved";
}

function getPoCostCode(po) {
  const code = po?.costRef?.costCode || po?.items?.[0]?.costCode;
  const value = String(code || "general").trim();
  return value || "general";
}

function getPoDevelopmentIdFromPayload(po) {
  if (!po) return null;
  if (po.development?.id) return String(po.development.id);
  if (po.developmentId) return String(po.developmentId);
  if (po.costRef?.developmentId) return String(po.costRef.developmentId);
  return null;
}

function getPoJobNumber(po) {
  const job = po?.job || po?.costRef?.job || null;
  if (!job) return "";
  return String(job.jobNumber || job.jobCode || "").trim();
}

function getSupplierLabel(po) {
  return (
    po?.supplierSnapshot?.name ||
    po?.supplierName ||
    po?.supplier ||
    ""
  );
}

function getDevelopmentLabels(po, developmentRow = null) {
  if (developmentRow) {
    return {
      developmentNumber: developmentRow.job_number || "",
      developmentName: developmentRow.development_name || "",
    };
  }

  return {
    developmentNumber: po?.developmentNumber || po?.development?.developmentNumber || "",
    developmentName:
      po?.developmentName ||
      po?.development?.developmentName ||
      "",
  };
}

function buildPackageGroupKey(developmentId, supplierId, costCode) {
  if (!developmentId || !supplierId) return null;
  return buildSubcontractOrderKey(developmentId, supplierId, costCode);
}

function extractEligiblePoForPackage(po, context = {}) {
  const { developmentIdResolver } = context;

  if (!isApprovedSubcontractPo(po)) {
    return {
      ok: false,
      reason: "not-approved-subcontract",
      poNumber: po?.poNumber || null,
    };
  }

  const supplierId = po?.supplierId ? String(po.supplierId) : "";
  if (!supplierId) {
    return {
      ok: false,
      reason: "missing-supplier-id",
      poNumber: po?.poNumber || null,
    };
  }

  const developmentId = developmentIdResolver
    ? developmentIdResolver(po)
    : getPoDevelopmentIdFromPayload(po);

  if (!developmentId) {
    return {
      ok: false,
      reason: "missing-development-id",
      poNumber: po?.poNumber || null,
    };
  }

  const rawCostCode = getPoCostCode(po);
  const costCode = normaliseCostCode(rawCostCode);
  const orderKey = buildPackageGroupKey(developmentId, supplierId, rawCostCode);

  return {
    ok: true,
    poNumber: po.poNumber,
    developmentId,
    supplierId,
    costCode,
    orderKey,
    supplierLabel: getSupplierLabel(po),
    rawCostCode,
  };
}

module.exports = {
  isApprovedSubcontractPo,
  getPoCostCode,
  getPoDevelopmentIdFromPayload,
  getPoJobNumber,
  getSupplierLabel,
  getDevelopmentLabels,
  buildPackageGroupKey,
  extractEligiblePoForPackage,
};
