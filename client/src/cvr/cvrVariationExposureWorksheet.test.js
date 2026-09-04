import { describe, expect, it, vi } from 'vitest';
import { calculateFinalForecast, enrichCvrForecastRow } from './cvrForecastEngine';
import { buildCvrTotals } from './cvrCalculations';
import { buildCvrRows } from './cvrEngine';
import { normalizeServerCvrPeriod } from './cvrPeriodServerMapper';

const storage = new Map();
vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

describe('CVR Variation exposure worksheet arithmetic', () => {
  it('keeps Submitted CE, VA uplift and adjustment separate in Final Forecast', () => {
    const row = enrichCvrForecastRow({ committed: 12000, actualCost: 0, currentBudget: 20000, expectedLiability: 500, vaExposureUplift: 5000, commercialAdjustment: 250 });
    expect(row.systemForecast).toBe(12000);
    expect(row.expectedLiability).toBe(500);
    expect(row.vaExposureUplift).toBe(5000);
    expect(row.commercialAdjustment).toBe(250);
    expect(row.finalForecast).toBe(17750);
    expect(buildCvrTotals([row]).vaExposureUplift).toBe(5000);
  });

  it('does exact-pence and signed credit arithmetic', () => {
    expect(calculateFinalForecast(-12.34, -0.01, 0, -0.02)).toBe(-12.37);
  });

  it('carries the real live period response through mapping into the worksheet and drawer row', () => {
    const exposureItem = {
      variationAccountItemId: '2bc8d236-5339-4b2a-b6e5-8895eba02263',
      reference: 'VA-0001',
      costCode: '4330',
      qsForecast: 17000,
      effectiveRecognisedAuthority: 12000,
      cumulativeLockedCertification: 8000,
      authorityAlreadyInCurrentContract: 12000,
      effectiveVaExposure: 17000,
      vaExposureUplift: 5000,
      remainingForecastExposure: 5000,
    };
    const period = normalizeServerCvrPeriod({
      id: '11111111-2222-4333-8444-555555555555',
      developmentId: 'dev-va-5c',
      periodKey: 'P01',
      status: 'draft',
      version: 1,
      variationExposure: {
        state: 'live',
        captured: false,
        document: { calculationVersion: 'va_expected_exposure_v1', items: [exposureItem] },
      },
    });
    const rows = buildCvrRows('dev-va-5c', {
      periodKey: 'P01',
      period,
      pos: [{
        type: 'S',
        status: 'approved',
        approval: { status: 'approved' },
        developmentId: 'dev-va-5c',
        supplierId: 'supplier-va-5c',
        costRef: { developmentId: 'dev-va-5c', costCode: '4330 — Mastic & Sealing' },
        totals: { net: 13000 },
        subtotal: 13000,
      }],
    });
    const row = rows.find((entry) => entry.costCodeKey === '4330');

    expect(row).toMatchObject({
      committed: 13000,
      systemForecast: 13000,
      vaExposureUplift: 5000,
      finalForecast: 18000,
      variationExposureItems: [exposureItem],
    });
  });
});
