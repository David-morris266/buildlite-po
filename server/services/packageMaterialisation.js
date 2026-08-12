/**
 * BL-027B.1 — Materialise server Package identity from approved subcontract POs.
 */

const { query } = require("../db");
const {
  extractEligiblePoForPackage,
  getPoDevelopmentIdFromPayload,
  getPoJobNumber,
  getDevelopmentLabels,
  isApprovedSubcontractPo,
  buildPackageGroupKey,
  getPoCostCode,
  getSupplierLabel,
} = require("./packagePoExtract");
const { normaliseCostCode } = require("./packageKey");
const {
  findDevelopmentByJobNumber,
  findDevelopmentRowForPo,
  upsertPackageWithMembership,
} = require("./packageRepository");

async function runQuery(dbClient, text, params) {
  if (dbClient) {
    return dbClient.query(text, params);
  }
  return query(text, params);
}

async function listPurchaseOrdersForClient(clientId, dbClient = null) {
  const { rows } = await runQuery(
    dbClient,
    `
      SELECT payload
      FROM purchase_orders
      WHERE client_id = $1
    `,
    [clientId]
  );
  return rows.map((row) => row.payload);
}

async function resolveDevelopmentForPo(clientId, po, caches = null, dbClient = null) {
  const store = caches || { developments: new Map(), jobNumbers: new Map() };

  const direct = getPoDevelopmentIdFromPayload(po);
  if (direct) {
    if (store.developments.has(direct)) {
      return { developmentId: direct, developmentRow: store.developments.get(direct) };
    }
    const row = await findDevelopmentRowForPo(clientId, direct, dbClient);
    if (row) {
      store.developments.set(direct, row);
      return { developmentId: direct, developmentRow: row };
    }
    return { developmentId: null, developmentRow: null, reason: "development-not-found" };
  }

  const jobNumber = getPoJobNumber(po);
  if (!jobNumber) {
    return { developmentId: null, developmentRow: null, reason: "missing-development-id" };
  }

  if (store.jobNumbers.has(jobNumber)) {
    const cachedId = store.jobNumbers.get(jobNumber);
    if (!cachedId) {
      return { developmentId: null, developmentRow: null, reason: "development-not-found" };
    }
    return {
      developmentId: cachedId,
      developmentRow: store.developments.get(cachedId) || null,
    };
  }

  const row = await findDevelopmentByJobNumber(clientId, jobNumber, dbClient);
  if (!row) {
    store.jobNumbers.set(jobNumber, null);
    return { developmentId: null, developmentRow: null, reason: "development-not-found" };
  }

  store.jobNumbers.set(jobNumber, row.id);
  store.developments.set(row.id, row);
  return { developmentId: row.id, developmentRow: row };
}

async function buildEligiblePoRecord(clientId, po, caches, dbClient = null) {
  if (!isApprovedSubcontractPo(po)) {
    return {
      ok: false,
      poNumber: po?.poNumber || null,
      reason: "not-approved-subcontract",
    };
  }

  const supplierId = po?.supplierId ? String(po.supplierId) : "";
  if (!supplierId) {
    return {
      ok: false,
      poNumber: po?.poNumber || null,
      reason: "missing-supplier-id",
    };
  }

  const development = await resolveDevelopmentForPo(clientId, po, caches, dbClient);
  if (!development.developmentId || !development.developmentRow) {
    return {
      ok: false,
      poNumber: po?.poNumber || null,
      reason: development.reason || "development-not-found",
    };
  }

  const rawCostCode = getPoCostCode(po);
  const costCode = normaliseCostCode(rawCostCode);
  const orderKey = buildPackageGroupKey(
    development.developmentId,
    supplierId,
    rawCostCode
  );

  return {
    ok: true,
    poNumber: po.poNumber,
    developmentId: development.developmentId,
    developmentRow: development.developmentRow,
    supplierId,
    costCode,
    orderKey,
    supplierLabel: getSupplierLabel(po),
    po,
  };
}

function groupEligiblePos(eligiblePos) {
  const groups = new Map();

  for (const item of eligiblePos) {
    const existing = groups.get(item.orderKey) || {
      orderKey: item.orderKey,
      developmentId: item.developmentId,
      supplierId: item.supplierId,
      costCode: item.costCode,
      supplierLabel: item.supplierLabel,
      developmentNumber: item.developmentRow?.job_number || "",
      developmentName: item.developmentRow?.development_name || "",
      poNumbers: [],
      pos: [],
    };

    if (item.supplierLabel && !existing.supplierLabel) {
      existing.supplierLabel = item.supplierLabel;
    }

    if (item.poNumber && !existing.poNumbers.includes(item.poNumber)) {
      existing.poNumbers.push(item.poNumber);
    }
    existing.pos.push(item.po);
    groups.set(item.orderKey, existing);
  }

  return groups;
}

async function upsertGroupedPackages(clientId, groups, { actor = null, dbClient = null } = {}) {
  let created = 0;
  let updated = 0;
  const packages = [];

  for (const group of groups.values()) {
    const result = await upsertPackageWithMembership(
      { id: clientId },
      {
        ...group,
        payload: {
          materialisationSource: "approved-pos",
        },
      },
      { actor, dbClient }
    );

    if (result.created) created += 1;
    else updated += 1;
    packages.push(result.package);
  }

  return { created, updated, packages };
}

async function materialisePackagesFromApprovedPos(clientId, options = {}) {
  const { actor = null, developmentId: filterDevelopmentId = null } = options;
  const pos = await listPurchaseOrdersForClient(clientId);
  const caches = {
    developments: new Map(),
    jobNumbers: new Map(),
  };

  const skipped = [];
  const eligible = [];

  for (const po of pos) {
    const record = await buildEligiblePoRecord(clientId, po, caches);
    if (!record.ok) {
      skipped.push({ poNumber: record.poNumber, reason: record.reason });
      continue;
    }

    if (
      filterDevelopmentId &&
      record.developmentId !== String(filterDevelopmentId)
    ) {
      continue;
    }

    eligible.push(record);
  }

  const groups = groupEligiblePos(eligible);
  const upsertResult = await upsertGroupedPackages(clientId, groups, { actor });

  return {
    ok: true,
    summary: {
      created: upsertResult.created,
      updated: upsertResult.updated,
      packageCount: upsertResult.packages.length,
      eligiblePoCount: eligible.length,
      skippedCount: skipped.length,
    },
    packages: upsertResult.packages,
    skipped,
  };
}

async function materialisePackageFromPoNumber(clientId, poNumber, options = {}) {
  const { actor = null, dbClient = null, requirePackage = false } = options;

  const { rows } = await runQuery(
    dbClient,
    `
      SELECT payload
      FROM purchase_orders
      WHERE client_id = $1 AND po_number = $2
      LIMIT 1
    `,
    [clientId, poNumber]
  );

  const po = rows[0]?.payload;
  if (!po) {
    return {
      ok: false,
      status: 404,
      message: "PO not found.",
    };
  }

  const caches = {
    developments: new Map(),
    jobNumbers: new Map(),
  };

  const seed = await buildEligiblePoRecord(clientId, po, caches, dbClient);
  if (!seed.ok) {
    const message = `PO is not eligible for package materialisation (${seed.reason}).`;
    if (requirePackage) {
      return {
        ok: false,
        status: 400,
        message,
        reason: seed.reason,
      };
    }
    return {
      ok: false,
      status: 400,
      message,
      reason: seed.reason,
    };
  }

  const pos = await listPurchaseOrdersForClient(clientId, dbClient);
  const eligible = [];

  for (const candidate of pos) {
    const record = await buildEligiblePoRecord(clientId, candidate, caches, dbClient);
    if (!record.ok) continue;
    if (record.orderKey !== seed.orderKey) continue;
    eligible.push(record);
  }

  const groups = groupEligiblePos(eligible);
  const group = groups.get(seed.orderKey);
  if (!group) {
    const message = "Could not build package group for PO.";
    return {
      ok: false,
      status: 400,
      message,
      reason: "package-group-not-built",
    };
  }

  const upsertResult = await upsertGroupedPackages(clientId, new Map([[seed.orderKey, group]]), {
    actor,
    dbClient,
  });

  const pkg = upsertResult.packages[0] || null;

  return {
    ok: true,
    status: upsertResult.created > 0 ? 201 : 200,
    created: upsertResult.created > 0,
    package: pkg,
  };
}

module.exports = {
  materialisePackagesFromApprovedPos,
  materialisePackageFromPoNumber,
  listPurchaseOrdersForClient,
  buildEligiblePoRecord,
  groupEligiblePos,
};
