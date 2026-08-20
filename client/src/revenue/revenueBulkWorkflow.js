/**
 * BL-019C.1 — Bulk action workflow orchestration (presentation layer only).
 * Wraps existing revenueStrategy bulk functions without changing calculation logic.
 */

import { getPlots } from '../developments/plotMaster';
import {
  bulkApplyDevelopmentStrategy,
  bulkClearManualOverrides,
  bulkRecalculateHouseTypeValues,
  bulkResetPlotPremiums,
  getHouseTypePricing,
  saveRevenueStrategy,
  syncPlotForecastPrices,
} from './revenueStrategy';

export function countManualOverrides(developmentId) {
  return getPlots(developmentId).filter((plot) => plot.revenueSource === 'Manual Value').length;
}

export function yieldToUi() {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

export const REVENUE_BULK_ACTIONS = [
  {
    key: 'apply-strategy',
    label: 'Update All Plot Prices',
    title: 'Update all plot prices?',
    message:
      'Auto-priced plots will switch to Development Strategy pricing. Manual overrides will not be changed.',
    progressLabel: 'Updating all plot prices…',
    async run(developmentId) {
      const manualPreserved = countManualOverrides(developmentId);
      const result = await bulkApplyDevelopmentStrategy(developmentId);
      return { ...result, manualPreserved };
    },
    buildToast(result) {
      if (result.skipReason) return result.skipReason;
      const parts = [`${result.updatedCount} plot${result.updatedCount === 1 ? '' : 's'} updated.`];
      if (result.manualPreserved > 0) {
        parts.push(`${result.manualPreserved} manual override${result.manualPreserved === 1 ? '' : 's'} preserved.`);
      }
      return parts.join(' ');
    },
  },
  {
    key: 'recalculate-house-types',
    label: 'Recalculate House Types',
    title: 'Recalculate house types?',
    message: 'House type NIA and auto forecast values will refresh from Plot Master and strategy defaults.',
    progressLabel: 'Recalculating house types…',
    async run(developmentId) {
      const manualPreserved = countManualOverrides(developmentId);
      const result = await bulkRecalculateHouseTypeValues(developmentId);
      const houseTypeCount = Object.keys(getHouseTypePricing(developmentId)).length;
      return { ...result, manualPreserved, houseTypeCount };
    },
    buildToast(result) {
      if (result.skipReason) return result.skipReason;
      const parts = ['House Types recalculated.'];
      if (result.houseTypeCount > 0) {
        parts.unshift(
          `${result.houseTypeCount} House Type${result.houseTypeCount === 1 ? '' : 's'} updated.`
        );
      }
      if (result.manualPreserved > 0) {
        parts.push(`${result.manualPreserved} manual override${result.manualPreserved === 1 ? '' : 's'} preserved.`);
      }
      return parts.join(' ');
    },
  },
  {
    key: 'clear-manual',
    label: 'Remove Plot Overrides',
    title: 'Remove all plot overrides?',
    message: 'Every manually priced plot will revert to House Type pricing.',
    progressLabel: 'Removing plot overrides…',
    async run(developmentId) {
      const result = await bulkClearManualOverrides(developmentId);
      return { ...result, removedCount: result.updatedCount };
    },
    buildToast(result) {
      if (result.skipReason) return result.skipReason;
      if (!result.removedCount) return 'No manual overrides to remove.';
      return `${result.removedCount} manual override${result.removedCount === 1 ? '' : 's'} removed.`;
    },
  },
  {
    key: 'reset-premiums',
    label: 'Clear Plot Premiums',
    title: 'Clear all plot premiums?',
    message: 'Plot premium amounts and reasons will be cleared across the development.',
    progressLabel: 'Clearing plot premiums…',
    async run(developmentId) {
      const manualPreserved = countManualOverrides(developmentId);
      const result = await bulkResetPlotPremiums(developmentId);
      return { ...result, manualPreserved };
    },
    buildToast(result) {
      if (result.skipReason) return result.skipReason;
      const parts = ['Plot premiums cleared.'];
      if (result.updatedCount > 0) {
        parts.unshift(`${result.updatedCount} plot${result.updatedCount === 1 ? '' : 's'} updated.`);
      }
      if (result.manualPreserved > 0) {
        parts.push(`${result.manualPreserved} manual override${result.manualPreserved === 1 ? '' : 's'} preserved.`);
      }
      return parts.join(' ');
    },
  },
];

export async function runBulkActionWorkflow(developmentId, action) {
  await yieldToUi();
  const result = await action.run(developmentId);
  await yieldToUi();
  return result;
}

export function saveRevenueStrategyOnly(developmentId, draft) {
  return saveRevenueStrategy(developmentId, draft);
}

export async function runSaveStrategyApplyWorkflow(developmentId, draft) {
  const manualPreserved = countManualOverrides(developmentId);
  const saveResult = await Promise.resolve(saveRevenueStrategy(developmentId, draft));
  if (!saveResult.ok) {
    return { ok: false, errors: saveResult.errors || ['Could not save revenue strategy.'] };
  }

  await bulkRecalculateHouseTypeValues(developmentId);
  const syncResult = await syncPlotForecastPrices(developmentId);
  const houseTypeCount = Object.keys(getHouseTypePricing(developmentId)).length;
  const plotsRecalculated = syncResult.updatedCount;

  return {
    ok: true,
    manualPreserved,
    houseTypeCount,
    plotsRecalculated,
  };
}

export function buildSaveStrategySummary(result) {
  if (!result?.ok) return null;
  const lines = ['Revenue Strategy saved.'];
  if (result.houseTypeCount > 0) {
    lines.push(`${result.houseTypeCount} House Type${result.houseTypeCount === 1 ? '' : 's'} updated.`);
  }
  if (result.plotsRecalculated > 0) {
    lines.push(
      `${result.plotsRecalculated} Plot forecast${result.plotsRecalculated === 1 ? '' : 's'} recalculated.`
    );
  }
  if (result.manualPreserved > 0) {
    lines.push(`${result.manualPreserved} Manual Override${result.manualPreserved === 1 ? '' : 's'} preserved.`);
  }
  return lines.join('\n');
}
