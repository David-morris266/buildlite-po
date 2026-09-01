/**
 * BL-028A — Commercial Event Postgres access layer.
 */

const crypto = require("crypto");
const { pool, query } = require("../db");
const { assertServicePermission } = require('../auth/authorization');
const { PERMISSIONS } = require('../auth/permissions');
const {
  rowToDocument,
  extractPayloadFromDocument,
  omitExpectedLiabilityWriteFields,
  auditRowToEntry,
} = require("./commercialEventMapper");
const {
  generateCommercialEventId,
  generateCommercialEventAuditId,
  isValidCommercialEventId,
  COMMERCIAL_EVENT_STATUSES,
  COMMERCIAL_EVENT_RECOVERY_STATUSES,
  isRecoveryRelationshipType,
  canSubmitCommercialEvent,
  canApproveCommercialEvent,
  canRejectCommercialEvent,
  canCloseCommercialEvent,
} = require("./commercialEventConstants");
const { allocateNextEventNumber } = require("./commercialEventNumbering");
const { applyContraChargeFinancialTreatment } = require("./commercialEventFinancialTreatment");
const {
  validateEventPayload,
  validateRecoveryPackageId,
  validateRecoveryDraftPatch,
  assertDraftEditable,
} = require("./commercialEventValidation");
const {
  EXPECTED_LIABILITY_AUDIT_ACTION,
  validateExpectedLiabilityIntent,
} = require("./commercialEventExpectedLiability");
const {
  findPackageRowById,
  findPackageByOrderKey,
  developmentExistsForClient,
} = require("./packageRepository");
const { parseSubcontractOrderKey } = require("./packageKey");

function isUniqueViolation(err) {
  return err && err.code === "23505";
}

async function runQuery(dbClient, text, params) {
  if (dbClient) return dbClient.query(text, params);
  return query(text, params);
}

function toBoolean(value, fallback = false) {
  if (value == null) return fallback;
  return Boolean(value);
}

function toRecoveredAmount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function provisionalActor(body = {}) {
  return body.updatedBy || body.createdBy || body.actor || null;
}

function buildDeterministicImportAuditId(commercialEventId, index, entry) {
  const seed = [
    commercialEventId,
    String(index),
    entry.action || "",
    entry.timestamp || entry.createdAt || "",
    entry.actor || "",
    entry.comment || "",
  ].join("|");
  const hash = crypto.createHash("sha256").update(seed).digest("hex").slice(0, 12);
  return `ce-audit-import-${commercialEventId}-${index}-${hash}`;
}

async function loadAuditRows(clientId, commercialEventId, dbClient = null) {
  const { rows } = await runQuery(
    dbClient,
    `
      SELECT *
      FROM commercial_event_audit
      WHERE client_id = $1 AND commercial_event_id = $2
      ORDER BY created_at ASC, id ASC
    `,
    [clientId, commercialEventId]
  );
  return rows;
}

async function findCommercialEventRow(clientId, id, dbClient = null) {
  const { rows } = await runQuery(
    dbClient,
    `
      SELECT *
      FROM commercial_events
      WHERE id = $1 AND client_id = $2
      LIMIT 1
    `,
    [id, clientId]
  );
  return rows[0] || null;
}

async function findCommercialEventById(clientId, id, { includeAudit = true } = {}) {
  const row = await findCommercialEventRow(clientId, id);
  if (!row) return null;
  const auditRows = includeAudit ? await loadAuditRows(clientId, id) : [];
  const issued = await runQuery(
    null,
    `SELECT id
       FROM variation_orders
      WHERE client_id=$1
        AND status='issued'
        AND (
          normal_source_commercial_event_id=$2
          OR EXISTS (
            SELECT 1 FROM variation_order_commercial_events link
             WHERE link.client_id=$1
               AND link.variation_order_id=variation_orders.id
               AND link.commercial_event_id=$2
          )
        )
      ORDER BY issued_at DESC, id
      LIMIT 1`,
    [clientId, id]
  );
  return rowToDocument(
    { ...row, issued_variation_order_id: issued.rows[0]?.id || null },
    auditRows
  );
}

async function listCommercialEvents(clientId, filters = {}, dbClient = null) {
  const clauses = ["client_id = $1"];
  const params = [clientId];

  if (filters.developmentId) {
    params.push(filters.developmentId);
    clauses.push(`development_id = $${params.length}`);
  }
  if (filters.packageUuid) {
    params.push(filters.packageUuid);
    clauses.push(`package_id = $${params.length}::uuid`);
  }
  if (filters.orderKey) {
    params.push(filters.orderKey);
    clauses.push(`order_key = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    clauses.push(`status = $${params.length}`);
  }
  if (filters.relationshipType) {
    params.push(filters.relationshipType);
    clauses.push(`relationship_type = $${params.length}`);
  }

  const { rows } = await runQuery(
    dbClient,
    `
      SELECT ce.*,
        (
          SELECT vo.id
          FROM variation_orders vo
          WHERE vo.client_id=ce.client_id
            AND vo.status='issued'
            AND (
              vo.normal_source_commercial_event_id=ce.id
              OR EXISTS (
                SELECT 1 FROM variation_order_commercial_events link
                WHERE link.client_id=ce.client_id
                  AND link.variation_order_id=vo.id
                  AND link.commercial_event_id=ce.id
              )
            )
          ORDER BY vo.issued_at DESC, vo.id
          LIMIT 1
        ) AS issued_variation_order_id
      FROM commercial_events ce
      WHERE ${clauses.map((clause) => `ce.${clause}`).join(" AND ")}
      ORDER BY ce.created_at ASC, ce.event_number ASC
    `,
    params
  );

  return rows.map((row) => rowToDocument(row, []));
}

async function resolvePackageForEvent(clientId, developmentId, body = {}) {
  const orderKey = String(body.packageId || body.orderKey || "").trim();
  const packageUuid = String(body.packageUuid || "").trim();

  if (!developmentId) {
    return { ok: false, status: 400, message: "developmentId is required." };
  }

  const devExists = await developmentExistsForClient(clientId, developmentId);
  if (!devExists) {
    return { ok: false, status: 400, message: "Development not found for active tenant." };
  }

  let packageRow = null;

  if (packageUuid) {
    packageRow = await findPackageRowById(clientId, packageUuid);
    if (!packageRow) {
      return { ok: false, status: 400, message: "Package not found for active tenant." };
    }
    if (orderKey && packageRow.order_key !== orderKey) {
      return {
        ok: false,
        status: 400,
        message: "Supplied orderKey does not match resolved Package.",
      };
    }
  } else if (orderKey) {
    const pkg = await findPackageByOrderKey(clientId, orderKey);
    packageRow = pkg
      ? {
          id: pkg.id,
          development_id: pkg.developmentId,
          order_key: pkg.orderKey,
          supplier_id: pkg.supplierId,
          cost_code: pkg.costCode,
        }
      : null;
    if (!packageRow) {
      return { ok: false, status: 400, message: "Package not found for active tenant." };
    }
  } else {
    return { ok: false, status: 400, message: "packageId (orderKey) or packageUuid is required." };
  }

  if (packageRow.development_id !== developmentId) {
    return {
      ok: false,
      status: 400,
      message: "Package does not belong to the specified development.",
    };
  }

  return {
    ok: true,
    packageRow,
    orderKey: packageRow.order_key,
    packageUuid: packageRow.id,
  };
}

function normalizeCreateDocument(body = {}, packageRow, developmentId, actor = null, options = {}) {
  const { forImport = false } = options;
  const nowIso = new Date().toISOString();
  const treated = forImport ? body : applyContraChargeFinancialTreatment(body, { isCreate: true });

  return {
    ...body,
    developmentId,
    packageUuid: packageRow.id,
    packageId: packageRow.order_key,
    orderKey: packageRow.order_key,
    poNumber: treated.poNumber || "",
    supplierId: treated.supplierId || packageRow.supplier_id || "",
    costCode: treated.costCode || packageRow.cost_code || "",
    eventType: treated.eventType,
    category: treated.category,
    subcategory: treated.subcategory || "",
    responsibility: treated.responsibility,
    description: String(treated.description || "").trim(),
    value: Number(treated.value),
    financialTreatment: treated.financialTreatment || null,
    vatTreatment: treated.vatTreatment || "standard",
    dateRaised: treated.dateRaised || nowIso.slice(0, 10),
    raisedBy: treated.raisedBy || actor,
    status: forImport
      ? treated.status || COMMERCIAL_EVENT_STATUSES.draft
      : COMMERCIAL_EVENT_STATUSES.draft,
    linkedEventId: treated.linkedEventId || null,
    recoveryPackageId: treated.recoveryPackageId || null,
    potentialContraCharge: toBoolean(treated.potentialContraCharge, false),
    potentialContraChargeNotes: String(treated.potentialContraChargeNotes || "").trim(),
    relationshipType: treated.relationshipType || null,
    recoveredAmount: toRecoveredAmount(treated.recoveredAmount),
    certificateStatus: treated.certificateStatus || "notIncluded",
    recoveryStatus: treated.recoveryStatus || "notApplicable",
    createdBy: actor,
    updatedBy: actor,
    payload: extractPayloadFromDocument(treated),
  };
}

function documentToInsertParams(document, { clientId, eventNumber, id }) {
  return [
    id,
    clientId,
    document.developmentId,
    document.packageUuid,
    document.orderKey,
    eventNumber,
    document.eventType,
    document.category,
    document.subcategory || "",
    document.responsibility,
    document.description,
    document.value,
    document.financialTreatment,
    document.vatTreatment || "standard",
    document.dateRaised || null,
    document.raisedBy || null,
    document.status || COMMERCIAL_EVENT_STATUSES.draft,
    document.linkedEventId || null,
    document.recoveryPackageId || null,
    toBoolean(document.potentialContraCharge, false),
    document.potentialContraChargeNotes || "",
    document.relationshipType || null,
    toRecoveredAmount(document.recoveredAmount),
    document.certificateStatus || "notIncluded",
    document.recoveryStatus || "notApplicable",
    document.poNumber || "",
    document.supplierId || "",
    document.costCode || "",
    JSON.stringify(document.payload || {}),
    document.createdBy || null,
    document.updatedBy || null,
  ];
}

const INSERT_EVENT_SQL = `
  INSERT INTO commercial_events (
    id, client_id, development_id, package_id, order_key, event_number,
    event_type, category, subcategory, responsibility, description, value,
    financial_treatment, vat_treatment, date_raised, raised_by, status,
    linked_event_id, recovery_package_id, potential_contra_charge,
    potential_contra_charge_notes, relationship_type, recovered_amount,
    certificate_status, recovery_status, po_number, supplier_id, cost_code,
    payload, created_by, updated_by
  )
  VALUES (
    $1, $2, $3, $4, $5, $6,
    $7, $8, $9, $10, $11, $12,
    $13, $14, $15, $16, $17,
    $18, $19, $20,
    $21, $22, $23,
    $24, $25, $26, $27, $28,
    $29::jsonb, $30, $31
  )
  RETURNING *
`;

const IMPORT_INSERT_EVENT_SQL = `
  INSERT INTO commercial_events (
    id, client_id, development_id, package_id, order_key, event_number,
    event_type, category, subcategory, responsibility, description, value,
    financial_treatment, vat_treatment, date_raised, raised_by, status,
    linked_event_id, recovery_package_id, potential_contra_charge,
    potential_contra_charge_notes, relationship_type, recovered_amount,
    certificate_status, recovery_status, po_number, supplier_id, cost_code,
    payload, created_by, updated_by, created_at, updated_at
  )
  VALUES (
    $1, $2, $3, $4, $5, $6,
    $7, $8, $9, $10, $11, $12,
    $13, $14, $15, $16, $17,
    $18, $19, $20,
    $21, $22, $23,
    $24, $25, $26, $27, $28,
    $29::jsonb, $30, $31, COALESCE($32::timestamptz, NOW()), COALESCE($33::timestamptz, NOW())
  )
  RETURNING *
`;

async function insertAuditEntry(
  dbClient,
  clientId,
  commercialEventId,
  {
    id = null,
    action,
    actor = null,
    comment = "",
    priorStatus = null,
    newStatus = null,
    priorRecoveryStatus = null,
    newRecoveryStatus = null,
    priorCertificateStatus = null,
    newCertificateStatus = null,
    createdAt = null,
    priorExpectedTreatment = null,
    newExpectedTreatment = null,
    priorExpectedAmount = null,
    newExpectedAmount = null,
    priorEffectiveExpected = null,
    newEffectiveExpected = null,
    ceValueAtChange = null,
    ceStatusAtChange = null,
    priorCeVersion = null,
    newCeVersion = null,
  }
) {
  const auditId = id || generateCommercialEventAuditId();
  const { rows } = await dbClient.query(
    `
      INSERT INTO commercial_event_audit (
        id, client_id, commercial_event_id, action, actor, comment,
        prior_status, new_status, prior_recovery_status, new_recovery_status,
        prior_certificate_status, new_certificate_status,
        prior_expected_treatment, new_expected_treatment,
        prior_expected_amount, new_expected_amount,
        prior_effective_expected, new_effective_expected,
        ce_value_at_change, ce_status_at_change,
        prior_ce_version, new_ce_version,
        created_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17, $18,
        $19, $20, $21, $22,
        COALESCE($23::timestamptz, NOW())
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `,
    [
      auditId,
      clientId,
      commercialEventId,
      action,
      actor,
      comment || "",
      priorStatus,
      newStatus,
      priorRecoveryStatus,
      newRecoveryStatus,
      priorCertificateStatus,
      newCertificateStatus,
      priorExpectedTreatment,
      newExpectedTreatment,
      priorExpectedAmount,
      newExpectedAmount,
      priorEffectiveExpected,
      newEffectiveExpected,
      ceValueAtChange,
      ceStatusAtChange,
      priorCeVersion,
      newCeVersion,
      createdAt,
    ]
  );
  return rows[0]?.id || null;
}

async function createCommercialEvent(clientId, body = {}, { actor = null } = {}) {
  const developmentId = String(body.developmentId || "").trim();
  const packageResolution = await resolvePackageForEvent(clientId, developmentId, body);
  if (!packageResolution.ok) return packageResolution;

  const validationErrors = validateEventPayload(body);
  if (validationErrors.length) {
    return { ok: false, status: 400, message: validationErrors.join("; ") };
  }

  const suppliedId = String(body.id || "").trim();
  let id = null;
  if (suppliedId) {
    if (!isValidCommercialEventId(suppliedId)) {
      return { ok: false, status: 400, message: "Supplied id is not a valid ce-* identifier." };
    }
    const existing = await findCommercialEventRow(clientId, suppliedId);
    if (existing) {
      return { ok: false, status: 409, message: "Commercial event id already exists." };
    }
    id = suppliedId;
  } else {
    id = generateCommercialEventId();
  }

  const document = normalizeCreateDocument(
    body,
    packageResolution.packageRow,
    developmentId,
    actor
  );

  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const eventNumber = await allocateNextEventNumber(db, clientId);

    const insertParams = documentToInsertParams(document, { clientId, eventNumber, id });
    const { rows } = await db.query(INSERT_EVENT_SQL, insertParams);

    await insertAuditEntry(db, clientId, id, {
      action: "CREATED",
      actor,
      priorStatus: null,
      newStatus: document.status,
    });

    await db.query("COMMIT");
    const event = await findCommercialEventById(clientId, rows[0].id);
    return { ok: true, status: 201, event };
  } catch (err) {
    await db.query("ROLLBACK");
    if (isUniqueViolation(err)) {
      const detail = String(err.detail || "").toLowerCase();
      if (detail.includes("event_number")) {
        return {
          ok: false,
          status: 409,
          message: "Commercial event number already exists for this tenant.",
        };
      }
      return { ok: false, status: 409, message: "Commercial event id already exists." };
    }
    throw err;
  } finally {
    db.release();
  }
}

async function updateCommercialEventDraft(
  clientId,
  id,
  rawPatch = {},
  expectedVersion,
  { actor = null } = {}
) {
  const patch = omitExpectedLiabilityWriteFields(rawPatch);
  const existing = await findCommercialEventById(clientId, id);
  if (!existing) {
    return { ok: false, status: 404, message: "Commercial event not found." };
  }

  const editable = assertDraftEditable(existing);
  if (!editable.ok) return editable;

  const parsedVersion = Number(expectedVersion);
  if (!Number.isInteger(parsedVersion) || parsedVersion < 1) {
    return {
      ok: false,
      status: 400,
      message: "version is required and must be a positive integer.",
    };
  }
  if (existing.version !== parsedVersion) {
    return {
      ok: false,
      status: 409,
      message: "Commercial event version conflict.",
      event: existing,
    };
  }

  const merged = { ...existing, ...patch };
  const errors = validateEventPayload(merged, { partial: true });
  errors.push(...validateRecoveryDraftPatch(existing, patch));
  if (errors.length) {
    return { ok: false, status: 400, message: errors.join("; ") };
  }

  const treated = applyContraChargeFinancialTreatment(
    {
      ...existing,
      ...patch,
      eventType: patch.eventType ?? existing.eventType,
      financialTreatment: patch.financialTreatment ?? existing.financialTreatment,
      linkedEventId: patch.linkedEventId ?? existing.linkedEventId,
      relationshipType: patch.relationshipType ?? existing.relationshipType,
      value: patch.value != null ? patch.value : existing.value,
    },
    { isCreate: false }
  );

  const nextValue = patch.value != null ? Number(treated.value) : existing.value;
  const nextFinancialTreatment =
    treated.financialTreatment ?? existing.financialTreatment ?? null;
  const nextRelationshipType = treated.relationshipType ?? existing.relationshipType ?? null;
  const nextLinkedEventId = treated.linkedEventId ?? existing.linkedEventId ?? null;

  const db = await pool.connect();
  try {
    await db.query("BEGIN");

    const { rows, rowCount } = await db.query(
      `
        UPDATE commercial_events
        SET
          event_type = $1,
          category = $2,
          subcategory = $3,
          responsibility = $4,
          description = $5,
          value = $6,
          financial_treatment = $7,
          vat_treatment = $8,
          date_raised = $9,
          raised_by = $10,
          linked_event_id = $11,
          relationship_type = $12,
          potential_contra_charge = $13,
          potential_contra_charge_notes = $14,
          po_number = $15,
          supplier_id = $16,
          cost_code = $17,
          payload = $18::jsonb,
          version = version + 1,
          updated_at = NOW(),
          updated_by = $19
        WHERE id = $20
          AND client_id = $21
          AND version = $22
          AND status = $23
        RETURNING *
      `,
      [
        patch.eventType ?? existing.eventType,
        patch.category ?? existing.category,
        patch.subcategory ?? existing.subcategory ?? "",
        patch.responsibility ?? existing.responsibility,
        patch.description != null
          ? String(patch.description).trim()
          : existing.description,
        nextValue,
        nextFinancialTreatment,
        patch.vatTreatment ?? existing.vatTreatment,
        patch.dateRaised ?? existing.dateRaised,
        patch.raisedBy ?? existing.raisedBy,
        nextLinkedEventId,
        nextRelationshipType,
        patch.potentialContraCharge != null
          ? toBoolean(patch.potentialContraCharge)
          : existing.potentialContraCharge,
        patch.potentialContraChargeNotes != null
          ? String(patch.potentialContraChargeNotes || "").trim()
          : existing.potentialContraChargeNotes,
        patch.poNumber ?? existing.poNumber ?? "",
        patch.supplierId ?? existing.supplierId ?? "",
        patch.costCode ?? existing.costCode ?? "",
        JSON.stringify({
          ...extractPayloadFromDocument(existing),
          ...extractPayloadFromDocument(patch),
        }),
        actor,
        id,
        clientId,
        parsedVersion,
        COMMERCIAL_EVENT_STATUSES.draft,
      ]
    );

    if (!rowCount) {
      await db.query("ROLLBACK");
      const current = await findCommercialEventById(clientId, id);
      return {
        ok: false,
        status: 409,
        message: "Commercial event version conflict.",
        event: current,
      };
    }

    await insertAuditEntry(db, clientId, id, {
      action: "UPDATED",
      actor,
      priorStatus: existing.status,
      newStatus: existing.status,
      comment: patch.auditComment || "",
    });

    await db.query("COMMIT");
    const event = await findCommercialEventById(clientId, id);
    return { ok: true, event };
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    db.release();
  }
}

async function applyWorkflowAction(
  clientId,
  id,
  {
    validate,
    nextStatus,
    auditAction,
    actor = null,
    comment = "",
    applyRecoveryOnApprove = false,
  }
) {
  const existing = await findCommercialEventById(clientId, id);
  if (!existing) {
    return { ok: false, status: 404, message: "Commercial event not found." };
  }

  const transitionError = validate(existing.status);
  if (transitionError) {
    return { ok: false, status: 400, message: transitionError };
  }

  const priorStatus = existing.status;
  const priorRecoveryStatus = existing.recoveryStatus;
  let nextRecoveryStatus = existing.recoveryStatus;

  if (applyRecoveryOnApprove && isRecoveryRelationshipType(existing.relationshipType)) {
    nextRecoveryStatus = "outstanding";
  }

  const db = await pool.connect();
  try {
    await db.query("BEGIN");

    const { rows, rowCount } = await db.query(
      `
        UPDATE commercial_events
        SET
          status = $1,
          recovery_status = $2,
          version = version + 1,
          updated_at = NOW(),
          updated_by = $3
        WHERE id = $4 AND client_id = $5
        RETURNING *
      `,
      [nextStatus, nextRecoveryStatus, actor, id, clientId]
    );

    if (!rowCount) {
      await db.query("ROLLBACK");
      return { ok: false, status: 404, message: "Commercial event not found." };
    }

    await insertAuditEntry(db, clientId, id, {
      action: auditAction,
      actor,
      comment,
      priorStatus,
      newStatus: nextStatus,
      priorRecoveryStatus:
        applyRecoveryOnApprove && isRecoveryRelationshipType(existing.relationshipType)
          ? priorRecoveryStatus
          : null,
      newRecoveryStatus:
        applyRecoveryOnApprove && isRecoveryRelationshipType(existing.relationshipType)
          ? nextRecoveryStatus
          : null,
    });

    await db.query("COMMIT");
    const event = await findCommercialEventById(clientId, rows[0].id);
    return { ok: true, event };
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    db.release();
  }
}

async function submitCommercialEvent(clientId, id, { actor = null, comment = "" } = {}) {
  return applyWorkflowAction(clientId, id, {
    validate: (status) =>
      canSubmitCommercialEvent(status) ? null : "Only draft events can be submitted",
    nextStatus: COMMERCIAL_EVENT_STATUSES.submitted,
    auditAction: "SUBMITTED",
    actor,
    comment,
  });
}

async function approveCommercialEvent(clientId, id, { actor = null, comment = "" } = {}, options = {}) {
  assertServicePermission(options.auth, PERMISSIONS.CE_APPROVE);
  return applyWorkflowAction(clientId, id, {
    validate: (status) =>
      canApproveCommercialEvent(status) ? null : "Only submitted events can be approved",
    nextStatus: COMMERCIAL_EVENT_STATUSES.approved,
    auditAction: "APPROVED",
    actor,
    comment,
    applyRecoveryOnApprove: true,
  });
}

async function rejectCommercialEvent(clientId, id, { actor = null, comment = "" } = {}) {
  return applyWorkflowAction(clientId, id, {
    validate: (status) =>
      canRejectCommercialEvent(status) ? null : "Only submitted events can be rejected",
    nextStatus: COMMERCIAL_EVENT_STATUSES.rejected,
    auditAction: "REJECTED",
    actor,
    comment,
  });
}

async function closeCommercialEvent(clientId, id, { actor = null, comment = "" } = {}) {
  const existing = await findCommercialEventById(clientId, id);
  if (!existing) return { ok: false, status: 404, message: "Commercial event not found." };
  if (isRecoveryRelationshipType(existing.relationshipType)) {
    return {
      ok: false,
      status: 400,
      message: "Recovery events cannot use generic Close. Fully recover them through approved certificates or use Mark Not Required with a reason.",
    };
  }
  return applyWorkflowAction(clientId, id, {
    validate: (status) =>
      canCloseCommercialEvent(status) ? null : "Event cannot be closed in its current status",
    nextStatus: COMMERCIAL_EVENT_STATUSES.closed,
    auditAction: "CLOSED",
    actor,
    comment,
  });
}

async function dismissPotentialContraCharge(
  clientId,
  id,
  { actor = null, comment = "" } = {},
  options = {}
) {
  assertServicePermission(options.auth, PERMISSIONS.CE_RECOVERY_WRITE_OFF);
  const existing = await findCommercialEventById(clientId, id);
  if (!existing) {
    return { ok: false, status: 404, message: "Commercial event not found." };
  }
  if (isRecoveryRelationshipType(existing.relationshipType)) {
    if (!String(comment || "").trim()) {
      return { ok: false, status: 400, message: "A reason is required to mark an outstanding recovery not required." };
    }
    if (existing.status !== COMMERCIAL_EVENT_STATUSES.approved && existing.status !== COMMERCIAL_EVENT_STATUSES.closed) {
      return { ok: false, status: 400, message: "Only an approved recovery can be marked not required." };
    }
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const { rows } = await db.query(
        `UPDATE commercial_events
         SET status = 'closed', recovery_status = 'writtenOff', version = version + 1,
             updated_at = NOW(), updated_by = $1
         WHERE id = $2 AND client_id = $3 RETURNING *`,
        [actor, id, clientId]
      );
      await insertAuditEntry(db, clientId, id, {
        action: "POTENTIAL_CONTRA_CHARGE_DISMISSED", actor, comment: String(comment).trim(),
        priorStatus: existing.status, newStatus: COMMERCIAL_EVENT_STATUSES.closed,
        priorRecoveryStatus: existing.recoveryStatus, newRecoveryStatus: "writtenOff",
      });
      await db.query("COMMIT");
      return { ok: true, event: await findCommercialEventById(clientId, rows[0].id) };
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    } finally { db.release(); }
  }
  if (!existing.potentialContraCharge) {
    return { ok: false, status: 400, message: "Event is not flagged for potential contra charge" };
  }
  if (existing.linkedEventId) {
    return {
      ok: false,
      status: 400,
      message: "Linked recovery already exists for this event",
    };
  }
  if (isRecoveryRelationshipType(existing.relationshipType)) {
    return {
      ok: false,
      status: 400,
      message: "Recovery events cannot dismiss potential contra charge",
    };
  }

  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const { rows, rowCount } = await db.query(
      `
        UPDATE commercial_events
        SET
          potential_contra_charge = false,
          potential_contra_charge_notes = '',
          version = version + 1,
          updated_at = NOW(),
          updated_by = $1
        WHERE id = $2 AND client_id = $3
        RETURNING *
      `,
      [actor, id, clientId]
    );
    if (!rowCount) {
      await db.query("ROLLBACK");
      return { ok: false, status: 404, message: "Commercial event not found." };
    }

    await insertAuditEntry(db, clientId, id, {
      action: "POTENTIAL_CONTRA_CHARGE_DISMISSED",
      actor,
      comment,
      priorStatus: existing.status,
      newStatus: existing.status,
    });

    await db.query("COMMIT");
    return { ok: true, event: await findCommercialEventById(clientId, rows[0].id) };
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    db.release();
  }
}

async function createLinkedRecoveryFromOrigin(
  clientId,
  originEventId,
  { recoveryPackageId, recoveryPackageUuid = null, actor = null, comment = "" } = {}
) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SET CONSTRAINTS fk_commercial_events_linked_event DEFERRED");

    const originRow = await findCommercialEventRow(clientId, originEventId, db);
    if (!originRow) {
      await db.query("ROLLBACK");
      return { ok: false, status: 404, message: "Origin event not found" };
    }

    const origin = rowToDocument(originRow, []);

    if (origin.status !== COMMERCIAL_EVENT_STATUSES.approved) {
      await db.query("ROLLBACK");
      return {
        ok: false,
        status: 400,
        message: "Origin event must be approved before creating a linked recovery",
      };
    }
    if (!origin.potentialContraCharge) {
      await db.query("ROLLBACK");
      return {
        ok: false,
        status: 400,
        message: "Origin event is not flagged for potential contra charge",
      };
    }
    if (origin.linkedEventId) {
      await db.query("ROLLBACK");
      return { ok: false, status: 400, message: "Origin event already has a linked recovery" };
    }
    if (isRecoveryRelationshipType(origin.relationshipType)) {
      await db.query("ROLLBACK");
      return {
        ok: false,
        status: 400,
        message: "Recovery events cannot create linked recoveries",
      };
    }

    const packageErrors = validateRecoveryPackageId(
      recoveryPackageId,
      origin.developmentId,
      origin.packageId
    );
    if (packageErrors.length) {
      await db.query("ROLLBACK");
      return { ok: false, status: 400, message: packageErrors.join("; ") };
    }

    const recoveryResolution = await resolvePackageForEvent(clientId, origin.developmentId, {
      packageId: recoveryPackageId,
      orderKey: recoveryPackageId,
      packageUuid: recoveryPackageUuid,
    });
    if (!recoveryResolution.ok) {
      await db.query("ROLLBACK");
      return recoveryResolution;
    }

    const recoveryPackageRow = recoveryResolution.packageRow;
    const parsedPackage = parseSubcontractOrderKey(recoveryPackageId);
    const recoveryId = generateCommercialEventId();
    const recoveryEventNumber = await allocateNextEventNumber(db, clientId);
    const absoluteOriginValue = Math.abs(Number(origin.value) || 0);
    const recoveryValue =
      absoluteOriginValue > 0 ? -absoluteOriginValue : Number(origin.value) || 0;

    const recoveryDocument = {
      developmentId: origin.developmentId,
      packageUuid: recoveryPackageRow.id,
      orderKey: recoveryPackageRow.order_key,
      eventType: "contraCharge",
      category: origin.category,
      subcategory: origin.subcategory || "contraCharge",
      responsibility: "subcontractor",
      description: origin.description,
      value: recoveryValue,
      financialTreatment: "recoverableDeduction",
      vatTreatment: origin.vatTreatment,
      dateRaised: new Date().toISOString().slice(0, 10),
      raisedBy: actor,
      status: COMMERCIAL_EVENT_STATUSES.draft,
      linkedEventId: origin.id,
      recoveryPackageId: recoveryPackageId,
      potentialContraCharge: false,
      potentialContraChargeNotes: "",
      relationshipType: "recovery",
      recoveredAmount: 0,
      certificateStatus: "notIncluded",
      recoveryStatus: "notApplicable",
      poNumber: "",
      supplierId: parsedPackage?.supplierId || recoveryPackageRow.supplier_id,
      costCode: parsedPackage?.costCode || recoveryPackageRow.cost_code,
      createdBy: actor,
      updatedBy: actor,
      payload: {},
    };

    const recoveryParams = documentToInsertParams(recoveryDocument, {
      clientId,
      eventNumber: recoveryEventNumber,
      id: recoveryId,
    });
    await db.query(INSERT_EVENT_SQL, recoveryParams);

    await insertAuditEntry(db, clientId, recoveryId, {
      action: "CREATED",
      actor,
      priorStatus: null,
      newStatus: COMMERCIAL_EVENT_STATUSES.draft,
      comment,
    });
    await insertAuditEntry(db, clientId, recoveryId, {
      action: "LINKED_TO_ORIGIN",
      actor,
      comment,
      priorStatus: COMMERCIAL_EVENT_STATUSES.draft,
      newStatus: COMMERCIAL_EVENT_STATUSES.draft,
    });

    const { rows: originUpdatedRows, rowCount } = await db.query(
      `
        UPDATE commercial_events
        SET
          linked_event_id = $1,
          relationship_type = 'origin',
          recovery_package_id = $2,
          recovery_status = 'notApplicable',
          version = version + 1,
          updated_at = NOW(),
          updated_by = $3
        WHERE id = $4 AND client_id = $5
        RETURNING *
      `,
      [recoveryId, recoveryPackageId, actor, origin.id, clientId]
    );

    if (!rowCount) {
      await db.query("ROLLBACK");
      return { ok: false, status: 500, message: "Failed to update origin event." };
    }

    await insertAuditEntry(db, clientId, origin.id, {
      action: "LINKED_RECOVERY_CREATED",
      actor,
      comment,
      priorStatus: origin.status,
      newStatus: origin.status,
    });

    await db.query("COMMIT");

    return {
      ok: true,
      origin: await findCommercialEventById(clientId, originUpdatedRows[0].id),
      recovery: await findCommercialEventById(clientId, recoveryId),
    };
  } catch (err) {
    await db.query("ROLLBACK");
    if (isUniqueViolation(err)) {
      return {
        ok: false,
        status: 409,
        message: "Commercial event number already exists for this tenant.",
      };
    }
    throw err;
  } finally {
    db.release();
  }
}

function sortImportEvents(events = []) {
  return [...events].sort((a, b) => {
    const aHasLink = Boolean(String(a.linkedEventId || "").trim());
    const bHasLink = Boolean(String(b.linkedEventId || "").trim());
    if (aHasLink === bHasLink) return 0;
    return aHasLink ? 1 : -1;
  });
}

async function importCommercialEvents(clientId, { developmentId, events = [] } = {}) {
  if (!developmentId) {
    return { ok: false, status: 400, message: "developmentId is required." };
  }
  if (!Array.isArray(events) || !events.length) {
    return { ok: false, status: 400, message: "events array is required." };
  }

  const devExists = await developmentExistsForClient(clientId, developmentId);
  if (!devExists) {
    return { ok: false, status: 400, message: "Development not found for active tenant." };
  }

  const summary = {
    imported: 0,
    skipped: 0,
    conflicts: [],
    failures: [],
    relationshipWarnings: [],
  };

  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SET CONSTRAINTS fk_commercial_events_linked_event DEFERRED");

    for (const rawEvent of sortImportEvents(events)) {
      const eventId = String(rawEvent.id || "").trim();
      if (!isValidCommercialEventId(eventId)) {
        summary.failures.push({ id: eventId || null, reason: "invalid id" });
        continue;
      }

      const existingById = await findCommercialEventRow(clientId, eventId, db);
      if (existingById) {
        summary.skipped += 1;
        continue;
      }

      const eventNumber = String(rawEvent.eventNumber || "").trim();
      if (!eventNumber) {
        summary.failures.push({ id: eventId, reason: "missing eventNumber" });
        continue;
      }

      const { rows: numberRows } = await db.query(
        `
          SELECT id, event_number
          FROM commercial_events
          WHERE client_id = $1 AND event_number = $2
          LIMIT 1
        `,
        [clientId, eventNumber]
      );
      if (numberRows[0] && numberRows[0].id !== eventId) {
        summary.conflicts.push({
          id: eventId,
          eventNumber,
          existingId: numberRows[0].id,
          reason: "eventNumber already assigned to a different id",
        });
        continue;
      }

      const orderKey = String(rawEvent.packageId || rawEvent.orderKey || "").trim();
      const packageResolution = await resolvePackageForEvent(clientId, developmentId, {
        packageId: orderKey,
        orderKey,
        packageUuid: rawEvent.packageUuid,
      });
      if (!packageResolution.ok) {
        summary.failures.push({ id: eventId, reason: packageResolution.message });
        continue;
      }

      if (rawEvent.linkedEventId) {
        const linkedId = String(rawEvent.linkedEventId).trim();
        const linkedRow = await findCommercialEventRow(clientId, linkedId, db);
        const linkedDev = linkedRow?.development_id || null;
        if (linkedRow && linkedDev !== developmentId) {
          summary.relationshipWarnings.push({
            id: eventId,
            linkedEventId: linkedId,
            reason: "cross-development link rejected",
          });
          summary.failures.push({ id: eventId, reason: "cross-development recovery link" });
          continue;
        }
      }

      const validationErrors = validateEventPayload(rawEvent);
      if (validationErrors.length) {
        summary.failures.push({ id: eventId, reason: validationErrors.join("; ") });
        continue;
      }

      const document = normalizeCreateDocument(
        {
          ...rawEvent,
          developmentId,
          status: rawEvent.status || COMMERCIAL_EVENT_STATUSES.draft,
          certificateStatus: rawEvent.certificateStatus || "notIncluded",
          recoveryStatus: rawEvent.recoveryStatus || "notApplicable",
          recoveredAmount: rawEvent.recoveredAmount,
        },
        packageResolution.packageRow,
        developmentId,
        rawEvent.createdBy || rawEvent.raisedBy || null,
        { forImport: true }
      );

      const insertParams = documentToInsertParams(document, {
        clientId,
        eventNumber,
        id: eventId,
      });
      insertParams.push(rawEvent.createdAt || null, rawEvent.updatedAt || null);

      await db.query(IMPORT_INSERT_EVENT_SQL, insertParams);

      const auditHistory = Array.isArray(rawEvent.auditHistory) ? rawEvent.auditHistory : [];
      for (let index = 0; index < auditHistory.length; index += 1) {
        const entry = auditHistory[index];
        const auditId =
          entry.id ||
          buildDeterministicImportAuditId(eventId, index, entry);
        await insertAuditEntry(db, clientId, eventId, {
          id: auditId,
          action: entry.action,
          actor: entry.actor,
          comment: entry.comment || "",
          priorStatus: entry.priorStatus ?? null,
          newStatus: entry.newStatus ?? null,
          priorRecoveryStatus: entry.priorRecoveryStatus ?? null,
          newRecoveryStatus: entry.newRecoveryStatus ?? null,
          priorCertificateStatus: entry.priorCertificateStatus ?? null,
          newCertificateStatus: entry.newCertificateStatus ?? null,
          createdAt: entry.timestamp || entry.createdAt || null,
        });
      }

      summary.imported += 1;
    }

    await db.query("COMMIT");
    return { ok: true, summary };
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    db.release();
  }
}

async function updateCommercialEventExpectedLiability(
  clientId,
  id,
  body = {},
  { actor = null } = {}
) {
  const existing = await findCommercialEventById(clientId, id);
  if (!existing) {
    return { ok: false, status: 404, message: "Commercial event not found." };
  }

  const parsedVersion = Number(body.expectedVersion ?? body.version);
  if (!Number.isInteger(parsedVersion) || parsedVersion < 1) {
    return {
      ok: false,
      status: 400,
      message: "expectedVersion is required and must be a positive integer.",
    };
  }
  if (existing.version !== parsedVersion) {
    return {
      ok: false,
      status: 409,
      message: "Commercial event version conflict.",
      event: existing,
    };
  }

  const validated = validateExpectedLiabilityIntent(body, existing);
  if (!validated.ok) return validated;

  const actorName = actor || body.actor || body.updatedBy || null;
  const comment =
    validated.treatment === "default"
      ? String(body.reason || body.expectedReason || "").trim() ||
        "Restored default expected-liability treatment"
      : validated.expectedReason;

  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const { rowCount } = await db.query(
      `
        UPDATE commercial_events
        SET
          expected_treatment = $1,
          expected_amount = $2,
          expected_reason = $3,
          expected_updated_at = NOW(),
          expected_updated_by = $4,
          version = version + 1,
          updated_at = NOW(),
          updated_by = $4
        WHERE id = $5
          AND client_id = $6
          AND version = $7
        RETURNING id
      `,
      [
        validated.treatment,
        validated.expectedAmount,
        validated.expectedReason,
        actorName,
        id,
        clientId,
        parsedVersion,
      ]
    );

    if (!rowCount) {
      await db.query("ROLLBACK");
      const current = await findCommercialEventById(clientId, id);
      return {
        ok: false,
        status: 409,
        message: "Commercial event version conflict.",
        event: current,
      };
    }

    await insertAuditEntry(db, clientId, id, {
      action: EXPECTED_LIABILITY_AUDIT_ACTION,
      actor: actorName,
      comment,
      priorStatus: existing.status,
      newStatus: existing.status,
      priorExpectedTreatment: existing.expectedTreatment || "default",
      newExpectedTreatment: validated.treatment,
      priorExpectedAmount: existing.expectedAmount,
      newExpectedAmount: validated.expectedAmount,
      priorEffectiveExpected: existing.expectedLiability,
      newEffectiveExpected: validated.nextEffectiveExpected,
      ceValueAtChange: existing.value,
      ceStatusAtChange: existing.status,
      priorCeVersion: existing.version,
      newCeVersion: existing.version + 1,
    });

    await db.query("COMMIT");
    const event = await findCommercialEventById(clientId, id);
    return { ok: true, event };
  } catch (err) {
    await db.query("ROLLBACK");
    if (err && err.code === "23514") {
      return {
        ok: false,
        status: 400,
        message: "Expected-liability treatment does not satisfy stored constraints.",
      };
    }
    throw err;
  } finally {
    db.release();
  }
}

module.exports = {
  findCommercialEventById,
  listCommercialEvents,
  createCommercialEvent,
  updateCommercialEventDraft,
  submitCommercialEvent,
  approveCommercialEvent,
  rejectCommercialEvent,
  closeCommercialEvent,
  dismissPotentialContraCharge,
  createLinkedRecoveryFromOrigin,
  importCommercialEvents,
  updateCommercialEventExpectedLiability,
  resolvePackageForEvent,
  provisionalActor,
};
