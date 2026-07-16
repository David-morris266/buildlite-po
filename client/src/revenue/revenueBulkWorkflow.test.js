import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

import { createDevelopment } from '../developments/developmentStore';
import { addPlot } from '../developments/plotMaster';
import {
  REVENUE_BULK_ACTIONS,
  buildSaveStrategySummary,
  countManualOverrides,
  runSaveStrategyApplyWorkflow,
  saveRevenueStrategyOnly,
} from './revenueBulkWorkflow';
import {
  bulkApplyDevelopmentStrategy,
  bulkClearManualOverrides,
  bulkResetPlotPremiums,
  emptyRevenueStrategy,
  saveRevenueStrategy,
} from './revenueStrategy';

describe('revenueBulkWorkflow', () => {
  beforeEach(() => storage.clear());

  it('exposes renamed bulk action labels', () => {
    expect(REVENUE_BULK_ACTIONS.map((action) => action.label)).toEqual([
      'Update All Plot Prices',
      'Recalculate House Types',
      'Remove Plot Overrides',
      'Clear Plot Premiums',
    ]);
  });

  it('builds contextual toast messages for bulk actions', () => {
    const applyAction = REVENUE_BULK_ACTIONS.find((action) => action.key === 'apply-strategy');
    expect(applyAction.buildToast({ updatedCount: 287, manualPreserved: 14 })).toBe(
      '287 plots updated. 14 manual overrides preserved.'
    );

    const premiumAction = REVENUE_BULK_ACTIONS.find((action) => action.key === 'reset-premiums');
    expect(premiumAction.buildToast({ updatedCount: 12, manualPreserved: 2 })).toContain(
      'Plot premiums cleared.'
    );
  });

  it('saves strategy without applying when requested', () => {
    const development = createDevelopment({
      jobNumber: 'WF-1',
      developmentName: 'Workflow Test',
    });

    const result = saveRevenueStrategyOnly(development.id, emptyRevenueStrategy());
    expect(result.ok).toBe(true);
  });

  it('runs save-and-apply workflow and preserves manual overrides', () => {
    const development = createDevelopment({
      jobNumber: 'WF-2',
      developmentName: 'Apply Test',
    });

    saveRevenueStrategy(development.id, emptyRevenueStrategy());

    addPlot(development.id, {
      plotNumber: '1',
      houseType: 'Ash',
      niaFt2: 950,
      revenueSource: 'House Type',
    });

    addPlot(development.id, {
      plotNumber: '2',
      houseType: 'Oak',
      niaFt2: 1000,
      revenueSource: 'Manual Value',
      manualForecastValue: 300000,
      manualOverrideExplicit: true,
      pricingMigrated: true,
    });

    expect(countManualOverrides(development.id)).toBe(1);

    const result = runSaveStrategyApplyWorkflow(development.id, emptyRevenueStrategy());
    const summary = buildSaveStrategySummary(result);

    expect(result.ok).toBe(true);
    expect(result.manualPreserved).toBe(1);
    expect(summary).toContain('Revenue Strategy saved.');
    expect(summary).toContain('Manual Override');
  });

  it('explains when bulk actions have no eligible plots', () => {
    const development = createDevelopment({
      jobNumber: 'WF-3',
      developmentName: 'Empty Bulk Test',
    });

    saveRevenueStrategy(development.id, emptyRevenueStrategy());

    addPlot(development.id, {
      plotNumber: '1',
      houseType: 'Ash',
      niaFt2: 950,
      revenueSource: 'Manual Value',
      manualForecastValue: 300000,
      manualOverrideExplicit: true,
      pricingMigrated: true,
    });

    const applyAction = REVENUE_BULK_ACTIONS.find((action) => action.key === 'apply-strategy');
    const applyResult = bulkApplyDevelopmentStrategy(development.id);
    expect(applyAction.buildToast(applyResult)).toBe(
      'All plots are manual overrides or plot overrides — nothing to update.'
    );

    const clearAction = REVENUE_BULK_ACTIONS.find((action) => action.key === 'clear-manual');
    const clearResult = bulkClearManualOverrides(development.id);
    expect(clearAction.buildToast({ ...clearResult, removedCount: clearResult.updatedCount })).toContain(
      'manual override'
    );

    const premiumAction = REVENUE_BULK_ACTIONS.find((action) => action.key === 'reset-premiums');
    const premiumResult = bulkResetPlotPremiums(development.id);
    expect(premiumAction.buildToast(premiumResult)).toBe('No plot premiums to clear.');
  });
});
