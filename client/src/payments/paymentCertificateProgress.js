/**
 * BL-011D.02 — Payment Certificate progress engine (Doc 36 / Doc 37).
 */

import { formatMoney } from '../components/poDrawerHelpers';
import { buildPackageCommercialDisplayFields } from '../commercialEvents/commercialEventPackageValue';
import { getPlots } from '../developments/plotMaster';
import { resolveOrderMatrixForPackage } from './orderMatrixStore';
import {
  calculateCertificateCellValues,
  normalizePct,
  resolveThisCertificatePct,
  roundMoney,
  roundPct,
  validateThisCertificatePct as validateThisCertificatePctCore,
} from './paymentCertificateCalculations';
import {
  getCertificate,
  isApprovedCommercialCertificate,
  resolveCertificatesForPackage,
} from './paymentCertificateStore';
import {
  buildValuationGridFromSnapshot,
  getPriorThisCertificatePct,
  getUiCellProgress,
  progressUsesStableIdentity,
  resolveStableIdentityForUiCell,
  sumPreviousStableProgress,
} from './paymentCertificateProgressAdapter';
import {
  calculatePreviousApprovedCommercialEventGross,
  calculatePreviousApprovedGrossWorks,
  formatSignedCommercialLineTotal,
  normalizeCertificateCommercialLines,
  sumValueInclusionCommercialLines,
} from './certificateCommercialLines';
import {
  sumRecoveryDeductionLines,
  sumRecoveryDeductionMagnitudes,
} from './certificateRecoveryLines';

export {
  normalizePct,
  resolveThisCertificatePct,
  calculateCertificateCellValues,
  sumPreviousApprovedProgress,
} from './paymentCertificateCalculations';

export const PROGRESS_PRESETS = [10, 25, 40, 50, 60, 75, 90, 100];

const DEFAULT_RETENTION_RATE = 0.05;
const DEFAULT_VAT_RATE = 0.2;

function readStoredCertificateMoney(value) {
  if (value == null || value === '') return null;
  const parsed = roundMoney(value);
  return Number.isFinite(parsed) ? parsed : null;
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

export function getOrderVatRate(order) {
  const pos = order?.pos?.length
    ? order.pos
    : order?.po
      ? [order.po]
      : [];

  if (!pos.length) return DEFAULT_VAT_RATE;

  let primary = pos[0];
  let maxNet = 0;
  for (const po of pos) {
    const net = Number(po.subtotal) || Number(po.totals?.net) || 0;
    if (net >= maxNet) {
      maxNet = net;
      primary = po;
    }
  }

  return extractPoVatRate(primary);
}

export function getOrderRetentionRate(order) {
  const pos = order?.pos?.length
    ? order.pos
    : order?.po
      ? [order.po]
      : [];

  if (!pos.length) return DEFAULT_RETENTION_RATE;

  let primary = pos[0];
  let maxNet = 0;
  for (const po of pos) {
    const net = Number(po.subtotal) || Number(po.totals?.net) || 0;
    if (net >= maxNet) {
      maxNet = net;
      primary = po;
    }
  }

  return extractPoRetentionRate(primary);
}

function buildPlotMasterLookup(developmentId) {
  const lookup = new Map();
  if (!developmentId) return lookup;

  for (const plot of getPlots(developmentId)) {
    const key = String(plot.plotNumber || '').trim().toLowerCase();
    if (key) lookup.set(key, plot);
  }

  return lookup;
}

function enrichPlotLabel(label, plotMasterLookup) {
  const plot = plotMasterLookup.get(String(label || '').trim().toLowerCase());
  if (!plot) {
    return {
      plotLabel: label,
      houseType: '',
      configuration: '',
    };
  }

  const houseType = String(plot.houseType || '').trim();
  const configuration = String(plot.configuration || '').trim();
  const suffix = [houseType, configuration].filter(Boolean).join(' · ');

  return {
    plotLabel: suffix ? `${label} — ${suffix}` : label,
    houseType,
    configuration,
  };
}

export function buildCellKey(plotIndex, stageIndex) {
  return `${plotIndex}::${stageIndex}`;
}

export function parseCellKey(cellKey) {
  const [plotIndex, stageIndex] = String(cellKey).split('::');
  return {
    plotIndex: Number.parseInt(plotIndex, 10),
    stageIndex: Number.parseInt(stageIndex, 10),
  };
}

export function getCellProgress(certificate, cellKey, matrix = null) {
  return getUiCellProgress(certificate, cellKey, matrix);
}

export function validateThisCertificatePct(previousCumulativePct, rawEntry, options) {
  return validateThisCertificatePctCore(previousCumulativePct, rawEntry, options);
}

function listPriorApprovedCertificates(orderKey, certificate, order = null) {
  const resolved = resolveCertificatesForPackage(orderKey, order);
  return (resolved.ready ? resolved.certificates : []).filter(
    (item) =>
      item.certificateNumber < certificate.certificateNumber &&
      isApprovedCommercialCertificate(item)
  );
}

export function getPreviousProgressForCell(orderKey, certificate, cellKey, options = {}) {
  const { order = null, matrix = null, plotId = null, stageKey = null } = options;
  const prior = listPriorApprovedCertificates(orderKey, certificate, order);
  const useStable =
    Boolean(plotId && stageKey) ||
    progressUsesStableIdentity(certificate?.progress) ||
    prior.some(
      (item) =>
        progressUsesStableIdentity(item.progress) ||
        Array.isArray(item.valuationSnapshot?.cells)
    );

  if (useStable) {
    const identity = resolveStableIdentityForUiCell(cellKey, matrix, plotId, stageKey);
    if (identity.ok) {
      return sumPreviousStableProgress(prior, identity.plotId, identity.stageKey);
    }
  }

  let cumulativePct = 0;
  let lastCertNumber = null;

  for (const priorCert of prior) {
    const pct = getCellProgress(priorCert, cellKey, matrix);
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

export function getCellVisualState({ cumulativePct, thisCertificatePct, hasError, selected }) {
  if (hasError) return 'error';
  if (selected) return 'selected';
  if (cumulativePct >= 100) return 'complete';
  if (cumulativePct > 0 || thisCertificatePct > 0) return 'partial';
  return 'idle';
}

export function buildCertificateCellModel({
  orderKey,
  certificate,
  plotIndex,
  stageIndex,
  plotLabel,
  stageLabel,
  contractValue,
  thisCertificatePct,
  selected = false,
  order = null,
  matrix = null,
  plotId = null,
  stageKey = null,
}) {
  const cellKey = buildCellKey(plotIndex, stageIndex);
  const contract = roundMoney(contractValue);
  const { previousCumulativePct, previousCertificateNumber } =
    getPreviousProgressForCell(orderKey, certificate, cellKey, {
      order,
      matrix,
      plotId,
      stageKey,
    });

  const validation = validateThisCertificatePct(
    previousCumulativePct,
    thisCertificatePct
  );
  const pct = validation.pct;
  const values = calculateCertificateCellValues({
    previousCumulativePct,
    thisCertificatePct: pct,
    contractValue: contract,
  });

  return {
    cellKey,
    plotIndex,
    stageIndex,
    plotLabel,
    stageLabel,
    contractValue: contract,
    previousCumulativePct: values.previousCumulativePct,
    previousCertificateNumber,
    thisCertificatePct: values.thisCertificatePct,
    cumulativePct: values.cumulativePct,
    previousValue: values.previousValue,
    thisCertificateValue: values.thisCertificateValue,
    certifiedToDateValue: values.certifiedToDateValue,
    remainingValue: values.remainingValue,
    errors: validation.errors,
    valid: validation.valid,
    editable: certificate.status === 'draft',
    selected,
    visualState: getCellVisualState({
      cumulativePct: values.cumulativePct,
      thisCertificatePct: pct,
      hasError: !validation.valid,
      selected: false,
    }),
  };
}

export function buildCertificateValuationGrid(
  orderKey,
  certificate,
  matrix,
  selectedKeys = new Set(),
  options = {}
) {
  if (
    !matrix ||
    matrix.layout !== 'plot-stage' ||
    !Array.isArray(matrix.plots) ||
    !Array.isArray(matrix.stages)
  ) {
    return null;
  }

  const plotMasterLookup = buildPlotMasterLookup(options.developmentId);

  const rows = matrix.plots.map((plot, plotIndex) => {
    const enriched = enrichPlotLabel(plot.label || String(plotIndex + 1), plotMasterLookup);
    const cells = matrix.stages.map((stageLabel, stageIndex) => {
      const cellKey = buildCellKey(plotIndex, stageIndex);
      const contractValue = Number(plot.values?.[stageIndex]) || 0;
      const thisCertificatePct = getCellProgress(certificate, cellKey, matrix);

      return buildCertificateCellModel({
        orderKey,
        certificate,
        plotIndex,
        stageIndex,
        plotLabel: enriched.plotLabel,
        houseType: enriched.houseType,
        stageLabel,
        contractValue,
        thisCertificatePct,
        selected: selectedKeys.has(cellKey),
        order: options.order || null,
        matrix,
        plotId: plot.id || null,
        stageKey: stageLabel,
      });
    });

    return {
      plotIndex,
      plotLabel: enriched.plotLabel,
      houseType: enriched.houseType,
      cells,
    };
  });

  return {
    stages: matrix.stages,
    rows,
    cells: rows.flatMap((row) => row.cells),
  };
}

/** Matrix-only totals — preserved for grid/cell logic (BL-025.3). */
export function buildMatrixOnlyCertificateTotals(
  cells,
  contractTotal,
  { vatRate = DEFAULT_VAT_RATE, retentionRate = DEFAULT_RETENTION_RATE } = {}
) {
  const matrixGrossThisCertificate = roundMoney(
    cells.reduce((sum, cell) => sum + cell.thisCertificateValue, 0)
  );
  const previousMatrixCertified = roundMoney(
    cells.reduce((sum, cell) => sum + cell.previousValue, 0)
  );
  const matrixCertifiedToDate = roundMoney(
    cells.reduce((sum, cell) => sum + cell.certifiedToDateValue, 0)
  );
  const retention = roundMoney(matrixGrossThisCertificate * retentionRate);
  const vat = roundMoney((matrixGrossThisCertificate - retention) * vatRate);
  const netPayment = roundMoney(matrixGrossThisCertificate - retention + vat);

  return {
    matrixGrossThisCertificate,
    grossThisCertificate: matrixGrossThisCertificate,
    previousMatrixCertified,
    previousCertified: previousMatrixCertified,
    certifiedToDate: matrixCertifiedToDate,
    remainingContract: roundMoney(Math.max(0, (Number(contractTotal) || 0) - matrixCertifiedToDate)),
    retention,
    vat,
    netPayment,
    contractTotal: roundMoney(contractTotal),
  };
}

/**
 * Combined matrix + commercial-event certificate totals (BL-025.3 / BL-026).
 *
 * Net payment: grossWorks - retention + recoveryDeductionSigned + VAT
 * (recoveryDeductionSigned is negative; e.g. -3000 reduces net by £3,000).
 * Recovery does not reduce grossWorks or retention base.
 */
export function buildCertificateWorksTotals(
  cells,
  {
    commercialLines = [],
    currentContractValue = 0,
    previousGrossWorks = 0,
    previousCommercialEventCertified = 0,
    vatRate = DEFAULT_VAT_RATE,
    retentionRate = DEFAULT_RETENTION_RATE,
  } = {}
) {
  const matrixGrossThisCertificate = roundMoney(
    cells.reduce((sum, cell) => sum + cell.thisCertificateValue, 0)
  );
  const commercialEventGrossThisCertificate =
    sumValueInclusionCommercialLines(commercialLines);
  const grossWorksThisCertificate = roundMoney(
    matrixGrossThisCertificate + commercialEventGrossThisCertificate
  );
  const recoveryDeductionSigned = sumRecoveryDeductionLines(commercialLines);
  const recoveryDeductionMagnitude = sumRecoveryDeductionMagnitudes(commercialLines);

  const previousMatrixCertified = roundMoney(
    cells.reduce((sum, cell) => sum + cell.previousValue, 0)
  );
  const previousCertified = roundMoney(previousGrossWorks);
  const certifiedToDate = roundMoney(previousCertified + grossWorksThisCertificate);
  const contract =
    currentContractValue == null ? null : roundMoney(currentContractValue);
  const remainingContract =
    contract == null ? null : roundMoney(contract - certifiedToDate);
  const retention = roundMoney(grossWorksThisCertificate * retentionRate);
  const vat = roundMoney((grossWorksThisCertificate - retention) * vatRate);
  const netPayment = roundMoney(
    grossWorksThisCertificate - retention + recoveryDeductionSigned + vat
  );

  return {
    matrixGrossThisCertificate,
    commercialEventGrossThisCertificate,
    grossWorksThisCertificate,
    recoveryDeductionSigned,
    recoveryDeductionMagnitude,
    /** @deprecated BL-025.3 alias — use grossWorksThisCertificate */
    grossThisCertificate: grossWorksThisCertificate,
    previousMatrixCertified,
    previousCommercialEventCertified: roundMoney(previousCommercialEventCertified),
    previousCertified,
    certifiedToDate,
    remainingContract,
    currentContractValue: contract,
    retention,
    vat,
    netPayment,
    overCertified: contract != null && certifiedToDate > contract + Number.EPSILON,
    contractTotal: contract,
    contractValueUnavailable: contract == null,
  };
}

/** @deprecated BL-025.3 — use buildCertificateWorksTotals; matrix-only when no CE lines. */
export function buildCertificateCommercialTotals(
  cells,
  contractTotal,
  options = {}
) {
  return buildMatrixOnlyCertificateTotals(cells, contractTotal, options);
}

export function summarizeCertificateProgress(orderKey, certificateId, order = null) {
  const certificate = getCertificate(orderKey, certificateId, order);
  if (!certificate) return null;

  const lockedWithSnapshot =
    isApprovedCommercialCertificate(certificate) &&
    Array.isArray(certificate.valuationSnapshot?.cells) &&
    certificate.valuationSnapshot.cells.length > 0;

  if (lockedWithSnapshot) {
    const grid = buildValuationGridFromSnapshot(certificate);
    const currentContractValue =
      buildPackageCommercialDisplayFields(order || { orderKey }).currentPackageValue;
    const previousGrossWorks = calculatePreviousApprovedGrossWorks(orderKey, certificate);
    const snapshotTotals = certificate.valuationSnapshot?.totals || {};
    const frozenGross =
      readStoredCertificateMoney(certificate.grossValue) ??
      readStoredCertificateMoney(snapshotTotals.grossWorksThisCertificate) ??
      readStoredCertificateMoney(snapshotTotals.grossThisCertificate);
    const frozenNet =
      readStoredCertificateMoney(certificate.netValue) ??
      readStoredCertificateMoney(snapshotTotals.netPayment);

    return {
      certificate,
      grid,
      totals: {
        matrixGrossThisCertificate:
          readStoredCertificateMoney(certificate.matrixGross) ??
          readStoredCertificateMoney(snapshotTotals.matrixGrossThisCertificate) ??
          frozenGross,
        commercialEventGrossThisCertificate:
          readStoredCertificateMoney(certificate.commercialEventGross) ??
          readStoredCertificateMoney(snapshotTotals.commercialEventGrossThisCertificate) ??
          0,
        grossWorksThisCertificate: frozenGross,
        grossThisCertificate: frozenGross,
        recoveryDeductionSigned:
          readStoredCertificateMoney(certificate.recoverySigned) ??
          readStoredCertificateMoney(snapshotTotals.recoveryDeductionSigned) ??
          0,
        recoveryDeductionMagnitude: Math.abs(
          readStoredCertificateMoney(certificate.recoverySigned) ??
            readStoredCertificateMoney(snapshotTotals.recoveryDeductionSigned) ??
            0
        ),
        previousCertified: previousGrossWorks,
        certifiedToDate: roundMoney(previousGrossWorks + (frozenGross || 0)),
        remainingContract:
          currentContractValue == null
            ? null
            : roundMoney(
                roundMoney(currentContractValue) -
                  roundMoney(previousGrossWorks + (frozenGross || 0))
              ),
        retention:
          readStoredCertificateMoney(certificate.retention) ??
          readStoredCertificateMoney(snapshotTotals.retention),
        vat:
          readStoredCertificateMoney(certificate.vat) ??
          readStoredCertificateMoney(snapshotTotals.vat),
        netPayment: frozenNet,
        currentContractValue:
          currentContractValue == null ? null : roundMoney(currentContractValue),
        contractTotal:
          currentContractValue == null ? null : roundMoney(currentContractValue),
        overCertified: false,
      },
      matrix: null,
      matrixReady: true,
      matrixLoadState: 'snapshot',
      matrixError: null,
      frozenTotals: true,
      fromValuationSnapshot: true,
    };
  }

  const matrixResolution = resolveOrderMatrixForPackage(order || orderKey, order?.developmentId);
  const matrixReady = matrixResolution.ready;
  const matrix = matrixReady ? matrixResolution.matrix : null;

  if (!matrixReady) {
    if (
      isApprovedCommercialCertificate(certificate) &&
      certificate.grossValue != null &&
      certificate.netValue != null
    ) {
      const previousGrossWorks = calculatePreviousApprovedGrossWorks(orderKey, certificate);
      return {
        certificate,
        grid: null,
        totals: {
          matrixGrossThisCertificate: roundMoney(certificate.grossValue),
          grossWorksThisCertificate: roundMoney(certificate.grossValue),
          grossThisCertificate: roundMoney(certificate.grossValue),
          netPayment: roundMoney(certificate.netValue),
          previousCertified: previousGrossWorks,
          certifiedToDate: roundMoney(previousGrossWorks + roundMoney(certificate.grossValue)),
          remainingContract: null,
        },
        matrix: null,
        matrixReady: false,
        matrixLoadState: matrixResolution.loadState,
        matrixError: matrixResolution.error || null,
        frozenTotals: true,
      };
    }

    return {
      certificate,
      grid: null,
      totals: null,
      matrix: null,
      matrixReady: false,
      matrixLoadState: matrixResolution.loadState,
      matrixError: matrixResolution.error || null,
    };
  }

  const grid = buildCertificateValuationGrid(orderKey, certificate, matrix, new Set(), {
    developmentId: order?.developmentId,
    order,
  });
  if (!grid) return null;

  const currentContractValue =
    buildPackageCommercialDisplayFields(order || { orderKey }).currentPackageValue;
  const contractValueUnavailable = currentContractValue == null;
  const previousGrossWorks = calculatePreviousApprovedGrossWorks(orderKey, certificate);
  const previousCommercialEventCertified =
    calculatePreviousApprovedCommercialEventGross(orderKey, certificate);

  const vatRate = getOrderVatRate(order);
  const retentionRate = getOrderRetentionRate(order);

  let totals = buildCertificateWorksTotals(grid.cells, {
    commercialLines: normalizeCertificateCommercialLines(certificate),
    currentContractValue,
    previousGrossWorks,
    previousCommercialEventCertified,
    vatRate,
    retentionRate,
  });

  if (
    isApprovedCommercialCertificate(certificate) &&
    certificate.grossValue != null &&
    certificate.netValue != null &&
    !contractValueUnavailable
  ) {
    totals = {
      ...totals,
      grossWorksThisCertificate: roundMoney(certificate.grossValue),
      grossThisCertificate: roundMoney(certificate.grossValue),
      netPayment: roundMoney(certificate.netValue),
      previousCertified: previousGrossWorks,
      certifiedToDate: roundMoney(previousGrossWorks + roundMoney(certificate.grossValue)),
      remainingContract: roundMoney(
        roundMoney(currentContractValue) - roundMoney(previousGrossWorks + certificate.grossValue)
      ),
      overCertified:
        roundMoney(previousGrossWorks + certificate.grossValue) >
        roundMoney(currentContractValue) + Number.EPSILON,
    };
  }

  return {
    certificate,
    grid,
    totals,
    matrix,
    matrixReady: true,
    matrixLoadState: 'loaded',
    matrixError: null,
  };
}

export function buildCommercialEventsPreview(certificate) {
  const lines = normalizeCertificateCommercialLines(certificate);
  const total = sumValueInclusionCommercialLines(lines);

  return {
    label: 'Commercial Events this certificate',
    value: formatSignedCommercialLineTotal(total),
    total,
    lineCount: lines.length,
  };
}

export function formatPctLabel(value) {
  const n = normalizePct(value);
  return `${n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)}%`;
}

export function formatMoneyLabel(value) {
  if (value == null || value === '') return '—';
  return `£${formatMoney(value)}`;
}

export function buildCommercialSummaryItems(totals, { matrixReady = true } = {}) {
  if (!matrixReady && !totals) {
    return [
      { label: 'Matrix valuation', value: 'Loading matrix data…' },
      { label: 'Gross this certificate', value: 'Loading matrix data…' },
      { label: 'Previous certified', value: '—' },
      { label: 'Certified to date', value: '—' },
      { label: 'Remaining contract', value: '—' },
      { label: 'Retention', value: '—' },
      { label: 'VAT', value: '—' },
      { label: 'Net payment', value: '—' },
    ];
  }

  if (!totals) {
    return [
      { label: 'Matrix valuation', value: '—' },
      { label: 'Gross this certificate', value: '—' },
      { label: 'Previous certified', value: '—' },
      { label: 'Certified to date', value: '—' },
      { label: 'Remaining contract', value: '—' },
      { label: 'Retention', value: '—' },
      { label: 'VAT', value: '—' },
      { label: 'Net payment', value: '—' },
    ];
  }

  const items = [
    {
      label: 'Matrix valuation',
      value: formatMoneyLabel(totals.matrixGrossThisCertificate),
    },
  ];

  if (totals.commercialEventGrossThisCertificate) {
    items.push({
      label: 'Commercial Events',
      value: formatSignedCommercialLineTotal(totals.commercialEventGrossThisCertificate),
    });
  }

  if (totals.recoveryDeductionMagnitude) {
    items.push({
      label: 'Recovery deductions',
      value: `−£${formatMoney(totals.recoveryDeductionMagnitude)}`,
    });
  }

  items.push(
    {
      label: 'Gross this certificate',
      value: formatMoneyLabel(totals.grossWorksThisCertificate ?? totals.grossThisCertificate),
      emphasis: true,
    },
    {
      label: 'Previous certified',
      value: formatMoneyLabel(totals.previousCertified),
    },
    {
      label: 'Certified to date',
      value: formatMoneyLabel(totals.certifiedToDate),
    },
    {
      label: 'Remaining contract',
      value: formatMoneyLabel(totals.remainingContract),
      modifier: totals.overCertified ? 'warning' : null,
    },
    {
      label: 'Retention',
      value: formatMoneyLabel(totals.retention),
    },
    { label: 'VAT', value: formatMoneyLabel(totals.vat) },
    {
      label: 'Net payment',
      value: formatMoneyLabel(totals.netPayment),
    }
  );

  return items;
}

export function getPreviousCertificationDetails(orderKey, certificate, cellKeys, options = {}) {
  const { order = null, matrix = null } = options;
  const prior = listPriorApprovedCertificates(orderKey, certificate, order);

  return cellKeys.map((cellKey) => {
    const identity = resolveStableIdentityForUiCell(cellKey, matrix);
    const entries = prior
      .map((priorCert) => ({
        certificateNumber: priorCert.certificateNumber,
        thisCertificatePct: identity.ok
          ? getPriorThisCertificatePct(priorCert, identity.plotId, identity.stageKey)
          : getCellProgress(priorCert, cellKey, matrix),
      }))
      .filter((entry) => entry.thisCertificatePct > 0);

    const { previousCumulativePct, previousCertificateNumber } =
      getPreviousProgressForCell(orderKey, certificate, cellKey, { order, matrix });

    return {
      cellKey,
      previousCumulativePct,
      previousCertificateNumber,
      entries,
    };
  });
}
