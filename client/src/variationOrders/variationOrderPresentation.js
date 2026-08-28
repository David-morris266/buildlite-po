import { COMMERCIAL_EVENT_STATUSES } from '../commercialEvents/commercialEventTypes';
import { isRecoveryCommercialEvent } from '../commercialEvents/commercialEventRegisterBadges';

const ELIGIBLE_TYPES = new Set(['variation', 'credit', 'salesUpgrade', 'valueEngineering', 'employerInstruction']);

export function canCreateVariationOrder(event) {
  return Boolean(
    event &&
    event.status === COMMERCIAL_EVENT_STATUSES.approved.key &&
    ELIGIBLE_TYPES.has(event.eventType) &&
    event.eventType !== 'budgetTransfer' &&
    !isRecoveryCommercialEvent(event)
  );
}

export function variationOrderStatusLabel(status) {
  return ({ draft: 'Draft', submitted: 'Submitted', approved: 'Approved', issued: 'Issued', rejected: 'Rejected' })[status] || status || 'Unknown';
}

export function formatVariationOrderReference(vo) {
  return vo?.displayReference || (vo?.sourcePoNumber && vo?.variationOrderNumber
    ? `${vo.sourcePoNumber}/${vo.variationOrderNumber}`
    : vo?.variationOrderNumber || 'Variation Order');
}
