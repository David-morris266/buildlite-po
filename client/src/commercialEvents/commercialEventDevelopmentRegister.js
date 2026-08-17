/**
 * BL-021B.3.2 — Development-scoped Commercial Events register (pure helpers).
 */

import { listCommercialEventsByDevelopment } from './commercialEventStore';
import { getCommercialEventRecoveryPresentation } from './commercialEventRecoveryOverlay';
import {
  getLinkedCommercialEvent,
  isActiveRecovery,
} from './commercialEventRecovery';
import {
  buildPackageCommercialDisplayFields,
  formatSignedCommercialEventValue,
  getApprovedCommercialEvents,
} from './commercialEventPackageValue';
import {
  canShowPotentialContraBanner,
  isRecoveryCommercialEvent,
} from './commercialEventRegisterBadges';
import {
  COMMERCIAL_EVENT_STATUSES,
  getCommercialEventCategoryMeta,
  getCommercialEventRecoveryStatusMeta,
  getCommercialEventStatusMeta,
  getCommercialEventTypeMeta,
  normalizeRecoveryStatusKey,
} from './commercialEventTypes';
import {
  buildCommercialEventTarget,
  resolveLinkedCommercialEventNavigation,
} from './commercialEventNavigation';
import {
  buildPackageWorkspaceLaunchContext,
  PACKAGE_OPENED_FROM,
  resolvePackageOrderFromList,
} from '../payments/packageWorkspaceLaunch';

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export const EMPTY_DEVELOPMENT_COMMERCIAL_FILTERS = {
  search: '',
  commercialStatus: '',
  eventType: '',
  recoveryStatus: '',
  supplier: '',
  packageId: '',
};

export const DEFAULT_DEVELOPMENT_COMMERCIAL_SORT = {
  key: 'dateRaised',
  direction: 'desc',
};

export const DEVELOPMENT_COMMERCIAL_SORT_KEYS = {
  eventNumber: 'eventNumber',
  dateRaised: 'dateRaised',
  value: 'value',
  supplier: 'supplier',
  status: 'status',
};

export function buildDevelopmentPackageLookup(packages = []) {
  const lookup = new Map();
  for (const pkg of packages) {
    if (pkg?.orderKey) {
      lookup.set(pkg.orderKey, pkg);
    }
  }
  return lookup;
}

export function resolveDevelopmentPackageRow(packageLookup, event) {
  if (!event?.packageId || !packageLookup) return null;
  return packageLookup.get(event.packageId) || null;
}

export function enrichDevelopmentCommercialEventRow(event, packageLookup, developmentId) {
  const packageRow = resolveDevelopmentPackageRow(packageLookup, event);
  const linkedEvent = getLinkedCommercialEvent(developmentId, event);

  let currentPackageValue = null;
  if (packageRow) {
    currentPackageValue = buildPackageCommercialDisplayFields(packageRow).currentPackageValue;
  }

  const supplierName =
    packageRow?.supplierLabel ||
    event.supplierId ||
    'Unknown supplier';
  const costCode =
    packageRow?.costCode != null && String(packageRow.costCode).trim() !== ''
      ? packageRow.costCode
      : event.costCode || '—';
  const poNumbers = packageRow?.poNumbers?.length
    ? packageRow.poNumbers
    : event.poNumber
      ? [event.poNumber]
      : [];

  return {
    event,
    packageLabel: packageRow
      ? `${packageRow.supplierLabel} – ${packageRow.projectLabel}`
      : event.packageId || 'Unknown package',
    supplierName,
    costCode,
    poNumbers,
    poLabel: poNumbers.length ? poNumbers.join(', ') : '—',
    currentPackageValue,
    packageMissing: !packageRow,
    linkedEventNumber: linkedEvent?.eventNumber || null,
    linkedEventUnavailable: Boolean(event.linkedEventId && !linkedEvent),
  };
}

export function listEnrichedDevelopmentCommercialEvents(developmentId, packages = []) {
  const packageLookup = buildDevelopmentPackageLookup(packages);
  return listCommercialEventsByDevelopment(developmentId).map((event) =>
    enrichDevelopmentCommercialEventRow(event, packageLookup, developmentId)
  );
}

export function countEventsByCommercialStatus(events, statusKey) {
  return (events || []).filter((event) => event.status === statusKey).length;
}

export function countPotentialContraChargesNotRaised(events) {
  return (events || []).filter((event) => canShowPotentialContraBanner(event)).length;
}

/**
 * Sum unrecovered amounts for Recovery events with active recovery status only.
 * Origin events are excluded.
 */
export function sumOutstandingRecoveryAmount(events) {
  return (events || []).reduce((total, event) => {
    if (!isRecoveryCommercialEvent(event)) return total;

    const orderKey = event.packageId || null;
    if (!orderKey) return total;

    const presentation = getCommercialEventRecoveryPresentation(event, orderKey);
    if (!presentation || presentation.unavailable || !presentation.isActiveForRecovery) {
      return total;
    }

    return total + presentation.remainingRecovery;
  }, 0);
}

export function sumNetApprovedCommercialMovement(events) {
  return getApprovedCommercialEvents(events || []).reduce(
    (total, event) => total + toNumber(event.value),
    0
  );
}

export function buildDevelopmentCommercialEventSummary(developmentId, packages = []) {
  const events = listCommercialEventsByDevelopment(developmentId);

  return {
    totalEvents: events.length,
    draftCount: countEventsByCommercialStatus(events, COMMERCIAL_EVENT_STATUSES.draft.key),
    submittedCount: countEventsByCommercialStatus(
      events,
      COMMERCIAL_EVENT_STATUSES.submitted.key
    ),
    approvedCount: countEventsByCommercialStatus(
      events,
      COMMERCIAL_EVENT_STATUSES.approved.key
    ),
    potentialContraNotRaisedCount: countPotentialContraChargesNotRaised(events),
    outstandingRecoveryAmount: sumOutstandingRecoveryAmount(events),
    netApprovedMovement: sumNetApprovedCommercialMovement(events),
  };
}

export function hasActiveDevelopmentCommercialFilters(filters = {}) {
  return Object.entries(filters).some(([, value]) => String(value || '').trim() !== '');
}

export function matchesDevelopmentCommercialEventSearch(row, searchQuery) {
  const query = String(searchQuery || '').trim().toLowerCase();
  if (!query) return true;

  const { event, supplierName, costCode, poNumbers } = row;
  let categoryLabel = event.category || '';
  try {
    categoryLabel = getCommercialEventCategoryMeta(event.category).label;
  } catch {
    categoryLabel = event.category || '';
  }

  const haystack = [
    event.eventNumber,
    event.description,
    categoryLabel,
    event.category,
    supplierName,
    costCode,
    event.costCode,
    event.poNumber,
    ...(poNumbers || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(query);
}

export function filterDevelopmentCommercialEventRows(rows, filters = {}) {
  const merged = { ...EMPTY_DEVELOPMENT_COMMERCIAL_FILTERS, ...filters };

  return (rows || []).filter((row) => {
    const { event } = row;

    if (merged.commercialStatus && event.status !== merged.commercialStatus) {
      return false;
    }

    if (merged.eventType && event.eventType !== merged.eventType) {
      return false;
    }

    if (merged.recoveryStatus) {
      const normalized = normalizeRecoveryStatusKey(event.recoveryStatus);
      if (normalized !== merged.recoveryStatus) return false;
    }

    if (merged.supplier) {
      const supplierNeedle = merged.supplier.trim().toLowerCase();
      if (!row.supplierName.toLowerCase().includes(supplierNeedle)) {
        return false;
      }
    }

    if (merged.packageId && event.packageId !== merged.packageId) {
      return false;
    }

    if (!matchesDevelopmentCommercialEventSearch(row, merged.search)) {
      return false;
    }

    return true;
  });
}

function compareStrings(a, b) {
  return String(a || '').localeCompare(String(b || ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

export function sortDevelopmentCommercialEventRows(
  rows,
  sort = DEFAULT_DEVELOPMENT_COMMERCIAL_SORT
) {
  const { key, direction } = { ...DEFAULT_DEVELOPMENT_COMMERCIAL_SORT, ...sort };
  const multiplier = direction === 'asc' ? 1 : -1;

  return [...(rows || [])].sort((left, right) => {
    let result = 0;

    switch (key) {
      case DEVELOPMENT_COMMERCIAL_SORT_KEYS.eventNumber:
        result = compareStrings(left.event.eventNumber, right.event.eventNumber);
        break;
      case DEVELOPMENT_COMMERCIAL_SORT_KEYS.value:
        result = toNumber(left.event.value) - toNumber(right.event.value);
        break;
      case DEVELOPMENT_COMMERCIAL_SORT_KEYS.supplier:
        result = compareStrings(left.supplierName, right.supplierName);
        break;
      case DEVELOPMENT_COMMERCIAL_SORT_KEYS.status:
        result = compareStrings(
          getCommercialEventStatusMeta(left.event.status).label,
          getCommercialEventStatusMeta(right.event.status).label
        );
        break;
      case DEVELOPMENT_COMMERCIAL_SORT_KEYS.dateRaised:
      default:
        result = compareStrings(left.event.dateRaised, right.event.dateRaised);
        break;
    }

    if (result === 0) {
      result = compareStrings(left.event.eventNumber, right.event.eventNumber);
    }

    return result * multiplier;
  });
}

export function buildDevelopmentCommercialEventFilterOptions(rows) {
  const suppliers = new Set();
  const packages = new Map();

  for (const row of rows || []) {
    if (row.supplierName) suppliers.add(row.supplierName);
    if (row.event.packageId) {
      packages.set(row.event.packageId, row.packageLabel);
    }
  }

  return {
    suppliers: [...suppliers].sort((a, b) => compareStrings(a, b)),
    packages: [...packages.entries()]
      .map(([orderKey, label]) => ({ orderKey, label }))
      .sort((a, b) => compareStrings(a.label, b.label)),
  };
}

export function buildDevelopmentCommercialEventPackageLaunch({
  event,
  packages = [],
  developmentId,
  openedFrom = PACKAGE_OPENED_FROM.DevelopmentPackages,
}) {
  if (!event?.packageId) {
    return { ok: false, errors: ['Commercial event is missing package identity'] };
  }

  const packageRow = resolvePackageOrderFromList(packages, event.packageId);
  if (!packageRow) {
    return {
      ok: false,
      errors: ['Responsible package not found. It may no longer be available.'],
    };
  }

  const launch = buildPackageWorkspaceLaunchContext({
    packageRow,
    developmentId,
    openedFrom,
    initialTab: 'variations',
    commercialEventTarget: buildCommercialEventTarget(event.id, 'view'),
  });

  if (launch.identityError) {
    return { ok: false, errors: [launch.identityError] };
  }

  return { ok: true, launch, packageRow };
}

export function resolveDevelopmentLinkedEventNavigation({
  developmentId,
  sourceEvent,
  packages = [],
}) {
  return resolveLinkedCommercialEventNavigation({
    developmentId,
    sourceEvent,
    currentPackageId: sourceEvent?.packageId || null,
    packages,
  });
}

export function createDevelopmentCommercialNavigationSnapshot(eventId) {
  if (!eventId) return null;
  return {
    kind: 'development-commercial',
    developmentCommercialTarget: buildCommercialEventTarget(eventId, 'view'),
  };
}

export function formatDevelopmentCommercialKpiValue(summaryKey, summary) {
  if (summaryKey === 'outstandingRecoveryAmount' || summaryKey === 'netApprovedMovement') {
    return formatSignedCommercialEventValue(summary[summaryKey]);
  }
  return String(summary[summaryKey] ?? 0);
}

export function getDevelopmentCommercialRecoveryStatusLabel(recoveryStatusKey) {
  try {
    return getCommercialEventRecoveryStatusMeta(recoveryStatusKey).label;
  } catch {
    return 'Not applicable';
  }
}

export function getDevelopmentCommercialTypeLabel(eventTypeKey) {
  try {
    return getCommercialEventTypeMeta(eventTypeKey).label;
  } catch {
    return eventTypeKey || 'Unknown';
  }
}

export function isValidDevelopmentPackageIdentity(pkg) {
  if (!pkg?.orderKey || !pkg?.developmentId || !pkg?.supplierId) return false;
  const costCode = pkg?.costCode;
  return costCode != null && String(costCode).trim() !== '';
}

export function buildDevelopmentCommercialEventPackageOptions(packages = []) {
  return packages
    .filter(isValidDevelopmentPackageIdentity)
    .map((pkg) => {
      const display = buildPackageCommercialDisplayFields(pkg);
      return {
        orderKey: pkg.orderKey,
        packageRow: pkg,
        supplierLabel: pkg.supplierLabel || pkg.supplierId || '—',
        costCode: pkg.costCode,
        poNumbers: Array.isArray(pkg.poNumbers) ? pkg.poNumbers : [],
        currentPackageValue: display.currentPackageValue,
      };
    })
    .sort((left, right) => {
      const supplierCompare = String(left.supplierLabel).localeCompare(
        String(right.supplierLabel)
      );
      if (supplierCompare !== 0) return supplierCompare;
      return String(left.costCode).localeCompare(String(right.costCode));
    });
}

export { formatSignedCommercialEventValue };
