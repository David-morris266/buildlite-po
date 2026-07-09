/**
 * BL-011D.01 — Payment Certificate view models (Doc 36).
 */

import { formatMoney, formatPoDate } from '../components/poDrawerHelpers';
import {
  getCertificateCount,
  getCertificateStatusMeta,
} from './paymentCertificateStore';
import {
  formatMoneyLabel,
  summarizeCertificateProgress,
} from './paymentCertificateProgress';
import {
  getCertificateListAction,
  getCreateCertificateState,
} from './paymentCertificateApproval';

export function getPackageDisplayName(order) {
  if (!order) return 'Subcontract Package';
  return `${order.supplierLabel || 'Subcontract'} Package`;
}

export function getPackageDevelopmentName(order) {
  return (
    order?.developmentName ||
    order?.projectLabel ||
    '—'
  );
}

export function buildCertificateWorkspaceModel(order, pkg) {
  if (!order || !pkg) return null;

  const certificateCount = getCertificateCount(order.orderKey);

  return {
    packageName: getPackageDisplayName(order),
    supplierLabel: order.supplierLabel || '—',
    developmentName: getPackageDevelopmentName(order),
    status: pkg.status,
    contractValue: pkg.adjustedContract,
    certifiedToDate: pkg.certifiedToDate,
    remainingValue: pkg.remaining,
    certificateCount,
    packageStatusLabel: pkg.status?.label || '—',
    summaryCards: [
      {
        label: 'Contract Value',
        value: formatMoneyPlaceholder(pkg.adjustedContract),
        modifier: 'default',
      },
      {
        label: 'Certified to Date',
        value: formatMoneyPlaceholder(pkg.certifiedToDate, true),
        modifier: 'muted',
      },
      {
        label: 'Remaining Value',
        value: formatMoneyPlaceholder(pkg.remaining),
        modifier: 'accent',
      },
      {
        label: 'Certificate Count',
        value: String(certificateCount),
        modifier: 'default',
      },
      {
        label: 'Package Status',
        value: pkg.status?.label || '—',
        modifier: pkg.status?.modifier || 'default',
        isBadge: true,
        status: pkg.status,
      },
    ],
  };
}

export function buildCertificateDetailModel(certificate, order, pkg) {
  if (!certificate || !order || !pkg) return null;

  const status = getCertificateStatusMeta(certificate.status);

  return {
    certificateNumber: certificate.certificateNumber,
    status,
    certificateDate: formatPoDate(certificate.certificateDate),
    packageName: getPackageDisplayName(order),
    supplierLabel: order.supplierLabel || '—',
    developmentName: getPackageDevelopmentName(order),
    commercialSummary: [
      { label: 'Gross This Certificate', value: '—' },
      { label: 'Previous Certified', value: '—' },
      { label: 'Certified To Date', value: '—' },
      { label: 'Remaining Contract', value: '—' },
      { label: 'Retention', value: '—' },
      { label: 'VAT', value: '—' },
      { label: 'Net Payment', value: '—' },
    ],
  };
}

export function formatCertificateListRow(certificate, orderKey, order = null) {
  const status = getCertificateStatusMeta(certificate.status);

  let grossLabel = formatMoneyPlaceholder(certificate.grossValue, true);
  let netLabel = formatMoneyPlaceholder(certificate.netValue, true);

  if (
    orderKey &&
    certificate.progress &&
    Object.keys(certificate.progress).length > 0
  ) {
    const summary = summarizeCertificateProgress(orderKey, certificate.id, order);
    if (summary?.totals) {
      grossLabel = formatMoneyLabel(summary.totals.grossThisCertificate);
      netLabel = formatMoneyLabel(summary.totals.netPayment);
    }
  }

  return {
    ...certificate,
    statusMeta: status,
    dateLabel: formatPoDate(certificate.certificateDate),
    grossLabel,
    netLabel,
    approvedByLabel: certificate.approvedBy || '—',
    canDelete: certificate.status === 'draft',
    listAction: getCertificateListAction(certificate),
  };
}

function formatMoneyPlaceholder(value, allowZero = false) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (!allowZero && n === 0) return '—';
  return `£${formatMoney(n)}`;
}

export function getCreateCertificateLabel(orderKey, certificateCount) {
  return getCreateCertificateState(orderKey, certificateCount).label;
}
