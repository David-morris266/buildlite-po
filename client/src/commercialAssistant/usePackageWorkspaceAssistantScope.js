/**
 * BL-024A.2.1 — Bind Commercial Assistant scope while a package workspace is open.
 */

import { useMemo } from 'react';
import { useCommercialAssistantScope } from './CommercialAssistantContext';
import {
  buildAssistantPackageOrderKeys,
  buildAssistantPackagesForDevelopment,
  resolveOrderDevelopmentId,
} from './commercialAssistantPackageScope';

function resolveDevelopmentPackagesKey(developmentId, developmentPackages) {
  if (!developmentId || !Array.isArray(developmentPackages) || !developmentPackages.length) {
    return '';
  }

  return buildAssistantPackageOrderKeys(
    buildAssistantPackagesForDevelopment(developmentId, developmentPackages)
  );
}

export function usePackageWorkspaceAssistantScope(
  order,
  {
    developmentPackages = null,
    onNavigate = null,
    enabled = true,
  } = {}
) {
  const developmentId = resolveOrderDevelopmentId(order);
  const developmentPackagesKey = resolveDevelopmentPackagesKey(
    developmentId,
    developmentPackages
  );
  const orderKey = order?.orderKey || '';

  const packages = useMemo(() => {
    if (!developmentId) return [];
    if (developmentPackagesKey) {
      return buildAssistantPackagesForDevelopment(developmentId, developmentPackages);
    }
    return order ? [order] : [];
  }, [developmentId, developmentPackagesKey, orderKey, developmentPackages, order]);

  useCommercialAssistantScope(
    developmentId
      ? {
          developmentId,
          packages,
          onNavigate,
        }
      : { developmentId: null, packages: [], onNavigate: null },
    [developmentId, developmentPackagesKey || orderKey, onNavigate],
    { enabled: enabled && Boolean(developmentId) }
  );

  return { developmentId, packages };
}
