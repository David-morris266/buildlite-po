import { getActiveHeadNames } from './commercialStructureStore';
import { readAdminStore, writeAdminStore } from './adminStorage';
import { notifyMasterDataChanged } from './masterDataEvents';

export const COMMERCIAL_BEHAVIOUR_KEY = 'buildlite_commercial_behaviour_v1';

export const FORECAST_SOURCE_OPTIONS = ['Committed', 'Budget', 'Actual'];

function defaultBehaviourForHead(headName) {
  return {
    commercialHead: headName,
    forecastSource: 'Committed',
    defaultJournalAllowed: true,
    negativeCtcWarning: true,
    includeOnExecutiveSummary: true,
  };
}

function normaliseBehaviour(headName, record = {}) {
  const forecastSource = FORECAST_SOURCE_OPTIONS.includes(record.forecastSource)
    ? record.forecastSource
    : 'Committed';

  return {
    commercialHead: headName,
    forecastSource,
    defaultJournalAllowed: record.defaultJournalAllowed !== false,
    negativeCtcWarning: record.negativeCtcWarning !== false,
    includeOnExecutiveSummary: record.includeOnExecutiveSummary !== false,
  };
}

export function getCommercialBehaviourSettings() {
  const stored = readAdminStore(COMMERCIAL_BEHAVIOUR_KEY, {});
  const behaviours = {};

  for (const headName of getActiveHeadNames()) {
    behaviours[headName] = normaliseBehaviour(
      headName,
      stored.behaviours?.[headName] || defaultBehaviourForHead(headName)
    );
  }

  return {
    behaviours,
    updatedAt: stored.updatedAt || null,
  };
}

export function getCommercialBehaviourForHead(headName) {
  return getCommercialBehaviourSettings().behaviours[headName] || null;
}

export function saveCommercialBehaviour(headName, patch = {}) {
  const label = String(headName || '').trim();
  if (!label) return { ok: false, errors: ['Commercial Head is required.'] };

  const current = getCommercialBehaviourSettings();
  const nextBehaviours = {
    ...current.behaviours,
    [label]: normaliseBehaviour(label, {
      ...current.behaviours[label],
      ...patch,
      commercialHead: label,
    }),
  };

  const next = {
    behaviours: nextBehaviours,
    updatedAt: new Date().toISOString(),
  };
  writeAdminStore(COMMERCIAL_BEHAVIOUR_KEY, next);
  notifyMasterDataChanged('commercial-behaviour');
  return { ok: true, settings: next };
}

export function saveAllCommercialBehaviours(behaviours = {}) {
  const current = getCommercialBehaviourSettings();
  const nextBehaviours = { ...current.behaviours };

  for (const [headName, patch] of Object.entries(behaviours)) {
    nextBehaviours[headName] = normaliseBehaviour(headName, {
      ...current.behaviours[headName],
      ...patch,
      commercialHead: headName,
    });
  }

  const next = {
    behaviours: nextBehaviours,
    updatedAt: new Date().toISOString(),
  };
  writeAdminStore(COMMERCIAL_BEHAVIOUR_KEY, next);
  notifyMasterDataChanged('commercial-behaviour');
  return { ok: true, settings: next };
}
