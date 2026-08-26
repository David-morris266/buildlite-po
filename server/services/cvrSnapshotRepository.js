/**
 * BL-031E.3B — Persist immutable CVR period snapshots.
 *
 * INSERT only. Never UPDATE/UPSERT/replace historic evidence.
 * Caller must supply the same Postgres transaction client used for
 * close-engine calculation and the submitted -> locked transition.
 */

const { query } = require("../db");
const assert = require("node:assert/strict");
const { CVR_SNAPSHOT_EXPECTED_LIABILITY_SCHEMA_VERSION } = require("./cvrCloseConstants");
const { snapshotHeaderToDocument } = require("./cvrSnapshotMapper");

const SNAPSHOT_MONEY_FIELDS = [
  ["currentBudget", "current_budget"],
  ["committed", "committed"],
  ["certified", "certified"],
  ["actualCost", "actual_cost"],
  ["manualAccrual", "manual_accrual"],
  ["currentCost", "current_cost"],
  ["systemForecast", "system_forecast"],
  ["expectedLiability", "expected_liability"],
  ["commercialAdjustment", "commercial_adjustment"],
  ["finalForecast", "final_forecast"],
  ["costToComplete", "cost_to_complete"],
  ["outstandingCertified", "outstanding_certified"],
  ["variance", "variance"],
];

const SNAPSHOT_REVENUE_FIELDS = [
  ["forecastRevenue", "forecast_revenue"],
  ["securedRevenue", "secured_revenue"],
  ["remainingForecastRevenue", "remaining_forecast_revenue"],
  ["grossProfit", "gross_profit"],
];

const ROW_MONEY_FIELDS = [
  ["originalBudget", "original_budget"],
  ["currentBudget", "current_budget"],
  ["commercialAdjustment", "commercial_adjustment"],
  ["manualAccrual", "manual_accrual"],
  ["committed", "committed"],
  ["certified", "certified"],
  ["actualCost", "actual_cost"],
  ["currentCost", "current_cost"],
  ["systemForecast", "system_forecast"],
  ["expectedLiability", "expected_liability"],
  ["finalForecast", "final_forecast"],
  ["costToComplete", "cost_to_complete"],
  ["outstandingCertified", "outstanding_certified"],
  ["variance", "variance"],
];

function isUniqueViolation(err) {
  return err && err.code === "23505";
}

async function runQuery(dbClient, text, params) {
  if (!dbClient) {
    throw new Error("CVR snapshot persistence requires a transaction client.");
  }
  return dbClient.query(text, params);
}

function moneyNumber(value, fallback = 0) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function moneyOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function assertSameMoney(actual, expected, label) {
  const left = actual == null ? null : moneyNumber(actual, null);
  const right = expected == null ? null : moneyNumber(expected, null);
  if (left !== right) {
    throw new Error(`CVR snapshot ${label} mismatch: persisted ${left}, candidate ${right}.`);
  }
}

function requireTransactionClient(dbClient) {
  if (!dbClient || typeof dbClient.query !== "function") {
    throw new Error("CVR snapshot persistence requires a transaction client.");
  }
}

async function getSnapshotForPeriod(clientId, periodId, dbClient = null) {
  const exec = dbClient ? dbClient.query.bind(dbClient) : query;
  const header = await exec(
    `
      SELECT *
      FROM cvr_period_snapshots
      WHERE client_id = $1 AND period_id = $2
      LIMIT 1
    `,
    [clientId, periodId]
  );
  if (!header.rows[0]) return null;
  const rows = await exec(
    `
      SELECT *
      FROM cvr_period_snapshot_rows
      WHERE client_id = $1 AND snapshot_id = $2
      ORDER BY cost_code_label ASC, cost_code_key ASC
    `,
    [clientId, header.rows[0].id]
  );
  let plots = { rows: [] };
  try {
    plots = await exec(
      `
        SELECT *
        FROM cvr_period_snapshot_plots
        WHERE client_id = $1 AND snapshot_id = $2
        ORDER BY plot_number ASC, plot_id ASC
      `,
      [clientId, header.rows[0].id]
    );
  } catch (err) {
    if (!/cvr_period_snapshot_plots/i.test(String(err.message || ""))) throw err;
  }
  return snapshotHeaderToDocument(header.rows[0], rows.rows, plots.rows);
}

async function insertSnapshotHeader(dbClient, { clientId, developmentId, periodRow, snapshot, actor }) {
  const { rows } = await runQuery(
    dbClient,
    `
      INSERT INTO cvr_period_snapshots (
        client_id, development_id, period_id, period_key, schema_version,
        commentary, source_readiness,
        current_budget, committed, certified, actual_cost, manual_accrual,
        current_cost, system_forecast, expected_liability, commercial_adjustment, final_forecast,
        cost_to_complete, outstanding_certified, variance,
        forecast_revenue, secured_revenue, remaining_forecast_revenue,
        plots_sold, plots_remaining, gross_profit, gross_margin_percent,
        revenue_assumptions, revenue_settings_id, revenue_settings_version,
        created_by
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6::jsonb, $7::jsonb,
        $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17,
        $18, $19, $20,
        $21, $22, $23,
        $24, $25, $26, $27,
        $28::jsonb, $29, $30,
        $31
      )
      RETURNING *
    `,
    [
      clientId,
      developmentId,
      periodRow.id,
      periodRow.period_key,
      snapshot.schemaVersion,
      JSON.stringify(snapshot.commentary || {}),
      JSON.stringify(snapshot.sourceReadiness || {}),
      moneyNumber(snapshot.currentBudget),
      moneyNumber(snapshot.committed),
      moneyNumber(snapshot.certified),
      moneyNumber(snapshot.actualCost),
      moneyNumber(snapshot.manualAccrual),
      moneyNumber(snapshot.currentCost),
      moneyNumber(snapshot.systemForecast),
      moneyNumber(snapshot.expectedLiability),
      moneyNumber(snapshot.commercialAdjustment),
      moneyNumber(snapshot.finalForecast),
      moneyNumber(snapshot.costToComplete),
      moneyNumber(snapshot.outstandingCertified),
      moneyNumber(snapshot.variance),
      moneyOrNull(snapshot.forecastRevenue),
      moneyOrNull(snapshot.securedRevenue),
      moneyOrNull(snapshot.remainingForecastRevenue),
      snapshot.plotsSold == null ? null : Number(snapshot.plotsSold),
      snapshot.plotsRemaining == null ? null : Number(snapshot.plotsRemaining),
      moneyOrNull(snapshot.grossProfit),
      snapshot.grossMarginPercent == null ? null : Number(snapshot.grossMarginPercent),
      snapshot.revenueAssumptions ? JSON.stringify(snapshot.revenueAssumptions) : null,
      snapshot.revenueSettingsId || null,
      snapshot.revenueSettingsVersion == null ? null : Number(snapshot.revenueSettingsVersion),
      actor || snapshot.createdBy || null,
    ]
  );
  return rows[0];
}

async function insertSnapshotRow(dbClient, { clientId, snapshotId, row }) {
  if (String(row.clientId || clientId) !== String(clientId)) {
    throw new Error("CVR snapshot row client_id does not match snapshot client.");
  }
  const metadata =
    row.displayMetadata && typeof row.displayMetadata === "object" && !Array.isArray(row.displayMetadata)
      ? { ...row.displayMetadata }
      : {};
  if (Array.isArray(row.adjustmentHistory) && metadata.adjustmentHistory == null) {
    metadata.adjustmentHistory = row.adjustmentHistory;
  }

  const { rows } = await runQuery(
    dbClient,
    `
      INSERT INTO cvr_period_snapshot_rows (
        client_id, snapshot_id, cost_code_key, cost_code_label, description,
        commercial_head, commercial_family, trade, active,
        original_budget, current_budget, commercial_adjustment, adjustment_reason,
        manual_accrual, notes, committed, certified, actual_cost, current_cost,
        system_forecast, expected_liability, final_forecast, cost_to_complete,
        outstanding_certified, variance, expected_liability_provenance, display_metadata
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, $12, $13,
        $14, $15, $16, $17, $18, $19,
        $20, $21, $22, $23,
        $24, $25, $26::jsonb, $27::jsonb
      )
      RETURNING *
    `,
    [
      clientId,
      snapshotId,
      row.costCodeKey,
      row.costCodeLabel,
      row.description || "",
      row.commercialHead || "",
      row.commercialFamily || "",
      row.trade || "",
      row.active !== false,
      moneyOrNull(row.originalBudget),
      moneyOrNull(row.currentBudget),
      moneyNumber(row.commercialAdjustment),
      row.adjustmentReason || "",
      moneyNumber(row.manualAccrual),
      row.notes || "",
      moneyNumber(row.committed),
      moneyNumber(row.certified),
      moneyNumber(row.actualCost),
      moneyNumber(row.currentCost),
      moneyNumber(row.systemForecast),
      moneyNumber(row.expectedLiability),
      moneyNumber(row.finalForecast),
      moneyNumber(row.costToComplete),
      moneyNumber(row.outstandingCertified),
      moneyNumber(row.variance),
      JSON.stringify(row.expectedLiabilityProvenance || []),
      JSON.stringify(metadata),
    ]
  );
  return rows[0];
}

async function insertSnapshotPlot(dbClient, { clientId, snapshotId, plot }) {
  const metadata =
    plot.displayMetadata && typeof plot.displayMetadata === "object" && !Array.isArray(plot.displayMetadata)
      ? plot.displayMetadata
      : {};
  const { rows } = await runQuery(
    dbClient,
    `
      INSERT INTO cvr_period_snapshot_plots (
        client_id, snapshot_id, plot_id, plot_number, house_type, tenure,
        revenue_category, revenue_status, revenue_source,
        forecast_revenue, secured_revenue, remaining_forecast_revenue,
        selling_price, derived_forecast, plot_premium, nia_ft2, effective_garage,
        reserved_at, exchanged_at, completed_at, display_metadata
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9,
        $10, $11, $12,
        $13, $14, $15, $16, $17,
        $18, $19, $20, $21::jsonb
      )
      RETURNING *
    `,
    [
      clientId,
      snapshotId,
      plot.plotId,
      plot.plotNumber || "",
      plot.houseType || "",
      plot.tenure || "",
      plot.revenueCategory || "",
      plot.revenueStatus || "",
      plot.revenueSource || "",
      moneyNumber(plot.forecastRevenue),
      moneyNumber(plot.securedRevenue),
      moneyNumber(plot.remainingForecastRevenue),
      moneyOrNull(plot.sellingPrice),
      moneyNumber(plot.derivedForecast),
      moneyNumber(plot.plotPremium),
      moneyNumber(plot.niaFt2),
      plot.effectiveGarage || "None",
      plot.reservedAt || null,
      plot.exchangedAt || null,
      plot.completedAt || null,
      JSON.stringify(metadata),
    ]
  );
  return rows[0];
}

function verifyPersistedSnapshot(header, insertedRows, insertedPlots, snapshot) {
  const candidateRows = snapshot.rows || [];
  if (insertedRows.length !== candidateRows.length) {
    throw new Error(
      `CVR snapshot row count mismatch: persisted ${insertedRows.length}, candidate ${candidateRows.length}.`
    );
  }
  for (const [camel, column] of SNAPSHOT_MONEY_FIELDS) {
    assertSameMoney(header[column], snapshot[camel], `header.${camel}`);
  }
  assertSameMoney(
    snapshot.finalForecast,
    moneyNumber(snapshot.systemForecast) +
      moneyNumber(snapshot.expectedLiability) +
      moneyNumber(snapshot.commercialAdjustment),
    "header.Final = System + Expected + Adjustment"
  );
  for (const [camel, column] of SNAPSHOT_REVENUE_FIELDS) {
    assertSameMoney(header[column], snapshot[camel], `header.${camel}`);
  }
  if (Number(header.plots_sold) !== Number(snapshot.plotsSold)) {
    throw new Error(
      `CVR snapshot plotsSold mismatch: persisted ${header.plots_sold}, candidate ${snapshot.plotsSold}.`
    );
  }
  if (Number(header.plots_remaining) !== Number(snapshot.plotsRemaining)) {
    throw new Error(
      `CVR snapshot plotsRemaining mismatch: persisted ${header.plots_remaining}, candidate ${snapshot.plotsRemaining}.`
    );
  }
  const persistedMargin =
    header.gross_margin_percent == null ? null : Number(header.gross_margin_percent);
  const candidateMargin =
    snapshot.grossMarginPercent == null ? null : Number(snapshot.grossMarginPercent);
  if (persistedMargin == null || candidateMargin == null) {
    if (persistedMargin !== candidateMargin) {
      throw new Error(
        `CVR snapshot grossMarginPercent mismatch: persisted ${persistedMargin}, candidate ${candidateMargin}.`
      );
    }
  } else if (Math.abs(persistedMargin - candidateMargin) > 0.00015) {
    throw new Error(
      `CVR snapshot grossMarginPercent mismatch: persisted ${persistedMargin}, candidate ${candidateMargin}.`
    );
  }
  const byKey = new Map(candidateRows.map((row) => [String(row.costCodeKey), row]));
  for (const persisted of insertedRows) {
    const candidate = byKey.get(String(persisted.cost_code_key));
    if (!candidate) {
      throw new Error(`CVR snapshot persisted unexpected cost code ${persisted.cost_code_key}.`);
    }
    for (const [camel, column] of ROW_MONEY_FIELDS) {
      assertSameMoney(persisted[column], candidate[camel], `${persisted.cost_code_key}.${camel}`);
    }
    assertSameMoney(
      candidate.finalForecast,
      moneyNumber(candidate.systemForecast) +
        moneyNumber(candidate.expectedLiability) +
        moneyNumber(candidate.commercialAdjustment),
      `${persisted.cost_code_key}.Final = System + Expected + Adjustment`
    );
    assert.deepStrictEqual(
      persisted.expected_liability_provenance || [],
      candidate.expectedLiabilityProvenance || [],
      `${persisted.cost_code_key}.expectedLiabilityProvenance mismatch`
    );
  }
  const candidatePlots = snapshot.plots || [];
  if (insertedPlots.length !== candidatePlots.length) {
    throw new Error(
      `CVR snapshot plot count mismatch: persisted ${insertedPlots.length}, candidate ${candidatePlots.length}.`
    );
  }
  const plotsById = new Map(candidatePlots.map((row) => [String(row.plotId), row]));
  for (const persisted of insertedPlots) {
    const candidate = plotsById.get(String(persisted.plot_id));
    if (!candidate) {
      throw new Error(`CVR snapshot persisted unexpected plot ${persisted.plot_id}.`);
    }
    assertSameMoney(persisted.forecast_revenue, candidate.forecastRevenue, `${persisted.plot_id}.forecastRevenue`);
    assertSameMoney(persisted.secured_revenue, candidate.securedRevenue, `${persisted.plot_id}.securedRevenue`);
  }
}

async function persistCvrPeriodSnapshot(
  dbClient,
  { clientId, developmentId, periodRow, candidate, actor, failAfter = null } = {}
) {
  requireTransactionClient(dbClient);
  const snapshot = candidate?.snapshot;
  if (!snapshot) {
    throw new Error("CVR close candidate has no snapshot to persist.");
  }
  if (String(snapshot.clientId) !== String(clientId)) {
    throw new Error("CVR snapshot client does not match approval tenant.");
  }
  if (String(snapshot.developmentId) !== String(developmentId)) {
    throw new Error("CVR snapshot development does not match approval development.");
  }
  if (String(snapshot.periodId) !== String(periodRow.id)) {
    throw new Error("CVR snapshot period does not match approval period.");
  }
  if (String(periodRow.client_id) !== String(clientId)) {
    throw new Error("CVR period client does not match approval tenant.");
  }
  if (String(periodRow.development_id) !== String(developmentId)) {
    throw new Error("CVR period development does not match approval development.");
  }
  if (Number(snapshot.schemaVersion) !== CVR_SNAPSHOT_EXPECTED_LIABILITY_SCHEMA_VERSION) {
    throw new Error("Whole-CVR lock requires snapshot schema version 3.");
  }
  if (
    snapshot.forecastRevenue == null ||
    snapshot.securedRevenue == null ||
    snapshot.remainingForecastRevenue == null ||
    snapshot.plotsSold == null ||
    snapshot.plotsRemaining == null ||
    snapshot.grossProfit == null
  ) {
    throw new Error("Whole-CVR snapshot is missing required Revenue totals.");
  }
  if (!snapshot.revenueAssumptions || typeof snapshot.revenueAssumptions !== "object") {
    throw new Error("Whole-CVR snapshot is missing frozen Revenue assumptions.");
  }
  if (!Array.isArray(snapshot.plots)) {
    throw new Error("Whole-CVR snapshot is missing plot Revenue rows.");
  }

  const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
  const seenKeys = new Set();
  for (const row of rows) {
    const key = String(row.costCodeKey || "").trim();
    if (!key) {
      throw new Error("CVR snapshot row is missing costCodeKey.");
    }
    if (seenKeys.has(key)) {
      throw new Error(`Duplicate CVR snapshot cost-code key: ${key}.`);
    }
    seenKeys.add(key);
  }

  if (failAfter === "header" || failAfter === "assumptions") {
    throw new Error(
      failAfter === "assumptions"
        ? "forced-assumptions-insert-failure"
        : "forced-header-insert-failure"
    );
  }

  const header = await insertSnapshotHeader(dbClient, {
    clientId,
    developmentId,
    periodRow,
    snapshot,
    actor,
  });

  if (failAfter === "duplicateHeader") {
    await insertSnapshotHeader(dbClient, {
      clientId,
      developmentId,
      periodRow,
      snapshot,
      actor,
    });
  }

  if (failAfter === "rows") {
    throw new Error("forced-row-insert-failure");
  }

  const insertedRows = [];
  for (const row of rows) {
    insertedRows.push(
      await insertSnapshotRow(dbClient, {
        clientId,
        snapshotId: header.id,
        row,
      })
    );
  }

  const counted = await runQuery(
    dbClient,
    `
      SELECT COUNT(*)::int AS n
      FROM cvr_period_snapshot_rows
      WHERE client_id = $1 AND snapshot_id = $2
    `,
    [clientId, header.id]
  );
  if (counted.rows[0].n !== rows.length) {
    throw new Error(
      `CVR snapshot row count mismatch: stored ${counted.rows[0].n}, candidate ${rows.length}.`
    );
  }

  if (failAfter === "plots") {
    throw new Error("forced-plot-insert-failure");
  }

  const plotRows = Array.isArray(snapshot.plots) ? snapshot.plots : [];
  const seenPlots = new Set();
  for (const plot of plotRows) {
    const plotId = String(plot.plotId || "").trim();
    if (!plotId) throw new Error("CVR snapshot plot is missing plotId.");
    if (seenPlots.has(plotId)) {
      throw new Error(`Duplicate CVR snapshot plot id: ${plotId}.`);
    }
    seenPlots.add(plotId);
  }

  const insertedPlots = [];
  for (const plot of plotRows) {
    insertedPlots.push(
      await insertSnapshotPlot(dbClient, {
        clientId,
        snapshotId: header.id,
        plot,
      })
    );
  }

  const plotCounted = await runQuery(
    dbClient,
    `
      SELECT COUNT(*)::int AS n
      FROM cvr_period_snapshot_plots
      WHERE client_id = $1 AND snapshot_id = $2
    `,
    [clientId, header.id]
  );
  if (plotCounted.rows[0].n !== plotRows.length) {
    throw new Error(
      `CVR snapshot plot count mismatch: stored ${plotCounted.rows[0].n}, candidate ${plotRows.length}.`
    );
  }

  verifyPersistedSnapshot(header, insertedRows, insertedPlots, snapshot);
  return snapshotHeaderToDocument(header, insertedRows, insertedPlots);
}

module.exports = {
  getSnapshotForPeriod,
  persistCvrPeriodSnapshot,
  isUniqueViolation,
};
