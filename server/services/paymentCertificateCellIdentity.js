/**
 * BL-030A — Stable matrix cell identity for V1 certificates.
 *
 * Server matrix payload (package_order_matrices.payload):
 *   plots[].id     required durable plot identity
 *   plots[].label  display only
 *   stages[]       array of stage label strings — no durable stage id exists
 *
 * Decision:
 *   plotKey  = trimmed plots[].id
 *   stageKey = NFC-normalised trimmed stage label (the label IS the identity)
 *   cellId   = encodeURIComponent(plotKey) + "::" + encodeURIComponent(stageKey)
 *
 * Array index is never an authoritative key.
 * Duplicate plot ids or duplicate stage labels are rejected for certificate use.
 */

function normalizePlotKey(value) {
  return String(value || "").trim();
}

function normalizeStageKey(value) {
  return String(value || "")
    .trim()
    .normalize("NFC");
}

function buildCellId(plotKey, stageKey) {
  return `${encodeURIComponent(plotKey)}::${encodeURIComponent(stageKey)}`;
}

function parseCellId(cellId) {
  const raw = String(cellId || "");
  const separator = raw.indexOf("::");
  if (separator < 0) return null;
  try {
    const plotKey = decodeURIComponent(raw.slice(0, separator));
    const stageKey = decodeURIComponent(raw.slice(separator + 2));
    if (!plotKey || !stageKey) return null;
    return { plotKey, stageKey };
  } catch {
    return null;
  }
}

function looksLikePositionalCellKey(value) {
  return /^\d+::\d+$/.test(String(value || "").trim());
}

function indexMatrixCells(matrix) {
  const errors = [];
  const stages = Array.isArray(matrix?.stages) ? matrix.stages : [];
  const plots = Array.isArray(matrix?.plots) ? matrix.plots : [];

  if (!matrix || matrix.layout !== "plot-stage") {
    return { ok: false, errors: ["A plot-stage order matrix is required."], cells: [] };
  }
  if (!stages.length || !plots.length) {
    return { ok: false, errors: ["Order matrix must contain plots and stages."], cells: [] };
  }

  const stageKeys = [];
  const seenStages = new Set();
  stages.forEach((label, index) => {
    const stageKey = normalizeStageKey(label);
    if (!stageKey) {
      errors.push(`stages[${index}] must not be blank`);
      return;
    }
    if (seenStages.has(stageKey)) {
      errors.push(`Duplicate stage identity "${stageKey}" is not allowed for certificates.`);
      return;
    }
    seenStages.add(stageKey);
    stageKeys.push({ stageKey, stageLabel: String(label).trim(), stageIndex: index });
  });

  const seenPlots = new Set();
  const cells = [];

  plots.forEach((plot, plotIndex) => {
    const plotKey = normalizePlotKey(plot?.id);
    const plotLabel = String(plot?.label || "").trim();
    if (!plotKey) {
      errors.push(`plots[${plotIndex}].id is required for certificate cell identity.`);
      return;
    }
    if (seenPlots.has(plotKey)) {
      errors.push(`Duplicate plot identity "${plotKey}" is not allowed for certificates.`);
      return;
    }
    seenPlots.add(plotKey);

    const values = Array.isArray(plot.values) ? plot.values : [];
    for (const stage of stageKeys) {
      const contractValue = Number(values[stage.stageIndex]);
      cells.push({
        cellId: buildCellId(plotKey, stage.stageKey),
        plotKey,
        plotLabel: plotLabel || plotKey,
        houseType: plot.houseType || plot.house_type || null,
        stageKey: stage.stageKey,
        stageLabel: stage.stageLabel,
        contractValue: Number.isFinite(contractValue) ? contractValue : 0,
      });
    }
  });

  if (errors.length) {
    return { ok: false, errors, cells: [] };
  }

  return { ok: true, errors: [], cells, stageKeys, plotKeys: [...seenPlots] };
}

function findIndexedCell(indexed, plotKey, stageKey) {
  const cellId = buildCellId(normalizePlotKey(plotKey), normalizeStageKey(stageKey));
  return indexed.cells.find((cell) => cell.cellId === cellId) || null;
}

module.exports = {
  normalizePlotKey,
  normalizeStageKey,
  buildCellId,
  parseCellId,
  looksLikePositionalCellKey,
  indexMatrixCells,
  findIndexedCell,
};
