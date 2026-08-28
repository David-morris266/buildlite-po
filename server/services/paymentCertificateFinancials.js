/**
 * BL-030A — Certificate financial composition (parity with client works totals).
 */

const {
  CERTIFICATE_LINE_TYPES,
  DEFAULT_RETENTION_RATE,
  DEFAULT_VAT_RATE,
  VALUATION_SNAPSHOT_VERSION,
} = require("./paymentCertificateConstants");
const {
  calculateCertificateCellValues,
  normalizePct,
  roundMoney,
  sumPreviousApprovedProgress,
  validateThisCertificatePct,
} = require("./paymentCertificateCalculations");
const {
  buildCellId,
  indexMatrixCells,
  normalizePlotKey,
  normalizeStageKey,
} = require("./paymentCertificateCellIdentity");

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractPoVatRate(po) {
  const raw = Number(po?.totals?.vatRate ?? po?.vatRateDefault ?? DEFAULT_VAT_RATE);
  if (raw === 0) return 0;
  if (Math.abs(raw - 0.05) < 0.001) return 0.05;
  if (Math.abs(raw - 0.2) < 0.001) return 0.2;
  if (raw > 1) {
    if (raw === 5) return 0.05;
    if (raw === 20) return 0.2;
    return raw / 100;
  }
  return Number.isFinite(raw) ? raw : DEFAULT_VAT_RATE;
}

function extractPoRetentionRate(po) {
  const raw = Number(
    po?.totals?.retentionRate ?? po?.retentionRateDefault ?? DEFAULT_RETENTION_RATE
  );
  if (raw === 0) return 0;
  if (raw > 1) return raw / 100;
  return Number.isFinite(raw) ? raw : DEFAULT_RETENTION_RATE;
}

function getPackageVatAndRetentionRates(pos = []) {
  if (!Array.isArray(pos) || !pos.length) {
    return { vatRate: DEFAULT_VAT_RATE, retentionRate: DEFAULT_RETENTION_RATE };
  }

  let primary = pos[0];
  let maxNet = 0;
  for (const po of pos) {
    const net = Number(po.subtotal) || Number(po.totals?.net) || 0;
    if (net >= maxNet) {
      maxNet = net;
      primary = po;
    }
  }

  return {
    vatRate: extractPoVatRate(primary),
    retentionRate: extractPoRetentionRate(primary),
  };
}

function listProgressEntries(progress) {
  if (Array.isArray(progress)) return progress.filter(Boolean);
  if (!progress || typeof progress !== "object") return [];
  return Object.entries(progress).map(([cellId, value]) => {
    if (value && typeof value === "object") {
      return { cellId, ...value };
    }
    return { cellId, thisCertificatePct: value };
  });
}

function progressPctForCell(progress, plotKey, stageKey) {
  const wantedId = buildCellId(plotKey, stageKey);
  for (const entry of listProgressEntries(progress)) {
    const entryPlot = normalizePlotKey(entry.plotId || entry.plotKey);
    const entryStage = normalizeStageKey(entry.stageKey || entry.stageId);
    if (entryPlot && entryStage) {
      if (entryPlot === plotKey && entryStage === stageKey) {
        return normalizePct(entry.thisCertificatePct);
      }
      continue;
    }
    if (entry.cellId === wantedId) {
      return normalizePct(entry.thisCertificatePct);
    }
  }
  return 0;
}

function collectLockedThisCertificatePcts(lockedCertificates, plotKey, stageKey) {
  const pcts = [];
  const ordered = [...(lockedCertificates || [])].sort(
    (a, b) => a.certificateNumber - b.certificateNumber
  );

  for (const certificate of ordered) {
    const snapshotCells = certificate.valuationSnapshot?.cells;
    if (Array.isArray(snapshotCells) && snapshotCells.length) {
      const match = snapshotCells.find(
        (cell) =>
          normalizePlotKey(cell.plotId || cell.plotKey) === plotKey &&
          normalizeStageKey(cell.stageKey) === stageKey
      );
      if (match) {
        pcts.push(normalizePct(match.thisCertificatePct));
        continue;
      }
    }
    pcts.push(progressPctForCell(certificate.progress, plotKey, stageKey));
  }

  return pcts;
}

function previousCumulativeForCell(lockedCertificates, plotKey, stageKey) {
  return sumPreviousApprovedProgress(
    collectLockedThisCertificatePcts(lockedCertificates, plotKey, stageKey)
  );
}

function sumValueInclusionLines(commercialLines = []) {
  return roundMoney(
    (commercialLines || [])
      .filter((line) => !line.lineType || line.lineType === CERTIFICATE_LINE_TYPES.valueInclusion)
      .reduce((sum, line) => sum + toNumber(line.amountThisCertificate), 0)
  );
}

function sumRecoverySignedLines(commercialLines = []) {
  return roundMoney(
    (commercialLines || [])
      .filter((line) => line.lineType === CERTIFICATE_LINE_TYPES.recoveryDeduction)
      .reduce((sum, line) => sum + toNumber(line.amountThisCertificate), 0)
  );
}

function cumulativeRetentionPosition(lockedCertificates = []) {
  return (lockedCertificates || [])
    .filter((certificate) => !certificate.status || certificate.status === "locked")
    .reduce(
    (position, certificate) => ({
      previousGross: roundMoney(position.previousGross + toNumber(certificate.grossValue)),
      previousRetentionHeld: roundMoney(
        position.previousRetentionHeld + toNumber(certificate.retention)
      ),
      priorRates: [
        ...position.priorRates,
        Number(certificate.retentionRate),
      ].filter(Number.isFinite),
    }),
    { previousGross: 0, previousRetentionHeld: 0, priorRates: [] }
  );
}

function calculateRetentionMovement({
  currentGross,
  retentionRate,
  previousGross = 0,
  previousRetentionHeld = 0,
  priorRates = [],
}) {
  const newCumulativeGross = roundMoney(previousGross + currentGross);
  if (newCumulativeGross < -Number.EPSILON) {
    return {
      ok: false,
      errors: ["This certificate would reduce cumulative certified gross below £0."],
      newCumulativeGross,
    };
  }

  const held = roundMoney(Math.max(0, previousRetentionHeld));
  const rateChanged = priorRates.some(
    (rate) => Math.abs(rate - retentionRate) > Number.EPSILON
  );
  const uncappedMovement = rateChanged
    ? roundMoney(currentGross * retentionRate)
    : roundMoney(Math.max(0, newCumulativeGross * retentionRate) - held);
  const retention = roundMoney(Math.max(-held, uncappedMovement));
  const cumulativeRetentionHeld = roundMoney(Math.max(0, held + retention));

  return {
    ok: true,
    errors: [],
    retention,
    newCumulativeGross,
    cumulativeRetentionHeld,
    retentionRateChangeDeferred: rateChanged,
  };
}

function buildCertificateWorksTotals(cells, {
  commercialLines = [],
  vatRate = DEFAULT_VAT_RATE,
  retentionRate = DEFAULT_RETENTION_RATE,
  previousGross = 0,
  previousRetentionHeld = 0,
  priorRates = [],
} = {}) {
  const matrixGrossThisCertificate = roundMoney(
    cells.reduce((sum, cell) => sum + toNumber(cell.thisCertificateValue), 0)
  );
  const commercialEventGrossThisCertificate = sumValueInclusionLines(commercialLines);
  const grossWorksThisCertificate = roundMoney(
    matrixGrossThisCertificate + commercialEventGrossThisCertificate
  );
  const recoveryDeductionSigned = sumRecoverySignedLines(commercialLines);
  const retentionResult = calculateRetentionMovement({
    currentGross: grossWorksThisCertificate,
    retentionRate,
    previousGross,
    previousRetentionHeld,
    priorRates,
  });
  const retention = retentionResult.ok ? retentionResult.retention : 0;
  const vat = roundMoney((grossWorksThisCertificate - retention) * vatRate);
  const netPayment = roundMoney(
    grossWorksThisCertificate - retention + recoveryDeductionSigned + vat
  );

  return {
    matrixGrossThisCertificate,
    commercialEventGrossThisCertificate,
    recoveryDeductionSigned,
    grossWorksThisCertificate,
    retention,
    vat,
    netPayment,
    vatRate,
    retentionRate,
    retentionErrors: retentionResult.errors || [],
    cumulativeRetentionHeld: retentionResult.cumulativeRetentionHeld,
    retentionRateChangeDeferred: retentionResult.retentionRateChangeDeferred || false,
  };
}

function buildLiveValuation({
  matrix,
  progress = {},
  commercialLines = [],
  lockedCertificates = [],
  pos = [],
}) {
  const indexed = indexMatrixCells(matrix);
  if (!indexed.ok) {
    return { ok: false, errors: indexed.errors };
  }

  const rates = getPackageVatAndRetentionRates(pos);
  const retentionPosition = cumulativeRetentionPosition(lockedCertificates);
  const cells = [];
  const progressErrors = [];

  for (const indexedCell of indexed.cells) {
    const thisCertificatePct = progressPctForCell(
      progress,
      indexedCell.plotKey,
      indexedCell.stageKey
    );
    const previousCumulativePct = previousCumulativeForCell(
      lockedCertificates,
      indexedCell.plotKey,
      indexedCell.stageKey
    );
    const validation = validateThisCertificatePct(
      previousCumulativePct,
      thisCertificatePct
    );
    if (!validation.valid) {
      progressErrors.push(
        `${indexedCell.plotLabel} / ${indexedCell.stageLabel}: ${validation.errors.join(" ")}`
      );
    }
    const values = calculateCertificateCellValues({
      previousCumulativePct,
      thisCertificatePct: validation.pct,
      contractValue: indexedCell.contractValue,
    });
    cells.push({
      cellId: indexedCell.cellId,
      plotId: indexedCell.plotKey,
      plotKey: indexedCell.plotKey,
      plotLabel: indexedCell.plotLabel,
      houseType: indexedCell.houseType || null,
      stageKey: indexedCell.stageKey,
      stageLabel: indexedCell.stageLabel,
      contractValue: roundMoney(indexedCell.contractValue),
      ...values,
    });
  }

  for (const entry of listProgressEntries(progress)) {
    const plotKey = normalizePlotKey(entry.plotId || entry.plotKey);
    const stageKey = normalizeStageKey(entry.stageKey || entry.stageId);
    if (!plotKey || !stageKey) continue;
    const exists = indexed.cells.some(
      (cell) => cell.plotKey === plotKey && cell.stageKey === stageKey
    );
    if (!exists) {
      progressErrors.push(
        `Progress cell ${plotKey} / ${stageKey} is not in the current order matrix.`
      );
    }
  }

  if (progressErrors.length) {
    return { ok: false, errors: progressErrors, cells };
  }

  const totals = buildCertificateWorksTotals(cells, {
    commercialLines,
    vatRate: rates.vatRate,
    retentionRate: rates.retentionRate,
    ...retentionPosition,
  });

  if (totals.retentionErrors.length) {
    return { ok: false, errors: totals.retentionErrors, cells, totals };
  }

  return {
    ok: true,
    errors: [],
    cells,
    totals,
    indexed,
  };
}

function buildValuationSnapshot({
  matrix,
  progress,
  commercialLines,
  lockedCertificates,
  pos,
  capturedAt,
}) {
  const live = buildLiveValuation({
    matrix,
    progress,
    commercialLines,
    lockedCertificates,
    pos,
  });
  if (!live.ok) return live;

  return {
    ok: true,
    snapshot: {
      snapshotVersion: VALUATION_SNAPSHOT_VERSION,
      capturedAt: capturedAt || new Date().toISOString(),
      matrixId: matrix.id || null,
      matrixVersion: matrix.version ?? null,
      totals: live.totals,
      cells: live.cells,
    },
    totals: live.totals,
    cells: live.cells,
  };
}

module.exports = {
  extractPoVatRate,
  extractPoRetentionRate,
  getPackageVatAndRetentionRates,
  listProgressEntries,
  progressPctForCell,
  previousCumulativeForCell,
  sumValueInclusionLines,
  sumRecoverySignedLines,
  cumulativeRetentionPosition,
  calculateRetentionMovement,
  buildCertificateWorksTotals,
  buildLiveValuation,
  buildValuationSnapshot,
};
