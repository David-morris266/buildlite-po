/**
 * BL-030C — Convert positional UI cell keys to stable server progress identity.
 *
 * UI may render by plotIndex::stageIndex. Server payloads must use plotId + stageKey.
 */

import {
  buildStableCellId,
  getProgressPctByStableIdentity,
  indexMatrixForCertificates,
  looksLikePositionalCellKey,
  normalizePlotKey,
  normalizeStageKey,
  parsePositionalCellKey,
  parseStableCellId,
  positionalKeyToStable,
  progressUsesStableIdentity,
  snapshotCellForIdentity,
} from './paymentCertificateCellIdentity';
import { roundPct } from './paymentCertificateCalculations';

export {
  buildStableCellId,
  getProgressPctByStableIdentity,
  looksLikePositionalCellKey,
  positionalKeyToStable,
  progressUsesStableIdentity,
  snapshotCellForIdentity,
};

function readThisCertificatePct(value) {
  const pct = Number.parseFloat(String(value?.thisCertificatePct ?? value));
  return Number.isFinite(pct) ? pct : 0;
}

export function resolveCurrentCertificateMatrix(matrixResolution) {
  if (!matrixResolution?.ready) {
    return {
      ok: false,
      errors: [
        matrixResolution?.error?.message ||
          'Unable to save progress because the order matrix is not loaded.',
      ],
      matrix: null,
    };
  }
  if (!matrixResolution.matrix) {
    return {
      ok: false,
      errors: ['A plot-stage order matrix is required to save certificate progress.'],
      matrix: null,
    };
  }
  const indexed = indexMatrixForCertificates(matrixResolution.matrix);
  if (!indexed.ok) {
    return { ok: false, errors: indexed.errors, matrix: null };
  }
  return { ok: true, errors: [], matrix: matrixResolution.matrix, indexed };
}

/**
 * Merge a positional UI patch onto existing (usually stable) progress using the
 * current authoritative matrix. Removed matrix cells are dropped from drafts.
 */
export function applyPositionalProgressPatch(existingProgress, positionalPatch, matrix) {
  const indexed = indexMatrixForCertificates(matrix);
  if (!indexed.ok) {
    return { ok: false, errors: indexed.errors };
  }

  const next = {};
  for (const cell of indexed.cells) {
    const pct = getProgressPctByStableIdentity(
      existingProgress,
      cell.plotId,
      cell.stageKey
    );
    if (pct > 0) {
      next[cell.cellId] = {
        plotId: cell.plotId,
        stageKey: cell.stageKey,
        thisCertificatePct: pct,
      };
    }
  }

  for (const [cellKey, value] of Object.entries(positionalPatch || {})) {
    const mapped = positionalKeyToStable(cellKey, matrix);
    if (!mapped.ok) {
      return mapped;
    }
    const pct = readThisCertificatePct(value);
    if (!pct) {
      delete next[mapped.cellId];
    } else {
      next[mapped.cellId] = {
        plotId: mapped.plotId,
        stageKey: mapped.stageKey,
        thisCertificatePct: pct,
      };
    }
  }

  return { ok: true, progress: next };
}

export function toServerProgress(uiProgress, matrix) {
  return applyPositionalProgressPatch({}, uiProgress, matrix);
}

export function getUiCellProgress(certificate, cellKey, matrix = null) {
  const direct = certificate?.progress?.[cellKey]?.thisCertificatePct;
  if (
    direct != null &&
    (!progressUsesStableIdentity(certificate?.progress) || !matrix)
  ) {
    return direct ?? 0;
  }

  if (matrix && looksLikePositionalCellKey(cellKey)) {
    const mapped = positionalKeyToStable(cellKey, matrix);
    if (mapped.ok) {
      return getProgressPctByStableIdentity(
        certificate?.progress,
        mapped.plotId,
        mapped.stageKey
      );
    }
  }

  return direct ?? 0;
}

export function getPriorThisCertificatePct(priorCertificate, plotId, stageKey) {
  const snapshotCell = snapshotCellForIdentity(
    priorCertificate?.valuationSnapshot,
    plotId,
    stageKey
  );
  if (snapshotCell) {
    const pct = Number(snapshotCell.thisCertificatePct);
    return Number.isFinite(pct) ? pct : 0;
  }
  return getProgressPctByStableIdentity(priorCertificate?.progress, plotId, stageKey);
}

export function sumPreviousStableProgress(priorCertificates, plotId, stageKey) {
  let cumulativePct = 0;
  let lastCertNumber = null;

  for (const priorCert of priorCertificates) {
    const pct = getPriorThisCertificatePct(priorCert, plotId, stageKey);
    if (pct > 0) {
      cumulativePct = roundPct(Math.min(100, cumulativePct + pct));
      lastCertNumber = priorCert.certificateNumber;
    }
  }

  return {
    previousCumulativePct: cumulativePct,
    previousCertificateNumber: lastCertNumber,
  };
}

export function resolveStableIdentityForUiCell(cellKey, matrix, plotId = null, stageKey = null) {
  if (plotId && stageKey) {
    const normalizedPlot = normalizePlotKey(plotId);
    const normalizedStage = normalizeStageKey(stageKey);
    return {
      ok: true,
      plotId: normalizedPlot,
      stageKey: normalizedStage,
      cellId: buildStableCellId(normalizedPlot, normalizedStage),
    };
  }
  if (looksLikePositionalCellKey(cellKey)) {
    if (!matrix) {
      return { ok: false, errors: ['Order matrix is required for stable cell identity.'] };
    }
    return positionalKeyToStable(cellKey, matrix);
  }
  const parsed = parseStableCellId(cellKey);
  if (parsed) {
    return {
      ok: true,
      plotId: parsed.plotKey,
      stageKey: parsed.stageKey,
      cellId: cellKey,
    };
  }
  if (!matrix) {
    return { ok: false, errors: ['Order matrix is required for stable cell identity.'] };
  }
  return positionalKeyToStable(cellKey, matrix);
}

/**
 * Historical locked grid from valuationSnapshot. Live matrix must not rewrite this.
 */
export function buildValuationGridFromSnapshot(certificate, selectedKeys = new Set()) {
  const cells = Array.isArray(certificate?.valuationSnapshot?.cells)
    ? certificate.valuationSnapshot.cells
    : [];
  if (!cells.length) return null;

  const stageOrder = [];
  const seenStages = new Set();
  const plotOrder = [];
  const plots = new Map();

  cells.forEach((cell) => {
    const plotKey = normalizePlotKey(cell.plotId || cell.plotKey);
    const stageKey = normalizeStageKey(cell.stageKey);
    const stageLabel = String(cell.stageLabel || cell.stageKey || '').trim() || stageKey;
    if (stageKey && !seenStages.has(stageKey)) {
      seenStages.add(stageKey);
      stageOrder.push(stageLabel);
    }
    if (!plots.has(plotKey)) {
      plots.set(plotKey, {
        plotKey,
        plotLabel: String(cell.plotLabel || plotKey).trim() || plotKey,
        houseType: cell.houseType || '',
        cells: [],
      });
      plotOrder.push(plotKey);
    }
  });

  const rows = plotOrder.map((plotKey, plotIndex) => {
    const plot = plots.get(plotKey);
    const plotCells = cells.filter(
      (cell) => normalizePlotKey(cell.plotId || cell.plotKey) === plotKey
    );
    const mappedCells = plotCells.map((cell, stageIndex) => {
      const cellId =
        cell.cellId ||
        buildStableCellId(
          normalizePlotKey(cell.plotId || cell.plotKey),
          normalizeStageKey(cell.stageKey)
        );
      const previousCumulativePct = Number(cell.previousCumulativePct) || 0;
      const thisCertificatePct = Number(cell.thisCertificatePct) || 0;
      const cumulativePct = Number(cell.cumulativePct) || previousCumulativePct + thisCertificatePct;
      return {
        cellKey: cellId,
        plotIndex,
        stageIndex,
        plotLabel: plot.plotLabel,
        houseType: plot.houseType,
        stageLabel: String(cell.stageLabel || cell.stageKey || '').trim(),
        contractValue: Number(cell.contractValue) || 0,
        previousCumulativePct,
        previousCertificateNumber: null,
        thisCertificatePct,
        cumulativePct,
        previousValue: Number(cell.previousValue) || 0,
        thisCertificateValue: Number(cell.thisCertificateValue) || 0,
        certifiedToDateValue: Number(cell.certifiedToDateValue) || 0,
        remainingValue: Number(cell.remainingValue) || 0,
        errors: [],
        valid: true,
        editable: false,
        selected: selectedKeys.has(cellId),
        visualState:
          cumulativePct >= 100 ? 'complete' : cumulativePct > 0 || thisCertificatePct > 0 ? 'partial' : 'idle',
        snapshotCell: true,
      };
    });

    return {
      plotIndex,
      plotLabel: plot.plotLabel,
      houseType: plot.houseType,
      cells: mappedCells,
    };
  });

  return {
    stages: stageOrder,
    rows,
    cells: rows.flatMap((row) => row.cells),
    fromValuationSnapshot: true,
  };
}

export function parsePositionalCellKeySafe(cellKey) {
  return parsePositionalCellKey(cellKey);
}
