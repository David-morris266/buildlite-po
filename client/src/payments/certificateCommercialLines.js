/**
 * BL-025.2 / BL-025.3 — Certificate commercial line helpers (Doc 64 / Doc 65).
 */

import {
  getCommercialEventById,
  listCommercialEventsByPackage,
} from '../commercialEvents/commercialEventStore';
import {
  getCommercialEventCertifiabilityReason,
  isCommercialEventCertifiable,
  CERTIFICATE_COMMERCIAL_LINE_TYPES,
} from '../commercialEvents/commercialEventCertifiability';
import { getCommercialEventTypeMeta } from '../commercialEvents/commercialEventTypes';
import { formatMoney } from '../components/poDrawerHelpers';
import { roundMoney } from './paymentCertificateCalculations';
import {
  getCertificate,
  isApprovedCommercialCertificate,
  isCertificateEditable,
  listCertificates,
} from './paymentCertificateStore';

function readStoredMoney(value) {
  if (value == null || value === '') return null;
  return roundMoney(value);
}

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

function newCommercialLineId() {
  return `cel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeCommercialLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines.map((line) => ({ ...line }));
}

export function normalizeCertificateCommercialLines(certificate) {
  if (!certificate) return [];
  return normalizeCommercialLines(certificate.commercialLines);
}

/**
 * Sum amountThisCertificate from approved/locked certificates only.
 * Draft and submitted certificates do not count as previously certified.
 */
export function calculateCommercialEventCertifiedToDate(
  orderKey,
  commercialEventId,
  { excludeCertificateId = null } = {}
) {
  if (!orderKey || !commercialEventId) return 0;

  return listCertificates(orderKey)
    .filter(
      (certificate) =>
        isApprovedCommercialCertificate(certificate) &&
        certificate.id !== excludeCertificateId
    )
    .reduce((sum, certificate) => {
      const line = normalizeCommercialLines(certificate.commercialLines).find(
        (item) => item.commercialEventId === commercialEventId
      );
      return sum + toNumber(line?.amountThisCertificate);
    }, 0);
}

export function getMaxAmountThisCertificate(sourceEventValue, previouslyCertified) {
  return roundMoney(toNumber(sourceEventValue) - toNumber(previouslyCertified));
}

export function calculateCommercialEventRemaining(
  sourceEventValue,
  previouslyCertified,
  amountThisCertificate = 0
) {
  return roundMoney(
    toNumber(sourceEventValue) -
      toNumber(previouslyCertified) -
      toNumber(amountThisCertificate)
  );
}

export function validateCommercialLineAmount(
  amountThisCertificate,
  sourceEventValue,
  previouslyCertified
) {
  const amount = roundMoney(amountThisCertificate);
  const source = toNumber(sourceEventValue);
  const maxAmount = getMaxAmountThisCertificate(source, previouslyCertified);

  if (amount === 0) {
    return { valid: false, errors: ['Enter an amount for this certificate.'] };
  }

  if (source >= 0) {
    if (amount < 0) {
      return {
        valid: false,
        errors: ['Positive commercial events must use a positive certificate amount.'],
      };
    }
    if (amount > maxAmount + Number.EPSILON) {
      return {
        valid: false,
        errors: [
          `Amount cannot exceed the remaining event value of £${formatMoney(maxAmount)}.`,
        ],
      };
    }
    return { valid: true, errors: [], amount, maxAmount };
  }

  if (amount > 0) {
    return {
      valid: false,
      errors: ['Credit events must use a negative certificate amount.'],
    };
  }
  if (amount < maxAmount - Number.EPSILON) {
    return {
      valid: false,
      errors: [
        `Amount cannot exceed the remaining credit of £${formatMoney(maxAmount)}.`,
      ],
    };
  }

  return { valid: true, errors: [], amount, maxAmount };
}

export function buildCommercialLineFromEvent(event, amountThisCertificate, actor = sessionActor()) {
  const now = new Date().toISOString();
  return {
    id: newCommercialLineId(),
    commercialEventId: event.id,
    lineType: CERTIFICATE_COMMERCIAL_LINE_TYPES.valueInclusion,
    amountThisCertificate: roundMoney(amountThisCertificate),
    sourceEventNumber: event.eventNumber || '',
    sourceEventType: event.eventType || '',
    description: event.description || '',
    sourceEventValue: toNumber(event.value),
    createdAt: now,
    createdBy: actor,
  };
}

export function buildCommercialLineDisplayRow({
  line,
  orderKey,
  certificateId,
  developmentId,
  liveEvent = null,
}) {
  const sourceEventValue = toNumber(line.sourceEventValue);
  const previouslyCertified = calculateCommercialEventCertifiedToDate(
    orderKey,
    line.commercialEventId,
    { excludeCertificateId: certificateId }
  );
  const amountThisCertificate = toNumber(line.amountThisCertificate);
  const remaining = calculateCommercialEventRemaining(
    sourceEventValue,
    previouslyCertified,
    amountThisCertificate
  );
  const maxAmount = getMaxAmountThisCertificate(sourceEventValue, previouslyCertified);
  const typeMeta = getCommercialEventTypeMeta(line.sourceEventType);

  return {
    ...line,
    eventNumber: line.sourceEventNumber,
    typeLabel: typeMeta.label,
    approvedValue: sourceEventValue,
    previouslyCertified,
    amountThisCertificate,
    remaining,
    maxAmount,
    liveEvent,
    stale: Boolean(
      liveEvent &&
        (liveEvent.packageId !== orderKey || !isCommercialEventCertifiable(liveEvent))
    ),
  };
}

export function buildCertificateCommercialLineRows(
  orderKey,
  certificate,
  developmentId
) {
  if (!certificate) return [];

  return normalizeCommercialLines(certificate.commercialLines).map((line) =>
    buildCommercialLineDisplayRow({
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

export function sumCommercialLinesThisCertificate(commercialLines) {
  return sumValueInclusionCommercialLines(commercialLines);
}

/** Sum signed valueInclusion lines on a certificate (BL-025.3). */
export function sumValueInclusionCommercialLines(commercialLines) {
  return roundMoney(
    normalizeCommercialLines(commercialLines)
      .filter(
        (line) =>
          !line.lineType ||
          line.lineType === CERTIFICATE_COMMERCIAL_LINE_TYPES.valueInclusion
      )
      .reduce((sum, line) => sum + toNumber(line.amountThisCertificate), 0)
  );
}

/** Prior approved certificates' combined commercial-event gross (BL-025.3). */
export function calculatePreviousApprovedCommercialEventGross(orderKey, certificate) {
  if (!orderKey || !certificate) return 0;

  return roundMoney(
    listCertificates(orderKey)
      .filter(
        (item) =>
          isApprovedCommercialCertificate(item) &&
          item.certificateNumber < certificate.certificateNumber
      )
      .reduce(
        (sum, item) => sum + sumValueInclusionCommercialLines(item.commercialLines),
        0
      )
  );
}

/** Prior approved certificates' combined gross works (matrix + CE), from stored grossValue. */
export function calculatePreviousApprovedGrossWorks(orderKey, certificate) {
  if (!orderKey || !certificate) return 0;

  return roundMoney(
    listCertificates(orderKey)
      .filter(
        (item) =>
          isApprovedCommercialCertificate(item) &&
          item.certificateNumber < certificate.certificateNumber
      )
      .reduce((sum, item) => sum + (readStoredMoney(item.grossValue) ?? 0), 0)
  );
}

export function formatSignedCommercialLineTotal(value) {
  const amount = roundMoney(value);
  if (amount === 0) return '£0.00';
  const prefix = amount > 0 ? '+' : '-';
  return `${prefix}£${formatMoney(Math.abs(amount))}`;
}

export function listEligibleCommercialEvents(developmentId, orderKey, certificate) {
  if (!developmentId || !orderKey || !certificate) return [];

  const existingIds = new Set(
    normalizeCommercialLines(certificate.commercialLines).map(
      (line) => line.commercialEventId
    )
  );

  const events = listCommercialEventsByPackage(developmentId, orderKey);

  return events.filter((event) => {
    if (!isCommercialEventCertifiable(event)) return false;
    if (event.packageId !== orderKey) return false;
    if (existingIds.has(event.id)) return false;

    const previouslyCertified = calculateCommercialEventCertifiedToDate(
      orderKey,
      event.id,
      { excludeCertificateId: certificate.id }
    );
    const remaining = calculateCommercialEventRemaining(
      event.value,
      previouslyCertified,
      0
    );

    if (sourceEventHasNoRemaining(event.value, remaining)) return false;
    return true;
  });
}

function sourceEventHasNoRemaining(sourceEventValue, remaining) {
  const source = toNumber(sourceEventValue);
  const left = roundMoney(remaining);
  if (source >= 0) return left <= 0;
  return left >= 0;
}

export function validateCommercialLinesForCertificate({
  orderKey,
  certificateId,
  developmentId,
  commercialLines,
}) {
  const certificate = getCertificate(orderKey, certificateId);
  if (!certificate) {
    return { valid: false, errors: ['Certificate not found.'] };
  }

  if (!isCertificateEditable(certificate)) {
    return { valid: false, errors: ['Only draft certificates can edit commercial lines.'] };
  }

  const lines = normalizeCommercialLines(commercialLines);
  const errors = [];
  const seenEventIds = new Set();

  for (const line of lines) {
    if (!line.commercialEventId) {
      errors.push('Each commercial line must reference a commercial event.');
      continue;
    }

    if (seenEventIds.has(line.commercialEventId)) {
      errors.push(
        `Commercial event ${line.sourceEventNumber || line.commercialEventId} appears more than once on this certificate.`
      );
    }
    seenEventIds.add(line.commercialEventId);

    const liveEvent = getCommercialEventById(developmentId, line.commercialEventId);
    if (!liveEvent) {
      errors.push(
        `Commercial event ${line.sourceEventNumber || line.commercialEventId} no longer exists. Re-open the certificate and remove stale lines.`
      );
      continue;
    }

    if (liveEvent.packageId !== orderKey) {
      errors.push(
        `Commercial event ${line.sourceEventNumber || liveEvent.eventNumber} is no longer on this package.`
      );
      continue;
    }

    const certifiabilityReason = getCommercialEventCertifiabilityReason(liveEvent);
    if (certifiabilityReason) {
      errors.push(
        `${line.sourceEventNumber || liveEvent.eventNumber}: ${certifiabilityReason}`
      );
      continue;
    }

    const previouslyCertified = calculateCommercialEventCertifiedToDate(
      orderKey,
      line.commercialEventId,
      { excludeCertificateId: certificateId }
    );
    const sourceEventValue = toNumber(liveEvent.value);
    const amountCheck = validateCommercialLineAmount(
      line.amountThisCertificate,
      sourceEventValue,
      previouslyCertified
    );

    if (!amountCheck.valid) {
      errors.push(
        `${line.sourceEventNumber || liveEvent.eventNumber}: ${amountCheck.errors.join(' ')}`
      );
    }

    if (line.sourceEventValue != null && roundMoney(line.sourceEventValue) !== roundMoney(sourceEventValue)) {
      errors.push(
        `${line.sourceEventNumber || liveEvent.eventNumber} has changed since this line was added. Remove the line and add it again.`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    commercialLines: lines,
  };
}
