import { normaliseCostCodeKey } from './cvrCalculations';

export const UNCLASSIFIED_HEAD = 'Unclassified';

function identityOf(value) {
  return normaliseCostCodeKey(value?.costCodeKey || value?.code || value?.value || value);
}

export function representedCostCodeKeys({ rows = [], inputs = [] } = {}) {
  return new Set([...rows, ...inputs].map(identityOf).filter(Boolean));
}

export function buildCostCodeCompleteness(masterCodes = [], represented = []) {
  const representedKeys = represented instanceof Set
    ? represented
    : new Set((represented || []).map(identityOf).filter(Boolean));
  const seen = new Set();
  const unrepresented = [];

  for (const item of masterCodes || []) {
    const key = identityOf(item);
    if (!key || item?.active === false || seen.has(key)) continue;
    seen.add(key);
    if (representedKeys.has(key)) continue;
    unrepresented.push({
      ...item,
      code: String(item.code || item.value || '').trim(),
      description: String(item.description || item.element || '').trim(),
      commercialHead: String(item.commercialHead || '').trim(),
      commercialFamily: String(item.commercialFamily || '').trim(),
      reportingGroup: String(item.reportingGroup || item.trade || '').trim(),
    });
  }

  unrepresented.sort((left, right) => {
    const order = Number(left.reportingOrder || 0) - Number(right.reportingOrder || 0);
    return order || left.code.localeCompare(right.code, 'en-GB', { numeric: true });
  });

  return {
    activeCount: seen.size,
    representedCount: seen.size - unrepresented.length,
    unrepresented,
    unrepresentedCount: unrepresented.length,
  };
}

export function filterUnrepresentedCostCodes(items = [], { query = '', commercialHead = '' } = {}) {
  const needle = String(query || '').trim().toLocaleLowerCase('en-GB');
  return (items || []).filter((item) => {
    const head = item.commercialHead || UNCLASSIFIED_HEAD;
    if (commercialHead && head !== commercialHead) return false;
    if (!needle) return true;
    return [item.code, item.description, head, item.commercialFamily, item.reportingGroup]
      .some((value) => String(value || '').toLocaleLowerCase('en-GB').includes(needle));
  });
}

export function completenessCommercialHeads(items = []) {
  return [...new Set((items || []).map((item) => item.commercialHead || UNCLASSIFIED_HEAD))]
    .sort((left, right) => left.localeCompare(right, 'en-GB'));
}
