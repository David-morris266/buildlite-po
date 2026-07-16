import { HEAD_FAMILY_MAP, COMMERCIAL_HEADS, refreshActiveHierarchyCatalog } from '../cvr/commercialReportingHierarchy';
import { newAdminId, readAdminStore, writeAdminStore } from './adminStorage';
import { notifyMasterDataChanged } from './masterDataEvents';

export const COMMERCIAL_STRUCTURE_KEY = 'buildlite_commercial_structure_v1';

function emptyStructure() {
  return { heads: [], families: [], trades: [], updatedAt: null };
}

function buildDefaultStructure() {
  const heads = [];
  const families = [];
  const trades = [];
  let headSort = 0;

  for (const headName of COMMERCIAL_HEADS) {
    const headId = newAdminId('head');
    heads.push({
      id: headId,
      name: headName,
      sortOrder: headSort++,
      archived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const familyNames = HEAD_FAMILY_MAP[headName] || ['General'];
    familyNames.forEach((familyName, familySort) => {
      const familyId = newAdminId('family');
      families.push({
        id: familyId,
        headId,
        name: familyName,
        sortOrder: familySort,
        archived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      trades.push({
        id: newAdminId('trade'),
        familyId,
        headId: null,
        name: 'General',
        sortOrder: 0,
        archived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });
  }

  return { heads, families, trades, updatedAt: new Date().toISOString() };
}

function syncHierarchyCatalog(structure) {
  const heads = structure.heads.filter((item) => !item.archived).map((item) => item.name);
  const familiesByHead = {};
  for (const head of structure.heads.filter((item) => !item.archived)) {
    familiesByHead[head.name] = structure.families
      .filter((item) => !item.archived && item.headId === head.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((item) => item.name);
  }
  refreshActiveHierarchyCatalog({ heads, familiesByHead });
}

export function getCommercialStructure() {
  const stored = readAdminStore(COMMERCIAL_STRUCTURE_KEY, null);
  if (stored?.heads?.length) {
    syncHierarchyCatalog(stored);
    return stored;
  }
  const defaults = buildDefaultStructure();
  writeAdminStore(COMMERCIAL_STRUCTURE_KEY, defaults);
  syncHierarchyCatalog(defaults);
  return defaults;
}

function saveStructure(structure) {
  const next = { ...structure, updatedAt: new Date().toISOString() };
  writeAdminStore(COMMERCIAL_STRUCTURE_KEY, next);
  syncHierarchyCatalog(next);
  notifyMasterDataChanged('commercial-structure');
  return next;
}

export function getActiveHeads() {
  return getCommercialStructure()
    .heads.filter((item) => !item.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export function getActiveHeadNames() {
  return getActiveHeads().map((item) => item.name);
}

export function getActiveFamilies(headId = null) {
  return getCommercialStructure()
    .families.filter((item) => !item.archived && (!headId || item.headId === headId))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export function getActiveFamilyNames(headName) {
  const head = getActiveHeads().find(
    (item) => item.name.toLowerCase() === String(headName || '').trim().toLowerCase()
  );
  if (!head) return [];
  return getActiveFamilies(head.id).map((item) => item.name);
}

export function getActiveTrades({ familyId = null, headId = null } = {}) {
  return getCommercialStructure()
    .trades.filter((item) => {
      if (item.archived) return false;
      if (familyId) return item.familyId === familyId;
      if (headId) return item.headId === headId && !item.familyId;
      return true;
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/** @deprecated Use getActiveTrades({ familyId }) */
export function getActiveTradesByFamily(familyId = null) {
  return getActiveTrades({ familyId });
}

export function getActiveTradeNames(headName, familyName = '') {
  const head = getActiveHeads().find(
    (item) => item.name.toLowerCase() === String(headName || '').trim().toLowerCase()
  );
  if (!head) return [];

  const familyTrim = String(familyName || '').trim();
  if (!familyTrim) {
    return getActiveTrades({ headId: head.id }).map((item) => item.name);
  }

  const family = getActiveFamilies(head.id).find(
    (item) => item.name.toLowerCase() === familyTrim.toLowerCase()
  );
  if (!family) return [];
  return getActiveTrades({ familyId: family.id }).map((item) => item.name);
}

export function getHeadFamilyMap() {
  const map = {};
  for (const head of getActiveHeads()) {
    map[head.name] = getActiveFamilies(head.id).map((item) => item.name);
  }
  return map;
}

function reorderItems(items, id, direction) {
  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
  const index = sorted.findIndex((item) => item.id === id);
  if (index < 0) return items;
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= sorted.length) return items;
  const next = [...sorted];
  [next[index], next[target]] = [next[target], next[index]];
  return next.map((item, sortOrder) => ({ ...item, sortOrder, updatedAt: new Date().toISOString() }));
}

export function addCommercialHead(name) {
  const label = String(name || '').trim();
  if (!label) return { ok: false, errors: ['Commercial Head name is required.'] };

  const structure = getCommercialStructure();
  if (structure.heads.some((item) => item.name.toLowerCase() === label.toLowerCase())) {
    return { ok: false, errors: ['Commercial Head already exists.'] };
  }

  const head = {
    id: newAdminId('head'),
    name: label,
    sortOrder: structure.heads.length,
    archived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const family = {
    id: newAdminId('family'),
    headId: head.id,
    name: 'General',
    sortOrder: 0,
    archived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const trade = {
    id: newAdminId('trade'),
    familyId: family.id,
    headId: null,
    name: 'General',
    sortOrder: 0,
    archived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return {
    ok: true,
    structure: saveStructure({
      ...structure,
      heads: [...structure.heads, head],
      families: [...structure.families, family],
      trades: [...structure.trades, trade],
    }),
  };
}

export function addCommercialFamily(headId, name) {
  const label = String(name || '').trim();
  if (!label) return { ok: false, errors: ['Commercial Family name is required.'] };

  const structure = getCommercialStructure();
  const head = structure.heads.find((item) => item.id === headId);
  if (!head) return { ok: false, errors: ['Commercial Head not found.'] };

  if (
    structure.families.some(
      (item) => item.headId === headId && item.name.toLowerCase() === label.toLowerCase()
    )
  ) {
    return { ok: false, errors: ['Commercial Family already exists under this head.'] };
  }

  const family = {
    id: newAdminId('family'),
    headId,
    name: label,
    sortOrder: structure.families.filter((item) => item.headId === headId).length,
    archived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const trade = {
    id: newAdminId('trade'),
    familyId: family.id,
    headId: null,
    name: 'General',
    sortOrder: 0,
    archived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return {
    ok: true,
    structure: saveStructure({
      ...structure,
      families: [...structure.families, family],
      trades: [...structure.trades, trade],
    }),
  };
}

export function addCommercialTrade(familyId, name) {
  const label = String(name || '').trim();
  if (!label) return { ok: false, errors: ['Trade name is required.'] };

  const structure = getCommercialStructure();
  const family = structure.families.find((item) => item.id === familyId);
  if (!family) return { ok: false, errors: ['Commercial Family not found.'] };

  if (
    structure.trades.some(
      (item) => item.familyId === familyId && item.name.toLowerCase() === label.toLowerCase()
    )
  ) {
    return { ok: false, errors: ['Trade already exists under this family.'] };
  }

  const trade = {
    id: newAdminId('trade'),
    familyId,
    headId: null,
    name: label,
    sortOrder: structure.trades.filter((item) => item.familyId === familyId).length,
    archived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return {
    ok: true,
    structure: saveStructure({
      ...structure,
      trades: [...structure.trades, trade],
    }),
  };
}

export function updateCommercialHead(id, patch) {
  const structure = getCommercialStructure();
  const index = structure.heads.findIndex((item) => item.id === id);
  if (index < 0) return { ok: false, errors: ['Commercial Head not found.'] };

  const name = patch.name != null ? String(patch.name).trim() : structure.heads[index].name;
  if (!name) return { ok: false, errors: ['Commercial Head name is required.'] };

  const heads = [...structure.heads];
  heads[index] = { ...heads[index], ...patch, name, updatedAt: new Date().toISOString() };
  return { ok: true, structure: saveStructure({ ...structure, heads }) };
}

export function updateCommercialFamily(id, patch) {
  const structure = getCommercialStructure();
  const index = structure.families.findIndex((item) => item.id === id);
  if (index < 0) return { ok: false, errors: ['Commercial Family not found.'] };

  const name = patch.name != null ? String(patch.name).trim() : structure.families[index].name;
  if (!name) return { ok: false, errors: ['Commercial Family name is required.'] };

  const families = [...structure.families];
  families[index] = { ...families[index], ...patch, name, updatedAt: new Date().toISOString() };
  return { ok: true, structure: saveStructure({ ...structure, families }) };
}

export function updateCommercialTrade(id, patch) {
  const structure = getCommercialStructure();
  const index = structure.trades.findIndex((item) => item.id === id);
  if (index < 0) return { ok: false, errors: ['Trade not found.'] };

  const name = patch.name != null ? String(patch.name).trim() : structure.trades[index].name;
  if (!name) return { ok: false, errors: ['Trade name is required.'] };

  const trades = [...structure.trades];
  trades[index] = { ...trades[index], ...patch, name, updatedAt: new Date().toISOString() };
  return { ok: true, structure: saveStructure({ ...structure, trades }) };
}

export function archiveCommercialHead(id, usageCount = 0) {
  if (usageCount > 0) {
    return { ok: false, errors: ['Cannot archive a Commercial Head referenced by master data.'] };
  }
  return updateCommercialHead(id, { archived: true });
}

export function archiveCommercialFamily(id, usageCount = 0) {
  if (usageCount > 0) {
    return { ok: false, errors: ['Cannot archive a Commercial Family referenced by master data.'] };
  }
  return updateCommercialFamily(id, { archived: true });
}

export function archiveCommercialTrade(id, usageCount = 0) {
  if (usageCount > 0) {
    return { ok: false, errors: ['Cannot archive a Trade referenced by master data.'] };
  }
  return updateCommercialTrade(id, { archived: true });
}

export function reorderCommercialHead(id, direction) {
  const structure = getCommercialStructure();
  const heads = reorderItems(structure.heads, id, direction);
  return { ok: true, structure: saveStructure({ ...structure, heads }) };
}

export function reorderCommercialFamily(headId, id, direction) {
  const structure = getCommercialStructure();
  const scoped = structure.families.filter((item) => item.headId === headId);
  const reordered = reorderItems(scoped, id, direction);
  const others = structure.families.filter((item) => item.headId !== headId);
  return { ok: true, structure: saveStructure({ ...structure, families: [...others, ...reordered] }) };
}

export function reorderCommercialTrade(familyId, id, direction) {
  const structure = getCommercialStructure();
  const scoped = structure.trades.filter((item) => item.familyId === familyId);
  const reordered = reorderItems(scoped, id, direction);
  const others = structure.trades.filter((item) => item.familyId !== familyId);
  return { ok: true, structure: saveStructure({ ...structure, trades: [...others, ...reordered] }) };
}

export function resetCommercialStructure() {
  return saveStructure(buildDefaultStructure());
}

function findHeadByName(structure, headName) {
  const label = String(headName || '').trim();
  return structure.heads.find(
    (item) => !item.archived && item.name.toLowerCase() === label.toLowerCase()
  );
}

export function ensureCommercialHead(name) {
  const label = String(name || '').trim();
  if (!label) return { ok: false, created: false, errors: ['Commercial Head name is required.'] };

  const structure = getCommercialStructure();
  const existing = findHeadByName(structure, label);
  if (existing) return { ok: true, created: false, head: existing, structure };

  const head = {
    id: newAdminId('head'),
    name: label,
    sortOrder: structure.heads.length,
    archived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const next = saveStructure({ ...structure, heads: [...structure.heads, head] });
  return { ok: true, created: true, head, structure: next };
}

export function ensureCommercialFamily(headName, familyName) {
  const headLabel = String(headName || '').trim();
  const familyLabel = String(familyName || '').trim();
  if (!headLabel || !familyLabel) {
    return { ok: false, created: false, errors: ['Commercial Head and Family are required.'] };
  }

  const headResult = ensureCommercialHead(headLabel);
  if (!headResult.ok) return headResult;

  const structure = getCommercialStructure();
  const head = findHeadByName(structure, headLabel);
  const existing = structure.families.find(
    (item) =>
      !item.archived &&
      item.headId === head.id &&
      item.name.toLowerCase() === familyLabel.toLowerCase()
  );
  if (existing) return { ok: true, created: false, family: existing, structure };

  const family = {
    id: newAdminId('family'),
    headId: head.id,
    name: familyLabel,
    sortOrder: structure.families.filter((item) => item.headId === head.id).length,
    archived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const next = saveStructure({ ...structure, families: [...structure.families, family] });
  return { ok: true, created: true, family, structure: next };
}

export function ensureReportingGroup({ headName, familyName = null, groupName }) {
  const headLabel = String(headName || '').trim();
  const groupLabel = String(groupName || '').trim();
  const familyLabel = String(familyName || '').trim();

  if (!headLabel || !groupLabel) {
    return { ok: false, created: false, errors: ['Commercial Head and Reporting Group are required.'] };
  }

  const headResult = ensureCommercialHead(headLabel);
  if (!headResult.ok) return headResult;

  const structure = getCommercialStructure();
  const head = findHeadByName(structure, headLabel);

  if (familyLabel) {
    const familyResult = ensureCommercialFamily(headLabel, familyLabel);
    if (!familyResult.ok) return familyResult;
    const refreshed = getCommercialStructure();
    const refreshedHead = findHeadByName(refreshed, headLabel);
    const family = refreshed.families.find(
      (item) =>
        !item.archived &&
        item.headId === refreshedHead.id &&
        item.name.toLowerCase() === familyLabel.toLowerCase()
    );
    const existing = refreshed.trades.find(
      (item) =>
        !item.archived &&
        item.familyId === family.id &&
        item.name.toLowerCase() === groupLabel.toLowerCase()
    );
    if (existing) return { ok: true, created: false, trade: existing, structure: refreshed };

    const trade = {
      id: newAdminId('trade'),
      familyId: family.id,
      headId: null,
      name: groupLabel,
      sortOrder: refreshed.trades.filter((item) => item.familyId === family.id).length,
      archived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const next = saveStructure({ ...refreshed, trades: [...refreshed.trades, trade] });
    return { ok: true, created: true, trade, structure: next };
  }

  const refreshed = getCommercialStructure();
  const refreshedHead = findHeadByName(refreshed, headLabel);
  const existing = refreshed.trades.find(
    (item) =>
      !item.archived &&
      item.headId === refreshedHead.id &&
      !item.familyId &&
      item.name.toLowerCase() === groupLabel.toLowerCase()
  );
  if (existing) return { ok: true, created: false, trade: existing, structure: refreshed };

  const trade = {
    id: newAdminId('trade'),
    familyId: null,
    headId: refreshedHead.id,
    name: groupLabel,
    sortOrder: refreshed.trades.filter((item) => item.headId === refreshedHead.id && !item.familyId)
      .length,
    archived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const next = saveStructure({ ...refreshed, trades: [...refreshed.trades, trade] });
  return { ok: true, created: true, trade, structure: next };
}

export function addHeadLevelReportingGroup(headId, name) {
  const label = String(name || '').trim();
  if (!label) return { ok: false, errors: ['Reporting Group name is required.'] };

  const structure = getCommercialStructure();
  const head = structure.heads.find((item) => item.id === headId);
  if (!head) return { ok: false, errors: ['Commercial Head not found.'] };

  if (
    structure.trades.some(
      (item) =>
        !item.archived &&
        item.headId === headId &&
        !item.familyId &&
        item.name.toLowerCase() === label.toLowerCase()
    )
  ) {
    return { ok: false, errors: ['Reporting Group already exists under this head.'] };
  }

  const trade = {
    id: newAdminId('trade'),
    familyId: null,
    headId,
    name: label,
    sortOrder: structure.trades.filter((item) => item.headId === headId && !item.familyId).length,
    archived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return {
    ok: true,
    structure: saveStructure({ ...structure, trades: [...structure.trades, trade] }),
  };
}
