import { buildCvrModel } from './cvrEngine';
import { formatCvrMoney } from './cvrHelpers';
import { listCvrPeriods } from './cvrPeriodStore';
import { isCvrPeriodLocked } from './cvrPeriodStatus';
import { normaliseHierarchyCostCodeKey, selectCvrCommercialHierarchy } from './cvrCommercialHierarchyPresentation';
import { attributeCvrMovementRow } from './cvrMovementAttribution';

const LEGACY_COMPONENTS = [
  ['systemForecast', 'System Forecast'],
  ['expectedLiability', 'Expected Liability'],
  ['vaExposureUplift', 'Variation Account exposure'],
  ['commercialAdjustment', 'Commercial Adjustment'],
];
const CHANGE_EXPOSURE_COMPONENTS = [
  ['systemForecast', 'System Forecast'],
  ['changeExposure', 'Change Exposure'],
  ['commercialAdjustment', 'Commercial Adjustment'],
];

const pence = (value) => value == null || value === '' || !Number.isFinite(Number(value))
  ? null
  : Math.round(Number(value) * 100);
const money = (value) => value == null ? null : value / 100;
const periodNumber = (key) => Number(String(key || '').replace(/[^0-9]/g, '')) || 0;

export function findPreviousLockedCvrPeriod(developmentId, periodKey) {
  const current = periodNumber(periodKey);
  return listCvrPeriods(developmentId)
    .filter((period) => isCvrPeriodLocked(period) && periodNumber(period.periodKey) < current)
    .sort((a, b) => periodNumber(a.periodKey) - periodNumber(b.periodKey))
    .at(-1) || null;
}

function hierarchyByCostCode(period) {
  const authority = selectCvrCommercialHierarchy(period || {});
  return {
    state: authority.state,
    entries: new Map((authority.document?.costCodes || []).map((entry) => [
      normaliseHierarchyCostCodeKey(entry.costCodeKey), entry,
    ])),
  };
}

function hierarchyPath(authority, key) {
  if (authority.state === 'legacy_not_captured') {
    return { state: 'legacy_not_captured', label: 'Historic hierarchy not captured', ids: [] };
  }
  const entry = authority.entries.get(key);
  if (!entry) return { state: 'missing_cost_code', label: 'Hierarchy evidence unavailable', ids: [] };
  if (entry.resolutionState !== 'allocated') {
    const labels = {
      not_applicable: 'Not applicable', unallocated: 'Unallocated',
      unresolved_legacy: 'Legacy hierarchy unresolved', archived_assignment: 'Archived hierarchy assignment',
      invalid_assignment: 'Hierarchy needs review', missing_cost_code: 'Hierarchy evidence unavailable',
    };
    return { state: entry.resolutionState, label: labels[entry.resolutionState] || 'Hierarchy needs review', ids: [] };
  }
  const nodes = [entry.head, entry.family, entry.reportingGroup].filter(Boolean);
  return { state: 'allocated', label: nodes.map((node) => node.name).join(' → '), ids: nodes.map((node) => node.id) };
}

function componentDelta(name, current, previous, comparable, componentSet) {
  const currentPence = pence(current?.[name]);
  const previousPence = pence(previous?.[name]);
  const captured = name === 'expectedLiability'
    ? current?.expectedLiabilityCaptured !== false && previous?.expectedLiabilityCaptured !== false
    : name !== 'changeExposure' || (current?.changeExposureCaptured !== false && previous?.changeExposureCaptured !== false);
  if (!comparable || !captured || currentPence == null || previousPence == null) {
    return { key: name, label: componentSet.find(([key]) => key === name)?.[1], available: false, previous: null, current: null, movement: null, previousLabel: '—', currentLabel: '—', movementLabel: '—' };
  }
  const previousValue = money(previousPence);
  const currentValue = money(currentPence);
  const movement = money(currentPence - previousPence);
  return { key: name, label: componentSet.find(([key]) => key === name)?.[1], available: true, previous: previousValue, current: currentValue, movement, previousLabel: formatCvrMoney(previousValue), currentLabel: formatCvrMoney(currentValue), movementLabel: formatSignedMovement(movement) };
}

export function formatSignedMovement(value) {
  const amount = pence(value);
  if (amount == null) return '—';
  if (amount === 0) return '£0.00';
  return `${amount > 0 ? '+' : '−'}${formatCvrMoney(Math.abs(amount) / 100)}`;
}

export function buildCvrPeriodComparison({ currentModel, previousModel, currentPeriod, previousPeriod }) {
  const previousAvailable = Boolean(previousModel && !previousModel.unavailable && !previousModel.historicUnavailable);
  const previousComplete = previousAvailable && Boolean(previousModel.historic && previousModel.snapshot);
  const currentRows = new Map((currentModel?.rows || []).map((row) => [normaliseHierarchyCostCodeKey(row.costCodeKey), row]));
  const previousRows = new Map((previousModel?.rows || []).map((row) => [normaliseHierarchyCostCodeKey(row.costCodeKey), row]));
  const keys = new Set([...currentRows.keys(), ...previousRows.keys()]);
  const currentHierarchy = hierarchyByCostCode(currentPeriod);
  const previousHierarchy = hierarchyByCostCode(previousPeriod);

  const rows = [...keys].map((key) => {
    const current = currentRows.get(key) || null;
    const previous = previousRows.get(key) || null;
    const newCode = Boolean(current && !previous);
    const previousOnly = Boolean(previous && !current);
    const comparable = previousAvailable && (!newCode || previousComplete) && (!previousOnly || currentModel?.ready);
    const previousForecastPence = previous ? pence(previous.finalForecast) : comparable ? 0 : null;
    const currentForecastPence = current ? pence(current.finalForecast) : comparable ? 0 : null;
    const movementPence = comparable && previousForecastPence != null && currentForecastPence != null
      ? currentForecastPence - previousForecastPence : null;
    const componentSet = current?.changeExposure != null && previous?.changeExposure != null
      ? CHANGE_EXPOSURE_COMPONENTS : LEGACY_COMPONENTS;
    const components = componentSet.map(([name]) => componentDelta(
      name, current || {}, previous || {}, comparable && !newCode && !previousOnly, componentSet
    ));
    let explainedPence = null;
    if (components.every((component) => component.available)) {
      explainedPence = components.reduce((sum, component) => sum + pence(component.movement), 0);
    } else if ((newCode || previousOnly) && comparable) {
      // A complete snapshot proves the missing row was genuinely zero, but component attribution is unavailable.
      explainedPence = 0;
    }
    const residualPence = movementPence == null || explainedPence == null ? null : movementPence - explainedPence;
    const currentPath = hierarchyPath(currentHierarchy, key);
    const previousPath = hierarchyPath(previousHierarchy, key);
    const hierarchyChanged = previousAvailable && (
      currentPath.state !== previousPath.state || currentPath.ids.join(':') !== previousPath.ids.join(':')
    );
    const source = current || previous;
    const currentBudget = current?.currentBudget ?? null;
    const variance = current?.variance ?? null;
    const adjustmentChanged = components.find((component) => component.key === 'commercialAdjustment')?.movement;
    const adjustmentReason = adjustmentChanged
      ? current?.adjustmentReason || current?.commercialReason || current?.adjustmentHistory?.at(-1)?.reason || null
      : null;
    const row = {
      id: `movement-${key}`, costCodeKey: source?.costCodeKey || key,
      costCodeLabel: source?.costCodeLabel || key.toUpperCase(), description: source?.description || '',
      previousForecast: money(previousForecastPence), currentForecast: money(currentForecastPence),
      movement: money(movementPence), currentBudget, variance, comparable,
      previousForecastLabel: formatCvrMoney(money(previousForecastPence)),
      currentForecastLabel: formatCvrMoney(money(currentForecastPence)), movementLabel: formatSignedMovement(money(movementPence)),
      currentBudgetLabel: formatCvrMoney(currentBudget), varianceLabel: formatCvrMoney(variance),
      components, explained: money(explainedPence), explainedLabel: formatSignedMovement(money(explainedPence)),
      residual: money(residualPence), residualLabel: formatSignedMovement(money(residualPence)),
      unexplained: residualPence == null ? movementPence !== 0 : residualPence !== 0,
      adjustmentReason, newCode, previousOnly, currentHierarchy: currentPath, previousHierarchy: previousPath, hierarchyChanged,
    };
    return attributeCvrMovementRow({ row, current, previous, currentPeriod, previousPeriod });
  }).sort((a, b) => Math.abs(pence(b.movement) || 0) - Math.abs(pence(a.movement) || 0));

  const moved = rows.filter((row) => row.comparable && pence(row.movement) !== 0);
  const explainedMoved = moved.filter((row) => !row.unexplained);
  const adverse = explainedMoved.filter((row) => pence(row.movement) > 0);
  const favourable = explainedMoved.filter((row) => pence(row.movement) < 0);
  const keyAdverse = adverse.slice(0, 5);
  const keyFavourable = favourable.slice(0, 5);
  const keyIds = new Set([...keyAdverse, ...keyFavourable].map((row) => row.id));
  const other = explainedMoved.filter((row) => !keyIds.has(row.id));
  const displayedIds = new Set([...keyAdverse, ...keyFavourable, ...other].map((row) => row.id));
  const totalMovementPence = previousAvailable
    ? (pence(currentModel?.summary?.finalForecast) ?? 0) - (pence(previousModel?.summary?.finalForecast) ?? 0)
    : null;
  const automaticallyAttributedPence = rows.reduce((sum, row) => sum + (pence(row.automaticallyAttributed) || 0), 0);
  const qsExplainedPence = rows.reduce((sum, row) => sum + (pence(row.qsExplained) || 0), 0);
  const awaitingExplanationPence = rows.reduce((sum, row) => sum + (pence(row.awaitingExplanation) || 0), 0);
  const explanationReconciliationPence = automaticallyAttributedPence + qsExplainedPence + awaitingExplanationPence;
  return {
    available: previousAvailable, previousPeriodKey: previousPeriod?.periodKey || null,
    previousPeriodId: previousPeriod?.id || null,
    previousSnapshotId: previousPeriod?.snapshot?.id || null,
    rows, totalMovement: money(totalMovementPence), totalMovementLabel: formatSignedMovement(money(totalMovementPence)),
    sections: {
      adverse: keyAdverse, favourable: keyFavourable,
      other,
      unexplained: rows.filter((row) => pence(row.awaitingExplanation) !== 0 && !displayedIds.has(row.id)),
    },
    reconciles: totalMovementPence == null ? null : rows.reduce((sum, row) => sum + (pence(row.movement) || 0), 0) === totalMovementPence,
    automaticallyAttributed: money(automaticallyAttributedPence),
    qsExplained: money(qsExplainedPence),
    awaitingExplanation: money(awaitingExplanationPence),
    awaitingExplanationMagnitude: money(rows.reduce((sum, row) =>
      sum + (pence(row.awaitingExplanationMagnitude) || 0), 0)),
    explanationReconciles: totalMovementPence == null ? null : explanationReconciliationPence === totalMovementPence,
  };
}

export function buildCvrPeriodComparisonForPeriod(developmentId, { periodKey, period, pos = [], currentModel = null } = {}) {
  const previousPeriod = findPreviousLockedCvrPeriod(developmentId, periodKey);
  const resolvedCurrent = currentModel || buildCvrModel(developmentId, { periodKey, period, pos });
  const previousModel = previousPeriod
    ? buildCvrModel(developmentId, { periodKey: previousPeriod.periodKey, period: previousPeriod, pos })
    : null;
  return buildCvrPeriodComparison({ currentModel: resolvedCurrent, previousModel, currentPeriod: period, previousPeriod });
}
