/**
 * BL-027A.1 — Development Postgres access layer.
 */

const { pool, query } = require("../db");
const {
  enforcePlotMasterMutationAuthority,
  lockPlotMasterAuthority,
} = require('./plotMasterUpdateAuthority');

async function runQuery(dbClient, text, params) {
  if (dbClient) return dbClient.query(text, params);
  return query(text, params);
}
const {
  documentToInsertRow,
  documentToUpdateRow,
  mergeDevelopmentPatch,
  rowToDocument,
} = require("./developmentMapper");
const {
  DEFAULT_DEVELOPMENT_STATUS,
  generateDevelopmentId,
} = require("./developmentConstants");

function isUniqueViolation(err) {
  return err && err.code === "23505";
}

function defaultPayload(nowIso) {
  return {
    client: "",
    location: "",
    address: "",
    postcode: "",
    startDate: "",
    targetCompletion: "",
    plotCount: 0,
    packageCount: 0,
    purchaseOrderCount: 0,
    certificateCount: 0,
    plotMaster: {
      plots: [],
      updatedAt: nowIso,
    },
  };
}

function normalizeCreateDocument(body = {}, suppliedId = null) {
  const nowIso = new Date().toISOString();
  const basePayload = defaultPayload(nowIso);
  const explicitId = suppliedId || body.id;
  const id =
    explicitId && String(explicitId).trim()
      ? String(explicitId).trim()
      : generateDevelopmentId();

  return {
    ...basePayload,
    ...body,
    id,
    jobNumber: body.jobNumber,
    developmentName: body.developmentName,
    status: body.status || DEFAULT_DEVELOPMENT_STATUS,
    createdBy: body.createdBy ?? null,
    updatedBy: body.updatedBy ?? null,
    plotMaster: body.plotMaster || basePayload.plotMaster,
  };
}

async function listDevelopmentsForClient(clientId) {
  const { rows } = await query(
    `
      SELECT *
      FROM developments
      WHERE client_id = $1
      ORDER BY updated_at DESC, created_at DESC
    `,
    [clientId]
  );
  return rows.map(rowToDocument);
}

async function findDevelopmentById(clientId, id, dbClient = null) {
  const { rows } = await runQuery(
    dbClient,
    `
      SELECT *
      FROM developments
      WHERE id = $1 AND client_id = $2
      LIMIT 1
    `,
    [id, clientId]
  );
  return rows[0] ? rowToDocument(rows[0]) : null;
}

async function findDevelopmentRowById(clientId, id) {
  const { rows } = await query(
    `
      SELECT *
      FROM developments
      WHERE id = $1 AND client_id = $2
      LIMIT 1
    `,
    [id, clientId]
  );
  return rows[0] || null;
}

async function createDevelopment(clientId, body = {}, { actor = null } = {}) {
  const document = normalizeCreateDocument(body, body.id || null);
  const insertRow = documentToInsertRow(document, { clientId, actor });

  try {
    const { rows } = await query(
      `
        INSERT INTO developments (
          id, client_id, job_number, development_name, status, payload,
          version, created_by, updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, 1, $7, $8)
        RETURNING *
      `,
      [
        insertRow.id,
        insertRow.client_id,
        insertRow.job_number,
        insertRow.development_name,
        insertRow.status,
        JSON.stringify(insertRow.payload),
        insertRow.created_by,
        insertRow.updated_by,
      ]
    );
    return { ok: true, development: rowToDocument(rows[0]) };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const detail = String(err.detail || "").toLowerCase();
      if (detail.includes("(id)")) {
        return { ok: false, status: 409, message: "Development id already exists." };
      }
      return {
        ok: false,
        status: 409,
        message: "Development number already exists for this client.",
      };
    }
    throw err;
  }
}

function applyPlotRevenueAuthority(existingDocument, patch, authorityActor = null) {
  const incomingPlots = patch?.plotMaster?.plots;
  const existingPlots = existingDocument?.plotMaster?.plots;
  if (!Array.isArray(incomingPlots) || !Array.isArray(existingPlots)) {
    return { ok: true, patch };
  }

  const existingById = new Map(existingPlots.map((plot) => [String(plot.id), plot]));
  const actor = authorityActor && typeof authorityActor === 'object' ? authorityActor : null;
  const actorEvidence = {
    actorUserId: actor?.userId || null,
    actorMembershipId: actor?.membershipId || null,
    actorDisplayName: actor?.displayName || null,
  };
  const now = new Date().toISOString();
  const contractStatuses = new Set(['Reserved', 'Exchanged', 'Completed']);
  const inactiveContractStatuses = new Set(['Available', 'Cancelled']);

  const plots = [];
  for (const incoming of incomingPlots) {
    const existing = existingById.get(String(incoming?.id));
    if (!existing) {
      plots.push(incoming);
      continue;
    }
    const next = { ...incoming };
    const previousStatus = String(existing.revenueStatus || 'Available');
    const nextStatus = String(next.revenueStatus || 'Available');
    const previousPricePence = Math.round(Number(existing.sellingPrice || 0) * 100);
    const nextPricePence = Math.round(Number(next.sellingPrice || 0) * 100);
    const priceChanged = previousPricePence !== nextPricePence;
    const enteringContract = !contractStatuses.has(previousStatus) && contractStatuses.has(nextStatus);
    const leavingContract = contractStatuses.has(previousStatus) && inactiveContractStatuses.has(nextStatus);
    const confirmationRequested = next.sellingPriceConfirmation?.requested === true;

    if (existing.sellingPriceRequiresConfirmation === true) {
      if (enteringContract && nextPricePence > 0) {
        if (!priceChanged && !confirmationRequested) {
          return {
            ok: false,
            status: 409,
            code: 'CONTRACT_PRICE_CONFIRMATION_REQUIRED',
            message: `Plot ${existing.plotNumber || existing.id} requires explicit confirmation of its contractual reservation price.`,
          };
        }
        if (!actor) {
          return { ok: false, status: 403, code: 'AUTHENTICATED_ACTOR_REQUIRED', message: 'Authenticated actor evidence is required to confirm a contractual selling price.' };
        }
        next.sellingPriceRequiresConfirmation = false;
        next.sellingPriceConfirmation = {
          source: priceChanged ? 'plot_drawer_new_price' : 'plot_drawer_explicit_confirmation',
          confirmedAt: now,
          ...actorEvidence,
        };
      } else {
        next.sellingPriceRequiresConfirmation = true;
        next.sellingPriceConfirmation = existing.sellingPriceConfirmation || null;
      }
    } else if (priceChanged && contractStatuses.has(nextStatus) && nextPricePence > 0) {
      if (!actor) {
        return { ok: false, status: 403, code: 'AUTHENTICATED_ACTOR_REQUIRED', message: 'Authenticated actor evidence is required to confirm a contractual selling price.' };
      }
      next.sellingPriceRequiresConfirmation = false;
      next.sellingPriceConfirmation = {
        source: 'plot_drawer_new_price',
        confirmedAt: now,
        ...actorEvidence,
      };
    }

    if (leavingContract && nextPricePence > 0) {
      next.sellingPriceRequiresConfirmation = true;
      next.sellingPriceConfirmation = {
        ...(existing.sellingPriceConfirmation || {}),
        invalidatedAt: now,
        invalidatedReason: `status-changed-to-${nextStatus.toLowerCase()}`,
        invalidatedByUserId: actor?.userId || null,
        invalidatedByMembershipId: actor?.membershipId || null,
        invalidatedByDisplayName: actor?.displayName || null,
      };
    }

    const priorImport = existing.forecastImportProvenance;
    if (priorImport) {
      const previousForecastPence = Math.round(Number(existing.manualForecastValue || 0) * 100);
      const nextForecastPence = Math.round(Number(next.manualForecastValue || 0) * 100);
      next.forecastImportProvenance = previousForecastPence === nextForecastPence
        ? priorImport
        : {
            ...priorImport,
            supersededAt: now,
            supersededReason: 'manual-forecast-edit',
            supersededByUserId: actor?.userId || null,
            supersededByMembershipId: actor?.membershipId || null,
            supersededByDisplayName: actor?.displayName || null,
          };
    } else {
      delete next.forecastImportProvenance;
    }

    plots.push(next);
  }

  return {
    ok: true,
    patch: {
      ...patch,
      plotMaster: { ...patch.plotMaster, plots },
    },
  };
}

async function updateDevelopment(
  clientId,
  id,
  patch = {},
  expectedVersion,
  { actor = null, authorityActor = null } = {}
) {
  const parsedVersion = Number(expectedVersion);
  if (!Number.isInteger(parsedVersion) || parsedVersion < 1) {
    return { ok: false, status: 400, message: "version is required and must be a positive integer." };
  }
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    await lockPlotMasterAuthority(dbClient, clientId, id);
    const existingResult = await dbClient.query(
      `SELECT * FROM developments WHERE id = $1 AND client_id = $2 FOR UPDATE`,
      [id, clientId]
    );
    if (!existingResult.rowCount) {
      await dbClient.query('ROLLBACK');
      return { ok: false, status: 404, message: 'Development not found.' };
    }
    const existingDocument = rowToDocument(existingResult.rows[0]);
    if (existingDocument.version !== parsedVersion) {
      await dbClient.query('ROLLBACK');
      return { ok: false, status: 409, message: 'Development version conflict.', development: existingDocument };
    }
    const revenueAuthority = applyPlotRevenueAuthority(existingDocument, patch, authorityActor);
    if (!revenueAuthority.ok) {
      await dbClient.query('ROLLBACK');
      return revenueAuthority;
    }
    const governedPatch = revenueAuthority.patch;
    const authority = await enforcePlotMasterMutationAuthority(
      dbClient, clientId, id, existingDocument, governedPatch
    );
    if (!authority.ok) {
      await dbClient.query('ROLLBACK');
      return authority;
    }
    const mergedDocument = mergeDevelopmentPatch(existingDocument, governedPatch);
    const updateRow = documentToUpdateRow(mergedDocument, { actor });
    const { rows, rowCount } = await dbClient.query(
      `
        UPDATE developments
        SET
          job_number = $1,
          development_name = $2,
          status = $3,
          payload = $4::jsonb,
          version = version + 1,
          updated_at = NOW(),
          updated_by = $5
        WHERE id = $6
          AND client_id = $7
          AND version = $8
        RETURNING *
      `,
      [
        updateRow.job_number,
        updateRow.development_name,
        updateRow.status,
        JSON.stringify(updateRow.payload),
        updateRow.updated_by,
        id,
        clientId,
        parsedVersion,
      ]
    );

    if (!rowCount) {
      await dbClient.query('ROLLBACK');
      return { ok: false, status: 409, message: 'Development version conflict.' };
    }
    await dbClient.query('COMMIT');
    return { ok: true, development: rowToDocument(rows[0]) };
  } catch (err) {
    await dbClient.query('ROLLBACK');
    if (isUniqueViolation(err)) {
      return {
        ok: false,
        status: 409,
        message: "Development number already exists for this client.",
      };
    }
    throw err;
  } finally {
    dbClient.release();
  }
}

module.exports = {
  listDevelopmentsForClient,
  findDevelopmentById,
  createDevelopment,
  updateDevelopment,
  normalizeCreateDocument,
  applyPlotRevenueAuthority,
};
