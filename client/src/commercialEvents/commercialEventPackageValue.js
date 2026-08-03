/**
 * BL-021A — Pure package value helpers for Commercial Events (Doc 54).
 * Does not alter existing certificate or CVR calculations.
 */

import {
  COMMERCIAL_EVENT_STATUSES,
  COMMERCIAL_EVENT_TYPES,
  PACKAGE_VALUE_STATUSES,
  PENDING_PACKAGE_VALUE_STATUSES,
} from './commercialEventTypes';

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sumEventValues(events, predicate) {
  return events.reduce((total, event) => {
    if (!predicate(event)) return total;
    return total + toNumber(event.value);
  }, 0);
}

export function filterEventsByPackage(events, packageId) {
  if (!packageId) return [];
  return (events || []).filter((event) => event.packageId === packageId);
}

export function getApprovedCommercialEvents(events) {
  return (events || []).filter((event) => PACKAGE_VALUE_STATUSES.has(event.status));
}

export function getPendingCommercialEvents(events) {
  return (events || []).filter((event) =>
    PENDING_PACKAGE_VALUE_STATUSES.has(event.status)
  );
}

export function buildPackageCommercialEventSummary(originalOrderValue, events = []) {
  const original = toNumber(originalOrderValue);
  const approvedEvents = getApprovedCommercialEvents(events);
  const pendingEvents = getPendingCommercialEvents(events);

  const approvedVariationValue = sumEventValues(
    approvedEvents,
    (event) => event.eventType === COMMERCIAL_EVENT_TYPES.variation.key
  );
  const approvedContraChargeValue = sumEventValues(
    approvedEvents,
    (event) => event.eventType === COMMERCIAL_EVENT_TYPES.contraCharge.key
  );
  const approvedCreditValue = sumEventValues(
    approvedEvents,
    (event) => event.eventType === COMMERCIAL_EVENT_TYPES.credit.key
  );

  const netCommercialEventMovement = sumEventValues(approvedEvents, () => true);
  const pendingEventValue = sumEventValues(pendingEvents, () => true);
  const currentPackageValue = original + netCommercialEventMovement;

  return {
    originalOrderValue: original,
    approvedVariationValue,
    approvedContraChargeValue,
    approvedCreditValue,
    netCommercialEventMovement,
    pendingEventValue,
    currentPackageValue,
    approvedEventCount: approvedEvents.length,
    pendingEventCount: pendingEvents.length,
    totalEventCount: events.length,
  };
}

export function buildPackageCommercialEventSummaryForPackage(
  originalOrderValue,
  events,
  packageId
) {
  const packageEvents = filterEventsByPackage(events, packageId);
  return buildPackageCommercialEventSummary(originalOrderValue, packageEvents);
}

/**
 * Legacy packages with no events preserve the original PO committed value.
 */
export function resolveCurrentPackageValue(originalOrderValue, events, packageId) {
  const summary = buildPackageCommercialEventSummaryForPackage(
    originalOrderValue,
    events,
    packageId
  );
  return summary.currentPackageValue;
}

export function findLinkedCommercialEvents(events, eventId) {
  if (!eventId) return [];

  const matches = (events || []).filter(
    (event) => event.id === eventId || event.linkedEventId === eventId
  );

  const linkedIds = new Set(matches.map((event) => event.id));
  for (const event of matches) {
    if (event.linkedEventId) linkedIds.add(event.linkedEventId);
  }

  return (events || []).filter(
    (event) => linkedIds.has(event.id) || linkedIds.has(event.linkedEventId)
  );
}

export function isNegativePackageEvent(event) {
  return toNumber(event?.value) < 0;
}

export function formatSignedCommercialEventValue(value) {
  const amount = toNumber(value);
  const prefix = amount < 0 ? '-£' : '£';
  return `${prefix}${Math.abs(amount).toFixed(2)}`;
}

export function getCommercialEventAuditActionLabel(action) {
  const labels = {
    CREATED: 'Created',
    UPDATED: 'Updated',
    SUBMITTED: 'Submitted',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    CLOSED: 'Closed',
  };
  return labels[action] || action;
}

export function isTerminalCommercialEventStatus(statusKey) {
  return (
    statusKey === COMMERCIAL_EVENT_STATUSES.rejected.key ||
    statusKey === COMMERCIAL_EVENT_STATUSES.closed.key
  );
}
