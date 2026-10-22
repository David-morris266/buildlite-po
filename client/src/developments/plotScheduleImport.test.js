import { describe, expect, it } from 'vitest';
import {
  autoDetectPlotColumnMapping,
  buildExistingPlotUpdatePreview,
  getSpreadsheetReadError,
  validateAndBuildPlotImport,
} from './plotScheduleImport';

function plots(count = 75) {
  return Array.from({ length: count }, (_, index) => ({
    id: `stable-${index + 1}`,
    plotNumber: String(index + 1),
    houseType: index === 0 ? 'Wrong Type' : `Type ${index % 5}`,
    configuration: 'Detached',
    bedrooms: 3,
    gia: index === 0 ? 999 : 850 + index,
    tenure: 'Open Market',
    tenureCode: 'OPEN_MARKET',
    sellingPrice: 325000,
    revenueStatus: 'Exchanged',
    revenueSource: 'Manual Value',
    manualForecastValue: 300000,
    plotPremium: 5000,
    reservedAt: '2026-01-01',
    exchangedAt: '2026-02-01',
  }));
}

describe('safe existing Plot Master update preview', () => {
  it('recognises Ft2 as GIA evidence', () => {
    expect(autoDetectPlotColumnMapping(['Plot', 'Type', 'Ft2'])).toMatchObject({
      plotNumber: 0,
      houseType: 1,
      gia: 2,
    });
  });

  it('matches a realistic 75-of-75 schedule and emits only structural changes', () => {
    const existing = plots();
    const rows = [
      ['Plot', 'Type', 'Config', 'Beds', 'Ft2', 'Phase', 'Tenure'],
      ...existing.map((plot) => [
        plot.plotNumber,
        plot.plotNumber === '1' ? 'Correct Type' : plot.houseType,
        plot.configuration,
        String(plot.bedrooms),
        String(plot.plotNumber === '1' ? 1172 : plot.gia),
        '',
        'Changed but not authorised',
      ]),
    ];
    const parsed = validateAndBuildPlotImport(
      rows,
      0,
      ['plotNumber', 'houseType', 'configuration', 'bedrooms', 'gia', 'phase', 'tenure']
    );
    expect(parsed).toMatchObject({ ready: true, detectedCount: 75, validCount: 75 });
    const preview = buildExistingPlotUpdatePreview({
      existingPlots: existing,
      importedPlots: parsed.plots,
      mappedFields: ['plotNumber', 'houseType', 'configuration', 'bedrooms', 'gia', 'tenure'],
    });

    expect(preview).toMatchObject({
      ready: true,
      existingCount: 75,
      importedCount: 75,
      matchedCount: 75,
      changedCount: 1,
      unchangedCount: 74,
    });
    expect(preview.updates).toEqual([{
      id: 'stable-1', houseType: 'Correct Type', gia: 1172,
    }]);
    expect(preview.selectedFields).not.toContain('tenure');
    expect(preview.areaImplications).toEqual([expect.objectContaining({
      plotNumber: '1', state: 'gia_fallback',
    })]);
  });

  it('preserves independently entered NIA while disclosing the GIA Revenue implication', () => {
    const existing = [{ ...plots(1)[0], gia: 999, niaFt2: 950, niaM2: 88.26 }];
    const preview = buildExistingPlotUpdatePreview({
      existingPlots: existing,
      importedPlots: [{ ...existing[0], gia: 1172 }],
      mappedFields: ['plotNumber', 'gia'],
    });

    expect(preview.ready).toBe(true);
    expect(preview.updates).toEqual([{ id: 'stable-1', gia: 1172 }]);
    expect(preview.changes[0].fields.map(({ field }) => field)).toEqual(['gia']);
    expect(preview.areaImplications).toEqual([expect.objectContaining({
      state: 'explicit_nia_preserved',
    })]);
  });

  it('updates likely compatibility-derived NIA and shows every derived area change', () => {
    const existing = [{ ...plots(1)[0], gia: 999, niaFt2: 999, niaM2: 92.81 }];
    const preview = buildExistingPlotUpdatePreview({
      existingPlots: existing,
      importedPlots: [{ ...existing[0], gia: 1172 }],
      mappedFields: ['plotNumber', 'gia'],
    });

    expect(preview.updates).toEqual([{
      id: 'stable-1', gia: 1172, niaFt2: 1172, niaM2: 108.88,
    }]);
    expect(preview.changes[0].fields).toEqual([
      { field: 'gia', before: 999, after: 1172 },
      { field: 'niaFt2', before: 999, after: 1172, derivedCompatibility: true },
      { field: 'niaM2', before: 92.81, after: 108.88, derivedCompatibility: true },
    ]);
    expect(preview.areaImplications[0].state).toBe('derived_nia_updated');
  });

  it('preserves and discloses independently entered NIA m² that does not reconcile', () => {
    const existing = [{ ...plots(1)[0], gia: 999, niaFt2: 999, niaM2: 90 }];
    const preview = buildExistingPlotUpdatePreview({
      existingPlots: existing,
      importedPlots: [{ ...existing[0], gia: 1172 }],
      mappedFields: ['plotNumber', 'gia'],
    });

    expect(preview.updates).toEqual([{ id: 'stable-1', gia: 1172, niaFt2: 1172 }]);
    expect(preview.changes[0].fields.map(({ field }) => field)).toEqual(['gia', 'niaFt2']);
    expect(preview.areaImplications).toEqual([expect.objectContaining({
      state: 'derived_nia_ft2_m2_mismatch',
      message: expect.stringContaining('does not reconcile'),
    })]);
  });

  it.each(['gia', 'bedrooms', 'phase'])(
    'blocks a blank mapped %s cell from clearing existing evidence',
    (field) => {
      const existing = [{ ...plots(1)[0], phase: 'Phase 1' }];
      const preview = buildExistingPlotUpdatePreview({
        existingPlots: existing,
        importedPlots: [{ ...existing[0], [field]: field === 'bedrooms' || field === 'gia' ? null : '' }],
        mappedFields: ['plotNumber', field],
      });
      expect(preview.ready).toBe(false);
      expect(preview.blankStructuralValues).toEqual([{ plotNumber: '1', field }]);
    }
  );

  it('requires explicit tenure authority and returns changed tenure to review', () => {
    const existing = plots(1);
    const imported = [{ ...existing[0], tenure: 'Affordable Rent', tenureSuggestion: 'AFFORDABLE_RENT' }];
    const preview = buildExistingPlotUpdatePreview({
      existingPlots: existing,
      importedPlots: imported,
      mappedFields: ['plotNumber', 'houseType', 'tenure'],
      allowTenureChange: true,
    });
    expect(preview.updates[0]).toMatchObject({
      id: 'stable-1',
      tenure: 'Affordable Rent',
      tenureCode: 'UNREVIEWED',
      tenureSuggestion: 'AFFORDABLE_RENT',
    });
  });

  it.each([
    ['unmatched import', plots(2), [{ plotNumber: '1', houseType: 'A' }, { plotNumber: '3', houseType: 'B' }]],
    ['missing import', plots(2), [{ plotNumber: '1', houseType: 'A' }]],
    ['duplicate import', plots(2), [{ plotNumber: '1', houseType: 'A' }, { plotNumber: '1', houseType: 'B' }]],
  ])('blocks %s without producing a partial update', (_label, existingPlots, importedPlots) => {
    const preview = buildExistingPlotUpdatePreview({
      existingPlots,
      importedPlots,
      mappedFields: ['plotNumber', 'houseType'],
    });
    expect(preview.ready).toBe(false);
    expect(preview.errors.length).toBeGreaterThan(0);
  });

  it('reports invalid mapped numeric evidence', () => {
    const result = validateAndBuildPlotImport(
      [['Plot', 'Type', 'Ft2'], ['1', 'Ash', 'not-an-area']],
      0,
      ['plotNumber', 'houseType', 'gia']
    );
    expect(result.ready).toBe(false);
    expect(result.rowErrors[0].issues).toContain('Invalid GIA');
  });

  it.each([
    ['1076 ft2', 'Invalid GIA'],
    ['100 m2', 'Invalid GIA'],
    ['-1', 'Invalid GIA'],
    ['0', 'Invalid GIA'],
    ['Infinity', 'Invalid GIA'],
    ['NaN', 'Invalid GIA'],
  ])('rejects ambiguous or invalid GIA %s', (value, issue) => {
    const result = validateAndBuildPlotImport(
      [['Plot', 'Type', 'Ft2'], ['1', 'Ash', value]],
      0,
      ['plotNumber', 'houseType', 'gia']
    );
    expect(result.ready).toBe(false);
    expect(result.rowErrors[0].issues).toContain(issue);
  });

  it.each(['2.5', '3-4'])('rejects malformed bedroom value %s', (value) => {
    const result = validateAndBuildPlotImport(
      [['Plot', 'Type', 'Beds'], ['1', 'Ash', value]],
      0,
      ['plotNumber', 'houseType', 'bedrooms']
    );
    expect(result.ready).toBe(false);
    expect(result.rowErrors[0].issues).toContain('Invalid Bedrooms');
  });

  it('preserves legitimate Excel numeric cells', () => {
    const result = validateAndBuildPlotImport(
      [['Plot', 'Type', 'Beds', 'Ft2'], [1, 'Ash', 3, 1076.4]],
      0,
      ['plotNumber', 'houseType', 'bedrooms', 'gia']
    );
    expect(result).toMatchObject({ ready: true, validCount: 1 });
    expect(result.plots[0]).toMatchObject({ bedrooms: 3, gia: 1076.4 });
  });

  it('returns safe diagnostic categories without workbook content', () => {
    expect(getSpreadsheetReadError(new Error('File is encrypted with a password'))).toContain('password-protected');
    expect(getSpreadsheetReadError(new TypeError('Failed to fetch dynamically imported module'))).toContain('reader could not load');
    expect(getSpreadsheetReadError(new Error('customer secret row'))).not.toContain('customer secret row');
  });
});
