/**
 * BL-018A — Flexible commercial reporting path model.
 * Level 1: Commercial Head
 * Level 2: Commercial Family (optional)
 * Level 3: Reporting Group (stored as trade for compatibility)
 * Level 4: Cost Code
 */

export const HIERARCHY_MODE_TWO_LEVEL = 'two-level';
export const HIERARCHY_MODE_THREE_LEVEL = 'three-level';
export const HIERARCHY_MODE_THREE_LEVEL_DEFAULT_FAMILY = 'three-level-default-family';

export const HIERARCHY_MODE_LABELS = {
  [HIERARCHY_MODE_TWO_LEVEL]: 'Two-level',
  [HIERARCHY_MODE_THREE_LEVEL]: 'Three-level',
  [HIERARCHY_MODE_THREE_LEVEL_DEFAULT_FAMILY]: 'Three-level (default family)',
};

export function getReportingGroup(record = {}) {
  return String(record.reportingGroup || record.trade || '').trim();
}

export function setReportingGroup(record, value) {
  const label = String(value || '').trim();
  return { ...record, trade: label, reportingGroup: label };
}

export function detectImportHierarchyMapping(fieldByColumn = []) {
  const mapped = new Set(fieldByColumn.filter((field) => field && field !== 'ignore'));
  const hasCommercialHead = mapped.has('commercialHead');
  const hasCommercialFamily = mapped.has('commercialFamily');
  const hasReportingGroup = mapped.has('trade') || mapped.has('reportingGroup');

  return {
    hasCommercialHead,
    hasCommercialFamily,
    hasReportingGroup,
    commercialFamilyAbsent: hasCommercialHead && !hasCommercialFamily,
    detectedMappings: [
      hasCommercialHead ? 'Commercial Head' : null,
      hasCommercialFamily ? 'Commercial Family' : null,
      hasReportingGroup ? 'Reporting Group' : null,
    ].filter(Boolean),
  };
}

export function inferDefaultHierarchyMode(detection = {}) {
  if (detection.hasCommercialFamily) return HIERARCHY_MODE_THREE_LEVEL;
  if (detection.commercialFamilyAbsent) return HIERARCHY_MODE_TWO_LEVEL;
  return HIERARCHY_MODE_TWO_LEVEL;
}

export function resolveHierarchyModeSelection({
  detection = {},
  selectedMode = null,
  defaultFamilyName = '',
} = {}) {
  const mode = selectedMode || inferDefaultHierarchyMode(detection);
  if (mode === HIERARCHY_MODE_THREE_LEVEL_DEFAULT_FAMILY) {
    return {
      mode,
      insertDefaultFamily: true,
      defaultFamilyName: String(defaultFamilyName || 'General').trim() || 'General',
    };
  }
  if (mode === HIERARCHY_MODE_THREE_LEVEL) {
    return { mode, insertDefaultFamily: false, defaultFamilyName: '' };
  }
  return { mode: HIERARCHY_MODE_TWO_LEVEL, insertDefaultFamily: false, defaultFamilyName: '' };
}

export function buildTradeUsageKey(head, family, trade) {
  return `${String(head || '').trim()}::${String(family ?? '').trim()}::${String(trade || '').trim()}`;
}

export function formatFamilyDisplay(family) {
  const value = String(family || '').trim();
  return value || '—';
}

export function resolveCostCodeReportingPath(
  mapped = {},
  {
    activeHeads = new Set(),
    hierarchyMode = HIERARCHY_MODE_TWO_LEVEL,
    defaultFamilyName = 'General',
    defaultHead = '',
  } = {}
) {
  const warnings = [];
  let commercialHead = String(mapped.commercialHead || '').trim();

  if (!commercialHead) {
    if (defaultHead) {
      commercialHead = defaultHead;
      warnings.push(`Commercial Head defaulted to "${commercialHead}"`);
    }
  } else if (activeHeads.size && !activeHeads.has(commercialHead.toLowerCase())) {
    warnings.push(`Unknown Commercial Head "${commercialHead}" — will be created on import`);
  }

  let commercialFamily = String(mapped.commercialFamily || '').trim();
  const reportingGroup =
    String(mapped.reportingGroup || mapped.trade || '').trim() ||
    String(mapped.description || '').trim();

  const mode = hierarchyMode || HIERARCHY_MODE_TWO_LEVEL;

  if (mode === HIERARCHY_MODE_TWO_LEVEL) {
    commercialFamily = '';
  } else if (mode === HIERARCHY_MODE_THREE_LEVEL_DEFAULT_FAMILY && !commercialFamily) {
    commercialFamily = String(defaultFamilyName || 'General').trim() || 'General';
    warnings.push(`Commercial Family set to default "${commercialFamily}"`);
  }

  if (!reportingGroup) {
    warnings.push('Reporting Group is blank — description will be used where possible');
  }

  return {
    commercialHead,
    commercialFamily,
    trade: reportingGroup,
    reportingGroup,
    hierarchyMode: mode,
    warnings,
    systemGeneratedFamily:
      mode === HIERARCHY_MODE_THREE_LEVEL_DEFAULT_FAMILY &&
      !String(mapped.commercialFamily || '').trim(),
  };
}

export function buildImportPreviewRow(row = {}) {
  return {
    ...row,
    reportingGroup: getReportingGroup(row),
    commercialFamilyDisplay: formatFamilyDisplay(row.commercialFamily),
  };
}

export function buildCommercialStructureTreeModel(costCodes = [], structure = {}) {
  const heads = (structure.heads || []).filter((item) => !item.archived);
  const families = (structure.families || []).filter((item) => !item.archived);
  const trades = (structure.trades || []).filter((item) => !item.archived);

  const headById = new Map(heads.map((item) => [item.id, item]));
  const familyById = new Map(families.map((item) => [item.id, item]));

  const codesByPath = new Map();
  for (const code of costCodes) {
    const head = String(code.commercialHead || '').trim();
    const family = String(code.commercialFamily || '').trim();
    const group = getReportingGroup(code);
    const pathKey = `${head}::${family}::${group}`;
    if (!codesByPath.has(pathKey)) codesByPath.set(pathKey, []);
    codesByPath.get(pathKey).push(code);
  }

  const tree = [];

  for (const head of heads.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))) {
    const headCodes = costCodes.filter((item) => item.commercialHead === head.name);
    const headFamilies = families
      .filter((item) => item.headId === head.id)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

    const twoLevelGroups = new Map();
    for (const code of headCodes) {
      if (String(code.commercialFamily || '').trim()) continue;
      const group = getReportingGroup(code);
      if (!group) continue;
      if (!twoLevelGroups.has(group)) twoLevelGroups.set(group, []);
      twoLevelGroups.get(group).push(code);
    }

    const familyNodes = [];
    for (const family of headFamilies) {
      const familyCodes = headCodes.filter((item) => item.commercialFamily === family.name);
      const familyTrades = trades
        .filter((item) => item.familyId === family.id)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

      const groupNodes = [];
      const seenGroups = new Set();

      for (const trade of familyTrades) {
        const pathKey = `${head.name}::${family.name}::${trade.name}`;
        const tradeCodes = codesByPath.get(pathKey) || familyCodes.filter((item) => getReportingGroup(item) === trade.name);
        if (!tradeCodes.length) continue;
        seenGroups.add(trade.name);
        groupNodes.push({
          type: 'reportingGroup',
          id: trade.id,
          name: trade.name,
          costCodes: tradeCodes,
        });
      }

      for (const code of familyCodes) {
        const group = getReportingGroup(code);
        if (!group || seenGroups.has(group)) continue;
        seenGroups.add(group);
        groupNodes.push({
          type: 'reportingGroup',
          id: `derived:${head.id}:${family.id}:${group}`,
          name: group,
          costCodes: familyCodes.filter((item) => getReportingGroup(item) === group),
        });
      }

      if (!groupNodes.length && !familyCodes.length) continue;

      familyNodes.push({
        type: 'family',
        id: family.id,
        name: family.name,
        reportingGroups: groupNodes,
      });
    }

    const directGroupNodes = [...twoLevelGroups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, codes]) => ({
        type: 'reportingGroup',
        id: `head-group:${head.id}:${name}`,
        name,
        costCodes: codes,
      }));

    if (!directGroupNodes.length && !familyNodes.length && !headCodes.length) continue;

    tree.push({
      type: 'head',
      id: head.id,
      name: head.name,
      families: familyNodes,
      reportingGroups: directGroupNodes,
    });
  }

  const orphanCodes = costCodes.filter((code) => {
    const headName = String(code.commercialHead || '').trim();
    return headName && !heads.some((item) => item.name === headName);
  });

  if (orphanCodes.length) {
    const orphanHeads = [...new Set(orphanCodes.map((item) => item.commercialHead))];
    for (const headName of orphanHeads.sort()) {
      const headCodes = orphanCodes.filter((item) => item.commercialHead === headName);
      const groups = new Map();
      for (const code of headCodes) {
        const family = String(code.commercialFamily || '').trim();
        const group = getReportingGroup(code);
        const key = `${family}::${group}`;
        if (!groups.has(key)) groups.set(key, { family, group, codes: [] });
        groups.get(key).codes.push(code);
      }

      const familyNodes = [];
      const directGroupNodes = [];

      for (const entry of groups.values()) {
        const node = {
          type: 'reportingGroup',
          id: `orphan:${headName}:${entry.family}:${entry.group}`,
          name: entry.group || '—',
          costCodes: entry.codes,
        };
        if (entry.family) {
          let familyNode = familyNodes.find((item) => item.name === entry.family);
          if (!familyNode) {
            familyNode = {
              type: 'family',
              id: `orphan-family:${headName}:${entry.family}`,
              name: entry.family,
              reportingGroups: [],
            };
            familyNodes.push(familyNode);
          }
          familyNode.reportingGroups.push(node);
        } else {
          directGroupNodes.push(node);
        }
      }

      tree.push({
        type: 'head',
        id: `orphan-head:${headName}`,
        name: headName,
        families: familyNodes,
        reportingGroups: directGroupNodes,
      });
    }
  }

  return tree;
}

export function buildCommercialStructureKpis(costCodes = [], structure = {}) {
  const headsInUse = new Set();
  const familiesInUse = new Set();
  const reportingGroupsInUse = new Set();

  for (const code of costCodes) {
    const head = String(code.commercialHead || '').trim();
    const family = String(code.commercialFamily || '').trim();
    const group = getReportingGroup(code);
    if (head) headsInUse.add(head);
    if (head && family) familiesInUse.add(`${head}::${family}`);
    if (head && group) reportingGroupsInUse.add(`${head}::${family}::${group}`);
  }

  const catalogueHeads = (structure.heads || []).filter((item) => !item.archived).length;
  const catalogueFamilies = (structure.families || []).filter((item) => !item.archived).length;
  const catalogueReportingGroups = (structure.trades || []).filter((item) => !item.archived).length;

  function buildKpiMetric(active, catalogue, { noneLabel = false, suffix = 'Active' } = {}) {
    const available = Math.max(0, catalogue - active);
    return {
      active,
      activeLabel: active === 0 && noneLabel ? 'None' : String(active),
      suffix,
      available: available > 0 ? available : null,
      availableLabel: available > 0 ? `${available} Available` : null,
    };
  }

  return {
    headsInUse: headsInUse.size,
    familiesInUse: familiesInUse.size,
    reportingGroupsInUse: reportingGroupsInUse.size,
    costCodes: costCodes.length,
    catalogueHeads,
    catalogueFamilies,
    catalogueReportingGroups,
    heads: buildKpiMetric(headsInUse.size, catalogueHeads),
    families: buildKpiMetric(familiesInUse.size, catalogueFamilies, { noneLabel: true }),
    reportingGroups: buildKpiMetric(reportingGroupsInUse.size, catalogueReportingGroups),
    costCodesKpi: {
      active: costCodes.length,
      activeLabel: String(costCodes.length),
      suffix: 'Imported',
      available: null,
      availableLabel: null,
    },
  };
}

/**
 * Import summary counts created heads only. Administration shows all heads in use.
 * A positive delta usually means one or more Cost Groups matched pre-seeded catalogue heads.
 */
export function explainHeadCountDelta({ headsInUse = 0, headsCreated = 0, headsMatched = 0 } = {}) {
  const accounted = headsCreated + headsMatched;
  if (headsInUse === accounted) {
    return {
      headsInUse,
      headsCreated,
      headsMatched,
      message:
        headsMatched > 0
          ? `${headsInUse} heads in use: ${headsCreated} created at import and ${headsMatched} matched existing catalogue heads.`
          : `${headsInUse} heads in use, all created at import.`,
    };
  }
  return {
    headsInUse,
    headsCreated,
    headsMatched,
    message: `${headsInUse} heads in use. Import created ${headsCreated} and matched ${headsMatched} catalogue heads.`,
  };
}

const SYSTEM_DEFAULT_FAMILIES = new Set([
  'Acquisition',
  'Planning',
  'Site Establishment',
  'General',
]);

export function shouldClearSystemGeneratedFamily(record = {}) {
  const meta = record.importMetadata;
  if (meta?.systemGeneratedFamily && !meta?.familyManuallyChanged) return true;
  if (meta?.hierarchyMode === HIERARCHY_MODE_TWO_LEVEL && meta?.hadFamilyMapping === false) {
    const family = String(record.commercialFamily || '').trim();
    if (family && SYSTEM_DEFAULT_FAMILIES.has(family)) return true;
  }
  return false;
}

export function migrateImportedCostCodeRecord(record = {}) {
  if (!shouldClearSystemGeneratedFamily(record)) {
    const reportingGroup = getReportingGroup(record);
    return {
      ...record,
      reportingGroup,
      hierarchyMode:
        record.hierarchyMode ||
        (String(record.commercialFamily || '').trim()
          ? HIERARCHY_MODE_THREE_LEVEL
          : HIERARCHY_MODE_TWO_LEVEL),
    };
  }

  const reportingGroup = getReportingGroup(record);
  return {
    ...record,
    commercialFamily: '',
    trade: reportingGroup,
    reportingGroup,
    hierarchyMode: HIERARCHY_MODE_TWO_LEVEL,
    importMetadata: {
      ...(record.importMetadata || {}),
      migratedAt: new Date().toISOString(),
      systemGeneratedFamilyCleared: true,
    },
  };
}

export function migrateImportedCostCodeRecords(records = []) {
  return records.map(migrateImportedCostCodeRecord);
}

export function buildImportMetadata({
  hierarchyMode,
  hadFamilyMapping = false,
  systemGeneratedFamily = false,
} = {}) {
  return {
    importedAt: new Date().toISOString(),
    hierarchyMode,
    hadFamilyMapping,
    systemGeneratedFamily,
    familyManuallyChanged: false,
    source: 'import',
  };
}
