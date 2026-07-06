/**
 * BL-011D.02 — Payment Certificate progress engine (Doc 36 / Doc 37).
 */

import { formatMoney } from '../components/poDrawerHelpers';
import { loadOrderMatrix } from './orderMatrixStore';
import {
  getCertificate,
  isApprovedCommercialCertificate,
  listCertificates,
} from './paymentCertificateStore';

export const PROGRESS_PRESETS = [10, 25, 40, 50, 60, 75, 90, 100];

const RETENTION_RATE = 0.05;
const VAT_RATE = 0.2;

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

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function roundPct(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizePct(value) {
  const n = Number.parseFloat(String(value));
  if (!Number.isFinite(n)) return 0;
  return roundPct(n);
}

export function getCellProgress(certificate, cellKey) {
  return certificate?.progress?.[cellKey]?.thisCertificatePct ?? 0;
}

export function getPreviousProgressForCell(orderKey, certificate, cellKey) {
  const prior = listCertificates(orderKey).filter(
    (item) =>
      item.certificateNumber < certificate.certificateNumber &&
      isApprovedCommercialCertificate(item)
  );

  let cumulativePct = 0;
  let lastCertNumber = null;

  for (const priorCert of prior) {
    const pct = getCellProgress(priorCert, cellKey);
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

export function validateThisCertificatePct(previousCumulativePct, thisCertificatePct) {
  const pct = normalizePct(thisCertificatePct);
  const errors = [];

  if (pct < 0) {
    errors.push('Progress cannot be negative.');
  }

  if (pct + previousCumulativePct > 100.005) {
    errors.push('Progress cannot exceed 100% cumulative.');
  }

  return { pct, errors, valid: errors.length === 0 };
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
}) {
  const cellKey = buildCellKey(plotIndex, stageIndex);
  const contract = roundMoney(contractValue);
  const { previousCumulativePct, previousCertificateNumber } =
    getPreviousProgressForCell(orderKey, certificate, cellKey);

  const validation = validateThisCertificatePct(
    previousCumulativePct,
    thisCertificatePct
  );
  const pct = validation.pct;
  const cumulativePct = roundPct(Math.min(100, previousCumulativePct + pct));
  const previousValue = roundMoney((contract * previousCumulativePct) / 100);
  const thisCertificateValue = roundMoney((contract * pct) / 100);
  const certifiedToDateValue = roundMoney((contract * cumulativePct) / 100);
  const remainingValue = roundMoney(Math.max(0, contract - certifiedToDateValue));

  return {
    cellKey,
    plotIndex,
    stageIndex,
    plotLabel,
    stageLabel,
    contractValue: contract,
    previousCumulativePct,
    previousCertificateNumber,
    thisCertificatePct: pct,
    cumulativePct,
    previousValue,
    thisCertificateValue,
    certifiedToDateValue,
    remainingValue,
    errors: validation.errors,
    valid: validation.valid,
    editable: certificate.status === 'draft',
    selected,
    visualState: getCellVisualState({
      cumulativePct,
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
  selectedKeys = new Set()
) {
  if (
    !matrix ||
    matrix.layout !== 'plot-stage' ||
    !Array.isArray(matrix.plots) ||
    !Array.isArray(matrix.stages)
  ) {
    return null;
  }

  const rows = matrix.plots.map((plot, plotIndex) => {
    const cells = matrix.stages.map((stageLabel, stageIndex) => {
      const cellKey = buildCellKey(plotIndex, stageIndex);
      const contractValue = Number(plot.values?.[stageIndex]) || 0;
      const thisCertificatePct = getCellProgress(certificate, cellKey);

      return buildCertificateCellModel({
        orderKey,
        certificate,
        plotIndex,
        stageIndex,
        plotLabel: plot.label || String(plotIndex + 1),
        stageLabel,
        contractValue,
        thisCertificatePct,
        selected: selectedKeys.has(cellKey),
      });
    });

    return {
      plotIndex,
      plotLabel: plot.label || String(plotIndex + 1),
      cells,
    };
  });

  return {
    stages: matrix.stages,
    rows,
    cells: rows.flatMap((row) => row.cells),
  };
}

export function buildCertificateCommercialTotals(cells, contractTotal) {
  const grossThisCertificate = roundMoney(
    cells.reduce((sum, cell) => sum + cell.thisCertificateValue, 0)
  );
  const previousCertified = roundMoney(
    cells.reduce((sum, cell) => sum + cell.previousValue, 0)
  );
  const certifiedToDate = roundMoney(
    cells.reduce((sum, cell) => sum + cell.certifiedToDateValue, 0)
  );
  const remainingContract = roundMoney(
    Math.max(0, (Number(contractTotal) || 0) - certifiedToDate)
  );
  const retention = roundMoney(grossThisCertificate * RETENTION_RATE);
  const vat = roundMoney((grossThisCertificate - retention) * VAT_RATE);
  const netPayment = roundMoney(grossThisCertificate - retention + vat);

  return {
    grossThisCertificate,
    previousCertified,
    certifiedToDate,
    remainingContract,
    retention,
    vat,
    netPayment,
    contractTotal: roundMoney(contractTotal),
  };
}

export function summarizeCertificateProgress(orderKey, certificateId) {
  const certificate = getCertificate(orderKey, certificateId);
  if (!certificate) return null;

  const matrix = loadOrderMatrix(orderKey);
  const grid = buildCertificateValuationGrid(orderKey, certificate, matrix);
  if (!grid) return null;

  const contractTotal = grid.cells.reduce(
    (sum, cell) => sum + cell.contractValue,
    0
  );
  const totals = buildCertificateCommercialTotals(grid.cells, contractTotal);

  return {
    certificate,
    grid,
    totals,
    matrix,
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

export function buildCommercialSummaryItems(totals) {
  if (!totals) {
    return [
      { label: 'Gross This Certificate', value: '—' },
      { label: 'Previous Certified', value: '—' },
      { label: 'Certified To Date', value: '—' },
      { label: 'Remaining Contract', value: '—' },
      { label: 'Retention', value: '—' },
      { label: 'VAT', value: '—' },
      { label: 'Net Payment', value: '—' },
    ];
  }

  return [
    {
      label: 'Gross This Certificate',
      value: formatMoneyLabel(totals.grossThisCertificate),
    },
    {
      label: 'Previous Certified',
      value: formatMoneyLabel(totals.previousCertified),
    },
    {
      label: 'Certified To Date',
      value: formatMoneyLabel(totals.certifiedToDate),
    },
    {
      label: 'Remaining Contract',
      value: formatMoneyLabel(totals.remainingContract),
    },
    {
      label: 'Retention',
      value: formatMoneyLabel(totals.retention),
    },
    { label: 'VAT', value: formatMoneyLabel(totals.vat) },
    { label: 'Net Payment', value: formatMoneyLabel(totals.netPayment) },
  ];
}

export function getPreviousCertificationDetails(orderKey, certificate, cellKeys) {
  const prior = listCertificates(orderKey).filter(
    (item) =>
      item.certificateNumber < certificate.certificateNumber &&
      isApprovedCommercialCertificate(item)
  );

  return cellKeys.map((cellKey) => {
    const entries = prior
      .map((priorCert) => ({
        certificateNumber: priorCert.certificateNumber,
        thisCertificatePct: getCellProgress(priorCert, cellKey),
      }))
      .filter((entry) => entry.thisCertificatePct > 0);

    const { previousCumulativePct, previousCertificateNumber } =
      getPreviousProgressForCell(orderKey, certificate, cellKey);

    return {
      cellKey,
      previousCumulativePct,
      previousCertificateNumber,
      entries,
    };
  });
}
