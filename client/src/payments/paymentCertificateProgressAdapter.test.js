import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';
import {
  applyPositionalProgressPatch,
  buildValuationGridFromSnapshot,
  positionalKeyToStable,
  sumPreviousStableProgress,
  toServerProgress,
} from './paymentCertificateProgressAdapter';
import { buildStableCellId } from './paymentCertificateCellIdentity';

const matrix = {
  layout: 'plot-stage',
  stages: ['First Fix', 'Second Fix'],
  plots: [
    { id: 'plot-1', label: 'Plot 1', values: [10000, 20000] },
    { id: 'plot-2', label: 'Plot 2', values: [8000, 12000] },
  ],
};

describe('paymentCertificateProgressAdapter (BL-030C)', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
  });

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  it('converts positional UI cells to plotId + stageKey', () => {
    const mapped = positionalKeyToStable('0::1', matrix);
    expect(mapped.ok).toBe(true);
    expect(mapped.plotId).toBe('plot-1');
    expect(mapped.stageKey).toBe('Second Fix');
    expect(mapped.cellId).toBe(buildStableCellId('plot-1', 'Second Fix'));
  });

  it('sends stable progress and never persists positional keys', () => {
    const converted = toServerProgress(
      {
        '0::0': { thisCertificatePct: 40 },
        '1::1': { thisCertificatePct: 25 },
      },
      matrix
    );
    expect(converted.ok).toBe(true);
    expect(converted.progress['0::0']).toBeUndefined();
    expect(converted.progress[buildStableCellId('plot-1', 'First Fix')]).toEqual({
      plotId: 'plot-1',
      stageKey: 'First Fix',
      thisCertificatePct: 40,
    });
    expect(converted.progress[buildStableCellId('plot-2', 'Second Fix')].thisCertificatePct).toBe(
      25
    );
  });

  it('is reorder-safe: previous % follows plotId + stageKey', () => {
    const prior = [
      {
        certificateNumber: 1,
        status: 'locked',
        progress: {
          [buildStableCellId('plot-1', 'First Fix')]: {
            plotId: 'plot-1',
            stageKey: 'First Fix',
            thisCertificatePct: 40,
          },
        },
        valuationSnapshot: {
          cells: [
            {
              plotId: 'plot-1',
              stageKey: 'First Fix',
              thisCertificatePct: 40,
            },
          ],
        },
      },
    ];

    const reordered = sumPreviousStableProgress(prior, 'plot-1', 'First Fix');
    expect(reordered.previousCumulativePct).toBe(40);

    const addedCell = sumPreviousStableProgress(prior, 'plot-3', 'Snagging');
    expect(addedCell.previousCumulativePct).toBe(0);
  });

  it('maps server stable progress back onto current grid indices via patch merge', () => {
    const existing = {
      [buildStableCellId('plot-2', 'First Fix')]: {
        plotId: 'plot-2',
        stageKey: 'First Fix',
        thisCertificatePct: 10,
      },
    };
    const merged = applyPositionalProgressPatch(
      existing,
      { '0::0': { thisCertificatePct: 50 } },
      matrix
    );
    expect(merged.ok).toBe(true);
    expect(merged.progress[buildStableCellId('plot-1', 'First Fix')].thisCertificatePct).toBe(50);
    expect(merged.progress[buildStableCellId('plot-2', 'First Fix')].thisCertificatePct).toBe(10);
  });

  it('drops removed matrix cells from draft progress', () => {
    const existing = {
      [buildStableCellId('plot-9', 'Gone')]: {
        plotId: 'plot-9',
        stageKey: 'Gone',
        thisCertificatePct: 80,
      },
      [buildStableCellId('plot-1', 'First Fix')]: {
        plotId: 'plot-1',
        stageKey: 'First Fix',
        thisCertificatePct: 15,
      },
    };
    const merged = applyPositionalProgressPatch(existing, {}, matrix);
    expect(merged.progress[buildStableCellId('plot-9', 'Gone')]).toBeUndefined();
    expect(merged.progress[buildStableCellId('plot-1', 'First Fix')].thisCertificatePct).toBe(15);
  });

  it('builds locked historical grids from valuationSnapshot, not live matrix order', () => {
    const grid = buildValuationGridFromSnapshot({
      status: 'locked',
      valuationSnapshot: {
        cells: [
          {
            cellId: buildStableCellId('plot-1', 'First Fix'),
            plotId: 'plot-1',
            plotLabel: 'Historic Plot 1',
            stageKey: 'First Fix',
            stageLabel: 'First Fix',
            contractValue: 999,
            thisCertificatePct: 40,
            previousCumulativePct: 0,
            cumulativePct: 40,
            thisCertificateValue: 400,
          },
        ],
      },
    });
    expect(grid.fromValuationSnapshot).toBe(true);
    expect(grid.cells[0].plotLabel).toBe('Historic Plot 1');
    expect(grid.cells[0].contractValue).toBe(999);
    expect(grid.cells[0].thisCertificatePct).toBe(40);
    expect(grid.cells[0].editable).toBe(false);
  });
});
