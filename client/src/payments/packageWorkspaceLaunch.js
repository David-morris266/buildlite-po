import { buildSubcontractOrderKey } from './packageKeyMigration';

export const PACKAGE_OPENED_FROM = {
  DevelopmentPackages: 'DevelopmentPackages',
  PaymentCertificates: 'PaymentCertificates',
  CommercialEventLink: 'CommercialEventLink',
};

/**
 * Build launch context for SubcontractPackageWorkspace from a development package row.
 */
export function buildPackageWorkspaceLaunchContext({
  packageRow = null,
  orderKey = null,
  openedFrom,
  initialTab = 'overview',
  developmentId = null,
  commercialEventTarget = null,
}) {
  const resolvedDevelopmentId =
    developmentId || packageRow?.developmentId || null;
  const supplierId = packageRow?.supplierId || null;
  const costCode = packageRow?.costCode ?? null;
  const resolvedOrderKey =
    orderKey ||
    packageRow?.orderKey ||
    (resolvedDevelopmentId && supplierId
      ? buildSubcontractOrderKey(resolvedDevelopmentId, supplierId, costCode)
      : null);

  const identityError = validatePackageLaunchIdentity({
    developmentId: resolvedDevelopmentId,
    supplierId,
    costCode,
    orderKey: resolvedOrderKey,
  });

  return {
    orderKey: resolvedOrderKey,
    developmentId: resolvedDevelopmentId,
    supplierId,
    costCode,
    openedFrom,
    initialTab: resolvePackageWorkspaceInitialTab(openedFrom, initialTab),
    commercialEventTarget: commercialEventTarget || null,
    identityError,
  };
}

export function validatePackageLaunchIdentity({
  developmentId,
  supplierId,
  costCode,
  orderKey,
}) {
  if (!developmentId) {
    return 'This package is missing development identity.';
  }
  if (!supplierId) {
    return 'This package is missing a supplier ID.';
  }
  if (costCode == null || String(costCode).trim() === '') {
    return 'This package is missing a cost code.';
  }
  if (!orderKey) {
    return 'Unable to resolve package identity.';
  }
  return null;
}

export function resolvePackageWorkspaceInitialTab(openedFrom, requestedTab) {
  if (requestedTab) return requestedTab;
  if (openedFrom === PACKAGE_OPENED_FROM.DevelopmentPackages) return 'overview';
  if (openedFrom === PACKAGE_OPENED_FROM.PaymentCertificates) return 'overview';
  return 'overview';
}

export function resolvePackageOrderFromList(packages, orderKey) {
  if (!orderKey || !Array.isArray(packages)) return null;
  return packages.find((pkg) => pkg.orderKey === orderKey) || null;
}

export function getPackageLaunchErrorMessage(launchContext, order) {
  if (launchContext?.identityError) return launchContext.identityError;
  if (!order) {
    return 'Package not found. It may have been removed or is no longer available.';
  }
  return null;
}

export function resolvePackageWorkspaceBackTarget(openedFrom) {
  if (openedFrom === PACKAGE_OPENED_FROM.DevelopmentPackages) {
    return 'development-packages';
  }
  if (openedFrom === PACKAGE_OPENED_FROM.PaymentCertificates) {
    return 'payment-certificates-list';
  }
  if (openedFrom === PACKAGE_OPENED_FROM.CommercialEventLink) {
    return 'commercial-event-link';
  }
  return 'unknown';
}
