/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { buildCvrPeriodHeaderMeta } from './cvrPeriodHelpers';

describe('CVR Reporting Period header presentation', () => {
  it('shows a human-readable Reporting Period separately from Created', () => {
    const items = buildCvrPeriodHeaderMeta({
      periodKey: 'P04',
      reportingMonth: '2027-02-01',
      createdAt: '2026-09-17T10:00:00.000Z',
    });
    expect(items).toContainEqual({ label: 'Reporting Period', value: 'February 2027' });
    expect(items.find((item) => item.label === 'Created')?.value).not.toBe('February 2027');
  });

  it('does not infer a missing historic Reporting Period', () => {
    const items = buildCvrPeriodHeaderMeta({ periodKey: 'P01', reportingMonth: null });
    expect(items).toContainEqual({ label: 'Reporting Period', value: '—' });
  });

  it('presents Site Start with its distinct Forecast as at authority', () => {
    expect(buildCvrPeriodHeaderMeta({
      periodKey: 'SITE_START',
      periodType: 'site_start',
      reportingMonth: null,
      forecastAsAtMonth: '2027-04-01',
    })).toEqual(expect.arrayContaining([
      { label: 'Forecast as at', value: 'April 2027' },
      { label: 'Period', value: 'Site Start' },
    ]));
  });
});
