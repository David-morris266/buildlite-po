/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import {
  applyPayloadFromDrafts,
  computeOverlap,
  draftsFromPreview,
  durationLabel,
  isLineReady,
  livePreviewCalculation,
  readyStateLabel,
} from './prelimsSetupWorksheet';

const PROGRAMME = {
  exists: true,
  siteStart: '2026-09-01',
  firstCompletion: null,
  finalCompletion: '2029-10-01',
};

function preview(overrides = {}) {
  const siteManager = {
    templateLineId: 'sm',
    templateKey: 'bl.prelims.v1.site_manager',
    name: 'Site Manager',
    guidance: 'Full-time site management',
    forecastDriver: 'TIME',
    startBasis: 'SITE_START',
    endBasis: 'FINAL_COMPLETION',
    costCodeKey: '5210',
    enabled: true,
    alreadyApplied: false,
    selectable: true,
    defaultSelected: true,
    overlap: false,
    ...overrides.siteManager,
  };
  const cleaning = {
    templateLineId: 'clean',
    templateKey: 'bl.prelims.v1.cleaning_ongoing',
    name: 'Ongoing Site Cleaning',
    forecastDriver: 'TIME',
    startBasis: 'SITE_START',
    endBasis: 'FINAL_COMPLETION',
    costCodeKey: '5231',
    enabled: true,
    alreadyApplied: false,
    selectable: true,
    defaultSelected: false,
    overlap: true,
    ...overrides.cleaning,
  };
  const custom = {
    templateLineId: 'custom',
    templateKey: 'co.prelims.abc',
    name: 'Custom UAT',
    forecastDriver: 'LUMP_SUM',
    costCodeKey: null,
    enabled: true,
    alreadyApplied: false,
    selectable: true,
    defaultSelected: false,
    overlap: false,
    ...overrides.custom,
  };
  const disabled = {
    templateLineId: 'disabled',
    templateKey: 'bl.prelims.v1.disabled',
    name: 'Disabled line',
    forecastDriver: 'LUMP_SUM',
    costCodeKey: '5210',
    enabled: false,
    alreadyApplied: false,
    selectable: false,
    defaultSelected: false,
    ...overrides.disabled,
  };
  return {
    template: { id: 'tmpl', version: 1, name: 'BuildLite Standard Prelims' },
    programme: PROGRAMME,
    reportingMonth: '2026-08',
    existingItems: [
      { id: 'd1', name: 'BL-033D.1 TIME UAT', costCodeKey: '5231' },
    ],
    lines: [siteManager, cleaning, custom, disabled],
    ...overrides.preview,
  };
}

describe('Prelims setup worksheet helpers', () => {
  it('defaults overlap lines unticked and unmapped/disabled not ready', () => {
    const next = preview();
    const drafts = draftsFromPreview(next);
    expect(drafts.find((row) => row.templateLineId === 'sm').selected).toBe(true);
    expect(drafts.find((row) => row.templateLineId === 'clean').selected).toBe(false);
    expect(drafts.find((row) => row.templateLineId === 'custom').selected).toBe(false);
    expect(isLineReady(next.lines[2], drafts[2])).toBe(false);
    expect(isLineReady(next.lines[3], { ...drafts[3], selected: true, lumpSumAmount: '10' })).toBe(
      false
    );
    expect(readyStateLabel(next.lines[3], drafts[3], false)).toMatch(/Disabled/);
  });

  it('shows TIME duration without a rate and live forecast once £/month is entered', () => {
    const next = preview();
    const empty = livePreviewCalculation(
      next.lines[0],
      { monthlyRate: '', selected: true, costCodeKey: '5210' },
      PROGRAMME,
      '2026-08'
    );
    expect(empty.span.totalMonths).toBe(38);
    expect(durationLabel(next.lines[0], empty.span)).toBe('38 months');
    expect(empty.calc.reason).toBe('INVALID_RATE');

    const priced = livePreviewCalculation(
      next.lines[0],
      { monthlyRate: '5500', selected: true, costCodeKey: '5210' },
      PROGRAMME,
      '2026-08'
    );
    expect(priced.calc.totalMonths).toBe(38);
    expect(priced.calc.totalForecast).toBe(209000);
  });

  it('shows LUMP_SUM forecast from the entered amount', () => {
    const next = preview();
    const live = livePreviewCalculation(
      next.lines[2],
      { lumpSumAmount: '250', selected: true, costCodeKey: 'UAT-CC-001' },
      PROGRAMME,
      '2026-08'
    );
    expect(durationLabel(next.lines[2], live.span)).toBe('—');
    expect(live.calc.totalForecast).toBe(250);
  });

  it('treats same cost code as overlap, not duplicate identity, and still allows create', () => {
    const next = preview();
    const drafts = draftsFromPreview(next);
    drafts[1].selected = true;
    drafts[1].monthlyRate = '100';
    const overlap = computeOverlap(next.lines[1], drafts[1], next, drafts);
    expect(overlap.overlap).toBe(true);
    expect(overlap.existingNames).toContain('BL-033D.1 TIME UAT');
    expect(isLineReady(next.lines[1], drafts[1])).toBe(true);
    expect(readyStateLabel(next.lines[1], drafts[1], true)).toMatch(/overlap/i);
  });

  it('builds apply payload only from selected ready lines', () => {
    const next = preview();
    const drafts = draftsFromPreview(next);
    drafts[0].monthlyRate = '5500';
    drafts[2].selected = true;
    drafts[2].costCodeKey = 'UAT-CC-001';
    drafts[2].lumpSumAmount = '250';
    const payload = applyPayloadFromDrafts(next, drafts);
    expect(payload.templateId).toBe('tmpl');
    expect(payload.lines.map((row) => row.templateLineId).sort()).toEqual(['custom', 'sm']);
    expect(payload.lines.find((row) => row.templateLineId === 'sm').monthlyRate).toBe(5500);
    expect(payload.lines.find((row) => row.templateLineId === 'custom').lumpSumAmount).toBe(250);
  });
});
