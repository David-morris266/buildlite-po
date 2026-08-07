/**
 * BL-021B.3.4 — Package commercial history timeline (display only).
 * Aggregates audit entries from PO, Commercial Events, Recoveries, Certificates and Matrix.
 */

import { formatApprovalAction } from '../components/poDrawerHelpers';
import { listCommercialEventsByPackage } from './commercialEventStore';
import {
  getCommercialEventAuditActionLabel,
  resolvePackageDevelopmentId,
} from './commercialEventPackageValue';
import { isRecoveryCommercialEvent } from './commercialEventRegisterBadges';
import {
  COMMERCIAL_EVENT_STATUSES,
  getCommercialEventRecoveryStatusMeta,
  getCommercialEventStatusMeta,
} from './commercialEventTypes';
import { loadOrderMatrix } from '../payments/orderMatrixStore';
import { listCertificates } from '../payments/paymentCertificateStore';
import { getPackageRecord } from '../payments/subcontractPackageStore';

export const PACKAGE_HISTORY_SOURCE = {
  po: 'po',
  commercialEvent: 'commercial-event',
  recovery: 'recovery',
  certificate: 'certificate',
  matrix: 'matrix',
};

export const PACKAGE_HISTORY_FILTER = {
  all: 'all',
  po: 'po',
  commercial: 'commercial',
  recovery: 'recovery',
  certificate: 'certificate',
  matrix: 'matrix',
};

const CERTIFICATE_AUDIT_LABELS = {
  created: 'created',
  submitted: 'submitted',
  approved: 'approved',
  rejected: 'rejected',
};

function parseTimelineWhen(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function resolveCommercialAuditModifier(action, source) {
  const key = String(action || '').toUpperCase();
  if (key === 'APPROVED') return 'approved';
  if (key === 'REJECTED') return 'rejected';
  if (key === 'RECOVERY_STATUS_CHANGED' || source === PACKAGE_HISTORY_SOURCE.recovery) {
    return 'recovery';
  }
  if (key === 'SUBMITTED') return 'pending';
  return 'default';
}

function resolveCertificateAuditModifier(action) {
  const key = String(action || '').toLowerCase();
  if (key === 'approved') return 'approved';
  if (key === 'rejected') return 'rejected';
  if (key === 'submitted') return 'pending';
  return 'certificate';
}

function resolvePoAuditModifier(action) {
  const key = String(action || '').toUpperCase();
  if (key === 'APPROVED') return 'approved';
  if (key === 'REJECTED') return 'rejected';
  if (key === 'SENT') return 'pending';
  return 'default';
}

export function buildCommercialEventAuditLabel(event, audit) {
  if (!event || !audit) return 'Commercial activity';

  const isRecovery = isRecoveryCommercialEvent(event);
  const prefix = isRecovery ? 'Recovery' : 'Commercial Event';
  const ref = event.eventNumber || event.id;
  const action = String(audit.action || '').toUpperCase();

  if (action === 'RECOVERY_STATUS_CHANGED') {
    const statusLabel = getCommercialEventRecoveryStatusMeta(
      audit.newRecoveryStatus
    ).label;
    return `${prefix} ${ref} recovery status changed to ${statusLabel}`;
  }

  if (action === 'LINKED_RECOVERY_CREATED') {
    return `Commercial Event ${ref} linked recovery created`;
  }

  if (action === 'LINKED_TO_ORIGIN') {
    return `Recovery ${ref} linked to origin event`;
  }

  if (action === 'POTENTIAL_CONTRA_CHARGE_DISMISSED') {
    return `Commercial Event ${ref} potential contra charge dismissed`;
  }

  const actionLabel = getCommercialEventAuditActionLabel(audit.action);
  return `${prefix} ${ref} ${actionLabel.toLowerCase()}`;
}

export function buildPoHistoryEntries(order) {
  const entries = [];

  for (const po of order?.pos || []) {
    const poNumber = po.poNumber || po.number;
    if (!poNumber) continue;

    const history = Array.isArray(po.approval?.history) ? po.approval.history : [];

    for (const [index, item] of history.entries()) {
      const when = parseTimelineWhen(item.at);
      if (!when) continue;

      entries.push({
        id: `po-${poNumber}-${item.at || index}-${item.action || index}`,
        when,
        label: `Purchase Order ${poNumber} ${formatApprovalAction(item.action).toLowerCase()}`,
        actor: item.by || null,
        detail: item.note || '',
        source: PACKAGE_HISTORY_SOURCE.po,
        modifier: resolvePoAuditModifier(item.action),
        poNumber,
      });
    }

    const isApproved =
      String(po.approval?.status || po.status || '').toLowerCase() === 'approved';

    if (isApproved && history.length === 0) {
      const when = parseTimelineWhen(
        po.approval?.decidedAt || po.updatedAt || po.createdAt
      );
      if (when) {
        entries.push({
          id: `po-legacy-${poNumber}`,
          when,
          label: `Purchase Order ${poNumber} approved`,
          actor: po.approval?.decidedBy || null,
          detail: '',
          source: PACKAGE_HISTORY_SOURCE.po,
          modifier: 'approved',
          poNumber,
        });
      }
    }
  }

  return entries;
}

export function buildCommercialEventHistoryEntries(events = []) {
  const entries = [];

  for (const event of events || []) {
    const auditHistory = Array.isArray(event.auditHistory) ? event.auditHistory : [];
    const isRecovery = isRecoveryCommercialEvent(event);
    const source = isRecovery
      ? PACKAGE_HISTORY_SOURCE.recovery
      : PACKAGE_HISTORY_SOURCE.commercialEvent;

    for (const audit of auditHistory) {
      const when = parseTimelineWhen(audit.timestamp);
      if (!when) continue;

      entries.push({
        id: `ce-${event.id}-${audit.id || audit.timestamp}`,
        when,
        label: buildCommercialEventAuditLabel(event, audit),
        actor: audit.actor || null,
        detail: audit.comment || '',
        source,
        modifier: resolveCommercialAuditModifier(audit.action, source),
        eventNumber: event.eventNumber || null,
        eventId: event.id,
      });
    }

    if (!auditHistory.length && event.createdAt) {
      const when = parseTimelineWhen(event.createdAt);
      if (when) {
        entries.push({
          id: `ce-legacy-${event.id}`,
          when,
          label: `${isRecovery ? 'Recovery' : 'Commercial Event'} ${
            event.eventNumber || event.id
          } recorded`,
          actor: event.raisedBy || null,
          detail: event.description || '',
          source,
          modifier: 'default',
          eventNumber: event.eventNumber || null,
          eventId: event.id,
        });
      }
    }
  }

  return entries;
}

export function buildCertificateHistoryEntries(orderKey) {
  if (!orderKey) return [];

  const entries = [];

  for (const certificate of listCertificates(orderKey)) {
    const auditHistory = Array.isArray(certificate.auditHistory)
      ? certificate.auditHistory
      : [];

    for (const audit of auditHistory) {
      const when = parseTimelineWhen(audit.at);
      if (!when) continue;

      const actionLabel =
        CERTIFICATE_AUDIT_LABELS[audit.action] || audit.action || 'updated';

      entries.push({
        id: `cert-${certificate.id}-${audit.id || audit.at}`,
        when,
        label: `Payment Certificate ${certificate.certificateNumber} ${actionLabel}`,
        actor: audit.actor || null,
        detail: audit.comment || '',
        source: PACKAGE_HISTORY_SOURCE.certificate,
        modifier: resolveCertificateAuditModifier(audit.action),
        certificateNumber: certificate.certificateNumber,
        certificateId: certificate.id,
      });
    }
  }

  return entries;
}

export function buildMatrixHistoryEntries(packageRecord, matrix) {
  const entries = [];

  for (const item of packageRecord?.activity || []) {
    if (item.modifier !== 'matrix') continue;

    const when = parseTimelineWhen(item.when);
    if (!when) continue;

    entries.push({
      id: `matrix-${item.id || when}`,
      when,
      label: item.label || 'Order Matrix updated',
      actor: null,
      detail: '',
      source: PACKAGE_HISTORY_SOURCE.matrix,
      modifier: 'matrix',
    });
  }

  if (matrix?.updatedAt) {
    const hasMatrixActivity = (packageRecord?.activity || []).some(
      (item) => item.modifier === 'matrix'
    );

    if (!hasMatrixActivity) {
      const when = parseTimelineWhen(matrix.updatedAt);
      if (when) {
        entries.push({
          id: `matrix-legacy-${matrix.updatedAt}`,
          when,
          label: 'Order Matrix updated',
          actor: null,
          detail: '',
          source: PACKAGE_HISTORY_SOURCE.matrix,
          modifier: 'matrix',
        });
      }
    }
  }

  return entries;
}

export function dedupePackageHistoryEntries(entries = []) {
  const seen = new Set();

  return entries.filter((entry) => {
    const key = entry.id || `${entry.source}-${entry.when}-${entry.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(entry.when);
  });
}

export function sortPackageHistoryEntriesNewestFirst(entries = []) {
  return [...entries].sort(
    (left, right) => new Date(right.when).getTime() - new Date(left.when).getTime()
  );
}

export function filterPackageHistoryEntries(entries, filterKey = PACKAGE_HISTORY_FILTER.all) {
  if (!filterKey || filterKey === PACKAGE_HISTORY_FILTER.all) {
    return entries;
  }

  if (filterKey === PACKAGE_HISTORY_FILTER.commercial) {
    return entries.filter(
      (entry) => entry.source === PACKAGE_HISTORY_SOURCE.commercialEvent
    );
  }

  if (filterKey === PACKAGE_HISTORY_FILTER.recovery) {
    return entries.filter((entry) => entry.source === PACKAGE_HISTORY_SOURCE.recovery);
  }

  if (filterKey === PACKAGE_HISTORY_FILTER.po) {
    return entries.filter((entry) => entry.source === PACKAGE_HISTORY_SOURCE.po);
  }

  if (filterKey === PACKAGE_HISTORY_FILTER.certificate) {
    return entries.filter((entry) => entry.source === PACKAGE_HISTORY_SOURCE.certificate);
  }

  if (filterKey === PACKAGE_HISTORY_FILTER.matrix) {
    return entries.filter((entry) => entry.source === PACKAGE_HISTORY_SOURCE.matrix);
  }

  return entries;
}

export function buildPackageCommercialHistory(order) {
  if (!order?.orderKey) {
    return [];
  }

  const packageRecord = getPackageRecord(order.orderKey);
  const matrix = loadOrderMatrix(order.orderKey);
  const developmentId = resolvePackageDevelopmentId(order);
  const events = developmentId
    ? listCommercialEventsByPackage(developmentId, order.orderKey)
    : [];

  const combined = dedupePackageHistoryEntries([
    ...buildPoHistoryEntries(order),
    ...buildCommercialEventHistoryEntries(events),
    ...buildCertificateHistoryEntries(order.orderKey),
    ...buildMatrixHistoryEntries(packageRecord, matrix),
  ]);

  return sortPackageHistoryEntriesNewestFirst(combined);
}

export function getCommercialEventStatusLabel(statusKey) {
  try {
    return getCommercialEventStatusMeta(statusKey).label;
  } catch {
    return statusKey || 'Unknown';
  }
}

export function isApprovedCommercialEventStatus(statusKey) {
  return statusKey === COMMERCIAL_EVENT_STATUSES.approved.key;
}
