const { isApprovedPo, getPoCommittedNet, getPoNumber } = require('./purchaseOrderAuthority');

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const positive = (value) => Math.max(0, money(value));
const signedSum = (items, selector) => money((items || []).reduce((sum, item) => sum + money(selector(item)), 0));

function lockedMatrixGross(certificate) {
  return money(certificate?.valuationSnapshot?.totals?.matrixGrossThisCertificate ?? certificate?.matrixGross ?? 0);
}

function buildPaymentCertificateSourceAuthority({
  certificateId,
  matrixGross = 0,
  approvedPos = [],
  priorLockedCertificates = [],
  commercialLines = [],
  paymentDiscoveredItems = [],
  variationAssessments = [],
  validatedCommercialLines = null,
  capturedAt = null,
  capturedBy = null,
} = {}) {
  const poFacts = (approvedPos || []).filter(isApprovedPo).map((po) => ({
    poNumber: getPoNumber(po),
    approvedNet: money(getPoCommittedNet(po)),
    status: po?.approval?.status || po?.status || 'approved',
    approvedAt: po?.approval?.decidedAt || po?.approvedAt || null,
    version: po?._rowVersion ?? po?.version ?? null,
  }));
  const approvedPoAuthority = signedSum(poFacts, (po) => po.approvedNet);
  const priorOrderedPositive = money((priorLockedCertificates || []).reduce(
    (sum, certificate) => sum + positive(lockedMatrixGross(certificate)), 0
  ));
  const remainingPoAuthority = positive(approvedPoAuthority - priorOrderedPositive);
  const orderedPositive = positive(matrixGross);
  const orderedExcess = positive(orderedPositive - remainingPoAuthority);

  const validIds = validatedCommercialLines instanceof Set ? validatedCommercialLines : null;
  const ceLines = [];
  const voLines = [];
  const invalidLines = [];
  for (const line of commercialLines || []) {
    if (line.lineType === 'recoveryDeduction') continue;
    const fact = {
      lineId: line.id || null,
      sourceType: line.sourceType || 'commercialEvent',
      commercialEventId: line.commercialEventId || null,
      variationOrderId: line.variationOrderId || null,
      variationOrderLineId: line.variationOrderLineId || null,
      reference: line.sourceReference || line.eventNumber || null,
      amount: money(line.amountThisCertificate),
      authorityStatus: line.authorityStatus || null,
      authorityVersion: line.authorityVersion ?? null,
      sourceValue: money(line.sourceValue),
      sourcePreviouslyCertified: money(line.sourcePreviouslyCertified),
      sourceRemainingAtAdd: money(line.sourceRemainingAtAdd),
    };
    if (validIds && !validIds.has(line.id)) invalidLines.push(fact);
    else if (fact.sourceType === 'variationOrder') voLines.push(fact);
    else ceLines.push(fact);
  }
  const discoveredFacts = (paymentDiscoveredItems || []).map((item) => ({
    id: item.id,
    description: item.description,
    costCode: item.costCode || item.cost_code,
    signedAmount: money(item.signedAmount ?? item.signed_amount),
    basis: item.basis,
    status: item.status,
    createdAt: item.createdAt || item.created_at,
    createdBy: item.createdBy || {
      userId: item.created_by_user_id,
      membershipId: item.created_by_membership_id,
      providerUserId: item.created_by_provider_user_id,
      displayName: item.created_by_display_name,
    },
  }));
  const variationAssessmentFacts=(variationAssessments||[]).map(item=>({id:item.id,variationAccountItemId:item.variationAccountItemId,variationReference:item.variationReference||null,description:item.description||null,applicationVariationLineId:item.applicationVariationLineId||null,signedAmount:money(item.currentAssessment),previousCertified:money(item.previousCertified),cumulativeCertified:money(item.cumulativeCertified),basis:item.basis,createdBy:item.createdBy,priorAuthority:0,unapprovedAmount:positive(item.currentAssessment)}));
  const recoverySigned = signedSum(commercialLines.filter((line) => line.lineType === 'recoveryDeduction'), (line) => line.amountThisCertificate);
  const discoveredPositive = money(discoveredFacts.reduce((sum, item) => sum + positive(item.signedAmount), 0));
  const variationPositive=money(variationAssessmentFacts.reduce((sum,item)=>sum+positive(item.signedAmount),0));
  const discoveredCredits = money(discoveredFacts.reduce((sum, item) => sum + Math.min(0, item.signedAmount), 0));
  const invalidPositive = money(invalidLines.reduce((sum, line) => sum + positive(line.amount), 0));
  const invalidCredits = money(invalidLines.reduce((sum, line) => sum + Math.min(0, line.amount), 0));
  const exceptions = [];
  if (orderedExcess > 0) exceptions.push({ code: 'ordered_authority_exceeded', amount: orderedExcess });
  if (discoveredPositive > 0) exceptions.push({ code: 'legacy_payment_discovered_unapproved', amount: discoveredPositive });
  if (variationPositive > 0) exceptions.push({ code: 'variation_assessment_unapproved', amount: variationPositive });
  if (invalidPositive > 0) exceptions.push({ code: 'commercial_authority_invalid', amount: invalidPositive });

  const approvedCeGross=signedSum(ceLines,(line)=>line.amount);
  const issuedVoGross=signedSum(voLines,(line)=>line.amount);
  const paymentDiscoveredGross=signedSum(discoveredFacts,(item)=>item.signedAmount);
  const variationAssessmentGross=signedSum(variationAssessmentFacts,item=>item.signedAmount);
  const unapprovedCertifiedGross=money(Math.max(0,discoveredPositive+variationPositive+orderedExcess+invalidPositive));
  return {
    schemaVersion: 1,
    state: 'captured',
    certificateId: certificateId || null,
    capturedAt,
    capturedBy,
    orderedWorkGross: money(matrixGross),
    approvedPoAuthority,
    priorOrderedWorkCertifiedPositive: priorOrderedPositive,
    remainingApprovedPoAuthorityBeforeCertificate: remainingPoAuthority,
    orderedWorkBackedGross: money(Math.min(orderedPositive, remainingPoAuthority)),
    orderedWorkExcessGross: orderedExcess,
    approvedCeGross,
    issuedVoGross,
    paymentDiscoveredGross,
    variationAssessmentGross,
    paymentDiscoveredPositiveGross: discoveredPositive,
    signedUnapprovedCredits: money(discoveredCredits + invalidCredits + Math.min(0, money(matrixGross))),
    invalidCommercialInclusionGross: signedSum(invalidLines, (line) => line.amount),
    unapprovedCertifiedGross,
    recoverySigned,
    ordered_work_gross: money(matrixGross),
    approved_po_authority: approvedPoAuthority,
    approved_ce_gross: approvedCeGross,
    issued_vo_gross: issuedVoGross,
    payment_discovered_gross: paymentDiscoveredGross,
    unapproved_certified_gross: unapprovedCertifiedGross,
    recovery_signed: recoverySigned,
    exceptions,
    evidence: { approvedPos: poFacts, approvedCeLines: ceLines, issuedVoLines: voLines, invalidCommercialLines: invalidLines, paymentDiscoveredItems: discoveredFacts, variationAssessments:variationAssessmentFacts },
  };
}

function legacySourceAuthority() {
  return { schemaVersion: null, state: 'not_captured', message: 'Source authority was not captured when this historic certificate was locked.' };
}

module.exports = { buildPaymentCertificateSourceAuthority, legacySourceAuthority };
