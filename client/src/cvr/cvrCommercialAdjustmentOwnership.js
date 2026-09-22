import { formatReportingPeriod } from './cvrReportingMonth';

const WORKFLOW_OWNERS = Object.freeze({
  prelims_adoption: {
    metadataKey: 'prelimsAdoption',
    sourceLabel: 'Site Prelims',
    reasonLabel: 'Site Prelims forecast adopted',
    actionLabel: 'View Site Prelims',
    tabId: 'prelims',
  },
  selling_costs_adoption: {
    metadataKey: 'sellingCostsAdoption',
    sourceLabel: 'Selling Costs',
    reasonLabel: 'Selling Costs forecast adopted',
    actionLabel: 'View Selling Costs',
    tabId: 'selling-costs',
  },
});

function moneyMatches(left, right) {
  const a = Number(left);
  const b = Number(right);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 0.005;
}

function text(value) {
  return String(value || '').trim();
}

export function resolveCommercialAdjustmentOwnership(row) {
  const history = Array.isArray(row?.adjustmentHistory) ? row.adjustmentHistory : [];
  const currentHistory = history.at(-1);
  const owner = WORKFLOW_OWNERS[currentHistory?.source];
  if (!owner) return { kind: 'manual' };

  const metadata = row?.displayMetadata?.[owner.metadataKey];
  if (!metadata || metadata.superseded) return { kind: 'manual' };

  const currentAdjustment = row?.commercialAdjustment ?? 0;
  const historyReason = currentHistory.newReason ?? currentHistory.reason;
  if (
    !moneyMatches(currentHistory.newAdjustment, currentAdjustment) ||
    !moneyMatches(metadata.adoptedAdjustment, currentAdjustment) ||
    text(historyReason) !== text(row?.commercialReason)
  ) {
    return { kind: 'manual' };
  }

  return {
    kind: 'workflow',
    source: currentHistory.source,
    sourceLabel: owner.sourceLabel,
    reasonLabel: owner.reasonLabel,
    actionLabel: owner.actionLabel,
    tabId: owner.tabId,
    changedAt: metadata.adoptedAt || currentHistory.timestamp || currentHistory.date || null,
    changedBy: metadata.adoptedBy || currentHistory.actor || currentHistory.user || null,
    reportingMonth: metadata.reportingMonth || null,
    reportingPeriodLabel: formatReportingPeriod(metadata.reportingMonth),
    metadata,
  };
}

export function appendManualAdjustmentHistory(history, entry) {
  return [
    ...(Array.isArray(history) ? history : []),
    {
      ...entry,
      source: 'manual_adjustment',
      previousReason: text(entry?.previousReason),
      newReason: text(entry?.newReason ?? entry?.reason),
      reason: text(entry?.newReason ?? entry?.reason),
    },
  ];
}
