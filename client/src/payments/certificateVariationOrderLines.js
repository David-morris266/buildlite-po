import { roundMoney } from './paymentCertificateCalculations';

function actor() {
  if (typeof localStorage === 'undefined') return 'Commercial Manager';
  return localStorage.getItem('userName') || localStorage.getItem('userEmail') || 'Commercial Manager';
}

export function variationOrderLineKey(line) {
  return `${line?.variationOrderId || ''}:${line?.variationOrderLineId || ''}`;
}

export function buildVariationOrderCertificateLine(authority, amountThisCertificate) {
  return {
    id: `cel-vo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    lineType: 'valueInclusion',
    sourceType: 'variationOrder',
    variationOrderId: authority.variationOrderId,
    variationOrderLineId: authority.variationOrderLineId,
    sourceReference: authority.variationOrderReference,
    sourcePoNumber: authority.sourcePoNumber,
    sourceCostCode: authority.costCode,
    description: authority.description,
    sourceValue: roundMoney(authority.issuedLineValue),
    sourcePreviouslyCertified: roundMoney(authority.previouslyCertifiedValue),
    sourceRemainingAtAdd: roundMoney(authority.remainingCertifiableValue),
    amountThisCertificate: roundMoney(amountThisCertificate),
    createdAt: new Date().toISOString(),
    createdBy: actor(),
  };
}

export function validateVariationOrderDraftAmount(authority, rawAmount) {
  const amount = roundMoney(rawAmount);
  const remaining = roundMoney(authority?.remainingCertifiableValue);
  if (!authority?.eligible) return { valid: false, errors: [authority?.exception || 'This Issued Variation Order line is not certifiable.'] };
  if (!amount) return { valid: false, errors: ['Enter a non-zero amount for this certificate.'] };
  if (Math.sign(amount) !== Math.sign(remaining)) return { valid: false, errors: ['Amount must preserve the Issued Variation Order line sign.'] };
  if (Math.abs(amount) > Math.abs(remaining) + 0.005) return { valid: false, errors: [`Amount cannot exceed the remaining VO-line authority of £${remaining.toFixed(2)}.`] };
  return { valid: true, errors: [], amount };
}
