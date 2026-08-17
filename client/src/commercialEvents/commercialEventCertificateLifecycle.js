/**
 * BL-025.4 — Certificate lifecycle reconciliation for normal valueInclusion CEs.
 *
 * Approved/locked certificate commercialLines remain the financial source of truth.
 * CE certificateStatus is derived from certificate history for presentation.
 * Legacy localStorage writes on approval occur only while local CE authority is active.
 */

import {
  getCommercialEventById,
  updateCommercialEventCertificateStatus,
} from './commercialEventStore';
import { shouldPersistCertificateDrivenCeState } from './commercialEventRecoveryOverlay';
import {
  isCommercialEventCertifiable,
  CERTIFICATE_COMMERCIAL_LINE_TYPES,
} from './commercialEventCertifiability';
import { isRecoveryCommercialEvent } from './commercialEventRegisterBadges';
import {
  COMMERCIAL_EVENT_CERTIFICATE_STATUSES,
  COMMERCIAL_EVENT_STATUSES,
  normalizeCertificateStatusKey,
} from './commercialEventTypes';
import { formatMoney } from '../components/poDrawerHelpers';
import {
  calculateCommercialEventRemaining,
  normalizeCommercialLines,
} from '../payments/certificateCommercialLines';
import { roundMoney } from '../payments/paymentCertificateCalculations';
import {
  isApprovedCommercialCertificate,
  resolveCertificatesForPackage,
} from '../payments/paymentCertificateStore';

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sessionActor() {
  if (typeof localStorage === 'undefined') return 'Commercial Manager';
  return (
    localStorage.getItem('userName') ||
    localStorage.getItem('userEmail') ||
    'Commercial Manager'
  );
}

function isValueInclusionLine(line) {
  return (
    !line?.lineType ||
    line.lineType === CERTIFICATE_COMMERCIAL_LINE_TYPES.valueInclusion
  );
}

export function isSubjectToCertificateLifecycleReconciliation(event) {
  if (!event?.id) return false;
  if (event.status !== COMMERCIAL_EVENT_STATUSES.approved.key) return false;
  if (isRecoveryCommercialEvent(event)) return false;
  return isCommercialEventCertifiable(event);
}

/**
 * Sum signed valueInclusion amounts from approved/locked certificates only.
 */
export function calculateValueInclusionCertifiedToDate(
  orderKey,
  commercialEventId,
  { excludeCertificateId = null } = {}
) {
  if (!orderKey || !commercialEventId) return 0;

  const resolved = resolveCertificatesForPackage(orderKey);
  if (!resolved.ready) return null;

  return roundMoney(
    resolved.certificates
      .filter(
        (certificate) =>
          isApprovedCommercialCertificate(certificate) &&
          certificate.id !== excludeCertificateId
      )
      .reduce((sum, certificate) => {
        const line = normalizeCommercialLines(certificate.commercialLines).find(
          (item) =>
            item.commercialEventId === commercialEventId && isValueInclusionLine(item)
        );
        return sum + toNumber(line?.amountThisCertificate);
      }, 0)
  );
}

export function deriveCertificateStatusFromCertification(eventValue, certifiedAmount) {
  const source = roundMoney(toNumber(eventValue));
  const certified = roundMoney(toNumber(certifiedAmount));

  if (source === 0) {
    return certified === 0
      ? COMMERCIAL_EVENT_CERTIFICATE_STATUSES.notIncluded.key
      : COMMERCIAL_EVENT_CERTIFICATE_STATUSES.fullyIncluded.key;
  }

  if (certified === 0) {
    return COMMERCIAL_EVENT_CERTIFICATE_STATUSES.notIncluded.key;
  }

  const remaining = roundMoney(source - certified);

  if (source >= 0) {
    return remaining <= 0
      ? COMMERCIAL_EVENT_CERTIFICATE_STATUSES.fullyIncluded.key
      : COMMERCIAL_EVENT_CERTIFICATE_STATUSES.partiallyIncluded.key;
  }

  return remaining >= 0
    ? COMMERCIAL_EVENT_CERTIFICATE_STATUSES.fullyIncluded.key
    : COMMERCIAL_EVENT_CERTIFICATE_STATUSES.partiallyIncluded.key;
}

export function hasCommercialEventCertificationRemaining(event, orderKey) {
  if (!isSubjectToCertificateLifecycleReconciliation(event)) return false;
  if (!orderKey) return false;

  const certifiedAmount = calculateValueInclusionCertifiedToDate(orderKey, event.id);
  if (certifiedAmount == null) return false;

  const remaining = calculateCommercialEventRemaining(
    event.value,
    certifiedAmount,
    0
  );

  return !eventHasNoCertificationRemaining(event.value, remaining);
}

export function eventHasNoCertificationRemaining(sourceEventValue, remaining) {
  const source = toNumber(sourceEventValue);
  const left = roundMoney(remaining);
  if (source >= 0) return left <= 0;
  return left >= 0;
}

export function buildCommercialEventCertificateLifecycleView(
  event,
  orderKey,
  { excludeCertificateId = null } = {}
) {
  const approvedValue = roundMoney(toNumber(event?.value));
  const certifiedAmount = calculateValueInclusionCertifiedToDate(orderKey, event?.id, {
    excludeCertificateId,
  });

  if (certifiedAmount == null) {
    return {
      approvedValue,
      certifiedAmount: null,
      remainingAmount: null,
      certificateStatus: null,
      certificatesReady: false,
      unavailable: true,
    };
  }

  const remainingAmount = calculateCommercialEventRemaining(
    approvedValue,
    certifiedAmount,
    0
  );
  const certificateStatus = deriveCertificateStatusFromCertification(
    approvedValue,
    certifiedAmount
  );

  return {
    approvedValue,
    certifiedAmount,
    remainingAmount,
    certificateStatus,
    certificatesReady: true,
    unavailable: false,
  };
}

const CERTIFICATION_BADGE_LABELS = {
  [COMMERCIAL_EVENT_CERTIFICATE_STATUSES.notIncluded.key]: 'Not Certified',
  [COMMERCIAL_EVENT_CERTIFICATE_STATUSES.pendingInclusion.key]: 'Not Certified',
  [COMMERCIAL_EVENT_CERTIFICATE_STATUSES.partiallyIncluded.key]: 'Part Certified',
  [COMMERCIAL_EVENT_CERTIFICATE_STATUSES.fullyIncluded.key]: 'Fully Certified',
};

const CERTIFICATION_BADGE_MODIFIERS = {
  [COMMERCIAL_EVENT_CERTIFICATE_STATUSES.notIncluded.key]: 'muted',
  [COMMERCIAL_EVENT_CERTIFICATE_STATUSES.pendingInclusion.key]: 'muted',
  [COMMERCIAL_EVENT_CERTIFICATE_STATUSES.partiallyIncluded.key]: 'pending',
  [COMMERCIAL_EVENT_CERTIFICATE_STATUSES.fullyIncluded.key]: 'approved',
};

export function getCommercialEventCertificationPresentation(event, orderKey) {
  if (!isSubjectToCertificateLifecycleReconciliation(event) || !orderKey) {
    return null;
  }

  const lifecycle = buildCommercialEventCertificateLifecycleView(event, orderKey);
  if (lifecycle.unavailable) {
    return {
      certificatesReady: false,
      unavailable: true,
      statusKey: null,
      badgeLabel: null,
      modifier: 'muted',
      progressLabel: null,
      ...lifecycle,
    };
  }

  const statusKey = normalizeCertificateStatusKey(lifecycle.certificateStatus);

  const progressLabel =
    statusKey === COMMERCIAL_EVENT_CERTIFICATE_STATUSES.notIncluded.key
      ? null
      : `Certified £${formatMoney(Math.abs(lifecycle.certifiedAmount))} / £${formatMoney(Math.abs(lifecycle.approvedValue))} · Remaining £${formatMoney(Math.abs(lifecycle.remainingAmount))}`;

  return {
    statusKey,
    badgeLabel: CERTIFICATION_BADGE_LABELS[statusKey] || statusKey,
    modifier: CERTIFICATION_BADGE_MODIFIERS[statusKey] || 'muted',
    progressLabel,
    ...lifecycle,
  };
}

export function getCommercialEventCertificationBadges(event, orderKey) {
  const presentation = getCommercialEventCertificationPresentation(event, orderKey);
  if (!presentation || presentation.unavailable) return [];

  return [
    {
      key: `certification-${presentation.statusKey}`,
      label: presentation.badgeLabel,
      modifier: presentation.modifier,
      title: presentation.progressLabel || undefined,
    },
  ];
}

export function applyValueInclusionLifecycleOnCertificateApproval({
  developmentId,
  orderKey,
  certificate,
  actor = sessionActor(),
}) {
  if (!developmentId || !certificate || !isApprovedCommercialCertificate(certificate)) {
    return { ok: true, applied: [], skipped: true };
  }

  if (!shouldPersistCertificateDrivenCeState()) {
    return {
      ok: true,
      applied: [],
      skipped: true,
      reason: 'server-ce-authority',
    };
  }

  if (certificate.valueInclusionLifecycleApplied) {
    return { ok: true, applied: [], skipped: true };
  }

  const valueLines = normalizeCommercialLines(certificate.commercialLines).filter(
    isValueInclusionLine
  );
  const seenEventIds = new Set();
  const applied = [];

  for (const line of valueLines) {
    if (!line.commercialEventId || seenEventIds.has(line.commercialEventId)) {
      continue;
    }
    seenEventIds.add(line.commercialEventId);

    const event = getCommercialEventById(developmentId, line.commercialEventId);
    if (!isSubjectToCertificateLifecycleReconciliation(event)) {
      continue;
    }

    const certifiedToDate = calculateValueInclusionCertifiedToDate(
      orderKey,
      event.id
    );
    const nextStatus = deriveCertificateStatusFromCertification(
      event.value,
      certifiedToDate
    );
    const priorStatus = normalizeCertificateStatusKey(event.certificateStatus);

    if (priorStatus === nextStatus) {
      continue;
    }

    const comment = [
      `Certificate No. ${certificate.certificateNumber} (${certificate.id})`,
      `Certified to date: £${formatMoney(Math.abs(certifiedToDate))}`,
      `Prior certificateStatus: ${priorStatus}`,
      `New certificateStatus: ${nextStatus}`,
    ].join(' · ');

    const result = updateCommercialEventCertificateStatus(
      developmentId,
      event.id,
      nextStatus,
      {
        actor,
        comment,
        priorCertificateStatus: priorStatus,
        newCertificateStatus: nextStatus,
        certifiedAmountToDate: certifiedToDate,
      }
    );

    if (result.ok) {
      applied.push({ line, event: result.event });
    }
  }

  return { ok: true, applied };
}
