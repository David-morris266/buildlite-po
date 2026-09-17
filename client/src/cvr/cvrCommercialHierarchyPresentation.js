const EXCEPTION_BUCKETS = Object.freeze({
  not_applicable: { key: 'resolution:not_applicable', label: 'Not applicable' },
  unallocated: { key: 'resolution:unallocated', label: 'Unallocated' },
  unresolved_legacy: { key: 'resolution:unresolved_legacy', label: 'Legacy hierarchy unresolved' },
  archived_assignment: { key: 'resolution:archived_assignment', label: 'Archived hierarchy assignment' },
  invalid_assignment: { key: 'resolution:needs_review', label: 'Hierarchy needs review' },
  missing_cost_code: { key: 'resolution:needs_review', label: 'Hierarchy needs review' },
});

export function normaliseHierarchyCostCodeKey(value) {
  return String(value || '').trim().replace(/\s+/g, '').toLowerCase();
}

export function selectCvrCommercialHierarchy(period = {}) {
  const authority = String(period.status || '').toLowerCase() === 'locked'
    ? period.snapshot?.commercialHierarchy
    : period.commercialHierarchy;
  if (authority?.state === 'legacy_not_captured') {
    return { state: 'legacy_not_captured', captured: false, document: null };
  }
  return authority || { state: 'unavailable', captured: false, document: null };
}

function descriptor(bucket) {
  const costCodeKeys = bucket.rows.map(({ row }) => row.costCodeKey);
  if (bucket.kind === 'commercial_head') {
    return { kind: 'commercial_head', headId: bucket.headId, label: bucket.label, costCodeKeys };
  }
  if (bucket.kind === 'legacy_not_captured') {
    return { kind: 'legacy_not_captured', label: bucket.label, costCodeKeys };
  }
  return {
    kind: 'hierarchy_resolution',
    resolutionStates: [...bucket.resolutionStates].sort(),
    label: bucket.label,
    costCodeKeys,
  };
}

function exceptionFor(state) {
  return EXCEPTION_BUCKETS[state] || EXCEPTION_BUCKETS.missing_cost_code;
}

export function buildCvrCommercialHierarchyPresentation(rows = [], period = {}) {
  const authority = selectCvrCommercialHierarchy(period);
  const evidenceByKey = new Map(
    (authority.document?.costCodes || []).map((entry) => [
      normaliseHierarchyCostCodeKey(entry.costCodeKey),
      entry,
    ])
  );
  const buckets = new Map();

  for (const row of rows) {
    const key = normaliseHierarchyCostCodeKey(row.costCodeKey);
    const legacy = authority.state === 'legacy_not_captured';
    const evidence = legacy ? null : evidenceByKey.get(key) || null;
    let bucketKey;
    let label;
    let kind;
    let headId = null;
    let resolutionState;

    if (legacy) {
      bucketKey = 'legacy:not_captured';
      label = 'Historic hierarchy not captured';
      kind = 'legacy_not_captured';
      resolutionState = 'legacy_not_captured';
    } else if (evidence?.resolutionState === 'allocated' && evidence.head?.id && evidence.head?.name) {
      bucketKey = `head:${evidence.head.id}`;
      label = evidence.head.name;
      kind = 'commercial_head';
      headId = evidence.head.id;
      resolutionState = 'allocated';
    } else {
      resolutionState = evidence?.resolutionState || 'missing_cost_code';
      const exceptional = exceptionFor(resolutionState);
      bucketKey = exceptional.key;
      label = exceptional.label;
      kind = 'hierarchy_resolution';
    }

    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, {
        key: bucketKey,
        label,
        kind,
        headId,
        resolutionStates: new Set(),
        rows: [],
        families: new Map(),
        reportingGroups: new Map(),
      });
    }
    const bucket = buckets.get(bucketKey);
    bucket.resolutionStates.add(resolutionState);
    bucket.rows.push({ row, evidence, resolutionState });
    if (evidence?.family?.id) bucket.families.set(evidence.family.id, evidence.family);
    if (evidence?.reportingGroup?.id) {
      bucket.reportingGroups.set(evidence.reportingGroup.id, evidence.reportingGroup);
    }
  }

  const items = [...buckets.values()].map((bucket) => ({
    ...bucket,
    resolutionStates: [...bucket.resolutionStates].sort(),
    families: [...bucket.families.values()],
    reportingGroups: [...bucket.reportingGroups.values()],
    filter: descriptor(bucket),
  }));

  return {
    authorityState: authority.state,
    captured: authority.captured === true,
    items,
    rowCount: rows.length,
    assignedRowCount: items.reduce((sum, item) => sum + item.rows.length, 0),
  };
}

export function filterCvrRowsByHierarchyDescriptor(rows = [], filter = null) {
  if (!filter) return rows;
  const keys = new Set((filter.costCodeKeys || []).map(normaliseHierarchyCostCodeKey));
  return rows.filter((row) => keys.has(normaliseHierarchyCostCodeKey(row.costCodeKey)));
}
