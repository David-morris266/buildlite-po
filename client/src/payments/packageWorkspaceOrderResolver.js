/**
 * BL-027B.3.1b — Canonical package workspace order resolution.
 *
 * Distinguishes list-display merge rows from commercially complete workspace orders.
 */

import { mergeServerPackagesWithPoOrders } from './packageIdentityMerge';

export function packageReferencesPoNumbers(pkg) {
  return Array.isArray(pkg?.poNumbers) && pkg.poNumbers.length > 0;
}

export function isCommercialContextReady(order, { serverPackage = null } = {}) {
  if (!order) return false;

  const referencesPos = packageReferencesPoNumbers(serverPackage || order);
  if (!referencesPos) {
    return true;
  }

  return Array.isArray(order.pos) && order.pos.length > 0;
}

export function resolvePackageWorkspaceOrder({
  orderKey,
  serverPackages = [],
  poOrders = [],
  poLoading = false,
  packagesLoading = false,
} = {}) {
  if (!orderKey) {
    return {
      status: 'incomplete',
      order: null,
      reason: 'missing-order-key',
      message: 'Unable to resolve package identity.',
    };
  }

  if (packagesLoading) {
    return {
      status: 'loading',
      order: null,
      reason: 'awaiting-server-packages',
      message: null,
    };
  }

  const serverPkg =
    (serverPackages || []).find((pkg) => pkg.orderKey === orderKey) || null;
  const poOrder = (poOrders || []).find((order) => order.orderKey === orderKey) || null;

  if (poLoading && serverPkg && packageReferencesPoNumbers(serverPkg)) {
    return {
      status: 'loading',
      order: null,
      reason: 'awaiting-po-context',
      message: null,
    };
  }

  let order = null;

  if (serverPkg) {
    [order] = mergeServerPackagesWithPoOrders([serverPkg], poOrders || []);
  } else if (poOrder) {
    order = poOrder;
  }

  if (!order) {
    return {
      status: 'incomplete',
      order: null,
      reason: 'package-not-found',
      message:
        'Package not found. It may have been removed or is no longer available.',
    };
  }

  const needsPoContext = packageReferencesPoNumbers(serverPkg || order);

  if (needsPoContext && !isCommercialContextReady(order, { serverPackage: serverPkg })) {
    return {
      status: 'incomplete',
      order,
      reason: 'unresolved-po-context',
      message:
        'Purchase order data for this package is unavailable. Return to Packages and try again.',
    };
  }

  return {
    status: 'ready',
    order,
    reason: null,
    message: null,
  };
}

/**
 * Payment Certificates — PO list authority (no server package merge required).
 */
export function resolvePackageWorkspaceOrderFromPoList({
  orderKey,
  poOrders = [],
  poLoading = false,
} = {}) {
  if (!orderKey) {
    return {
      status: 'incomplete',
      order: null,
      reason: 'missing-order-key',
      message: 'Unable to resolve package identity.',
    };
  }

  if (poLoading) {
    return {
      status: 'loading',
      order: null,
      reason: 'awaiting-po-list',
      message: null,
    };
  }

  const order = (poOrders || []).find((item) => item.orderKey === orderKey) || null;

  if (!order) {
    return {
      status: 'incomplete',
      order: null,
      reason: 'package-not-found',
      message:
        'Package not found. It may have been removed or is no longer available.',
    };
  }

  return {
    status: 'ready',
    order,
    reason: null,
    message: null,
  };
}

export function compareCommercialWorkspaceOrders(developmentOrder, certificatesOrder) {
  if (!developmentOrder || !certificatesOrder) {
    return { equivalent: false, differences: ['missing-order'] };
  }

  const fields = [
    'orderKey',
    'developmentId',
    'supplierId',
    'committedValue',
  ];
  const differences = [];

  for (const field of fields) {
    if (developmentOrder[field] !== certificatesOrder[field]) {
      differences.push(field);
    }
  }

  const devPoNumbers = [...(developmentOrder.poNumbers || [])].sort();
  const certPoNumbers = [...(certificatesOrder.poNumbers || [])].sort();
  if (JSON.stringify(devPoNumbers) !== JSON.stringify(certPoNumbers)) {
    differences.push('poNumbers');
  }

  return {
    equivalent: differences.length === 0,
    differences,
  };
}
