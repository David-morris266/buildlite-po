/**
 * BL-024A.1 — Commercial Assistant navigation using existing BuildLite helpers.
 */

import { getCommercialEventById } from '../commercialEvents/commercialEventStore';
import { buildDevelopmentCommercialEventPackageLaunch } from '../commercialEvents/commercialEventDevelopmentRegister';
import { buildCommercialEventTarget } from '../commercialEvents/commercialEventNavigation';
import { PACKAGE_OPENED_FROM } from '../payments/packageWorkspaceLaunch';
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

export function resolveCommercialAssistantNavigation(
  navigationTarget,
  { developmentId, packages = [] } = {}
) {
  if (!navigationTarget) {
    return { ok: false, errors: ['Navigation target is missing'] };
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
