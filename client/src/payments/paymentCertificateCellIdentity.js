/**
 * BL-030C — Stable matrix cell identity for V1 certificates (client).
 *
 * plotKey  = trimmed plots[].id
 * stageKey = NFC-normalised trimmed stage label
 * cellId   = encodeURIComponent(plotKey) + "::" + encodeURIComponent(stageKey)
 *
 * Array index is never an authoritative key.
 */

export function normalizePlotKey(value) {
  return String(value || '').trim();
}

export function normalizeStageKey(value) {
  return String(value || '')
    .trim()
    .normalize('NFC');
}

export function buildStableCellId(plotKey, stageKey) {
  return `${encodeURIComponent(plotKey)}::${encodeURIComponent(stageKey)}`;
}

export function parseStableCellId(cellId) {
  const raw = String(cellId || '');
  const separator = raw.indexOf('::');
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

export function looksLikePositionalCellKey(value) {
  return /^\d+::\d+$/.test(String(value || '').trim());
}

export function parsePositionalCellKey(cellKey) {
  const [plotIndex, stageIndex] = String(cellKey || '').split('::');
  return {
    plotIndex: Number.parseInt(plotIndex, 10),
    stageIndex: Number.parseInt(stageIndex, 10),
  };
}

export function progressUsesStableIdentity(progress) {
  if (!progress || typeof progress !== 'object') return false;
  return Object.values(progress).some(
    (entry) =>
      entry &&
      typeof entry === 'object' &&
      (entry.plotId || entry.plotKey || entry.stageKey)
  );
}

/**
 * Index a plot-stage matrix for certificate identity.
 */
export function indexMatrixForCertificates(matrix) {
  const errors = [];
  const stages = Array.isArray(matrix?.stages) ? matrix.stages : [];
  const plots = Array.isArray(matrix?.plots) ? matrix.plots : [];

  if (!matrix || matrix.layout !== 'plot-stage') {
    return { ok: false, errors: ['A plot-stage order matrix is required.'], cells: [] };
  }
  if (!stages.length || !plots.length) {
    return { ok: false, errors: ['Order matrix must contain plots and stages.'], cells: [] };
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
    const plotLabel = String(plot?.label || '').trim();
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
        cellId: buildStableCellId(plotKey, stage.stageKey),
        plotKey,
        plotId: plotKey,
        plotLabel: plotLabel || plotKey,
        plotIndex,
        houseType: plot.houseType || plot.house_type || null,
        stageKey: stage.stageKey,
        stageLabel: stage.stageLabel,
        stageIndex: stage.stageIndex,
        contractValue: Number.isFinite(contractValue) ? contractValue : 0,
      });
    }
  });

  if (errors.length) {
    return { ok: false, errors, cells: [] };
  }

  return { ok: true, errors: [], cells, stageKeys, plotKeys: [...seenPlots] };
}

export function positionalKeyToStable(cellKey, matrix) {
  const { plotIndex, stageIndex } = parsePositionalCellKey(cellKey);
  if (!Number.isInteger(plotIndex) || !Number.isInteger(stageIndex)) {
    return { ok: false, errors: [`Invalid progress cell "${cellKey}".`] };
  }

  const indexed = indexMatrixForCertificates(matrix);
  if (!indexed.ok) {
    return { ok: false, errors: indexed.errors };
  }

  const cell = indexed.cells.find(
    (item) => item.plotIndex === plotIndex && item.stageIndex === stageIndex
  );
  if (!cell) {
    return {
      ok: false,
      errors: [`Progress cell ${cellKey} is not in the current order matrix.`],
    };
  }

  return {
    ok: true,
    plotId: cell.plotId,
    stageKey: cell.stageKey,
    cellId: cell.cellId,
    plotIndex: cell.plotIndex,
    stageIndex: cell.stageIndex,
  };
}

export function getProgressPctByStableIdentity(progress, plotId, stageKey) {
  const plotKey = normalizePlotKey(plotId);
  const stage = normalizeStageKey(stageKey);
  if (!plotKey || !stage || !progress || typeof progress !== 'object') return 0;

  const cellId = buildStableCellId(plotKey, stage);
  const direct = progress[cellId];
  if (direct && typeof direct === 'object') {
    const pct = Number(direct.thisCertificatePct);
    return Number.isFinite(pct) ? pct : 0;
  }

  for (const [key, entry] of Object.entries(progress)) {
    if (!entry || typeof entry !== 'object') continue;
    const entryPlot = normalizePlotKey(entry.plotId || entry.plotKey);
    const entryStage = normalizeStageKey(entry.stageKey || entry.stageId);
    if (entryPlot === plotKey && entryStage === stage) {
      const pct = Number(entry.thisCertificatePct);
      return Number.isFinite(pct) ? pct : 0;
    }
    const parsed = parseStableCellId(key);
    if (parsed && parsed.plotKey === plotKey && parsed.stageKey === stage) {
      const pct = Number(entry.thisCertificatePct);
      return Number.isFinite(pct) ? pct : 0;
    }
  }

  return 0;
}

export function snapshotCellForIdentity(snapshot, plotId, stageKey) {
  const plotKey = normalizePlotKey(plotId);
  const stage = normalizeStageKey(stageKey);
  const cells = Array.isArray(snapshot?.cells) ? snapshot.cells : [];
  return (
    cells.find(
      (cell) =>
        normalizePlotKey(cell.plotId || cell.plotKey) === plotKey &&
        normalizeStageKey(cell.stageKey) === stage
    ) || null
  );
}
