/**
 * BL-021B.3.3 — Package-level recovery KPI helpers (display only).
 * Uses Commercial Events for the current package only; does not alter certificates or CVR.
 */

import { listCommercialEventsByPackage } from './commercialEventStore';
import { resolvePackageDevelopmentId } from './commercialEventPackageValue';
import { sumOutstandingRecoveryAmount } from './commercialEventDevelopmentRegister';
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

export function sumRecoveredValue(events) {
  return filterPackageRecoveryEvents(events).reduce(
    (total, event) => total + toNumber(event.recoveredAmount),
    0
  );
}

export function sumWrittenOffValue(events) {
  return filterPackageRecoveryEvents(events).reduce((total, event) => {
    if (
      normalizeRecoveryStatusKey(event.recoveryStatus) !==
      COMMERCIAL_EVENT_RECOVERY_STATUSES.writtenOff.key
    ) {
      return total;
    }

    const absoluteValue = Math.abs(toNumber(event.value));
    const recovered = toNumber(event.recoveredAmount);
    return total + Math.max(0, absoluteValue - recovered);
  }, 0);
}

export function countOpenRecoveryItems(events) {
  return filterPackageRecoveryEvents(events).filter((event) => {
    const recoveryStatus = normalizeRecoveryStatusKey(event.recoveryStatus);
    return !TERMINAL_RECOVERY_STATUSES.has(recoveryStatus);
  }).length;
}

export function countRecoveryEventsByStatus(events, recoveryStatusKey) {
  const target = normalizeRecoveryStatusKey(recoveryStatusKey);
  return filterPackageRecoveryEvents(events).filter(
    (event) => normalizeRecoveryStatusKey(event.recoveryStatus) === target
  ).length;
}

export function buildPackageRecoverySummary(events = []) {
  const recoveryEvents = filterPackageRecoveryEvents(events);

  return {
    hasRecoveries: recoveryEvents.length > 0,
    totalContraCharges: sumTotalContraCharges(events),
    outstandingRecoveries: sumOutstandingRecoveryAmount(events),
    recoveredValue: sumRecoveredValue(events),
    openRecoveryItems: countOpenRecoveryItems(events),
    writtenOff: sumWrittenOffValue(events),
    fullyRecoveredCount: countRecoveryEventsByStatus(
      events,
      COMMERCIAL_EVENT_RECOVERY_STATUSES.fullyRecovered.key
    ),
    partiallyRecoveredCount: countRecoveryEventsByStatus(
      events,
      COMMERCIAL_EVENT_RECOVERY_STATUSES.partiallyRecovered.key
    ),
  };
}

export function buildPackageRecoverySummaryForPackage(developmentId, packageId) {
  if (!developmentId || !packageId) {
    return buildPackageRecoverySummary([]);
  }

  const events = listCommercialEventsByPackage(developmentId, packageId);
  return buildPackageRecoverySummary(events);
}

export function buildPackageRecoverySummaryFromOrder(order) {
  const developmentId = resolvePackageDevelopmentId(order);
  const packageId = order?.orderKey || null;
  return buildPackageRecoverySummaryForPackage(developmentId, packageId);
}
