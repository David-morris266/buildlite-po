const {
  getPoCommittedNet,
  getPoNumber,
} = require('./purchaseOrderAuthority');
const {
  isQualifyingContractEvent,
  money,
  voValue,
} = require('./variationOrderAuthority');
const { getApprovedCertificateValue, normaliseCostCodeKey } = require('./cvrCloseFormulas');

const COMMERCIAL_EVIDENCE_KEY = 'commercialEvidence';
const COMMERCIAL_EVIDENCE_VERSION = 'cvr_commercial_evidence_v1';
const MAX_LEDGER_ITEMS_PER_COST_CODE = 50;

function text(value, max = 240) {
  return String(value || '').trim().slice(0, max);
}

function actorLabel(value) {
  if (!value || typeof value !== 'object') return text(value, 160);
  return text(value.displayName || value.name || value.email || value.userId, 160);
}

function actorEvidence(actor, at, action) {
  return {
    actor: actorLabel(actor) || null,
    at: at || null,
    action,
  };
}

function poApprovalEvidence(po) {
  const history = Array.isArray(po?.approval?.history) ? po.approval.history : [];
  const approved = [...history].reverse().find((entry) =>
    ['approve', 'approved'].includes(String(entry?.action || '').toLowerCase())
  );
  return actorEvidence(
    approved?.by || po?.approval?.approvedBy || po?.approvedBy,
    approved?.at || po?.approval?.approvedAt || po?.approval?.decidedAt || po?.approvedAt,
    'Approved PO'
  );
}

function eventAuthorityEvidence(event) {
  const history = Array.isArray(event?.auditHistory)
    ? event.auditHistory
    : Array.isArray(event?.auditTrail) ? event.auditTrail : [];
  const status = String(event?.status || '').toLowerCase();
  const matching = [...history].reverse().find((entry) =>
    String(entry?.newStatus || entry?.status || '').toLowerCase() === status
  );
  return actorEvidence(
    (status === 'submitted' && event?.submittedBy) || matching?.actor || matching?.by,
    (status === 'submitted' && event?.submittedAt) || matching?.timestamp || matching?.createdAt,
    status === 'submitted' ? 'Submitted CE' : 'Approved CE authority'
  );
}

function item({ type, id, reference, description, amount, includedAmount = amount,
  status, authority, navigation = null, orderKey = null, relatedIds = [] }) {
  return {
    type,
    id: id ? String(id) : null,
    reference: text(reference, 120) || 'Unreferenced record',
    description: text(description),
    amount: money(amount),
    includedAmount: money(includedAmount),
    status: text(status, 80) || null,
    authority,
    navigation,
    orderKey,
    relatedIds: relatedIds.filter(Boolean).map(String),
  };
}

function group(items, total = null, extra = {}) {
  const itemTotal = money(items.reduce((sum, entry) => sum + Number(entry.includedAmount || 0), 0));
  const supportingTotal = extra.supportingTotal == null ? itemTotal : money(extra.supportingTotal);
  const includedTotal = total == null
    ? supportingTotal
    : money(total);
  const authoritativeTotal = extra.authoritativeTotal == null ? includedTotal : money(extra.authoritativeTotal);
  const reconciles = supportingTotal === authoritativeTotal;
  return { count: items.length, total: authoritativeTotal, supportingTotal,
    reconciliation: reconciles ? 'reconciled' : 'unreconciled', items, ...extra };
}

function sourceEventIds(vo) {
  return (vo?.sourceCommercialEvents || [])
    .map((source) => source.commercialEventId || source.id)
    .filter(Boolean)
    .map(String);
}

function commitmentItemsForFact(fact) {
  const items = [];
  const order = fact.order;
  const purchaseOrders = order?.purchaseOrders || (fact.purchaseOrder ? [fact.purchaseOrder] : []);
  for (const po of purchaseOrders) {
    const orderKey = order?.orderKey || null;
    items.push(item({ type: 'purchase_order', id: getPoNumber(po), reference: getPoNumber(po),
      description: po?.title || po?.description || po?.supplierSnapshot?.name || po?.supplierName,
      amount: getPoCommittedNet(po), status: 'approved', authority: poApprovalEvidence(po), orderKey,
      navigation: orderKey ? { type: 'package', orderKey, tab: 'overview' } : null }));
  }
  const displaced = new Set((fact.variationOrders || []).filter((vo) => vo?.status === 'issued')
    .map((vo) => vo.supersedesId).filter(Boolean).map(String));
  const supersededEvents = new Set((fact.authority?.supersededCommercialEventIds || []).map(String));
  for (const event of fact.events || []) {
    if (!isQualifyingContractEvent(event)) continue;
    const replaced = supersededEvents.has(String(event.id));
    items.push(item({ type: 'commercial_event', id: event.id,
      reference: event.eventNumber || event.reference || event.id,
      description: event.description || event.title, amount: event.value,
      includedAmount: replaced ? 0 : event.value,
      status: replaced ? 'replaced by issued VO' : event.status,
      authority: eventAuthorityEvidence(event), orderKey: order?.orderKey,
      navigation: order?.orderKey ? { type: 'package', orderKey: order.orderKey, tab: 'variations' } : null }));
  }
  for (const vo of (fact.variationOrders || []).filter((entry) => entry?.status === 'issued')) {
    const displacedVo = displaced.has(String(vo.id));
    const signedValue = voValue(vo);
    items.push(item({ type: 'variation_order', id: vo.id,
      reference: vo.displayReference || [vo.sourcePoNumber, vo.variationOrderNumber].filter(Boolean).join('/') || vo.reference || vo.id,
      description: vo.description || vo.reference, amount: signedValue,
      includedAmount: displacedVo ? 0 : signedValue,
      status: displacedVo ? 'superseded' : vo.reversesId ? 'issued reversal' : 'issued',
      authority: actorEvidence(vo.issuedBy, vo.issuedAt, 'Issued VO'), orderKey: order?.orderKey,
      navigation: vo.id && order?.orderKey ? {
        type: 'variation_order', variationOrderId: String(vo.id),
        packageId: vo.packageId ? String(vo.packageId) : null, orderKey: order.orderKey,
      } : null,
      relatedIds: [...sourceEventIds(vo), vo.supersedesId, vo.reversesId] }));
  }
  return items;
}

function exposureItem(entry) {
  const ce = entry.commercialEvent;
  const va = entry.va;
  const included = entry.incrementalExposure ?? entry.resultingExposure;
  const latest = Array.isArray(va?.forecastHistory) ? va.forecastHistory.at(-1) : null;
  return item({ type: ce && va ? 'linked_ce_va_exposure' : ce ? 'commercial_event' : 'variation_account',
    id: ce?.id || va?.variationAccountItemId,
    reference: ce?.eventNumber || ce?.reference || va?.reference || va?.vaReference || va?.variationAccountItemId,
    description: ce?.expectedReason || ce?.description || va?.description || latest?.reason,
    amount: entry.resultingExposure, includedAmount: included,
    status: entry.suppressedByTreatment ? `excluded (${entry.expectedTreatment})`
      : entry.absorbedAtSiteStart != null ? 'incremental after Site Start absorption'
        : entry.linked ? 'linked CE / VA directional envelope' : 'governed change exposure',
    authority: ce ? eventAuthorityEvidence(ce) : actorEvidence(latest?.actor || latest?.user,
      latest?.createdAt || latest?.at, 'QS VA forecast decision'),
    orderKey: ce?.orderKey || va?.orderKey || null,
    navigation: ce?.orderKey ? { type: 'package', orderKey: ce.orderKey, tab: 'variations' }
      : va?.variationAccountItemId ? { type: 'variation_account', itemId: va.variationAccountItemId, packageId: va.packageId || null } : null,
    relatedIds: [ce?.id, va?.variationAccountItemId] });
}

function buildCommercialEvidenceByCostCode({ commitmentAuthority = {}, changeExposure = {},
  certifiedAuthority = {}, actualAuthority = {}, certificates = [], ledgerTransactions = [], inputs = [] } = {}) {
  const byKey = new Map();
  const ensure = (rawKey) => {
    const key = normaliseCostCodeKey(rawKey);
    if (!key) return null;
    if (!byKey.has(key)) byKey.set(key, {
      commitments: [], exposure: [], certified: [], actual: [], qs: [],
    });
    return byKey.get(key);
  };

  for (const [key, facts] of commitmentAuthority.evidence || []) {
    const evidence = ensure(key);
    evidence.commitments.push(...facts.flatMap(commitmentItemsForFact));
  }
  for (const [key, entries] of changeExposure.evidence || []) {
    const evidence = ensure(key);
    evidence.exposure.push(...entries.map(exposureItem));
  }

  const codeByOrder = new Map();
  for (const [key, facts] of commitmentAuthority.evidence || []) {
    for (const fact of facts) if (fact.order?.orderKey) codeByOrder.set(fact.order.orderKey, key);
  }
  for (const certificate of certificates) {
    if (!certificate?.status || ['draft', 'submitted'].includes(certificate.status)) continue;
    const key = codeByOrder.get(certificate.orderKey);
    const evidence = ensure(key);
    const value = getApprovedCertificateValue(certificate);
    if (!evidence || value == null) continue;
    evidence.certified.push(item({
      type: 'certificate', id: certificate.id,
      reference: `Certificate ${certificate.certificateNumber}`,
      description: certificate.applicationReference || certificate.assessmentReason || '',
      amount: value, status: certificate.status,
      authority: actorEvidence(certificate.approvedBy, certificate.approvedAt, 'Approved certificate'),
      orderKey: certificate.orderKey,
      navigation: { type: 'certificate', orderKey: certificate.orderKey, certificateId: certificate.id },
    }));
  }

  for (const transaction of ledgerTransactions) {
    const evidence = ensure(transaction.costCodeKey || transaction.costCode);
    if (!evidence) continue;
    evidence.actual.push(item({
      type: 'ledger_transaction', id: transaction.id,
      reference: transaction.invoiceNumber || transaction.reference || transaction.id,
      description: transaction.description || transaction.supplier,
      amount: transaction.netAmount, status: transaction.reversesId ? 'reversal' : 'posted',
      authority: actorEvidence(transaction.createdBy, transaction.createdAt, 'Imported ledger fact'),
      navigation: { type: 'ledger', transactionId: transaction.id },
    }));
  }

  for (const input of inputs) {
    const evidence = ensure(input.costCodeKey);
    if (!evidence) continue;
    const history = Array.isArray(input.displayMetadata?.adjustmentHistory)
      ? input.displayMetadata.adjustmentHistory : [];
    const latest = history.at(-1);
    if (Number(input.commercialAdjustment || 0) !== 0 || input.adjustmentReason) {
      evidence.qs.push(item({
        type: latest?.source || 'projected_adjustment', id: latest?.id || input.id,
        reference: latest?.source === 'prelims_adoption' ? 'Site Prelims adoption'
          : latest?.source === 'selling_costs_adoption' ? 'Selling Costs adoption' : 'Projected Adjustment',
        description: input.adjustmentReason || latest?.reason || latest?.newReason,
        amount: input.commercialAdjustment || 0, status: 'current QS judgement',
        authority: actorEvidence(latest?.user || latest?.actor, latest?.date || latest?.at, 'QS forecast decision'),
      }));
    }
    if (Number(input.manualAccrual || 0) !== 0) {
      evidence.qs.push(item({
        type: 'manual_accrual', id: input.id, reference: 'Manual Accrual',
        description: input.notes || 'Cost incurred not yet in the ledger',
        amount: input.manualAccrual, status: 'current QS judgement',
        authority: actorEvidence(input.updatedBy, input.updatedAt, 'QS accrual decision'),
      }));
    }
  }

  const documents = new Map();
  for (const [key, evidence] of byKey.entries()) {
    const actualItems = [...evidence.actual].sort((a, b) =>
      String(b.authority?.at || '').localeCompare(String(a.authority?.at || ''))
    );
    const visibleActual = actualItems.slice(0, MAX_LEDGER_ITEMS_PER_COST_CODE);
    documents.set(key, {
      version: COMMERCIAL_EVIDENCE_VERSION,
      captured: true,
      commitment: group(evidence.commitments, null, { authoritativeTotal: commitmentAuthority.totals?.get(key) || 0 }),
      exposure: group(evidence.exposure, null, { authoritativeTotal: changeExposure.totals?.get(key) || 0 }),
      certified: group(evidence.certified, null, { authoritativeTotal: certifiedAuthority.totals?.get(key) || 0 }),
      actual: group(visibleActual,
        actualAuthority.totals?.has(key) ? actualAuthority.totals.get(key)
          : actualItems.reduce((sum, entry) => sum + Number(entry.includedAmount || 0), 0), {
          supportingTotal: actualItems.reduce((sum, entry) => sum + Number(entry.includedAmount || 0), 0),
          sourceCount: actualItems.length,
          omittedCount: Math.max(0, actualItems.length - visibleActual.length),
        }),
      qsJudgement: group(evidence.qs),
    });
  }
  return documents;
}

function stripReservedCommercialEvidence(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const { [COMMERCIAL_EVIDENCE_KEY]: _forged, ...safe } = metadata;
  return safe;
}

module.exports = {
  COMMERCIAL_EVIDENCE_KEY,
  COMMERCIAL_EVIDENCE_VERSION,
  MAX_LEDGER_ITEMS_PER_COST_CODE,
  buildCommercialEvidenceByCostCode,
  stripReservedCommercialEvidence,
};
