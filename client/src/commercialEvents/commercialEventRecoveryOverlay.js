/**
 * BL-028B.2 — Certificate-driven recovery overlay.
 *
 * Local approved recoveryDeduction certificate lines are the source of truth for
 * certificate-driven recovered amount. CE-native recoveryStatus (closed, writtenOff,
 * notApplicable) remains authoritative for workflow gating.
 */

import { roundMoney } from '../payments/paymentCertificateCalculations';
import {
  isApprovedCommercialCertificate,
  resolveCertificatesForPackage,
} from '../payments/paymentCertificateStore';
import { normalizeCommercialLines } from '../payments/certificateCommercialLines';
import { CERTIFICATE_COMMERCIAL_LINE_TYPES } from './commercialEventCertifiability';
import { isCommercialEventServerAuthorityEnabled } from './commercialEventAuthority';
import { isPaymentCertificateServerAuthorityEnabled } from '../payments/paymentCertificateAuthority';
import { isRecoveryCommercialEvent } from './commercialEventRegisterBadges';
import { isActiveRecovery } from './commercialEventRecovery';
import {
  COMMERCIAL_EVENT_RECOVERY_STATUSES,
  normalizeRecoveryStatusKey,
} from './commercialEventTypes';

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const CE_NATIVE_TERMINAL_RECOVERY_STATUSES = new Set([
  COMMERCIAL_EVENT_RECOVERY_STATUSES.closed.key,
  COMMERCIAL_EVENT_RECOVERY_STATUSES.writtenOff.key,
]);

/**
 * Sum approved recoveryDeduction magnitudes from local certificate history.
 */
export function calculateCertificateDerivedRecoveredAmount(
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
            item.commercialEventId === commercialEventId &&
            item.lineType === CERTIFICATE_COMMERCIAL_LINE_TYPES.recoveryDeduction
        );
        return sum + Math.abs(toNumber(line?.amountThisCertificate));
      }, 0)
  );
}

export function hasApprovedRecoveryCertificateHistory(orderKey, commercialEventId) {
  const recovered = calculateCertificateDerivedRecoveredAmount(orderKey, commercialEventId);
  return recovered != null && recovered > 0;
}

/**
 * Resolve recovered amount for certificate-driven presentation.
 *
 * Server authority ON: certificate history only (never event.recoveredAmount).
 * Server authority OFF: certificate history wins; event.recoveredAmount is a legacy
 * fallback only when no approved certificate deductions exist.
 */
export function resolveCertificateDerivedRecoveredAmount(event, orderKey, options = {}) {
  const fromCertificates = calculateCertificateDerivedRecoveredAmount(
    orderKey,
    event?.id,
    options
  );

  if (fromCertificates == null) return null;

  if (isCommercialEventServerAuthorityEnabled()) {
    return fromCertificates;
  }

  if (fromCertificates > 0) {
    return fromCertificates;
  }

  return roundMoney(toNumber(event?.recoveredAmount));
}

export function deriveCertificateRecoveryProgressStatus(recoveryMagnitude, recoveredToDate) {
  const recovered = roundMoney(toNumber(recoveredToDate));

  if (recovered <= 0) {
    return COMMERCIAL_EVENT_RECOVERY_STATUSES.outstanding.key;
  }
  if (recovered >= recoveryMagnitude - Number.EPSILON) {
    return COMMERCIAL_EVENT_RECOVERY_STATUSES.fullyRecovered.key;
  }
  return COMMERCIAL_EVENT_RECOVERY_STATUSES.partiallyRecovered.key;
}

function getRecoveryMagnitude(event) {
  return roundMoney(Math.abs(toNumber(event?.value)));
}

/**
 * Combine CE-native workflow state with certificate-derived recovery progress.
 * Does not mutate the event.
 */
export function getCommercialEventRecoveryPresentation(event, orderKey, options = {}) {
  if (!event?.id || !orderKey || !isRecoveryCommercialEvent(event)) {
    return null;
  }

  const ceNativeStatus = normalizeRecoveryStatusKey(event.recoveryStatus);
  const recoveryMagnitude = getRecoveryMagnitude(event);
  const recoveredToDate = resolveCertificateDerivedRecoveredAmount(event, orderKey, options);
  if (recoveredToDate == null) {
    return {
      eventId: event.id,
      orderKey,
      recoveryMagnitude,
      recoveredToDate: null,
      remainingRecovery: null,
      certificateDerivedStatus: null,
      ceNativeRecoveryStatus: ceNativeStatus,
      presentationRecoveryStatus: null,
      isFullyRecoveredByCertificates: false,
      isActiveForRecovery: false,
      certificatesReady: false,
      unavailable: true,
      source: 'certificate-cache-unready',
    };
  }

  const remainingRecovery = roundMoney(Math.max(0, recoveryMagnitude - recoveredToDate));
  const certificateDerivedStatus = deriveCertificateRecoveryProgressStatus(
    recoveryMagnitude,
    recoveredToDate
  );

  let presentationRecoveryStatus = certificateDerivedStatus;
  if (CE_NATIVE_TERMINAL_RECOVERY_STATUSES.has(ceNativeStatus)) {
    presentationRecoveryStatus = ceNativeStatus;
  } else if (ceNativeStatus === COMMERCIAL_EVENT_RECOVERY_STATUSES.notApplicable.key) {
    presentationRecoveryStatus = ceNativeStatus;
  }

  const isFullyRecoveredByCertificates =
    recoveredToDate >= recoveryMagnitude - Number.EPSILON;

  return {
    eventId: event.id,
    orderKey,
    recoveryMagnitude,
    recoveredToDate,
    remainingRecovery,
    certificateDerivedStatus,
    ceNativeRecoveryStatus: ceNativeStatus,
    presentationRecoveryStatus,
    isFullyRecoveredByCertificates,
    isActiveForRecovery:
      isActiveRecovery(event) && !CE_NATIVE_TERMINAL_RECOVERY_STATUSES.has(ceNativeStatus),
    certificatesReady: true,
    unavailable: false,
    source: isPaymentCertificateServerAuthorityEnabled()
      ? 'server-certificate-history'
      : 'local-certificate-history',
  };
}

export function getRecoveryCommercialStatusForPresentation(event, orderKey) {
  const presentation = getCommercialEventRecoveryPresentation(event, orderKey);
  if (!presentation || presentation.unavailable) return event?.status;
  if (
    presentation.ceNativeRecoveryStatus === COMMERCIAL_EVENT_RECOVERY_STATUSES.writtenOff.key ||
    presentation.ceNativeRecoveryStatus === COMMERCIAL_EVENT_RECOVERY_STATUSES.closed.key
  ) return 'closed';
  if (event?.status === 'closed' && presentation.recoveredToDate <= 0) return 'closed';
  return presentation.isFullyRecoveredByCertificates ? 'closed' : 'approved';
}

export function shouldPersistCertificateDrivenCeState() {
  return !isCommercialEventServerAuthorityEnabled();
}
