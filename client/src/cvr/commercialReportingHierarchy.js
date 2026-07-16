/**
 * BL-016A — Commercial Reporting Hierarchy (Doc 46).
 * Single reporting hierarchy for BuildLite: Head → Family → Trade → Cost Code.
 */

export const COMMERCIAL_HEADS = [
  'Land',
  'Professional Fees',
  'Preliminaries',
  'House Build',
  'External Works',
  'Infrastructure & Utilities',
  'Sales & Marketing',
  'Finance & Legal',
  'Customer Costs',
  'Other',
];

export const COMMERCIAL_FAMILIES = [
  'Acquisition',
  'Planning',
  'Engineering',
  'Site Establishment',
  'Groundworks',
  'Foundations',
  'Superstructure',
  'Roofing',
  'Windows',
  'Internal Finishes',
  'M&E',
  'External Works',
  'Utilities',
  'Sales',
  'Customer Care',
  'General',
];

export const HEAD_FAMILY_MAP = {
  Land: ['Acquisition', 'Planning', 'General'],
  'Professional Fees': ['Planning', 'Engineering', 'General'],
  Preliminaries: ['Site Establishment', 'General'],
  'House Build': [
    'Groundworks',
    'Foundations',
    'Superstructure',
    'Roofing',
    'Windows',
    'Internal Finishes',
    'M&E',
    'General',
  ],
  'External Works': ['External Works', 'General'],
  'Infrastructure & Utilities': ['Utilities', 'Engineering', 'General'],
  'Sales & Marketing': ['Sales', 'General'],
  'Finance & Legal': ['General'],
  'Customer Costs': ['Customer Care', 'General'],
  Other: ['General'],
};

const LEGACY_FAMILY_TO_HEAD = {
  land: 'Land',
  fees: 'Professional Fees',
  'professional fees': 'Professional Fees',
  preliminaries: 'Preliminaries',
  'preliminaries & general': 'Preliminaries',
  'house build': 'House Build',
  'direct cost': 'House Build',
  'direct costs': 'House Build',
  subcontract: 'House Build',
  materials: 'House Build',
  plant: 'House Build',
  'external works': 'External Works',
  infrastructure: 'Infrastructure & Utilities',
  utilities: 'Infrastructure & Utilities',
  'sales & marketing': 'Sales & Marketing',
  'finance & legal': 'Finance & Legal',
  'customer costs': 'Customer Costs',
  other: 'Other',
};

const HEAD_DEFAULT_FAMILY = {
  Land: 'Acquisition',
  'Professional Fees': 'Planning',
  Preliminaries: 'Site Establishment',
  'House Build': 'General',
  'External Works': 'External Works',
  'Infrastructure & Utilities': 'Utilities',
  'Sales & Marketing': 'Sales',
  'Finance & Legal': 'General',
  'Customer Costs': 'Customer Care',
  Other: 'General',
};

const FAMILY_TO_HEAD = COMMERCIAL_FAMILIES.reduce((map, family) => {
  for (const [head, families] of Object.entries(HEAD_FAMILY_MAP)) {
    if (families.includes(family)) {
      map[family.toLowerCase()] = head;
    }
  }
  return map;
}, {});

export const DEFAULT_COMMERCIAL_HEAD = 'Other';
export const DEFAULT_COMMERCIAL_FAMILY = 'General';

let activeHeadNames = null;
let activeHeadFamilyMap = null;

export function refreshActiveHierarchyCatalog({ heads = [], familiesByHead = {} } = {}) {
  activeHeadNames = heads.length ? heads : null;
  activeHeadFamilyMap = Object.keys(familiesByHead).length ? familiesByHead : null;
}

function getHeadCatalog() {
  return activeHeadNames?.length ? activeHeadNames : COMMERCIAL_HEADS;
}

function getHeadFamilyMapCatalog() {
  return activeHeadFamilyMap || HEAD_FAMILY_MAP;
}

function cleanLabel(value) {
  return String(value || '').trim();
}

export function normaliseCommercialHead(head) {
  const value = cleanLabel(head);
  if (!value) return DEFAULT_COMMERCIAL_HEAD;

  const exact = getHeadCatalog().find((item) => item.toLowerCase() === value.toLowerCase());
  if (exact) return exact;

  const legacy = LEGACY_FAMILY_TO_HEAD[value.toLowerCase()];
  if (legacy) return legacy;

  return DEFAULT_COMMERCIAL_HEAD;
}

export function normaliseCommercialFamily(family, head = null) {
  const value = cleanLabel(family);
  if (!value) return resolveFamilyForHead(head || DEFAULT_COMMERCIAL_HEAD, null);

  const exact = COMMERCIAL_FAMILIES.find((item) => item.toLowerCase() === value.toLowerCase());
  if (exact) {
    const resolvedHead =
      head || FAMILY_TO_HEAD[exact.toLowerCase()] || DEFAULT_COMMERCIAL_HEAD;
    return ensureFamilyBelongsToHead(exact, resolvedHead);
  }

  const legacyHead = LEGACY_FAMILY_TO_HEAD[value.toLowerCase()];
  if (legacyHead) {
    return HEAD_DEFAULT_FAMILY[legacyHead] || DEFAULT_COMMERCIAL_FAMILY;
  }

  return resolveFamilyForHead(head || DEFAULT_COMMERCIAL_HEAD, value);
}

export function normaliseTrade(trade, centre = {}) {
  const value = cleanLabel(trade);
  if (value) return value;

  return (
    cleanLabel(centre.description) ||
    cleanLabel(centre.costCodeLabel) ||
    'General'
  );
}

function resolveFamilyForHead(head, fallbackFamily) {
  const normalisedHead = normaliseCommercialHead(head);
  const fallback = cleanLabel(fallbackFamily);

  if (fallback) {
    const exact = COMMERCIAL_FAMILIES.find(
      (item) => item.toLowerCase() === fallback.toLowerCase()
    );
    if (exact) return ensureFamilyBelongsToHead(exact, normalisedHead);
  }

  return HEAD_DEFAULT_FAMILY[normalisedHead] || DEFAULT_COMMERCIAL_FAMILY;
}

export function ensureFamilyBelongsToHead(family, head) {
  const normalisedHead = normaliseCommercialHead(head);
  const normalisedFamily = COMMERCIAL_FAMILIES.find(
    (item) => item.toLowerCase() === cleanLabel(family).toLowerCase()
  );

  if (!normalisedFamily) {
    return HEAD_DEFAULT_FAMILY[normalisedHead] || DEFAULT_COMMERCIAL_FAMILY;
  }

  const allowed = getHeadFamilyMapCatalog()[normalisedHead] || ['General'];
  if (allowed.includes(normalisedFamily)) return normalisedFamily;

  return HEAD_DEFAULT_FAMILY[normalisedHead] || DEFAULT_COMMERCIAL_FAMILY;
}

export function deriveHierarchyFromLegacy(centre = {}) {
  const legacyFamily = cleanLabel(centre.commercialFamily);
  const description = cleanLabel(centre.description);
  const label = cleanLabel(centre.costCodeLabel);

  if (!legacyFamily) {
    return {
      commercialHead: DEFAULT_COMMERCIAL_HEAD,
      commercialFamily: DEFAULT_COMMERCIAL_FAMILY,
      trade: description || label || 'General',
    };
  }

  const legacyHead = LEGACY_FAMILY_TO_HEAD[legacyFamily.toLowerCase()];
  if (legacyHead) {
    return {
      commercialHead: legacyHead,
      commercialFamily: HEAD_DEFAULT_FAMILY[legacyHead] || DEFAULT_COMMERCIAL_FAMILY,
      trade: description || label || legacyFamily,
    };
  }

  const inferredHead = FAMILY_TO_HEAD[legacyFamily.toLowerCase()];
  if (inferredHead) {
    return {
      commercialHead: inferredHead,
      commercialFamily: normaliseCommercialFamily(legacyFamily, inferredHead),
      trade: description || label || legacyFamily,
    };
  }

  return {
    commercialHead: DEFAULT_COMMERCIAL_HEAD,
    commercialFamily: DEFAULT_COMMERCIAL_FAMILY,
    trade: description || label || legacyFamily,
  };
}

export function migrateCostCentreHierarchy(centre = {}) {
  const hasHead = cleanLabel(centre.commercialHead);
  const hasFamily = cleanLabel(centre.commercialFamily);
  const hasTrade = cleanLabel(centre.trade);

  if (hasHead && hasTrade) {
    const commercialHead = normaliseCommercialHead(hasHead);
    return {
      ...centre,
      commercialHead,
      commercialFamily: hasFamily
        ? normaliseCommercialFamily(hasFamily, commercialHead)
        : '',
      trade: normaliseTrade(hasTrade, centre),
    };
  }

  if (hasHead && hasFamily && hasTrade) {
    const commercialHead = normaliseCommercialHead(hasHead);
    return {
      ...centre,
      commercialHead,
      commercialFamily: normaliseCommercialFamily(hasFamily, commercialHead),
      trade: normaliseTrade(hasTrade, centre),
    };
  }

  const legacy = deriveHierarchyFromLegacy(centre);
  const commercialHead = hasHead
    ? normaliseCommercialHead(hasHead)
    : legacy.commercialHead;
  const commercialFamily = hasFamily
    ? normaliseCommercialFamily(hasFamily, commercialHead)
    : legacy.commercialFamily;
  const trade = hasTrade ? normaliseTrade(hasTrade, centre) : legacy.trade;

  return {
    ...centre,
    commercialHead,
    commercialFamily,
    trade,
  };
}

export function resolveHierarchyForNewCostCentre(payload = {}) {
  const migrated = migrateCostCentreHierarchy({
    commercialHead: payload.commercialHead,
    commercialFamily: payload.commercialFamily,
    trade: payload.trade,
    description: payload.description,
    costCodeLabel: payload.costCodeLabel,
  });

  return {
    commercialHead: migrated.commercialHead,
    commercialFamily: migrated.commercialFamily,
    trade: migrated.trade,
  };
}

export function validateCostCentreHierarchy(centre = {}) {
  const hierarchy = migrateCostCentreHierarchy(centre);
  const errors = [];

  if (!hierarchy.commercialHead) errors.push('Commercial Head is required.');
  if (!hierarchy.trade) errors.push('Trade / Reporting Group is required.');
  if (hierarchy.commercialFamily && !COMMERCIAL_FAMILIES.includes(hierarchy.commercialFamily)) {
    errors.push(`Unknown Commercial Family: ${hierarchy.commercialFamily}`);
  }

  if (!COMMERCIAL_HEADS.includes(hierarchy.commercialHead) && !getHeadCatalog().includes(hierarchy.commercialHead)) {
    errors.push(`Unknown Commercial Head: ${hierarchy.commercialHead}`);
  }

  if (hierarchy.commercialFamily) {
    const allowedFamilies = getHeadFamilyMapCatalog()[hierarchy.commercialHead] || [];
    if (
      allowedFamilies.length &&
      !allowedFamilies.includes(hierarchy.commercialFamily)
    ) {
      errors.push(
        `Commercial Family "${hierarchy.commercialFamily}" is not valid under "${hierarchy.commercialHead}".`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    hierarchy,
  };
}

export function assertUniqueCostCodeKeys(centres = []) {
  const seen = new Set();
  const duplicates = [];

  for (const centre of centres) {
    const key = cleanLabel(centre.costCodeKey).toLowerCase();
    if (!key || centre.active === false) continue;
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
  }

  return {
    valid: duplicates.length === 0,
    duplicates,
  };
}

export function buildHierarchyKeyMap(periodCentres = []) {
  const map = new Map();

  for (const centre of periodCentres) {
    if (centre.active === false || !centre.costCodeKey) continue;
    const hierarchy = migrateCostCentreHierarchy(centre);
    map.set(centre.costCodeKey, {
      commercialHead: hierarchy.commercialHead,
      commercialFamily: hierarchy.commercialFamily,
      trade: hierarchy.trade,
    });
  }

  return map;
}

export function resolveRowCommercialHead(costCodeKey, hierarchyMap) {
  return hierarchyMap.get(costCodeKey)?.commercialHead || DEFAULT_COMMERCIAL_HEAD;
}

export function resolveRowCommercialFamily(costCodeKey, hierarchyMap) {
  return hierarchyMap.get(costCodeKey)?.commercialFamily || DEFAULT_COMMERCIAL_FAMILY;
}

export function resolveRowTrade(costCodeKey, hierarchyMap) {
  return hierarchyMap.get(costCodeKey)?.trade || 'General';
}

/** @deprecated Use buildHierarchyKeyMap — retained for worksheet filters during transition. */
export function buildFamilyKeyMap(periodCentres = []) {
  const map = new Map();
  for (const [key, hierarchy] of buildHierarchyKeyMap(periodCentres)) {
    map.set(key, hierarchy.commercialHead);
  }
  return map;
}
