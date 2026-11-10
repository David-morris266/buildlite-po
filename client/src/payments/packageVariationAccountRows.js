import { effectiveExpectedLiability } from '../commercialEvents/commercialEventExpectedLiability';

function eventExpectedValue(event) {
  if (event?.status !== 'submitted') return null;
  if (event.effectiveExpectedLiability != null) return Number(event.effectiveExpectedLiability);
  return effectiveExpectedLiability(event);
}

function sourceIds(vo) {
  return new Set((vo.sourceCommercialEvents || []).map(source => String(source.id || source.commercialEventId || '')));
}

export function buildPackageVariationRows({ events, variationOrders, variationItems, certification, packageExposure = null }) {
  const issued = variationOrders.filter(vo => vo.status === 'issued');
  const supersededIds = new Set(issued.map(vo => vo.supersedesId).filter(Boolean).map(String));
  const instructedEventIds = new Set(issued.flatMap(vo => [...sourceIds(vo)]).filter(Boolean));
  const reversingByPredecessor = new Map(issued.filter(vo => vo.reversesId).map(vo => [String(vo.reversesId), vo.displayReference]));
  const certifiedByVo = new Map();
  const exposureEvidence = packageExposure?.ready ? packageExposure.evidence || [] : [];
  const exposureForCe = id => exposureEvidence.find(entry => String(entry.commercialEventId) === String(id));
  const exposureForVa = id => exposureEvidence.find(entry => String(entry.variationAccountItemId) === String(id));
  for (const line of certification) {
    const key = String(line.variationOrderId || '');
    certifiedByVo.set(key, (certifiedByVo.get(key) || 0) + Number(line.previouslyCertifiedValue || 0));
  }

  const ceRows = events.map(event => {
    const instructed = instructedEventIds.has(String(event.id));
    const exposure = exposureForCe(event.id);
    return {
      key: `ce:${event.id}`,
      kind: 'ce',
      id: event.id,
      reference: event.eventNumber || event.reference || event.id,
      description: event.description || event.title || '',
      costCodes: [event.costCode].filter(Boolean),
      contractorClaim: null,
      contractorPosition: null,
      forecast: eventExpectedValue(event),
      instructed: null,
      certified: null,
      unresolved: exposure?.linked ? null : exposure?.resultingExposure ?? null,
      exposureNote: exposure?.linked ? 'Combined with linked VA assessment' : null,
      status: instructed ? 'Replaced by issued VO' : event.status,
      attention: event.status === 'submitted' && !instructed,
      related: instructed
        ? issued.filter(vo => sourceIds(vo).has(String(event.id))).map(vo => vo.displayReference)
        : [],
      event,
    };
  });

  const voRows = variationOrders.map(vo => {
    const superseded = supersededIds.has(String(vo.id));
    const reversedBy = reversingByPredecessor.get(String(vo.id));
    const issuedAuthority = vo.status === 'issued';
    const linkedItems = variationItems.filter(item => (item.authority?.allocations || []).some(allocation =>
      allocation.sourceType === 'variation_order_line'
      && vo.lines?.some(line => String(line.id) === String(allocation.variationOrderLineId))
    ));
    return {
      key: `vo:${vo.id}`,
      kind: 'vo',
      id: vo.id,
      reference: vo.displayReference,
      description: vo.description,
      costCodes: [...new Set((vo.lines || []).map(line => line.costCode).filter(Boolean))],
      contractorClaim: null,
      contractorPosition: null,
      forecast: null,
      instructed: issuedAuthority ? superseded ? 0 : Number(vo.totalNetValue || 0) : null,
      certified: certifiedByVo.get(String(vo.id)) || 0,
      unresolved: null,
      status: superseded ? 'Superseded' : reversedBy ? `Reversed by ${reversedBy}` : vo.status,
      attention: (vo.sourceCertificationExceptions || []).length > 0,
      related: [
        ...(vo.sourceCommercialEvents || []).map(source => source.eventNumber || source.id),
        ...linkedItems.map(item => item.reference),
      ].filter(Boolean),
      vo,
    };
  });

  const vaRows = variationItems.map(item => ({
    key: `va:${item.id}`,
    kind: 'va',
    id: item.id,
    reference: item.reference,
    description: item.description,
    costCodes: [item.costCode].filter(Boolean),
    contractorClaim: item.contractorClaim,
    contractorPosition: item.contractorValue,
    forecast: item.qsForecast,
    claimAssessmentDifference: item.contractorClaim == null || item.qsForecast == null
      ? null
      : Number(item.contractorClaim) - Number(item.qsForecast),
    instructed: item.authority?.effectiveVoAuthority,
    certified: null,
    unresolved: exposureForVa(item.id)?.resultingExposure ?? null,
    status: item.exposureClassification === 'fully_instructed' ? 'Fully instructed' : item.status,
    attention: item.forecastStatus === 'pending' || Boolean(item.authority?.exception),
    related: [
      events.find(event => String(event.id) === String(item.sourceCommercialEventId))?.eventNumber,
      ...(item.authority?.allocations || []).map(allocation => allocation.sourceReference),
    ].filter(Boolean),
    item,
  }));

  return [...ceRows, ...voRows, ...vaRows];
}
