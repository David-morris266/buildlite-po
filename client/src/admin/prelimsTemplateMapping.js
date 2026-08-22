/**
 * BL-033D.x.2 — Company template mapping helpers.
 * Mapping identity is the canonical cost-code only. Classification is advisory.
 */

export function classifyTemplateMapping(costCodeKey, semanticGroup) {
  const key = String(costCodeKey || '').trim();
  if (!key) return { tone: 'unmapped', message: null };
  const group = String(semanticGroup || 'UNCLASSIFIED').trim() || 'UNCLASSIFIED';
  if (group === 'PRELIMS') return { tone: 'normal', message: null };
  return {
    tone: 'warning',
    message: `Mapped code ${key} is currently classified ${group} rather than PRELIMS.`,
  };
}

export function sharedCostCodeCounts(lines = []) {
  const counts = {};
  for (const line of lines) {
    const key = String(line?.costCodeKey || '').trim();
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export function mappingOptionLabel(option) {
  const code = option?.code || option?.value || '';
  const description = option?.description || option?.element || '';
  const reportingGroup = option?.reportingGroup || option?.trade || '';
  const core = [code, description].filter(Boolean).join(' — ');
  return reportingGroup ? `${core} (${reportingGroup})` : core;
}

export function filterMappingOptions(options = [], query = '', currentCode = '') {
  const needle = String(query || '').trim().toLowerCase();
  const current = String(currentCode || '').trim();
  const matched = (options || []).filter((option) => {
    if (!needle) return true;
    const haystack = [
      option.code,
      option.value,
      option.description,
      option.element,
      option.reportingGroup,
      option.trade,
      option.label,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
  if (current && !matched.some((option) => option.code === current || option.value === current)) {
    const existing = (options || []).find(
      (option) => option.code === current || option.value === current
    );
    if (existing) return [existing, ...matched];
  }
  return matched;
}
