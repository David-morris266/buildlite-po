/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import {
  applyPayloadFromDrafts,
  computeOverlap,
  draftAfterDriverChange,
  draftsFromPreview,
  durationLabel,
  effectiveDriver,
  isLineReady,
  livePreviewCalculation,
  readyStateLabel,
  setupStateChips,
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

  it('builds apply payload with development-owned TIME offsets', () => {
    const next = preview();
    const drafts = draftsFromPreview(next);
    drafts[0].monthlyRate = '5500';
    drafts[0].startOffsetMonths = 3;
    drafts[0].endOffsetMonths = 0;
    const payload = applyPayloadFromDrafts(next, drafts);
    const sm = payload.lines.find((row) => row.templateLineId === 'sm');
    expect(sm.startOffsetMonths).toBe(3);
    expect(sm.startBasis).toBe('SITE_START');
    expect(sm.endBasis).toBe('FINAL_COMPLETION');
    const live = livePreviewCalculation(next.lines[0], drafts[0], PROGRAMME, '2026-08');
    expect(live.span.totalMonths).toBe(35);
    expect(live.calc.totalForecast).toBe(192500);
  });

  it('allows development driver override TIME↔LUMP_SUM without changing template line driver', () => {
    const next = preview();
    const drafts = draftsFromPreview(next);
    expect(effectiveDriver(next.lines[0], drafts[0])).toBe('TIME');

    const asLump = draftAfterDriverChange(drafts[0], 'LUMP_SUM', next.lines[0]);
    expect(asLump.forecastDriver).toBe('LUMP_SUM');
    expect(asLump.monthlyRate).toBe('');
    asLump.selected = true;
    asLump.costCodeKey = '5210';
    asLump.lumpSumAmount = '75000';
    expect(isLineReady(next.lines[0], asLump, PROGRAMME)).toBe(true);
    const liveLump = livePreviewCalculation(next.lines[0], asLump, PROGRAMME, '2026-08');
    expect(liveLump.calc.totalForecast).toBe(75000);
    expect(durationLabel(next.lines[0], liveLump.span, asLump)).toBe('—');

    const asTime = draftAfterDriverChange(drafts[2], 'TIME', next.lines[2]);
    expect(asTime.forecastDriver).toBe('TIME');
    expect(asTime.lumpSumAmount).toBe('');
    expect(asTime.startBasis).toBe('SITE_START');
    expect(asTime.endBasis).toBe('FINAL_COMPLETION');
    asTime.selected = true;
    asTime.costCodeKey = 'UAT-CC-001';
    asTime.monthlyRate = '1000';
    expect(isLineReady(next.lines[2], asTime, PROGRAMME)).toBe(true);

    drafts[0] = asLump;
    drafts[2] = asTime;
    const payload = applyPayloadFromDrafts(next, drafts);
    expect(payload.lines.find((row) => row.templateLineId === 'sm')).toMatchObject({
      forecastDriver: 'LUMP_SUM',
      lumpSumAmount: 75000,
      monthlyRate: null,
      startBasis: null,
    });
    expect(payload.lines.find((row) => row.templateLineId === 'custom')).toMatchObject({
      forecastDriver: 'TIME',
      monthlyRate: 1000,
      lumpSumAmount: null,
      startBasis: 'SITE_START',
    });
    expect(next.lines[0].forecastDriver).toBe('TIME');
    expect(next.lines[2].forecastDriver).toBe('LUMP_SUM');
  });

  it('keeps classification/overlap semantics while compacting state chip labels', () => {
    const chips = setupStateChips({
      classification: {
        tone: 'warning',
        message: 'Mapped code 1110 is currently classified UNCLASSIFIED rather than PRELIMS.',
      },
      overlapInfo: {
        overlap: true,
        existingNames: ['A', 'B', 'C'],
        siblingNames: [],
      },
    });
    expect(chips.map((row) => row.text)).toEqual([
      'UNCLASSIFIED',
      'Expected PRELIMS',
      'Overlap · 3 existing lines',
    ]);
    expect(
      setupStateChips({
        classification: { tone: 'normal', message: null },
        overlapInfo: { overlap: false, existingNames: [], siblingNames: [] },
      }).map((row) => row.text)
    ).toEqual(['PRELIMS']);
  });
});
