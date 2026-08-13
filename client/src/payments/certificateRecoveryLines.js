/**
 * BL-026 — Certificate recovery / contra deduction helpers.
 *
 * Source of truth for draft availability: approved certificate recoveryDeduction lines.
 * Legacy localStorage recoveredAmount writes occur only while local CE authority is active.
 */

import {
  getCommercialEventById,
  listCommercialEventsByPackage,
  updateRecoveryStatus,
} from '../commercialEvents/commercialEventStore';
import {
  calculateCertificateDerivedRecoveredAmount,
  resolveCertificateDerivedRecoveredAmount,
  shouldPersistCertificateDrivenCeState,
} from '../commercialEvents/commercialEventRecoveryOverlay';
import { isRecoveryCommercialEvent } from '../commercialEvents/commercialEventRegisterBadges';
import { isActiveRecovery } from '../commercialEvents/commercialEventRecovery';
import {
  COMMERCIAL_EVENT_RECOVERY_STATUSES,
  COMMERCIAL_EVENT_STATUSES,
  normalizeRecoveryStatusKey,
} from '../commercialEvents/commercialEventTypes';
import { CERTIFICATE_COMMERCIAL_LINE_TYPES } from '../commercialEvents/commercialEventCertifiability';
import { formatMoney } from '../components/poDrawerHelpers';
import { roundMoney } from './paymentCertificateCalculations';
import {
  isApprovedCommercialCertificate,
  isCertificateEditable,
  listCertificates,
} from './paymentCertificateStore';
import { normalizeCommercialLines } from './certificateCommercialLines';

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

function newRecoveryLineId() {
  return `crl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getRecoveryMagnitude(event) {
  return roundMoney(Math.abs(toNumber(event?.value)));
}

export function normalizeRecoveryDeductionAmount(rawAmount) {
  const magnitude = Math.abs(toNumber(rawAmount));
  if (magnitude === 0) return 0;
  return -roundMoney(magnitude);
}

export function sumRecoveryDeductionLines(commercialLines) {
  return roundMoney(
    normalizeCommercialLines(commercialLines)
      .filter(
        (line) =>
          line.lineType === CERTIFICATE_COMMERCIAL_LINE_TYPES.recoveryDeduction
      )
      .reduce((sum, line) => sum + toNumber(line.amountThisCertificate), 0)
  );
}

export function sumRecoveryDeductionMagnitudes(commercialLines) {
  return roundMoney(Math.abs(sumRecoveryDeductionLines(commercialLines)));
}

/**
 * Approved/locked certificate recoveryDeduction magnitudes only.
 * Draft and submitted certificates do not count as previously recovered.
 */
export function calculateRecoveryPreviouslyRecovered(
  orderKey,
  commercialEventId,
  options = {}
) {
  return calculateCertificateDerivedRecoveredAmount(
    orderKey,
    commercialEventId,
    options
  );
}

export function resolvePreviouslyRecoveredAmount(
  event,
  orderKey,
  commercialEventId,
  options = {}
) {
  return resolveCertificateDerivedRecoveredAmount(event, orderKey, options);
}

export function calculateRecoveryRemaining(
  event,
  orderKey,
  { excludeCertificateId = null, draftDeductionSigned = 0 } = {}
) {
  const recoveryMagnitude = getRecoveryMagnitude(event);
  const previouslyRecovered = resolvePreviouslyRecoveredAmount(
    event,
    orderKey,
    event?.id,
    { excludeCertificateId }
  );
  const currentDraftMagnitude = Math.abs(toNumber(draftDeductionSigned));

  return roundMoney(
    recoveryMagnitude - previouslyRecovered - currentDraftMagnitude
  );
}

export function getMaxRecoveryDeductionThisCertificate(
  event,
  orderKey,
  { excludeCertificateId = null } = {}
) {
  return calculateRecoveryRemaining(event, orderKey, { excludeCertificateId });
}

export function isRecoveryEligibleForCertificate(event, orderKey = null) {
  if (!event?.id) return false;
  if (!isRecoveryCommercialEvent(event)) return false;
  if (event.status !== COMMERCIAL_EVENT_STATUSES.approved.key) return false;

  const recoveryStatus = normalizeRecoveryStatusKey(event.recoveryStatus);
  if (recoveryStatus === COMMERCIAL_EVENT_RECOVERY_STATUSES.closed.key) {
    return false;
  }
  if (recoveryStatus === COMMERCIAL_EVENT_RECOVERY_STATUSES.writtenOff.key) {
    return false;
  }

  const resolvedOrderKey = orderKey || event.packageId || null;
  if (resolvedOrderKey) {
    const recovered = resolveCertificateDerivedRecoveredAmount(event, resolvedOrderKey);
    if (recovered >= getRecoveryMagnitude(event) - Number.EPSILON) {
      return false;
    }
  } else if (recoveryStatus === COMMERCIAL_EVENT_RECOVERY_STATUSES.fullyRecovered.key) {
    return false;
  }

  return isActiveRecovery(event);
}

export function getRecoveryDeductionEligibilityReason(event) {
  if (!event?.id) return 'Commercial event not found.';
  if (!isRecoveryCommercialEvent(event)) {
    return 'Only approved recovery events (linked or direct) can be deducted on a payment certificate.';
  }
  if (event.status !== COMMERCIAL_EVENT_STATUSES.approved.key) {
    return 'Only approved recovery events can be deducted on a payment certificate.';
  }

  const recoveryStatus = normalizeRecoveryStatusKey(event.recoveryStatus);
  if (recoveryStatus === COMMERCIAL_EVENT_RECOVERY_STATUSES.fullyRecovered.key) {
    return 'This recovery has already been fully recovered.';
  }
  if (recoveryStatus === COMMERCIAL_EVENT_RECOVERY_STATUSES.closed.key) {
    return 'Closed recovery events cannot be deducted.';
  }
  if (recoveryStatus === COMMERCIAL_EVENT_RECOVERY_STATUSES.writtenOff.key) {
    return 'Written-off recovery events cannot be deducted.';
  }
  if (!isActiveRecovery(event)) {
    return 'This recovery is not active for certificate deduction.';
  }
  return null;
}

export function validateRecoveryDeductionAmount(
  rawAmount,
  event,
  orderKey,
  { excludeCertificateId = null } = {}
) {
  const signedAmount = normalizeRecoveryDeductionAmount(rawAmount);
  const magnitude = Math.abs(signedAmount);

  if (magnitude === 0) {
    return { valid: false, errors: ['Enter a recovery amount for this certificate.'] };
  }

  if (signedAmount > 0) {
    return {
      valid: false,
      errors: ['Recovery deductions must be stored as negative amounts.'],
    };
  }

  const maxMagnitude = getMaxRecoveryDeductionThisCertificate(event, orderKey, {
    excludeCertificateId,
  });

  if (magnitude > maxMagnitude + Number.EPSILON) {
    return {
      valid: false,
      errors: [
        `Amount cannot exceed the remaining recovery of £${formatMoney(maxMagnitude)}.`,
      ],
    };
  }

  return { valid: true, errors: [], amount: signedAmount, maxMagnitude };
}

export function buildRecoveryDeductionLineFromEvent(
  event,
  rawAmount,
  actor = sessionActor()
) {
  const now = new Date().toISOString();
  const signedAmount = normalizeRecoveryDeductionAmount(rawAmount);

  return {
    id: newRecoveryLineId(),
    commercialEventId: event.id,
    lineType: CERTIFICATE_COMMERCIAL_LINE_TYPES.recoveryDeduction,
    amountThisCertificate: signedAmount,
    sourceEventNumber: event.eventNumber || '',
    sourceEventType: event.eventType || '',
    description: event.description || '',
    sourceEventValue: toNumber(event.value),
    createdAt: now,
    createdBy: actor,
  };
}

export function buildRecoveryDeductionDisplayRow({
  line,
  orderKey,
  certificateId,
  developmentId,
  liveEvent = null,
}) {
  const recoveryMagnitude = getRecoveryMagnitude(
    liveEvent || { value: line.sourceEventValue }
  );
  const previouslyRecovered = liveEvent
    ? resolvePreviouslyRecoveredAmount(liveEvent, orderKey, line.commercialEventId, {
        excludeCertificateId: certificateId,
      })
    : calculateRecoveryPreviouslyRecovered(orderKey, line.commercialEventId, {
        excludeCertificateId: certificateId,
      });
  const amountThisCertificate = toNumber(line.amountThisCertificate);
  const currentMagnitude = Math.abs(amountThisCertificate);
  const remainingRecovery = roundMoney(
    recoveryMagnitude - previouslyRecovered - currentMagnitude
  );

  return {
    ...line,
    eventNumber: line.sourceEventNumber,
    recoveryValue: recoveryMagnitude,
    previouslyRecovered,
    amountThisCertificate,
    amountThisCertificateMagnitude: currentMagnitude,
    remainingRecovery,
    maxMagnitude: roundMoney(recoveryMagnitude - previouslyRecovered),
    liveEvent,
    stale: Boolean(
      liveEvent &&
        (liveEvent.packageId !== orderKey ||
          !isRecoveryEligibleForCertificate(liveEvent) ||
          getRecoveryDeductionEligibilityReason(liveEvent))
    ),
  };
}

export function buildCertificateRecoveryLineRows(orderKey, certificate, developmentId) {
  if (!certificate) return [];

  return normalizeCommercialLines(certificate.commercialLines)
    .filter(
      (line) =>
        line.lineType === CERTIFICATE_COMMERCIAL_LINE_TYPES.recoveryDeduction
    )
    .map((line) =>
      buildRecoveryDeductionDisplayRow({
        line,
        orderKey,
        certificateId: certificate.id,
        developmentId,
        liveEvent: developmentId
          ? getCommercialEventById(developmentId, line.commercialEventId)
          : null,
      })
    );
}

function truncateDescription(description, maxLength = 48) {
  const text = String(description || '—').trim() || '—';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

export function formatRecoveryMagnitudeLabel(value) {
  return `£${formatMoney(Math.abs(roundMoney(toNumber(value))))}`;
}

export function buildEligibleRecoveryValuation(event, orderKey, certificateId = null) {
  const recoveryValue = getRecoveryMagnitude(event);
  const previouslyRecovered = resolvePreviouslyRecoveredAmount(
    event,
    orderKey,
    event.id,
    { excludeCertificateId: certificateId }
  );
  const availableThisCertificate = calculateRecoveryRemaining(event, orderKey, {
    excludeCertificateId: certificateId,
  });

  return {
    recoveryValue,
    previouslyRecovered,
    availableThisCertificate,
  };
}

export function formatEligibleRecoveryOptionLabel(event, orderKey, certificateId = null) {
  const { availableThisCertificate } = buildEligibleRecoveryValuation(
    event,
    orderKey,
    certificateId
  );
  const description = truncateDescription(event?.description);
  return `${event?.eventNumber || '—'} — ${description} — ${formatRecoveryMagnitudeLabel(availableThisCertificate)} remaining`;
}

export function buildSelectedRecoveryPreview(event, orderKey, certificateId = null) {
  const valuation = buildEligibleRecoveryValuation(event, orderKey, certificateId);
  return {
    ...valuation,
    recoveryValueFormatted: formatRecoveryMagnitudeLabel(valuation.recoveryValue),
    previouslyRecoveredFormatted: formatRecoveryMagnitudeLabel(
      valuation.previouslyRecovered
    ),
    availableThisCertificateFormatted: formatRecoveryMagnitudeLabel(
      valuation.availableThisCertificate
    ),
  };
}

export function listEligibleRecoveryEvents(developmentId, orderKey, certificate) {
  if (!developmentId || !orderKey || !certificate) return [];

  const existingIds = new Set(
    normalizeCommercialLines(certificate.commercialLines)
      .filter(
        (line) =>
          line.lineType === CERTIFICATE_COMMERCIAL_LINE_TYPES.recoveryDeduction
      )
      .map((line) => line.commercialEventId)
  );

  const events = listCommercialEventsByPackage(developmentId, orderKey);

  return events.filter((event) => {
    if (!isRecoveryEligibleForCertificate(event, orderKey)) return false;
    if (event.packageId !== orderKey) return false;
    if (existingIds.has(event.id)) return false;

    const remaining = calculateRecoveryRemaining(event, orderKey, {
      excludeCertificateId: certificate.id,
    });
    return remaining > 0;
  });
}

export function validateRecoveryLinesForCertificate({
  orderKey,
  certificateId,
  developmentId,
  commercialLines,
  forApproval = false,
}) {
  const certificate = listCertificates(orderKey).find((item) => item.id === certificateId);
  if (!certificate) {
    return { valid: false, errors: ['Certificate not found.'] };
  }

  if (!forApproval && !isCertificateEditable(certificate)) {
    return {
      valid: false,
      errors: ['Only draft certificates can edit recovery deductions.'],
    };
  }

  const lines = normalizeCommercialLines(commercialLines).filter(
    (line) => line.lineType === CERTIFICATE_COMMERCIAL_LINE_TYPES.recoveryDeduction
  );
  const errors = [];
  const seenEventIds = new Set();

  for (const line of lines) {
    if (!line.commercialEventId) {
      errors.push('Each recovery line must reference a commercial event.');
      continue;
    }

    if (seenEventIds.has(line.commercialEventId)) {
      errors.push(
        `Recovery event ${line.sourceEventNumber || line.commercialEventId} appears more than once on this certificate.`
      );
    }
    seenEventIds.add(line.commercialEventId);

    const liveEvent = getCommercialEventById(developmentId, line.commercialEventId);
    if (!liveEvent) {
      errors.push(
        `Recovery event ${line.sourceEventNumber || line.commercialEventId} no longer exists. Re-open the certificate and remove stale lines.`
      );
      continue;
    }

    if (liveEvent.packageId !== orderKey) {
      errors.push(
        `Recovery event ${line.sourceEventNumber || liveEvent.eventNumber} is no longer on this package.`
      );
      continue;
    }

    const eligibilityReason = getRecoveryDeductionEligibilityReason(liveEvent);
    if (eligibilityReason) {
      errors.push(`${line.sourceEventNumber || liveEvent.eventNumber}: ${eligibilityReason}`);
      continue;
    }

    const amountCheck = validateRecoveryDeductionAmount(
      line.amountThisCertificate,
      liveEvent,
      orderKey,
      { excludeCertificateId: certificateId }
    );

    if (!amountCheck.valid) {
      errors.push(
        `${line.sourceEventNumber || liveEvent.eventNumber}: ${amountCheck.errors.join(' ')}`
      );
    }

    if (
      line.sourceEventValue != null &&
      roundMoney(line.sourceEventValue) !== roundMoney(liveEvent.value)
    ) {
      errors.push(
        `${line.sourceEventNumber || liveEvent.eventNumber} has changed since this line was added. Remove the line and add it again.`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    recoveryLines: lines,
  };
}

export function deriveRecoveryStatusAfterDeduction(event, newRecoveredAmount) {
  const recoveryMagnitude = getRecoveryMagnitude(event);
  const recovered = roundMoney(toNumber(newRecoveredAmount));

  if (recovered <= 0) {
    return COMMERCIAL_EVENT_RECOVERY_STATUSES.outstanding.key;
  }
  if (recovered >= recoveryMagnitude - Number.EPSILON) {
    return COMMERCIAL_EVENT_RECOVERY_STATUSES.fullyRecovered.key;
  }
  return COMMERCIAL_EVENT_RECOVERY_STATUSES.partiallyRecovered.key;
}

export function applyRecoveryDeductionsOnCertificateApproval({
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

  if (certificate.recoveryDeductionsApplied) {
    return { ok: true, applied: [], skipped: true };
  }

  const recoveryLines = normalizeCommercialLines(certificate.commercialLines).filter(
    (line) => line.lineType === CERTIFICATE_COMMERCIAL_LINE_TYPES.recoveryDeduction
  );

  const applied = [];

  for (const line of recoveryLines) {
    const event = getCommercialEventById(developmentId, line.commercialEventId);
    if (!event) continue;

    const deductionMagnitude = Math.abs(toNumber(line.amountThisCertificate));
    if (deductionMagnitude <= 0) continue;

    const newRecovered = calculateCertificateDerivedRecoveredAmount(orderKey, event.id);
    const priorRecovered = roundMoney(toNumber(event.recoveredAmount));
    const priorStatus = normalizeRecoveryStatusKey(event.recoveryStatus);
    const nextStatus = deriveRecoveryStatusAfterDeduction(event, newRecovered);

    const comment = [
      `Certificate No. ${certificate.certificateNumber} (${certificate.id})`,
      `Recovery deduction this certificate: £${formatMoney(deductionMagnitude)}`,
      `Prior recoveredAmount: £${formatMoney(priorRecovered)}`,
      `New recoveredAmount: £${formatMoney(newRecovered)}`,
      `Prior recoveryStatus: ${priorStatus}`,
      `New recoveryStatus: ${nextStatus}`,
    ].join(' · ');

    const result = updateRecoveryStatus(developmentId, event.id, nextStatus, {
      actor,
      comment,
      recoveredAmount: newRecovered,
    });

    if (result.ok) {
      applied.push({ line, event: result.event });
    }
  }

  return { ok: true, applied };
}
