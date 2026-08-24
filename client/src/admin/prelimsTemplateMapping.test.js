/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import {
  classifyTemplateMapping,
  filterCostCodeSearchOptions,
  filterMappingOptions,
  mappingOptionLabel,
  mappingOptionPrimaryLabel,
  mappingOptionSecondaryLabel,
  sharedCostCodeCounts,
} from './prelimsTemplateMapping';

describe('prelims template mapping helpers', () => {
  it('treats PRELIMS as normal and other groups as warnings', () => {
    expect(classifyTemplateMapping('5231', 'PRELIMS')).toEqual({ tone: 'normal', message: null });
    expect(classifyTemplateMapping('1110', 'UNCLASSIFIED').message).toBe(
      'Mapped code 1110 is currently classified UNCLASSIFIED rather than PRELIMS.'
    );
    expect(classifyTemplateMapping('5206', 'BUILD').message).toBe(
      'Mapped code 5206 is currently classified BUILD rather than PRELIMS.'
    );
    expect(classifyTemplateMapping('', 'PRELIMS').tone).toBe('unmapped');
  });

  it('counts shared canonical codes without treating duplicates as errors', () => {
    expect(
      sharedCostCodeCounts([
        { costCodeKey: '5231' },
        { costCodeKey: '5231' },
        { costCodeKey: '2300' },
        { costCodeKey: null },
      ])
    ).toEqual({ 5231: 2, 2300: 1 });
  });

  it('builds display labels without using them as option identity', () => {
    expect(
      mappingOptionLabel({
        code: '5231',
        description: 'Cleaning',
        reportingGroup: 'Plot & Housebuild Costs - 52',
      })
    ).toBe('5231 — Cleaning (Plot & Housebuild Costs - 52)');
    expect(
      filterMappingOptions(
        [
          { code: '5231', description: 'Cleaning', reportingGroup: 'Prelims' },
          { code: 'P100-SM', description: 'Site manager', reportingGroup: 'Prelims' },
        ],
        'p100'
      ).map((row) => row.code)
    ).toEqual(['P100-SM']);
  });

  it('searches setup codes by code/description first and does not flood on reporting group', () => {
    const options = [
      {
        code: '5210',
        description: 'Site management',
        reportingGroup: 'Prelim & Supervision Costs - 53',
      },
      {
        code: '5305',
        description: 'Supervision / Management',
        reportingGroup: 'Prelim & Supervision Costs - 53',
      },
      {
        code: '1110',
        description: 'VAT on Land Purchase',
        reportingGroup: 'Land Costs - 11',
      },
    ];
    expect(filterCostCodeSearchOptions(options, '5305').map((row) => row.code)).toEqual(['5305']);
    expect(filterCostCodeSearchOptions(options, 'supervision').map((row) => row.code)).toEqual([
      '5305',
    ]);
    expect(filterCostCodeSearchOptions(options, 'SUPERVISION').map((row) => row.code)).toEqual([
      '5305',
    ]);
    expect(
      filterCostCodeSearchOptions(options, 'Prelim & Supervision').map((row) => row.code)
    ).toEqual(['5210', '5305']);
    expect(mappingOptionPrimaryLabel(options[1])).toBe('5305 — Supervision / Management');
    expect(mappingOptionSecondaryLabel(options[1])).toBe('Prelim & Supervision Costs - 53');
  });
});
