/**
 * BL-012A — Create CVR cost codes from ledger import (localStorage).
 */

import { normaliseCostCodeKey, expandCostCodeKeys } from '../cvr/cvrCalculations';
import {
  getPeriodData,
  upsertAutoCostCentre,
} from '../cvr/costCentreStore';
import { getEditablePeriodKey } from '../cvr/cvrPeriodStore';

export const DEFAULT_COMMERCIAL_FAMILY = 'Direct Cost';

function readCostCentreKeys(developmentId) {
  const periodKey = getEditablePeriodKey(developmentId);
  return new Set(
    getPeriodData(developmentId, periodKey).costCentres
      .filter((item) => item.active !== false)
      .map((item) => normaliseCostCodeKey(item.costCodeKey))
      .filter(Boolean)
  );
}

export function buildCostCentreLabel(costCode, description = '') {
  const code = String(costCode || '').trim();
  const desc = String(description || '').trim();
  if (code && desc && !code.toLowerCase().includes(desc.toLowerCase())) {
    return `${code} — ${desc}`;
  }
  return code || desc || 'Unclassified';
}

export function buildImportCostCentreDescription(mapped = {}) {
  return (
    String(mapped.description || '').trim() ||
    String(mapped.activity || '').trim() ||
    String(mapped.costCode || '').trim()
  );
}

export function collectKnownCostCentreKeys(developmentId, apiCostCodeKeys = []) {
  const keys = readCostCentreKeys(developmentId);
  for (const key of apiCostCodeKeys) {
    for (const variant of expandCostCodeKeys(key)) {
      if (variant) keys.add(variant);
    }
  }
  for (const key of [...keys]) {
    for (const variant of expandCostCodeKeys(key)) {
      if (variant) keys.add(variant);
    }
  }
  return keys;
}

export function createCostCentresFromImport(developmentId, pendingCostCentres = []) {
  const existingKeys = readCostCentreKeys(developmentId);
  const created = [];

  for (const pending of pendingCostCentres) {
    const costCodeKey = normaliseCostCodeKey(pending.costCodeKey || pending.costCode);
    if (!costCodeKey || existingKeys.has(costCodeKey)) continue;

    const periodKey = getEditablePeriodKey(developmentId);
    const costCentre = upsertAutoCostCentre(
      developmentId,
      {
        costCodeKey,
        costCodeLabel: buildCostCentreLabel(pending.costCode, pending.description),
        description: pending.description || '',
        commercialFamily: pending.commercialFamily || DEFAULT_COMMERCIAL_FAMILY,
      },
      periodKey
    );

    if (costCentre) {
      created.push(costCentre);
      existingKeys.add(costCodeKey);
    }
  }

  return created;
}
