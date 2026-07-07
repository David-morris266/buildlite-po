/**
 * BL-012B — CVR persistence (localStorage, period-ready structure).
 */

const STORAGE_KEY = 'buildlite_cvr_v1';
export const CVR_CURRENT_PERIOD = 'current';

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function newId() {
  return `cc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyPeriod() {
  return {
    costCentres: [],
    developmentNotes: '',
    updatedAt: null,
  };
}

function normaliseDevelopmentRecord(record) {
  if (!record) {
    return {
      activePeriodKey: CVR_CURRENT_PERIOD,
      periods: { [CVR_CURRENT_PERIOD]: emptyPeriod() },
      updatedAt: null,
    };
  }

  const periods =
    record.periods && typeof record.periods === 'object'
      ? { ...record.periods }
      : { [CVR_CURRENT_PERIOD]: emptyPeriod() };

  if (!periods[CVR_CURRENT_PERIOD]) {
    periods[CVR_CURRENT_PERIOD] = emptyPeriod();
  }

  periods[CVR_CURRENT_PERIOD].costCentres = Array.isArray(
    periods[CVR_CURRENT_PERIOD].costCentres
  )
    ? periods[CVR_CURRENT_PERIOD].costCentres
    : [];

  return {
    activePeriodKey: record.activePeriodKey || CVR_CURRENT_PERIOD,
    periods,
    updatedAt: record.updatedAt || null,
  };
}

export function ensureCvrRecord(developmentId) {
  const all = readAll();
  if (!all[developmentId]) {
    all[developmentId] = normaliseDevelopmentRecord(null);
    writeAll(all);
  }
  return normaliseDevelopmentRecord(all[developmentId]);
}

export function getCvrRecord(developmentId) {
  return normaliseDevelopmentRecord(readAll()[developmentId]);
}

export function getActivePeriodKey(developmentId) {
  return getCvrRecord(developmentId).activePeriodKey || CVR_CURRENT_PERIOD;
}

export function getPeriodData(developmentId, periodKey = CVR_CURRENT_PERIOD) {
  const record = ensureCvrRecord(developmentId);
  return record.periods[periodKey] || emptyPeriod();
}

export function listCostCentres(developmentId, periodKey = CVR_CURRENT_PERIOD) {
  return [...getPeriodData(developmentId, periodKey).costCentres].filter(
    (item) => item.active !== false
  );
}

export function getCostCentre(developmentId, costCentreId, periodKey = CVR_CURRENT_PERIOD) {
  return (
    getPeriodData(developmentId, periodKey).costCentres.find(
      (item) => item.id === costCentreId
    ) || null
  );
}

export function getDevelopmentNotes(developmentId, periodKey = CVR_CURRENT_PERIOD) {
  return getPeriodData(developmentId, periodKey).developmentNotes || '';
}

export function updateDevelopmentNotes(
  developmentId,
  notes,
  periodKey = CVR_CURRENT_PERIOD
) {
  const all = readAll();
  const record = ensureCvrRecord(developmentId);
  const now = new Date().toISOString();

  record.periods[periodKey] = {
    ...record.periods[periodKey],
    developmentNotes: String(notes || ''),
    updatedAt: now,
  };
  record.updatedAt = now;
  all[developmentId] = record;
  writeAll(all);

  return record.periods[periodKey];
}

function parseBudgetValue(value) {
  if (value == null || value === '') return null;
  const n = Number.parseFloat(String(value).replace(/[£,\s]/g, ''));
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : null;
}

export function addCostCentre(developmentId, payload, periodKey = CVR_CURRENT_PERIOD) {
  const all = readAll();
  const record = ensureCvrRecord(developmentId);
  const period = record.periods[periodKey] || emptyPeriod();
  const now = new Date().toISOString();

  const label = String(payload.costCodeLabel || '').trim();
  if (!label) {
    return { ok: false, errors: ['Cost code is required.'] };
  }

  const costCentre = {
    id: newId(),
    costCodeKey: String(payload.costCodeKey || label).trim().toLowerCase(),
    costCodeLabel: label,
    description: String(payload.description || '').trim(),
    commercialFamily: String(payload.commercialFamily || 'Direct Cost').trim(),
    originalBudget: parseBudgetValue(payload.originalBudget),
    currentBudget:
      parseBudgetValue(payload.currentBudget) ??
      parseBudgetValue(payload.originalBudget),
    forecastFinalCost: parseBudgetValue(payload.forecastFinalCost),
    commercialNotes: '',
    forecastNotes: '',
    active: true,
    createdAt: now,
    updatedAt: now,
  };

  period.costCentres = [...period.costCentres, costCentre];
  period.updatedAt = now;
  record.periods[periodKey] = period;
  record.updatedAt = now;
  all[developmentId] = record;
  writeAll(all);

  return { ok: true, costCentre };
}

export function updateCostCentre(
  developmentId,
  costCentreId,
  patch,
  periodKey = CVR_CURRENT_PERIOD
) {
  const all = readAll();
  const record = ensureCvrRecord(developmentId);
  const period = record.periods[periodKey];
  if (!period) return { ok: false, errors: ['CVR period not found.'] };

  const index = period.costCentres.findIndex((item) => item.id === costCentreId);
  if (index < 0) return { ok: false, errors: ['Cost code not found.'] };

  const current = period.costCentres[index];
  const now = new Date().toISOString();
  const next = { ...current, updatedAt: now };

  if (patch.costCodeLabel != null) {
    next.costCodeLabel = String(patch.costCodeLabel).trim() || current.costCodeLabel;
  }
  if (patch.originalBudget !== undefined) {
    next.originalBudget = parseBudgetValue(patch.originalBudget);
  }
  if (patch.currentBudget !== undefined) {
    next.currentBudget = parseBudgetValue(patch.currentBudget);
  }
  if (patch.forecastFinalCost !== undefined) {
    next.forecastFinalCost = parseBudgetValue(patch.forecastFinalCost);
  }
  if (patch.commercialNotes !== undefined) {
    next.commercialNotes = String(patch.commercialNotes || '');
  }
  if (patch.forecastNotes !== undefined) {
    next.forecastNotes = String(patch.forecastNotes || '');
  }
  if (patch.active !== undefined) {
    next.active = Boolean(patch.active);
  }

  period.costCentres[index] = next;
  period.updatedAt = now;
  record.updatedAt = now;
  all[developmentId] = record;
  writeAll(all);

  return { ok: true, costCentre: next };
}

export function deactivateCostCentre(
  developmentId,
  costCentreId,
  periodKey = CVR_CURRENT_PERIOD
) {
  return updateCostCentre(developmentId, costCentreId, { active: false }, periodKey);
}

export function deleteCostCentre(
  developmentId,
  costCentreId,
  periodKey = CVR_CURRENT_PERIOD
) {
  const all = readAll();
  const record = ensureCvrRecord(developmentId);
  const period = record.periods[periodKey];
  if (!period) return { ok: false, errors: ['CVR period not found.'] };

  period.costCentres = period.costCentres.filter((item) => item.id !== costCentreId);
  period.updatedAt = new Date().toISOString();
  record.updatedAt = period.updatedAt;
  all[developmentId] = record;
  writeAll(all);

  return { ok: true };
}

export function upsertAutoCostCentre(
  developmentId,
  { costCodeKey, costCodeLabel, description = '', commercialFamily = 'Direct Cost' },
  periodKey = CVR_CURRENT_PERIOD
) {
  const period = getPeriodData(developmentId, periodKey);
  const existing = period.costCentres.find(
    (item) => item.costCodeKey === costCodeKey && item.active !== false
  );
  if (existing) return existing;

  const result = addCostCentre(
    developmentId,
    {
      costCodeKey,
      costCodeLabel,
      description,
      commercialFamily,
      originalBudget: null,
      currentBudget: null,
      forecastFinalCost: null,
    },
    periodKey
  );

  return result.ok ? result.costCentre : null;
}
