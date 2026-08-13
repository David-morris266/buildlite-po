/**
 * BL-028B.2 — Certificate-driven certification overlay.
 *
 * Local approved Payment Certificate valueInclusion lines are the presentation
 * source of truth. Server/imported event.certificateStatus is transitional metadata only.
 */

export {
  buildCommercialEventCertificateLifecycleView,
  calculateValueInclusionCertifiedToDate,
  deriveCertificateStatusFromCertification,
  getCommercialEventCertificationBadges,
  getCommercialEventCertificationPresentation,
  hasCommercialEventCertificationRemaining,
  isSubjectToCertificateLifecycleReconciliation,
} from './commercialEventCertificateLifecycle';

import {
  buildCommercialEventCertificateLifecycleView,
  isSubjectToCertificateLifecycleReconciliation,
} from './commercialEventCertificateLifecycle';

/**
 * Derive certification presentation from local approved certificate history.
 *
 * @param {{ event: object, orderKey: string, excludeCertificateId?: string|null }} params
 */
export function buildCommercialEventCertificationOverlay({
  event,
  orderKey,
  excludeCertificateId = null,
}) {
  if (!event?.id || !orderKey) {
    return null;
  }

  if (!isSubjectToCertificateLifecycleReconciliation(event)) {
    return null;
  }

  const lifecycle = buildCommercialEventCertificateLifecycleView(event, orderKey, {
    excludeCertificateId,
  });

  return {
    eventId: event.id,
    orderKey,
    approvedValue: lifecycle.approvedValue,
    certifiedToDate: lifecycle.certifiedAmount,
    remainingToCertify: lifecycle.remainingAmount,
    certificateStatus: lifecycle.certificateStatus,
    source: 'local-certificate-history',
  };
}
