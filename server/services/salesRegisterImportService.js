const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { pool } = require('../db');
const { rowToDocument, documentToUpdateRow, mergeDevelopmentPatch } = require('./developmentMapper');
const { settingsRowToDocument } = require('./revenueSettingsMapper');
const { buildRevenueAuthorityFromDocuments } = require('./cvrRevenueClose');
const { lockPlotMasterAuthority, submittedPeriod } = require('./plotMasterUpdateAuthority');

const SALES_STATUSES = new Set(['Available', 'Reserved', 'Exchanged', 'Completed', 'Cancelled']);
const CONTRACTUAL_STATUSES = new Set(['Reserved', 'Exchanged', 'Completed']);
const TREATMENTS = new Set(['contractual_selling_price', 'forecast_manual_value']);
const CURRENCY_FLOAT_TOLERANCE_PENCE = 0.000001;

function fail(status, message, extra = {}) {
  return { ok: false, status, message, ...extra };
}

function canonicalMoney(value, { positive = false } = {}) {
  const amount = Number(value);
  if (value == null || value === '' || !Number.isFinite(amount)) return null;
  const scaled = amount * 100;
  const integerPence = Math.round(scaled);
  if (Math.abs(scaled - integerPence) > CURRENCY_FLOAT_TOLERANCE_PENCE) return null;
  if (positive ? integerPence <= 0 : integerPence < 0) return null;
  return integerPence / 100;
}

function pence(value) {
  return Math.round(Number(value || 0) * 100);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function validSource(source) {
  return Boolean(
    String(source?.fileName || '').trim() &&
    String(source?.worksheet || '').trim() &&
    /^[0-9a-f]{64}$/i.test(String(source?.sha256 || ''))
  );
}

function independentForecastPlot(plot = {}) {
  const status = String(plot.revenueStatus || 'Available');
  if (['Cancelled', 'Exchanged', 'Completed'].includes(status)) return true;
  if (
    status === 'Reserved' &&
    Number(plot.sellingPrice) > 0 &&
    !plot.sellingPriceRequiresConfirmation
  ) return true;
  return (
    plot.revenueSource === 'Manual Value' &&
    plot.manualOverrideExplicit === true &&
    Number.isFinite(Number(plot.manualForecastValue))
  );
}

function priorForecastImportHistory(plot = {}) {
  const current = plot.forecastImportProvenance;
  if (!current) return [];
  const { history = [], ...entry } = current;
  return [...(Array.isArray(history) ? history : []), entry];
}

function settingsForAuthority(row, developmentId, plots) {
  if (row) return settingsRowToDocument(row, developmentId);
  if (!plots.every(independentForecastPlot)) return null;
  return {
    id: null,
    exists: false,
    version: 0,
    revenueMode: 'sales_register',
    summaryRevenueLines: [],
    recognitionPolicy: 'completion',
    revenueStrategy: {},
    houseTypePricing: {},
    revenueAdjustments: [],
    recognitionSettings: {},
    independentlyEstablishedPlotForecasts: true,
  };
}

function buildReviewedImport(development, settingsRow, body, auth = {}) {
  const expectedVersion = Number(body.version);
  const treatment = String(body.treatment || '');
  const reason = String(body.reason || '').trim();
  const source = body.sourceEvidence || {};
  const replaceSupersededImport = body.replaceSupersededImport === true;

  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return fail(400, 'A valid Development version is required.');
  }
  if (!TREATMENTS.has(treatment)) {
    return fail(400, 'Choose whether the imported price is contractual selling-price evidence or an adopted forecast value.');
  }
  if (!reason) return fail(400, 'A commercial reason is required.');
  if (!validSource(source)) {
    return fail(400, 'A source filename, worksheet and SHA-256 fingerprint are required.');
  }
  if (!Array.isArray(body.updates) || !body.updates.length) {
    return fail(400, 'At least one reviewed Sales Register row is required.');
  }

  const plots = development.plotMaster?.plots;
  if (!Array.isArray(plots)) {
    return fail(409, 'Plot Master is not available for this Development.');
  }

  const byId = new Map(plots.map((plot) => [String(plot.id), plot]));
  const seenIds = new Set();
  const seenNumbers = new Set();
  const rows = [];
  const errors = [];
  const nextById = new Map();
  let sourceTotalPence = 0;

  for (const [index, update] of body.updates.entries()) {
    const sourceRowNumber = Number(update?.sourceRowNumber) || index + 1;
    const plotId = String(update?.plotId || '').trim();
    const plotNumber = String(update?.plotNumber || '').trim();
    const target = byId.get(plotId);
    const row = { sourceRowNumber, plotId, plotNumber, accepted: false, reason: null };
    const numberKey = plotNumber.toLocaleLowerCase('en-GB');

    if (!plotId || !target) row.reason = 'Plot identity does not match Plot Master.';
    else if (String(target.plotNumber || '').trim() !== plotNumber) row.reason = 'Plot Number changed after review.';
    else if (seenIds.has(plotId) || seenNumbers.has(numberKey)) row.reason = 'Duplicate Plot identity.';

    if (row.reason) {
      errors.push(row);
      rows.push(row);
      continue;
    }
    seenIds.add(plotId);
    seenNumbers.add(numberKey);

    const next = { ...target };
    if (Object.prototype.hasOwnProperty.call(update, 'revenueStatus')) {
      if (!SALES_STATUSES.has(update.revenueStatus)) row.reason = 'Unsupported Sales Status.';
      else {
        next.revenueStatus = update.revenueStatus;
        row.revenueStatus = update.revenueStatus;
      }
    }

    const hasImportedPrice = (
      Object.prototype.hasOwnProperty.call(update, 'importedPrice') &&
      update.importedPrice !== '' &&
      update.importedPrice != null
    );
    const imported = hasImportedPrice
      ? canonicalMoney(update.importedPrice, { positive: treatment === 'forecast_manual_value' })
      : null;
    if ((treatment === 'forecast_manual_value' || hasImportedPrice) && imported == null) {
      row.reason = treatment === 'forecast_manual_value'
        ? 'Imported forecast must be greater than zero and valid to exact pence.'
        : 'Imported price is not a non-negative exact-pence value.';
    }

    if (!row.reason && treatment === 'contractual_selling_price' && hasImportedPrice) {
      next.sellingPrice = imported;
      next.sellingPriceRequiresConfirmation = false;
      next.sellingPriceConfirmation = {
        source: 'sales_register_import',
        confirmedAt: new Date().toISOString(),
        confirmedBy: auth.displayName || null,
        confirmedByUserId: auth.userId || null,
        confirmedByMembershipId: auth.membershipId || null,
      };
    }

    const targetStatus = String(target.revenueStatus || 'Available');
    const nextStatus = String(next.revenueStatus || 'Available');
    if (
      !row.reason &&
      CONTRACTUAL_STATUSES.has(targetStatus) &&
      !CONTRACTUAL_STATUSES.has(nextStatus)
    ) {
      next.sellingPriceRequiresConfirmation = Number(next.sellingPrice) > 0;
      delete next.sellingPriceConfirmation;
    }
    if (
      !row.reason &&
      !CONTRACTUAL_STATUSES.has(nextStatus) &&
      Number(next.sellingPrice) > 0
    ) {
      next.sellingPriceRequiresConfirmation = true;
      delete next.sellingPriceConfirmation;
    }

    if (!row.reason && treatment === 'forecast_manual_value') {
      if (['Reserved', 'Exchanged', 'Completed'].includes(String(next.revenueStatus || 'Available'))) {
        row.reason = 'Forecast adoption cannot establish a contractual Reserved, Exchanged or Completed price. Import contractual evidence separately.';
      } else if (
        target.revenueSource === 'Manual Value' &&
        target.manualOverrideExplicit === true &&
        !target.forecastImportProvenance
      ) {
        row.reason = 'A human-entered Manual Value already exists and requires explicit resolution.';
      } else if (
        target.forecastImportProvenance &&
        (
          target.forecastImportProvenance.supersededAt ||
          pence(target.manualForecastValue) !== pence(target.forecastImportProvenance.importedForecast)
        ) &&
        !replaceSupersededImport
      ) {
        row.reason = 'This imported forecast was manually edited. Confirm explicitly before replacing the superseding QS value.';
      } else {
        next.revenueSource = 'Manual Value';
        next.manualForecastValue = imported;
        next.forecastSellingPrice = imported;
        next.manualOverrideExplicit = true;
        next.pricingMigrated = true;
        next.forecastImportProvenance = {
          schemaVersion: 'sales_register_forecast_v1',
          fileName: String(source.fileName).trim(),
          worksheet: String(source.worksheet).trim(),
          sha256: String(source.sha256).toLowerCase(),
          sourceRowNumber,
          importedForecast: imported,
          reason,
          adoptedAt: new Date().toISOString(),
          adoptedBy: auth.displayName || null,
          adoptedByUserId: auth.userId || null,
          adoptedByMembershipId: auth.membershipId || null,
          history: priorForecastImportHistory(target),
        };
        if (String(next.revenueStatus || 'Available') === 'Available' && Number(next.sellingPrice) > 0) {
          next.sellingPriceRequiresConfirmation = true;
        }
      }
    }

    if (
      !row.reason &&
      ['Reserved', 'Exchanged', 'Completed'].includes(String(next.revenueStatus)) &&
      next.sellingPriceRequiresConfirmation === true
    ) {
      row.reason = 'The existing imported Available-plot price is not contractual evidence. Confirm a reservation or exchange price explicitly.';
    }
    if (
      !row.reason &&
      ['Exchanged', 'Completed'].includes(String(next.revenueStatus)) &&
      !(Number(next.sellingPrice) > 0)
    ) {
      row.reason = `A positive contractual Selling Price is required for ${next.revenueStatus}.`;
    }

    if (row.reason) {
      errors.push(row);
      rows.push(row);
      continue;
    }
    if (hasImportedPrice) sourceTotalPence += pence(imported);
    row.accepted = true;
    row.importedPrice = hasImportedPrice ? imported : null;
    rows.push(row);
    nextById.set(plotId, next);
  }

  const nextPlots = plots.map((plot) => nextById.get(String(plot.id)) || plot);
  const settings = settingsForAuthority(settingsRow, development.id, nextPlots);
  const candidate = { ...development, plotMaster: { ...development.plotMaster, plots: nextPlots } };
  const authority = buildRevenueAuthorityFromDocuments({
    clientId: development.clientId,
    developmentId: development.id,
    development: candidate,
    settingsDocument: settings,
  });
  const projectedPence = authority.ready ? pence(authority.summary.forecastRevenue) : null;
  const excludedRows = Array.isArray(body.excludedRows)
    ? body.excludedRows.map((item) => ({
        sourceRowNumber: Number(item.sourceRowNumber) || null,
        reason: String(item.reason || 'Excluded non-financial row'),
        importedValue: item.importedValue ?? null,
      }))
    : [];
  const sourceRowCount = Number(source.sourceRowCount);
  const countsConsistent = Number.isInteger(sourceRowCount) && sourceRowCount === rows.length + excludedRows.length;
  const forecastAdoption = treatment === 'forecast_manual_value';
  const exactlyReconciled = (
    errors.length === 0 &&
    projectedPence != null &&
    projectedPence === sourceTotalPence &&
    countsConsistent
  );
  const canApply = (
    errors.length === 0 &&
    countsConsistent &&
    (!forecastAdoption || (authority.ready && exactlyReconciled))
  );
  const evidence = {
    treatment,
    reason,
    replaceSupersededImport,
    source: {
      fileName: String(source.fileName).trim(),
      worksheet: String(source.worksheet).trim(),
      sha256: String(source.sha256).toLowerCase(),
      mapping: source.mapping || null,
      sourceRowCount,
    },
    rows: rows.map(({ sourceRowNumber, plotId, plotNumber, revenueStatus, accepted, reason: rowReason, importedPrice }) => ({
      sourceRowNumber,
      plotId,
      plotNumber,
      revenueStatus: revenueStatus || null,
      accepted,
      reason: rowReason,
      importedPrice,
    })),
    excludedRows,
    developmentVersion: expectedVersion,
    sourceTotalPence,
    projectedPence,
  };

  return {
    ok: true,
    status: 200,
    preview: {
      fingerprint: digest(evidence),
      treatment,
      rows,
      errors,
      excludedRows,
      sourceRowCount,
      acceptedRowCount: rows.filter((row) => row.accepted).length,
      rejectedRowCount: errors.length,
      excludedRowCount: excludedRows.length,
      sourceTotal: sourceTotalPence / 100,
      projectedAuthoritativeGdv: projectedPence == null ? null : projectedPence / 100,
      difference: projectedPence == null ? null : (projectedPence - sourceTotalPence) / 100,
      authorityReady: forecastAdoption ? authority.ready : null,
      authorityBlockers: forecastAdoption ? (authority.blockers || []) : [],
      exactlyReconciled: forecastAdoption ? exactlyReconciled : null,
      canApply,
      evidence,
    },
    nextPlots,
  };
}

async function withLockedEvidence(clientId, developmentId, callback) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await lockPlotMasterAuthority(db, clientId, developmentId);
    const result = await db.query(
      'SELECT * FROM developments WHERE client_id=$1 AND id=$2 FOR UPDATE',
      [clientId, developmentId]
    );
    if (!result.rowCount) {
      await db.query('ROLLBACK');
      return fail(404, 'Development not found.');
    }
    const development = rowToDocument(result.rows[0]);
    development.clientId = clientId;
    const settingsRow = (await db.query(
      'SELECT * FROM development_revenue_settings WHERE client_id=$1 AND development_id=$2 LIMIT 1 FOR SHARE',
      [clientId, developmentId]
    )).rows[0] || null;
    const output = await callback({ db, development, settingsRow });
    if (!output?.committed) await db.query('ROLLBACK');
    return output;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

async function previewSalesRegisterImport(clientId, developmentId, body = {}, auth = {}) {
  return withLockedEvidence(clientId, developmentId, async ({ development, settingsRow }) => {
    if (development.version !== Number(body.version)) {
      return fail(409, 'The Development changed after the file was reviewed. Refresh and preview again.', {
        code: 'VERSION_CONFLICT', development,
      });
    }
    return buildReviewedImport(development, settingsRow, body, auth);
  });
}

async function applySalesRegisterImport(clientId, developmentId, body = {}, auth = {}) {
  return withLockedEvidence(clientId, developmentId, async ({ db, development, settingsRow }) => {
    if (development.version !== Number(body.version)) {
      return fail(409, 'The Development changed after this import was reviewed. Refresh and preview again.', {
        code: 'VERSION_CONFLICT', development,
      });
    }
    const submitted = await submittedPeriod(db, clientId, developmentId);
    if (submitted) {
      return fail(409, 'Revenue forecasts cannot be imported while a Site Start or monthly CVR is Submitted.', {
        code: 'PLOT_MASTER_UPDATE_BLOCKED_SUBMITTED_CVR', period: submitted,
      });
    }
    const reviewed = buildReviewedImport(development, settingsRow, body, auth);
    if (!reviewed.ok) return reviewed;
    if (!reviewed.preview.canApply) {
      return fail(
        422,
        body.treatment === 'forecast_manual_value'
          ? 'The imported forecasts do not reconcile exactly to the projected authoritative GDV.'
          : 'The reviewed Sales Register evidence is not ready to apply.',
        { preview: reviewed.preview }
      );
    }
    if (String(body.previewFingerprint || '') !== reviewed.preview.fingerprint) {
      return fail(409, 'Revenue evidence changed after preview. Preview the import again.', { code: 'STALE_PREVIEW' });
    }
    if (isDeepStrictEqual(reviewed.nextPlots, development.plotMaster.plots)) {
      return fail(409, 'The reviewed import does not change any Revenue evidence.');
    }

    const now = new Date().toISOString();
    const plotMaster = {
      ...development.plotMaster,
      plots: reviewed.nextPlots,
      updatedAt: now,
      lastSalesRegisterImport: {
        schemaVersion: 'sales_register_import_v2',
        appliedAt: now,
        appliedBy: auth.displayName || null,
        appliedByUserId: auth.userId || null,
        appliedByMembershipId: auth.membershipId || null,
        treatment: body.treatment,
        reason: String(body.reason || '').trim(),
        sourceEvidence: reviewed.preview.evidence.source,
        reconciliation: {
          sourceRowCount: reviewed.preview.sourceRowCount,
          acceptedRowCount: reviewed.preview.acceptedRowCount,
          rejectedRowCount: 0,
          excludedRowCount: reviewed.preview.excludedRowCount,
          sourceTotal: reviewed.preview.sourceTotal,
          authoritativeGdv: reviewed.preview.projectedAuthoritativeGdv,
          difference: reviewed.preview.difference,
        },
        rows: reviewed.preview.evidence.rows,
        excludedRows: reviewed.preview.excludedRows,
      },
    };
    const merged = mergeDevelopmentPatch(development, { plotMaster });
    const row = documentToUpdateRow(merged, { actor: auth.displayName || null });
    const updated = await db.query(
      `UPDATE developments
       SET payload=$1::jsonb,version=version+1,updated_at=NOW(),updated_by=$2
       WHERE id=$3 AND client_id=$4 AND version=$5
       RETURNING *`,
      [JSON.stringify(row.payload), row.updated_by, developmentId, clientId, development.version]
    );
    if (!updated.rowCount) return fail(409, 'Development version conflict.', { code: 'VERSION_CONFLICT' });
    await db.query('COMMIT');
    return {
      ok: true,
      status: 200,
      committed: true,
      development: rowToDocument(updated.rows[0]),
      updatedPlots: reviewed.preview.acceptedRowCount,
      reconciliation: {
        sourceTotal: reviewed.preview.sourceTotal,
        authoritativeGdv: reviewed.preview.projectedAuthoritativeGdv,
        difference: reviewed.preview.difference,
      },
    };
  });
}

module.exports = {
  SALES_STATUSES,
  previewSalesRegisterImport,
  applySalesRegisterImport,
  buildReviewedImport,
  independentForecastPlot,
  canonicalMoney,
};
