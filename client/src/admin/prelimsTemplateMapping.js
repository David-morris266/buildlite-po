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

export function mappingOptionPrimaryLabel(option) {
  const code = option?.code || option?.value || '';
  const description = option?.description || option?.element || '';
  return [code, description].filter(Boolean).join(' — ');
}

export function mappingOptionSecondaryLabel(option) {
  return String(option?.reportingGroup || option?.trade || '').trim();
}

export function mappingOptionLabel(option) {
  const core = mappingOptionPrimaryLabel(option);
  const reportingGroup = mappingOptionSecondaryLabel(option);
  return reportingGroup ? `${core} (${reportingGroup})` : core;
}

function optionIdentity(option) {
  return String(option?.code || option?.value || '').trim();
}

function textIncludes(parts, needle) {
  return parts
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(needle);
}

function prependCurrent(options, matched, current) {
  if (current && !matched.some((option) => optionIdentity(option) === current)) {
    const existing = (options || []).find((option) => optionIdentity(option) === current);
    if (existing) return [existing, ...matched];
  }
  return matched;
}

export function filterMappingOptions(options = [], query = '', currentCode = '') {
  const needle = String(query || '').trim().toLowerCase();
  const current = String(currentCode || '').trim();
  const matched = (options || []).filter((option) => {
    if (!needle) return true;
    return textIncludes(
      [
        option.code,
        option.value,
        option.description,
        option.element,
        option.reportingGroup,
        option.trade,
        option.label,
      ],
      needle
    );
  });
  return prependCurrent(options, matched, current);
}

/** Setup worksheet search: code + description first; reporting group is fallback only. */
export function filterCostCodeSearchOptions(options = [], query = '', currentCode = '') {
  const needle = String(query || '').trim().toLowerCase();
  const current = String(currentCode || '').trim();
  if (!needle) return prependCurrent(options, options || [], current);
  const primary = (options || []).filter((option) =>
    textIncludes([option.code, option.value, option.description, option.element], needle)
  );
  if (primary.length) return prependCurrent(options, primary, current);
  const fallback = (options || []).filter((option) =>
    textIncludes([option.reportingGroup, option.trade], needle)
  );
  return prependCurrent(options, fallback, current);
}
