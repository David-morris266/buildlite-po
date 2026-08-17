/**
 * BL-021B.3.3 — Package-level recovery KPI helpers (display only).
 * Uses Commercial Events for the current package only; does not alter certificates or CVR.
 */

import { listCommercialEventsByPackage } from './commercialEventStore';
import { resolvePackageDevelopmentId } from './commercialEventPackageValue';
import { getCommercialEventRecoveryPresentation } from './commercialEventRecoveryOverlay';
import { isRecoveryCommercialEvent } from './commercialEventRegisterBadges';
import {
  COMMERCIAL_EVENT_RECOVERY_STATUSES,
  COMMERCIAL_EVENT_STATUSES,
  normalizeRecoveryStatusKey,
  PACKAGE_VALUE_STATUSES,
} from './commercialEventTypes';

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Recovery statuses that close an item for open-item counting (BL-021B.3.3). */
export const TERMINAL_RECOVERY_STATUSES = new Set([
  COMMERCIAL_EVENT_RECOVERY_STATUSES.fullyRecovered.key,
  COMMERCIAL_EVENT_RECOVERY_STATUSES.closed.key,
  COMMERCIAL_EVENT_RECOVERY_STATUSES.writtenOff.key,
]);

export function filterPackageRecoveryEvents(events) {
  return (events || []).filter((event) => {
    if (!isRecoveryCommercialEvent(event)) return false;
    if (event.status === COMMERCIAL_EVENT_STATUSES.rejected.key) return false;
    return true;
  });
}

export function sumTotalContraCharges(events) {
  return filterPackageRecoveryEvents(events).reduce((total, event) => {
    if (!PACKAGE_VALUE_STATUSES.has(event.status)) return total;
    return total + Math.abs(toNumber(event.value));
  }, 0);
}

export function sumRecoveredValue(events, orderKey = null) {
  return filterPackageRecoveryEvents(events).reduce((total, event) => {
    const resolvedOrderKey = orderKey || event.packageId || null;
    if (!resolvedOrderKey) {
      return total + toNumber(event.recoveredAmount);
    }
    const presentation = getCommercialEventRecoveryPresentation(event, resolvedOrderKey);
    if (presentation?.unavailable) return total;
    return total + toNumber(presentation?.recoveredToDate ?? event.recoveredAmount);
  }, 0);
}

export function sumOutstandingRecoveryAmountForEvents(events, orderKey = null) {
  return filterPackageRecoveryEvents(events).reduce((total, event) => {
    const resolvedOrderKey = orderKey || event.packageId || null;
    if (!resolvedOrderKey) return total;

    const presentation = getCommercialEventRecoveryPresentation(event, resolvedOrderKey);
    if (!presentation || presentation.unavailable || !presentation.isActiveForRecovery) {
      return total;
    }

    return total + presentation.remainingRecovery;
  }, 0);
}

export function sumWrittenOffValue(events, orderKey = null) {
  return filterPackageRecoveryEvents(events).reduce((total, event) => {
    if (
      normalizeRecoveryStatusKey(event.recoveryStatus) !==
      COMMERCIAL_EVENT_RECOVERY_STATUSES.writtenOff.key
    ) {
      return total;
    }

    const absoluteValue = Math.abs(toNumber(event.value));
    const resolvedOrderKey = orderKey || event.packageId || null;
    const recovered = resolvedOrderKey
      ? toNumber(
          getCommercialEventRecoveryPresentation(event, resolvedOrderKey)?.recoveredToDate
        )
      : toNumber(event.recoveredAmount);
    return total + Math.max(0, absoluteValue - recovered);
  }, 0);
}

const PRESENTATION_TERMINAL_RECOVERY_STATUSES = new Set([
  COMMERCIAL_EVENT_RECOVERY_STATUSES.fullyRecovered.key,
  COMMERCIAL_EVENT_RECOVERY_STATUSES.closed.key,
  COMMERCIAL_EVENT_RECOVERY_STATUSES.writtenOff.key,
]);

export function countOpenRecoveryItems(events, orderKey = null) {
  return filterPackageRecoveryEvents(events).filter((event) => {
    const resolvedOrderKey = orderKey || event.packageId || null;
    if (resolvedOrderKey) {
      const presentation = getCommercialEventRecoveryPresentation(event, resolvedOrderKey);
      if (!presentation || presentation.unavailable) return false;
      if (PRESENTATION_TERMINAL_RECOVERY_STATUSES.has(presentation.presentationRecoveryStatus)) {
        return false;
      }
      return presentation.isActiveForRecovery && presentation.remainingRecovery > 0;
    }

    const recoveryStatus = normalizeRecoveryStatusKey(event.recoveryStatus);
    return !TERMINAL_RECOVERY_STATUSES.has(recoveryStatus);
  }).length;
}

export function countRecoveryEventsByStatus(events, recoveryStatusKey, orderKey = null) {
  const target = normalizeRecoveryStatusKey(recoveryStatusKey);
  return filterPackageRecoveryEvents(events).filter((event) => {
    const resolvedOrderKey = orderKey || event.packageId || null;
    if (resolvedOrderKey) {
      const presentation = getCommercialEventRecoveryPresentation(event, resolvedOrderKey);
      const status = presentation?.presentationRecoveryStatus || event.recoveryStatus;
      return normalizeRecoveryStatusKey(status) === target;
    }
    return normalizeRecoveryStatusKey(event.recoveryStatus) === target;
  }).length;
}

export function buildPackageRecoverySummary(events = [], orderKey = null) {
  const recoveryEvents = filterPackageRecoveryEvents(events);
  const resolvedOrderKey = orderKey || recoveryEvents[0]?.packageId || null;

  return {
    hasRecoveries: recoveryEvents.length > 0,
    totalContraCharges: sumTotalContraCharges(events),
    outstandingRecoveries: sumOutstandingRecoveryAmountForEvents(events, resolvedOrderKey),
    recoveredValue: sumRecoveredValue(events, resolvedOrderKey),
    openRecoveryItems: countOpenRecoveryItems(events, resolvedOrderKey),
    writtenOff: sumWrittenOffValue(events, resolvedOrderKey),
    fullyRecoveredCount: countRecoveryEventsByStatus(
      events,
      COMMERCIAL_EVENT_RECOVERY_STATUSES.fullyRecovered.key,
      resolvedOrderKey
    ),
    partiallyRecoveredCount: countRecoveryEventsByStatus(
      events,
      COMMERCIAL_EVENT_RECOVERY_STATUSES.partiallyRecovered.key,
      resolvedOrderKey
    ),
  };
}

export function buildPackageRecoverySummaryForPackage(developmentId, packageId) {
  if (!developmentId || !packageId) {
    return buildPackageRecoverySummary([]);
  }

  const events = listCommercialEventsByPackage(developmentId, packageId);
  return buildPackageRecoverySummary(events, packageId);
}

export function buildPackageRecoverySummaryFromOrder(order) {
  const developmentId = resolvePackageDevelopmentId(order);
  const packageId = order?.orderKey || null;
  return buildPackageRecoverySummaryForPackage(developmentId, packageId);
}
