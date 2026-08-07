/**
 * BL-021B.3.1 — Linked commercial event navigation helpers (read-only).
 */

import { parseSubcontractOrderKey } from '../payments/packageKeyMigration';
import {
  PACKAGE_OPENED_FROM,
  buildPackageWorkspaceLaunchContext,
  resolvePackageOrderFromList,
} from '../payments/packageWorkspaceLaunch';
import { getCommercialEventById } from './commercialEventStore';
import { getLinkedCommercialEvent } from './commercialEventRecovery';
import { isRecoveryCommercialEvent } from './commercialEventRegisterBadges';

export const COMMERCIAL_EVENTS_PACKAGE_TAB = 'variations';

export function buildCommercialEventTarget(eventId, mode = 'view', navigationKey = null) {
  if (!eventId) return null;
  return {
    eventId,
    mode,
    navigationKey: navigationKey ?? `${eventId}-${Date.now()}`,
  };
}

export function createCommercialEventNavigationSnapshot(packageLaunch, eventId) {
  if (!packageLaunch || !eventId) return null;

  return {
    kind: 'package',
    packageLaunch: {
      ...packageLaunch,
      initialTab: COMMERCIAL_EVENTS_PACKAGE_TAB,
      commercialEventTarget: buildCommercialEventTarget(eventId, 'view'),
    },
  };
}

export function buildLinkedCommercialEventLaunch({
  packages = [],
  linkedEvent,
  developmentId,
  openedFrom = PACKAGE_OPENED_FROM.CommercialEventLink,
}) {
  if (!linkedEvent) {
    return { ok: false, errors: ['Linked commercial event not found'] };
  }

  if (!linkedEvent.packageId) {
    return { ok: false, errors: ['Linked event is missing package identity'] };
  }

  const parsed = parseSubcontractOrderKey(linkedEvent.packageId);
  if (!parsed || parsed.legacy) {
    return { ok: false, errors: ['Linked event package identity is invalid'] };
  }

  if (developmentId && parsed.developmentId !== developmentId) {
    return { ok: false, errors: ['Linked event belongs to a different development'] };
  }

  const packageRow = resolvePackageOrderFromList(packages, linkedEvent.packageId);
  if (!packageRow) {
    return {
      ok: false,
      errors: ['Responsible package not found. It may no longer be available.'],
    };
  }

  const launch = buildPackageWorkspaceLaunchContext({
    packageRow,
    orderKey: linkedEvent.packageId,
    developmentId: developmentId || parsed.developmentId,
    openedFrom,
    initialTab: COMMERCIAL_EVENTS_PACKAGE_TAB,
    commercialEventTarget: buildCommercialEventTarget(linkedEvent.id, 'view'),
  });

  if (launch.identityError) {
    return { ok: false, errors: [launch.identityError] };
  }

  return { ok: true, launch };
}

export function resolveLinkedCommercialEventNavigation({
  developmentId,
  sourceEvent,
  currentPackageId,
  packages = [],
}) {
  if (!developmentId || !sourceEvent) {
    return { ok: false, errors: ['Commercial event context is missing'] };
  }

  const linkedEvent = getLinkedCommercialEvent(developmentId, sourceEvent);
  if (!linkedEvent) {
    return { ok: false, errors: ['Related commercial event is no longer available'] };
  }

  if (linkedEvent.packageId === currentPackageId) {
    return {
      ok: true,
      kind: 'same-package',
      linkedEvent,
    };
  }

  const launchResult = buildLinkedCommercialEventLaunch({
    packages,
    linkedEvent,
    developmentId,
  });

  if (!launchResult.ok) {
    return { ok: false, errors: launchResult.errors };
  }

  return {
    ok: true,
    kind: 'cross-package',
    linkedEvent,
    launch: launchResult.launch,
  };
}

export function getLinkedEventNavigationLabel(sourceEvent) {
  return isRecoveryCommercialEvent(sourceEvent) ? 'Open Origin Event' : 'Open Related Event';
}

export function readCommercialEventForNavigation(developmentId, eventId) {
  if (!developmentId || !eventId) return null;
  return getCommercialEventById(developmentId, eventId);
}
