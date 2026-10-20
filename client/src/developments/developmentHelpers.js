import { formatMoney, formatPoDate } from '../components/poDrawerHelpers';
import { getDevelopmentStatusMeta } from './developmentStore';
import { getPlotCount } from './plotMaster';
import { getTotalActualCost, getTransactionCount } from '../ledger/ledgerTransactionStore';
import {
  buildSubcontractOrdersFromPos,
  getPoOrderScopeId,
} from '../payments/subcontractOrders';
import { mergeServerPackagesWithPoOrders } from '../payments/packageIdentityMerge';
import {
  isApprovedCommercialCertificate,
  listCertificates,
} from '../payments/paymentCertificateStore';

function getCertifiedTotalForOrder(orderKey) {
  return listCertificates(orderKey)
    .filter(isApprovedCommercialCertificate)
    .reduce(
      (sum, certificate) =>
        sum + (Number(certificate.netValue) || Number(certificate.grossValue) || 0),
      0
    );
}

export function buildDevelopmentPackageSnapshot(developmentId, pos = [], options = {}) {
  const { serverPackages = null } = options;

  const poOrders = buildSubcontractOrdersFromPos(pos).filter(
    (order) => order.developmentId === developmentId
  );

  const orders = Array.isArray(serverPackages)
    ? mergeServerPackagesWithPoOrders(serverPackages, poOrders)
    : [];

  let certificateCount = 0;
  let certifiedToDate = 0;
  let committedValue = 0;

  for (const order of orders) {
    committedValue += Number(order.committedValue) || 0;
    certificateCount += Number(order.certificateCount) || 0;
    certifiedToDate += getCertifiedTotalForOrder(order.orderKey);
  }

  const purchaseOrderCount = (pos || []).filter((po) => {
    if (po?.archived) return false;
    return getPoOrderScopeId(po) === developmentId;
  }).length;

  return {
    packages: orders,
    packageCount: orders.length,
    certificateCount,
    committedValue,
    certifiedToDate,
    purchaseOrderCount,
  };
}

export function formatDevelopmentListRow(development) {
  const status = getDevelopmentStatusMeta(development.status);
  return {
    ...development,
    statusMeta: status,
    lastUpdatedLabel: formatPoDate(development.updatedAt),
    plotsLabel: String(getPlotCount(development)),
    // packageCount is a create-time payload default, not a maintained aggregate.
    // Do not present its stored zero (or any later stale value) as current evidence.
    packagesLabel: 'Unavailable',
  };
}

export function formatPlotsSummary(plotCount) {
  const count = Number(plotCount) || 0;
  return `${count} plot${count === 1 ? '' : 's'} imported`;
}

export function buildDevelopmentWorkspaceModel(development, options = {}) {
  if (!development) return null;

  const status = getDevelopmentStatusMeta(development.status);
  const plotCount = getPlotCount(development);
  const ledgerTransactionCount = getTransactionCount(development.id);
  const actualCost = getTotalActualCost(development.id);

  const snapshot = buildDevelopmentPackageSnapshot(
    development.id,
    options.pos || [],
    { serverPackages: options.serverPackages ?? null }
  );

  const posReady = options.posReady !== false;
  const packagesReady = options.packagesReady !== false;
  const certificatesReady = options.certificatesReady !== false;
  const packageCount = snapshot.packageCount;
  const certificateCount = snapshot.certificateCount;
  const purchaseOrderCount = posReady ? snapshot.purchaseOrderCount : null;
  const committedValue = snapshot.committedValue;
  const certifiedToDate = snapshot.certifiedToDate;
  const operationalCount = (value, ready) =>
    ready ? String(Number(value) || 0) : 'Unavailable';

  const overallProgress =
    committedValue > 0
      ? `${Math.min(100, Math.round((certifiedToDate / committedValue) * 100))}%`
      : '—';

  return {
    ...development,
    statusMeta: status,
    plotCount,
    ledgerTransactionCount,
    actualCost,
    packages: snapshot.packages,
    packageCount,
    certificateCount,
    purchaseOrderCount,
    committedValue,
    certifiedToDate,
    summaryCards: [
      {
        label: 'Plots',
        value: String(plotCount),
        modifier: 'default',
      },
      {
        label: 'Purchase Orders',
        value: operationalCount(purchaseOrderCount, posReady),
        modifier: 'default',
      },
      {
        label: 'Packages',
        value: operationalCount(packageCount, packagesReady),
        modifier: 'default',
      },
      {
        label: 'Certificates',
        value: operationalCount(certificateCount, certificatesReady),
        modifier: certificatesReady ? 'default' : 'muted',
      },
    ],
    commercialCards: [
      {
        label: 'Committed value',
        value: committedValue > 0 ? `£${formatMoney(committedValue)}` : '—',
      },
      {
        label: 'Certified to date',
        value: certifiedToDate > 0 ? `£${formatMoney(certifiedToDate)}` : '—',
      },
      {
        label: 'Actual cost',
        value: actualCost > 0 ? `£${formatMoney(actualCost)}` : '—',
      },
      { label: 'Overall progress', value: overallProgress },
    ],
  };
}
