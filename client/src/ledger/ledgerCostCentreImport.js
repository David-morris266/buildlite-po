/**
 * BL-012A — Create CVR cost codes from ledger import (localStorage).
 */

import { normaliseCostCodeKey } from '../cvr/cvrCalculations';
import {
  CVR_CURRENT_PERIOD,
  getPeriodData,
  upsertAutoCostCentre,
} from '../cvr/costCentreStore';

export const DEFAULT_COMMERCIAL_FAMILY = 'Direct Cost';

function readCostCentreKeys(developmentId) {
  return new Set(
    getPeriodData(developmentId, CVR_CURRENT_PERIOD).costCentres
      .filter((item) => item.active !== false)
      .map((item) => item.costCodeKey)
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
    const normalised = normaliseCostCodeKey(key);
    if (normalised) keys.add(normalised);
  }
  return keys;
}

export function createCostCentresFromImport(developmentId, pendingCostCentres = []) {
  const existingKeys = readCostCentreKeys(developmentId);
  const created = [];

  for (const pending of pendingCostCentres) {
    const costCodeKey = normaliseCostCodeKey(pending.costCodeKey || pending.costCode);
    if (!costCodeKey || existingKeys.has(costCodeKey)) continue;

    const costCentre = upsertAutoCostCentre(
      developmentId,
      {
        costCodeKey,
        costCodeLabel: buildCostCentreLabel(pending.costCode, pending.description),
        description: pending.description || '',
        commercialFamily: pending.commercialFamily || DEFAULT_COMMERCIAL_FAMILY,
      },
      CVR_CURRENT_PERIOD
    );

    if (costCentre) {
      created.push(costCentre);
      existingKeys.add(costCodeKey);
    }
  }

  return created;
}
