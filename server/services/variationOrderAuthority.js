const APPROVED_EVENT_STATUSES = new Set(["approved", "includedInCertificate", "closed"]);
const PENDING_EVENT_STATUSES = new Set(["draft", "submitted"]);

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) / 100 : 0;
}

function isQualifyingContractEvent(event) {
  return APPROVED_EVENT_STATUSES.has(event?.status)
    && event?.relationshipType !== "recovery"
    && event?.relationship_type !== "recovery"
    && event?.eventType !== "budgetTransfer"
    && event?.event_type !== "budgetTransfer"
    && event?.financialTreatment !== "recoverableDeduction"
    && event?.financial_treatment !== "recoverableDeduction";
}

function voValue(vo) {
  if (vo?.signedValue != null) return money(vo.signedValue);
  return money((vo?.lines || []).reduce((sum, line) => sum + Number(line.netValue ?? line.net_value ?? 0), 0));
}

function sourceIds(vo) {
  return new Set((vo?.sourceCommercialEvents || vo?.source_commercial_events || [])
    .map((source) => String(source.commercialEventId ?? source.commercial_event_id ?? source.id ?? ""))
    .filter(Boolean));
}

function buildContractAuthority({ originalOrderValue = 0, events = [], variationOrders = [] } = {}) {
  const issued = (variationOrders || []).filter((vo) => vo?.status === "issued");
  const supersededEventIds = new Set();
  for (const vo of issued) for (const id of sourceIds(vo)) supersededEventIds.add(id);

  const approvedUninstructedEvents = (events || []).filter((event) =>
    isQualifyingContractEvent(event) && !supersededEventIds.has(String(event.id))
  );
  const approvedUninstructedValue = money(approvedUninstructedEvents.reduce(
    (sum, event) => sum + Number(event.value || 0), 0
  ));
  const issuedVariationOrderValue = money(issued.reduce((sum, vo) => sum + voValue(vo), 0));
  const pendingEventValue = money((events || []).filter((event) =>
    PENDING_EVENT_STATUSES.has(event?.status) && event?.relationshipType !== "recovery"
  ).reduce((sum, event) => sum + Number(event.value || 0), 0));
  const originalOrder = money(originalOrderValue);

  return {
    originalOrder,
    approvedUninstructedValue,
    issuedVariationOrderValue,
    pendingEventValue,
    currentContract: money(originalOrder + approvedUninstructedValue + issuedVariationOrderValue),
    supersededCommercialEventIds: [...supersededEventIds],
    issuedVariationOrderCount: issued.length,
  };
}

function buildVariationOrderCertificationReadiness({ status, value, historicCertified = 0, lineCount = 1 } = {}) {
  const authority = money(value);
  const certified = money(historicCertified);
  const sameDirection = authority === 0 || certified === 0 || Math.sign(authority) === Math.sign(certified);
  const excess = sameDirection ? Math.max(0, Math.abs(certified) - Math.abs(authority)) : Math.abs(certified);
  const remainingMagnitude = Math.max(0, Math.abs(authority) - (sameDirection ? Math.abs(certified) : 0));
  const remaining = money(Math.sign(authority || 1) * remainingMagnitude);
  return {
    isIssuedAuthority: status === "issued",
    certifiable: status === "issued" && lineCount === 1 && remainingMagnitude > 0,
    authorityValue: authority,
    historicCertifiedValue: certified,
    remainingCertifiableValue: status === "issued" ? remaining : 0,
    overCertifiedAmount: money(excess),
    exception: excess > 0 ? `£${money(excess).toFixed(2)} certified above Issued Variation Order authority.` : null,
    readinessReason: status !== "issued"
      ? "Only Issued Variation Orders are formal certificate authority."
      : lineCount !== 1
        ? "Multi-line Variation Order certification requires typed line allocation."
        : remainingMagnitude === 0 ? "No certifiable balance remains." : null,
  };
}

async function listVariationOrderAuthorityFacts(db, clientId, { developmentId = null, packageIds = null } = {}) {
  const params = [clientId];
  const clauses = ["vo.client_id=$1"];
  if (developmentId) { params.push(developmentId); clauses.push(`vo.development_id=$${params.length}`); }
  if (packageIds) { params.push(packageIds); clauses.push(`vo.package_id=ANY($${params.length}::uuid[])`); }
  const { rows } = await db.query(
    `SELECT vo.id, vo.package_id, vo.order_key, vo.status,
            COALESCE((SELECT SUM(lines.net_value) FROM variation_order_lines lines
                       WHERE lines.client_id=vo.client_id AND lines.variation_order_id=vo.id),0)::float AS signed_value,
            COALESCE((SELECT array_agg(links.commercial_event_id) FROM variation_order_commercial_events links
                       WHERE links.client_id=vo.client_id AND links.variation_order_id=vo.id), '{}') AS source_event_ids
       FROM variation_orders vo
      WHERE ${clauses.join(" AND ")}`, params
  );
  return rows.map((row) => ({
    id: row.id, packageId: row.package_id, orderKey: row.order_key, status: row.status,
    signedValue: money(row.signed_value),
    sourceCommercialEvents: (row.source_event_ids || []).map((id) => ({ commercialEventId: id })),
  }));
}

async function listContractEventFacts(db, clientId, { developmentId = null, packageIds = null } = {}) {
  const params = [clientId];
  const clauses = ["client_id=$1"];
  if (developmentId) { params.push(developmentId); clauses.push(`development_id=$${params.length}`); }
  if (packageIds) { params.push(packageIds); clauses.push(`package_id=ANY($${params.length}::uuid[])`); }
  const { rows } = await db.query(
    `SELECT id, package_id, order_key, status, event_type, relationship_type, financial_treatment, value::float AS value
       FROM commercial_events WHERE ${clauses.join(" AND ")}`, params
  );
  return rows.map((row) => ({
    id: row.id, packageUuid: row.package_id, orderKey: row.order_key, packageId: row.order_key,
    status: row.status, eventType: row.event_type, relationshipType: row.relationship_type,
    financialTreatment: row.financial_treatment, value: money(row.value),
  }));
}

module.exports = { buildContractAuthority, buildVariationOrderCertificationReadiness, isQualifyingContractEvent, listContractEventFacts, listVariationOrderAuthorityFacts, money, voValue };
