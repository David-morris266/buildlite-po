/**
 * BL-024A.1 / BL-024A.2 — Commercial Assistant navigation using existing BuildLite helpers.
 */

import { getCommercialEventById } from '../commercialEvents/commercialEventStore';
import { buildDevelopmentCommercialEventPackageLaunch } from '../commercialEvents/commercialEventDevelopmentRegister';
import { buildCommercialEventTarget } from '../commercialEvents/commercialEventNavigation';
import {
  buildPackageWorkspaceLaunchContext,
  PACKAGE_OPENED_FROM,
  resolvePackageOrderFromList,
} from '../payments/packageWorkspaceLaunch';
import { getCertificate } from '../payments/paymentCertificateStore';
import { COMMERCIAL_ASSISTANT_NAVIGATION_KIND } from './commercialAssistantTypes';

export function buildDevelopmentCommercialEventNavigationTarget({
  developmentId,
  eventId,
  packageId = null,
}) {
  if (!developmentId || !eventId) return null;

  return {
    kind: COMMERCIAL_ASSISTANT_NAVIGATION_KIND.developmentCommercialEvent,
    developmentId,
    eventId,
    packageId,
  };
}

export function buildPackageCertificatesNavigationTarget({
  developmentId,
  orderKey,
  certificateId = null,
}) {
  if (!developmentId || !orderKey) return null;

  return {
    kind: COMMERCIAL_ASSISTANT_NAVIGATION_KIND.packageCertificates,
    developmentId,
    orderKey,
    packageId: orderKey,
    certificateId: certificateId || null,
  };
}

export function buildPackageCommercialEventsNavigationTarget({ developmentId, orderKey }) {
  if (!developmentId || !orderKey) return null;

  return {
    kind: COMMERCIAL_ASSISTANT_NAVIGATION_KIND.packageCommercialEvents,
    developmentId,
    orderKey,
    packageId: orderKey,
  };
}

function resolvePackageLaunchFromTarget(navigationTarget, { developmentId, packages = [] } = {}) {
  const resolvedDevelopmentId = navigationTarget.developmentId || developmentId;
  const packageRow = resolvePackageOrderFromList(packages, navigationTarget.orderKey);

  if (!packageRow) {
    return {
      ok: false,
      errors: ['Package is no longer available'],
      unavailable: true,
    };
  }

  const launch = buildPackageWorkspaceLaunchContext({
    packageRow,
    developmentId: resolvedDevelopmentId,
    openedFrom: PACKAGE_OPENED_FROM.DevelopmentPackages,
    initialTab:
      navigationTarget.kind === COMMERCIAL_ASSISTANT_NAVIGATION_KIND.packageCommercialEvents
        ? 'variations'
        : 'certificates',
    commercialEventTarget: null,
    certificateTarget:
      navigationTarget.certificateId
        ? {
            certificateId: navigationTarget.certificateId,
            navigationKey: `${navigationTarget.certificateId}-${Date.now()}`,
          }
        : null,
  });

  if (launch.identityError) {
    return {
      ok: false,
      errors: [launch.identityError],
      unavailable: true,
    };
  }

  if (navigationTarget.certificateId) {
    const certificate = getCertificate(launch.orderKey, navigationTarget.certificateId);
    if (!certificate) {
      return {
        ok: false,
        errors: ['Certificate is no longer available'],
        unavailable: true,
      };
    }
  }

  return { ok: true, launch, packageRow };
}

export function resolveCommercialAssistantNavigation(
  navigationTarget,
  { developmentId, packages = [] } = {}
) {
  if (!navigationTarget) {
    return { ok: false, errors: ['Navigation target is missing'] };
  }

  if (
    navigationTarget.kind === COMMERCIAL_ASSISTANT_NAVIGATION_KIND.packageCertificates ||
    navigationTarget.kind === COMMERCIAL_ASSISTANT_NAVIGATION_KIND.packageCommercialEvents
  ) {
    return resolvePackageLaunchFromTarget(navigationTarget, { developmentId, packages });
  }

  if (
    navigationTarget.kind !== COMMERCIAL_ASSISTANT_NAVIGATION_KIND.developmentCommercialEvent
  ) {
    return { ok: false, errors: ['Unsupported navigation target'] };
  }

  const resolvedDevelopmentId = navigationTarget.developmentId || developmentId;
  if (!resolvedDevelopmentId) {
    return { ok: false, errors: ['Development context is missing'] };
  }

  const event = getCommercialEventById(resolvedDevelopmentId, navigationTarget.eventId);
  if (!event) {
    return {
      ok: false,
      errors: ['Commercial event is no longer available'],
      unavailable: true,
    };
  }

  const launchResult = buildDevelopmentCommercialEventPackageLaunch({
    event,
    packages,
    developmentId: resolvedDevelopmentId,
    openedFrom: PACKAGE_OPENED_FROM.DevelopmentPackages,
  });

  if (!launchResult.ok) {
    return {
      ok: false,
      errors: launchResult.errors || ['Unable to open the related record'],
      unavailable: true,
    };
  }

  return {
    ok: true,
    kind: 'package-launch',
    launch: launchResult.launch,
    developmentCommercialTarget: buildCommercialEventTarget(event.id, 'view'),
    event,
  };
}
