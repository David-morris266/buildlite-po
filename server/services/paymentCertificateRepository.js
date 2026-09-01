/**
 * BL-030A — V1 Payment Certificate Postgres access layer.
 */

const { pool, query } = require("../db");
const { rowToDocument: ceRowToDocument } = require("./commercialEventMapper");
const {
  CERTIFICATE_STATUSES,
  isValidCertificateUuid,
  isValidPackageUuid,
} = require("./paymentCertificateConstants");
const { buildValuationSnapshot, buildLiveValuation } = require("./paymentCertificateFinancials");
const { loadVariationOrder } = require("./variationOrderRepository");
const {
  documentToLockedColumns,
  payloadOf,
  rowToDocument,
} = require("./paymentCertificateMapper");
const {
  parseExpectedVersion,
  progressEntriesToPayload,
  validateDraftPatchBody,
  validateLinesAgainstEvents,
} = require("./paymentCertificateValidation");
const { loadActiveApplicationForCertificate, mapRow: mapApplicationRow } = require("./paymentApplicationRepository");
const { normalizeApplication } = require("./paymentApplicationNormalization");
const { snapshotForPackage } = require("./subcontractTermsRepository");
const {
  timetableForRead,
  insertSubmissionSnapshot,
  copyLatestSubmissionToLocked,
  hasSubmissionHistory,
  loadApplication: loadTimetableApplication,
} = require("./paymentCertificateTimetable");

function isUniqueViolation(err) {
  return err && err.code === "23505";
}

async function runQuery(dbClient, text, params) {
  if (dbClient) return dbClient.query(text, params);
  return query(text, params);
}

function invalidPackageUuidResult() {
  return { ok: false, status: 400, message: "packageId must be a valid UUID." };
}

function invalidCertificateUuidResult() {
  return { ok: false, status: 400, message: "certificateId must be a valid UUID." };
}

function versionConflict(certificate) {
  return {
    ok: false,
    status: 409,
    message: "Payment certificate version conflict.",
    certificate,
  };
}

function requireVersion(body, row, document) {
  const expected = parseExpectedVersion(body?.version);
  if (expected == null) {
    return {
      ok: false,
      status: 400,
      message: "version is required and must be a positive integer.",
    };
  }
  if (expected !== Number(row.version)) {
    return versionConflict(document);
  }
  return { ok: true };
}

function provisionalActor(body = {}) {
  return body.updatedBy || body.createdBy || body.actor || null;
}

async function loadAuditRows(clientId, certificateId, dbClient = null) {
  const { rows } = await runQuery(
    dbClient,
    `
      SELECT *
      FROM package_payment_certificate_audit
      WHERE client_id = $1 AND certificate_id = $2
      ORDER BY created_at ASC, id ASC
    `,
    [clientId, certificateId]
  );
  return rows;
}

async function insertAudit(dbClient, {
  clientId,
  certificateId,
  action,
  actor,
  comment = "",
  priorStatus = null,
  newStatus = null,
}) {
  await runQuery(
    dbClient,
    `
      INSERT INTO package_payment_certificate_audit (
        client_id, certificate_id, action, actor, comment, prior_status, new_status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [clientId, certificateId, action, actor || null, comment || "", priorStatus, newStatus]
  );
}

async function findCertificateRow(clientId, packageId, certificateId, dbClient = null, { forUpdate = false } = {}) {
  const { rows } = await runQuery(
    dbClient,
    `
      SELECT *
      FROM package_payment_certificates
      WHERE client_id = $1
        AND package_id = $2
        AND id = $3
      LIMIT 1
      ${forUpdate ? "FOR UPDATE" : ""}
    `,
    [clientId, packageId, certificateId]
  );
  return rows[0] || null;
}

async function listCertificateRows(clientId, packageId, dbClient = null, { forUpdate = false } = {}) {
  const { rows } = await runQuery(
    dbClient,
    `
      SELECT *
      FROM package_payment_certificates
      WHERE client_id = $1
        AND package_id = $2
      ORDER BY certificate_number ASC
      ${forUpdate ? "FOR UPDATE" : ""}
    `,
    [clientId, packageId]
  );
  return rows;
}

async function findPackageRow(clientId, packageId, dbClient = null, { forUpdate = false } = {}) {
  const { rows } = await runQuery(
    dbClient,
    `
      SELECT *
      FROM packages
      WHERE id = $1 AND client_id = $2
      LIMIT 1
      ${forUpdate ? "FOR UPDATE" : ""}
    `,
    [packageId, clientId]
  );
  return rows[0] || null;
}

async function loadPackagePos(clientId, packageId, dbClient = null) {
  const { rows } = await runQuery(
    dbClient,
    `
      SELECT po.payload
      FROM package_purchase_orders ppo
      JOIN purchase_orders po
        ON po.client_id = ppo.client_id
       AND po.po_number = ppo.po_number
      WHERE ppo.client_id = $1
        AND ppo.package_id = $2
    `,
    [clientId, packageId]
  );
  return rows.map((row) => row.payload).filter(Boolean);
}

async function loadMatrixDocument(clientId, packageId, dbClient = null) {
  const { rows } = await runQuery(
    dbClient,
    `
      SELECT *
      FROM package_order_matrices
      WHERE client_id = $1 AND package_id = $2
      LIMIT 1
    `,
    [clientId, packageId]
  );
  const row = rows[0];
  if (!row) return null;
  const payload =
    row.payload && typeof row.payload === "object" ? row.payload : {};
  return {
    id: row.id,
    packageId: row.package_id,
    layout: row.layout,
    version: row.version,
    stages: Array.isArray(payload.stages) ? payload.stages : [],
    plots: Array.isArray(payload.plots) ? payload.plots : [],
  };
}

async function loadEventsByIds(clientId, packageId, ids, dbClient = null) {
  const map = new Map();
  if (!ids.length) return map;
  const { rows } = await runQuery(
    dbClient,
    `
      SELECT ce.*, issued.id AS issued_variation_order_id
      FROM commercial_events ce
      LEFT JOIN variation_order_commercial_events link
        ON link.client_id=ce.client_id AND link.commercial_event_id=ce.id
      LEFT JOIN variation_orders issued
        ON issued.client_id=link.client_id AND issued.id=link.variation_order_id AND issued.status='issued'
      WHERE ce.client_id = $1
        AND ce.id = ANY($2::text[])
    `,
    [clientId, ids]
  );
  for (const row of rows) {
    map.set(row.id, { ...ceRowToDocument(row, []), issuedVariationOrderId: row.issued_variation_order_id || null });
  }
  return map;
}

async function loadVariationOrdersByIds(clientId, ids, dbClient = null) {
  const map = new Map();
  for (const id of ids) {
    const vo = await loadVariationOrder(clientId, id, dbClient || null);
    if (vo) map.set(id, vo);
  }
  return map;
}

function lockedDocumentsFromRows(rows) {
  return rows
    .filter((row) => row.status === CERTIFICATE_STATUSES.locked)
    .map((row) => {
      const payload = payloadOf(row);
      return {
        certificateNumber: row.certificate_number,
        status: row.status,
        grossValue: row.gross_value,
        retention: row.retention,
        retentionRate: row.retention_rate,
        progress: payload.progress || {},
        commercialLines: payload.commercialLines || [],
        valuationSnapshot: payload.valuationSnapshot || null,
      };
    });
}

function payloadFromRow(row) {
  const payload = payloadOf(row);
  return {
    progress: payload.progress && typeof payload.progress === "object" ? payload.progress : {},
    commercialLines: Array.isArray(payload.commercialLines) ? payload.commercialLines : [],
    valuationSnapshot: payload.valuationSnapshot || null,
    submissionApplicationSnapshot: payload.submissionApplicationSnapshot || null,
    lockedApplicationSnapshot: payload.lockedApplicationSnapshot || null,
    submissionGoverningTermsSnapshot: payload.submissionGoverningTermsSnapshot || null,
    lockedGoverningTermsSnapshot: payload.lockedGoverningTermsSnapshot || null,
  };
}

async function hydrateDocument(clientId, row, dbClient = null, extras = {}) {
  const auditRows = await loadAuditRows(clientId, row.id, dbClient);
  const paymentTimetable = await timetableForRead(dbClient, clientId, row.package_id, row);
  return rowToDocument(row, auditRows, { ...extras, paymentTimetable });
}

async function computeLiveTotals(clientId, packageId, row, allRows, dbClient = null) {
  const payload = payloadFromRow(row);
  const matrix = await loadMatrixDocument(clientId, packageId, dbClient);
  if (!matrix) return { totals: null };
  const pos = await loadPackagePos(clientId, packageId, dbClient);
  const locked = lockedDocumentsFromRows(allRows).filter(
    (item) => item.certificateNumber < row.certificate_number
  );
  const live = buildLiveValuation({
    matrix,
    progress: payload.progress,
    commercialLines: payload.commercialLines,
    lockedCertificates: locked,
    pos,
  });
  if (!live.ok) return { totals: null, errors: live.errors };
  return { totals: live.totals };
}

async function listCertificatesForPackage(clientId, packageId) {
  if (!isValidPackageUuid(packageId)) return invalidPackageUuidResult();

  const pkg = await findPackageRow(clientId, packageId);
  if (!pkg) {
    return { ok: false, status: 404, message: "Package not found." };
  }

  const rows = await listCertificateRows(clientId, packageId);
  const certificates = [];
  for (const row of rows) {
    const live = row.status === CERTIFICATE_STATUSES.locked
      ? { totals: null }
      : await computeLiveTotals(clientId, packageId, row, rows);
    certificates.push(await hydrateDocument(clientId, row, null, live));
  }
  return { ok: true, certificates };
}

async function getCertificateForPackage(clientId, packageId, certificateId) {
  if (!isValidPackageUuid(packageId)) return invalidPackageUuidResult();
  if (!isValidCertificateUuid(certificateId)) return invalidCertificateUuidResult();

  const pkg = await findPackageRow(clientId, packageId);
  if (!pkg) {
    return { ok: false, status: 404, message: "Package not found." };
  }

  const row = await findCertificateRow(clientId, packageId, certificateId);
  if (!row) {
    return { ok: false, status: 404, message: "Certificate not found." };
  }
  const rows = await listCertificateRows(clientId, packageId);
  const live = row.status === CERTIFICATE_STATUSES.locked
    ? { totals: null }
    : await computeLiveTotals(clientId, packageId, row, rows);
  return {
    ok: true,
    certificate: await hydrateDocument(clientId, row, null, live),
  };
}

async function createCertificateForPackage(clientId, packageId, body = {}, { actor } = {}) {
  if (!isValidPackageUuid(packageId)) return invalidPackageUuidResult();

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const pkg = await findPackageRow(clientId, packageId, dbClient, { forUpdate: true });
    if (!pkg) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 404, message: "Package not found." };
    }

    const existing = await listCertificateRows(clientId, packageId, dbClient, { forUpdate: true });
    const open = existing.find((row) =>
      row.status === CERTIFICATE_STATUSES.draft || row.status === CERTIFICATE_STATUSES.submitted
    );
    if (open) {
      await dbClient.query("ROLLBACK");
      return {
        ok: false,
        status: 409,
        message: `Certificate No. ${open.certificate_number} must be approved before creating the next certificate.`,
      };
    }

    const nextNumber =
      existing.reduce((max, row) => Math.max(max, Number(row.certificate_number) || 0), 0) + 1;
    const now = new Date();
    const certificateDate =
      typeof body.certificateDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.certificateDate)
        ? body.certificateDate
        : now.toISOString().slice(0, 10);

    const inserted = await runQuery(
      dbClient,
      `
        INSERT INTO package_payment_certificates (
          client_id, package_id, development_id, order_key, certificate_number,
          status, certificate_date, payload, version, created_by, updated_by
        )
        VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7::jsonb, 1, $8, $8)
        RETURNING *
      `,
      [
        clientId,
        pkg.id,
        pkg.development_id,
        pkg.order_key,
        nextNumber,
        certificateDate,
        JSON.stringify({ progress: {}, commercialLines: [] }),
        actor || null,
      ]
    );

    await insertAudit(dbClient, {
      clientId,
      certificateId: inserted.rows[0].id,
      action: "created",
      actor,
      newStatus: CERTIFICATE_STATUSES.draft,
    });

    await dbClient.query("COMMIT");
    return {
      ok: true,
      status: 201,
      certificate: await hydrateDocument(clientId, inserted.rows[0], null, { totals: null }),
    };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    if (isUniqueViolation(err)) {
      return {
        ok: false,
        status: 409,
        message: "An open payment certificate already exists for this package.",
      };
    }
    throw err;
  } finally {
    dbClient.release();
  }
}

async function patchCertificateForPackage(clientId, packageId, certificateId, body = {}, { actor } = {}) {
  if (!isValidPackageUuid(packageId)) return invalidPackageUuidResult();
  if (!isValidCertificateUuid(certificateId)) return invalidCertificateUuidResult();

  const parsed = validateDraftPatchBody(body);
  if (!parsed.ok) {
    return { ok: false, status: 400, message: parsed.errors[0], errors: parsed.errors };
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const pkg = await findPackageRow(clientId, packageId, dbClient, { forUpdate: true });
    if (!pkg) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 404, message: "Package not found." };
    }

    const row = await findCertificateRow(clientId, packageId, certificateId, dbClient, {
      forUpdate: true,
    });
    if (!row) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 404, message: "Certificate not found." };
    }

    const current = await hydrateDocument(clientId, row, dbClient);
    const versionCheck = requireVersion(body, row, current);
    if (!versionCheck.ok) {
      await dbClient.query("ROLLBACK");
      return versionCheck;
    }

    if (row.status !== CERTIFICATE_STATUSES.draft) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 409, message: "Only draft certificates can be edited." };
    }

    const currentPayload = payloadFromRow(row);
    const nextProgress =
      parsed.progressEntries
        ? progressEntriesToPayload(parsed.progressEntries)
        : currentPayload.progress;
    const nextLines =
      parsed.commercialLines !== null && parsed.commercialLines !== undefined
        ? parsed.commercialLines
        : currentPayload.commercialLines;

    const matrix = await loadMatrixDocument(clientId, packageId, dbClient);
    if ((parsed.progressEntries || parsed.commercialLines) && matrix) {
      const live = buildLiveValuation({
        matrix,
        progress: nextProgress,
        commercialLines: nextLines,
        lockedCertificates: lockedDocumentsFromRows(
          await listCertificateRows(clientId, packageId, dbClient)
        ).filter((item) => item.certificateNumber < row.certificate_number),
        pos: await loadPackagePos(clientId, packageId, dbClient),
      });
      if (!live.ok) {
        await dbClient.query("ROLLBACK");
        return { ok: false, status: 400, message: live.errors[0], errors: live.errors };
      }
    } else if ((parsed.progressEntries || parsed.commercialLines) && !matrix) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 400, message: "A plot-stage order matrix is required." };
    }

    if (parsed.commercialLines) {
      const eventIds = [...new Set(nextLines.filter((line) => line.sourceType !== "variationOrder").map((line) => line.commercialEventId).filter(Boolean))];
      const variationOrderIds = [...new Set(nextLines.filter((line) => line.sourceType === "variationOrder").map((line) => line.variationOrderId).filter(Boolean))];
      const eventsById = await loadEventsByIds(clientId, packageId, eventIds, dbClient);
      const variationOrdersById = await loadVariationOrdersByIds(clientId, variationOrderIds, dbClient);
      const lineCheck = validateLinesAgainstEvents({
        lines: nextLines,
        eventsById,
        packageId: pkg.id,
        orderKey: pkg.order_key,
        lockedCertificates: lockedDocumentsFromRows(
          await listCertificateRows(clientId, packageId, dbClient)
        ),
        variationOrdersById,
      });
      if (!lineCheck.ok) {
        await dbClient.query("ROLLBACK");
        return { ok: false, status: 400, message: lineCheck.errors[0], errors: lineCheck.errors };
      }
    }

    const updated = await runQuery(
      dbClient,
      `
        UPDATE package_payment_certificates
        SET payload = $1::jsonb,
            certificate_date = COALESCE($2::date, certificate_date),
            contractual_valuation_date = CASE WHEN $3::boolean THEN $4::date ELSE contractual_valuation_date END,
            version = version + 1,
            updated_at = NOW(),
            updated_by = $5
        WHERE client_id = $6 AND package_id = $7 AND id = $8
        RETURNING *
      `,
      [
        JSON.stringify({
          progress: nextProgress,
          commercialLines: nextLines,
          submissionApplicationSnapshot: currentPayload.submissionApplicationSnapshot,
          lockedApplicationSnapshot: currentPayload.lockedApplicationSnapshot,
          submissionGoverningTermsSnapshot: currentPayload.submissionGoverningTermsSnapshot,
          lockedGoverningTermsSnapshot: currentPayload.lockedGoverningTermsSnapshot,
        }),
        parsed.certificateDate || null,
        parsed.contractualValuationDate !== undefined,
        parsed.contractualValuationDate || null,
        actor || null,
        clientId,
        packageId,
        certificateId,
      ]
    );

    await insertAudit(dbClient, {
      clientId,
      certificateId,
      action: parsed.contractualValuationDate !== undefined ? "payment_cycle_updated" : "edited",
      actor,
      priorStatus: CERTIFICATE_STATUSES.draft,
      newStatus: CERTIFICATE_STATUSES.draft,
    });

    await dbClient.query("COMMIT");
    const rows = await listCertificateRows(clientId, packageId);
    const live = await computeLiveTotals(clientId, packageId, updated.rows[0], rows);
    return {
      ok: true,
      certificate: await hydrateDocument(clientId, updated.rows[0], null, live),
    };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    throw err;
  } finally {
    dbClient.release();
  }
}

async function submitCertificateForPackage(clientId, packageId, certificateId, body = {}, { actor } = {}) {
  if (!isValidPackageUuid(packageId)) return invalidPackageUuidResult();
  if (!isValidCertificateUuid(certificateId)) return invalidCertificateUuidResult();

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const pkg = await findPackageRow(clientId, packageId, dbClient, { forUpdate: true });
    if (!pkg) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 404, message: "Package not found." };
    }

    const row = await findCertificateRow(clientId, packageId, certificateId, dbClient, {
      forUpdate: true,
    });
    if (!row) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 404, message: "Certificate not found." };
    }

    const current = await hydrateDocument(clientId, row, dbClient);
    const versionCheck = requireVersion(body, row, current);
    if (!versionCheck.ok) {
      await dbClient.query("ROLLBACK");
      return versionCheck;
    }
    if (row.status !== CERTIFICATE_STATUSES.draft) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 409, message: "Only draft certificates can be submitted." };
    }

    const allRows = await listCertificateRows(clientId, packageId, dbClient);
    const prepared = await prepareApprovalInputs(dbClient, {
      clientId,
      packageId,
      pkg,
      row,
      allRows,
      requireMatrix: true,
    });
    if (!prepared.ok) {
      await dbClient.query("ROLLBACK");
      return prepared;
    }

    const termsSnapshot = await snapshotForPackage(clientId, packageId, dbClient);
    const applicationState = await loadTimetableApplication(dbClient, clientId, packageId, row.id, { forUpdate: true });
    const applicationSnapshot = applicationState.document ? {
      application: { ...applicationState.document, comparison: undefined, auditHistory: undefined },
      comparison: normalizeApplication(applicationState.document, prepared.snapshot.totals),
      capturedAt: new Date().toISOString(),
    } : null;
    const submissionPayload = {
      ...prepared.payload,
      submissionApplicationSnapshot: applicationSnapshot,
      submissionGoverningTermsSnapshot: termsSnapshot,
    };
    await insertSubmissionSnapshot(dbClient, {
      clientId, packageId, developmentId: pkg.development_id, certificateRow: row, actor,
      terms: termsSnapshot, applicationState,
    });

    const updated = await runQuery(
      dbClient,
      `
        UPDATE package_payment_certificates
        SET status = 'submitted',
            payload = $5::jsonb,
            submitted_at = NOW(),
            submitted_by = $1,
            version = version + 1,
            updated_at = NOW(),
            updated_by = $1
        WHERE client_id = $2 AND package_id = $3 AND id = $4
        RETURNING *
      `,
      [actor || null, clientId, packageId, certificateId, JSON.stringify(submissionPayload)]
    );

    await insertAudit(dbClient, {
      clientId,
      certificateId,
      action: "submitted",
      actor,
      priorStatus: CERTIFICATE_STATUSES.draft,
      newStatus: CERTIFICATE_STATUSES.submitted,
    });

    await dbClient.query("COMMIT");
    const live = await computeLiveTotals(clientId, packageId, updated.rows[0], allRows);
    return {
      ok: true,
      certificate: await hydrateDocument(clientId, updated.rows[0], null, live),
    };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    throw err;
  } finally {
    dbClient.release();
  }
}

async function prepareApprovalInputs(dbClient, {
  clientId,
  packageId,
  pkg,
  row,
  allRows,
  requireMatrix,
}) {
  const payload = payloadFromRow(row);
  const matrix = await loadMatrixDocument(clientId, packageId, dbClient);
  if (requireMatrix && !matrix) {
    return { ok: false, status: 400, message: "A plot-stage order matrix is required." };
  }

  const pos = await loadPackagePos(clientId, packageId, dbClient);
  const locked = lockedDocumentsFromRows(allRows).filter(
    (item) => item.certificateNumber < row.certificate_number
  );
  const eventIds = [...new Set(payload.commercialLines.filter((line) => line.sourceType !== "variationOrder").map((line) => line.commercialEventId).filter(Boolean))];
  const variationOrderIds = [...new Set(payload.commercialLines.filter((line) => line.sourceType === "variationOrder").map((line) => line.variationOrderId).filter(Boolean))];
  const eventsById = await loadEventsByIds(clientId, packageId, eventIds, dbClient);
  const variationOrdersById = await loadVariationOrdersByIds(clientId, variationOrderIds, dbClient);
  const lineCheck = validateLinesAgainstEvents({
    lines: payload.commercialLines,
    eventsById,
    packageId: pkg.id,
    orderKey: pkg.order_key,
    lockedCertificates: locked,
    variationOrdersById,
  });
  if (!lineCheck.ok) {
    return { ok: false, status: 400, message: lineCheck.errors[0], errors: lineCheck.errors };
  }

  if (!matrix) {
    return { ok: true, payload, matrix: null, pos, locked };
  }

  const snapshot = buildValuationSnapshot({
    matrix,
    progress: payload.progress,
    commercialLines: payload.commercialLines,
    lockedCertificates: locked,
    pos,
  });
  if (!snapshot.ok) {
    return { ok: false, status: 400, message: snapshot.errors[0], errors: snapshot.errors };
  }

  return { ok: true, payload, matrix, pos, locked, snapshot };
}

async function buildApplicationSnapshot(dbClient, clientId, packageId, row, totals, payload, kind) {
  const applicationRow = await loadActiveApplicationForCertificate(clientId, packageId, row.id, dbClient);
  const application = applicationRow ? await mapApplicationRow(clientId, applicationRow, null, dbClient) : null;
  const snapshot = application ? {
    application: { ...application, comparison: undefined, auditHistory: undefined },
    comparison: normalizeApplication(application, totals),
    capturedAt: new Date().toISOString(),
  } : null;
  const termsSnapshot = await snapshotForPackage(clientId, packageId, dbClient);
  return {
    ...payload,
    [kind === "locked" ? "lockedApplicationSnapshot" : "submissionApplicationSnapshot"]: snapshot,
    [kind === "locked" ? "lockedGoverningTermsSnapshot" : "submissionGoverningTermsSnapshot"]: termsSnapshot,
  };
}

async function approveCertificateForPackage(clientId, packageId, certificateId, body = {}, { actor, auth } = {}) {
  require('../auth/authorization').assertServicePermission(auth, require('../auth/permissions').PERMISSIONS.CERTIFICATE_LOCK);
  if (!isValidPackageUuid(packageId)) return invalidPackageUuidResult();
  if (!isValidCertificateUuid(certificateId)) return invalidCertificateUuidResult();

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const pkg = await findPackageRow(clientId, packageId, dbClient, { forUpdate: true });
    if (!pkg) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 404, message: "Package not found." };
    }

    const row = await findCertificateRow(clientId, packageId, certificateId, dbClient, {
      forUpdate: true,
    });
    if (!row) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 404, message: "Certificate not found." };
    }

    const current = await hydrateDocument(clientId, row, dbClient);
    const versionCheck = requireVersion(body, row, current);
    if (!versionCheck.ok) {
      await dbClient.query("ROLLBACK");
      return versionCheck;
    }
    if (row.status !== CERTIFICATE_STATUSES.submitted) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 409, message: "Only submitted certificates can be approved." };
    }

    const allRows = await listCertificateRows(clientId, packageId, dbClient);
    const prepared = await prepareApprovalInputs(dbClient, {
      clientId,
      packageId,
      pkg,
      row,
      allRows,
      requireMatrix: true,
    });
    if (!prepared.ok) {
      await dbClient.query("ROLLBACK");
      return prepared;
    }

    const frozen = documentToLockedColumns(prepared.snapshot.totals);
    const nextPayload = {
      ...prepared.payload,
      valuationSnapshot: prepared.snapshot.snapshot,
      lockedApplicationSnapshot: prepared.payload.submissionApplicationSnapshot || null,
      lockedGoverningTermsSnapshot: prepared.payload.submissionGoverningTermsSnapshot || null,
    };
    await copyLatestSubmissionToLocked(dbClient, {
      clientId, packageId, developmentId: pkg.development_id, certificateRow: row, actor,
    });

    const updated = await runQuery(
      dbClient,
      `
        UPDATE package_payment_certificates
        SET status = 'locked',
            payload = $1::jsonb,
            gross_value = $2,
            net_value = $3,
            matrix_gross = $4,
            commercial_event_gross = $5,
            recovery_signed = $6,
            retention = $7,
            vat = $8,
            retention_rate = $9,
            vat_rate = $10,
            approved_at = NOW(),
            approved_by = $11,
            version = version + 1,
            updated_at = NOW(),
            updated_by = $11
        WHERE client_id = $12 AND package_id = $13 AND id = $14
        RETURNING *
      `,
      [
        JSON.stringify(nextPayload),
        frozen.gross_value,
        frozen.net_value,
        frozen.matrix_gross,
        frozen.commercial_event_gross,
        frozen.recovery_signed,
        frozen.retention,
        frozen.vat,
        frozen.retention_rate,
        frozen.vat_rate,
        actor || null,
        clientId,
        packageId,
        certificateId,
      ]
    );

    await insertAudit(dbClient, {
      clientId,
      certificateId,
      action: "approved",
      actor,
      priorStatus: CERTIFICATE_STATUSES.submitted,
      newStatus: CERTIFICATE_STATUSES.locked,
    });

    await dbClient.query("COMMIT");
    return {
      ok: true,
      certificate: await hydrateDocument(clientId, updated.rows[0]),
    };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    throw err;
  } finally {
    dbClient.release();
  }
}

async function rejectCertificateForPackage(clientId, packageId, certificateId, body = {}, { actor } = {}) {
  if (!isValidPackageUuid(packageId)) return invalidPackageUuidResult();
  if (!isValidCertificateUuid(certificateId)) return invalidCertificateUuidResult();

  const comment = String(body.comment || "").trim();
  if (!comment) {
    return { ok: false, status: 400, message: "A rejection comment is required." };
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const pkg = await findPackageRow(clientId, packageId, dbClient, { forUpdate: true });
    if (!pkg) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 404, message: "Package not found." };
    }

    const row = await findCertificateRow(clientId, packageId, certificateId, dbClient, {
      forUpdate: true,
    });
    if (!row) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 404, message: "Certificate not found." };
    }

    const current = await hydrateDocument(clientId, row, dbClient);
    const versionCheck = requireVersion(body, row, current);
    if (!versionCheck.ok) {
      await dbClient.query("ROLLBACK");
      return versionCheck;
    }
    if (row.status !== CERTIFICATE_STATUSES.submitted) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 409, message: "Only submitted certificates can be rejected." };
    }

    const updated = await runQuery(
      dbClient,
      `
        UPDATE package_payment_certificates
        SET status = 'draft',
            submitted_at = NULL,
            submitted_by = NULL,
            version = version + 1,
            updated_at = NOW(),
            updated_by = $1
        WHERE client_id = $2 AND package_id = $3 AND id = $4
        RETURNING *
      `,
      [actor || null, clientId, packageId, certificateId]
    );

    await insertAudit(dbClient, {
      clientId,
      certificateId,
      action: "rejected",
      actor,
      comment,
      priorStatus: CERTIFICATE_STATUSES.submitted,
      newStatus: CERTIFICATE_STATUSES.draft,
    });

    await dbClient.query("COMMIT");
    const rows = await listCertificateRows(clientId, packageId);
    const live = await computeLiveTotals(clientId, packageId, updated.rows[0], rows);
    return {
      ok: true,
      certificate: await hydrateDocument(clientId, updated.rows[0], null, live),
    };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    throw err;
  } finally {
    dbClient.release();
  }
}

async function deleteCertificateForPackage(clientId, packageId, certificateId, body = {}, { actor } = {}) {
  if (!isValidPackageUuid(packageId)) return invalidPackageUuidResult();
  if (!isValidCertificateUuid(certificateId)) return invalidCertificateUuidResult();

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const pkg = await findPackageRow(clientId, packageId, dbClient, { forUpdate: true });
    if (!pkg) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 404, message: "Package not found." };
    }

    const row = await findCertificateRow(clientId, packageId, certificateId, dbClient, {
      forUpdate: true,
    });
    if (!row) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 404, message: "Certificate not found." };
    }
    if (row.status !== CERTIFICATE_STATUSES.draft) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 409, message: "Only draft certificates can be deleted." };
    }
    if (await hasSubmissionHistory(dbClient, clientId, certificateId)) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 409, message: "This certificate has submission history and must be retained as immutable audit evidence." };
    }

    await runQuery(
      dbClient,
      `
        DELETE FROM package_payment_certificates
        WHERE client_id = $1 AND package_id = $2 AND id = $3
      `,
      [clientId, packageId, certificateId]
    );

    await dbClient.query("COMMIT");
    return { ok: true };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    throw err;
  } finally {
    dbClient.release();
  }
}

module.exports = {
  provisionalActor,
  listCertificatesForPackage,
  getCertificateForPackage,
  createCertificateForPackage,
  patchCertificateForPackage,
  submitCertificateForPackage,
  buildApplicationSnapshot,
  approveCertificateForPackage,
  rejectCertificateForPackage,
  deleteCertificateForPackage,
};
