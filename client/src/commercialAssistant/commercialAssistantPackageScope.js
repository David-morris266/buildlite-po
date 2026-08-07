/**
 * BL-024A.2.1 — Resolve Commercial Assistant scope from package workspace context.
 */

import { resolvePackageDevelopmentId } from '../commercialEvents/commercialEventPackageValue';

export function resolveOrderDevelopmentId(order) {
  return resolvePackageDevelopmentId(order);
}

export function buildAssistantPackagesForDevelopment(developmentId, packageRows = []) {
  if (!developmentId || !Array.isArray(packageRows)) return [];

  return packageRows.filter((row) => {
    if (!row?.orderKey) return false;
    if (row.developmentId) return row.developmentId === developmentId;
    return row.orderKey.startsWith(`${developmentId}::`);
  });
}

export function buildAssistantScopeFromOrder(
  order,
  { developmentPackages = [], onNavigate = null } = {}
) {
  const developmentId = resolveOrderDevelopmentId(order);
  if (!developmentId) return null;

  const resolvedPackages = buildAssistantPackagesForDevelopment(
    developmentId,
    developmentPackages.length ? developmentPackages : order ? [order] : []
  );

  return {
    developmentId,
    packages: resolvedPackages,
    onNavigate: typeof onNavigate === 'function' ? onNavigate : null,
  };
}

export function buildAssistantPackageOrderKeys(packages = []) {
  return packages
    .map((row) => row?.orderKey || '')
    .filter(Boolean)
    .sort()
    .join('|');
}
