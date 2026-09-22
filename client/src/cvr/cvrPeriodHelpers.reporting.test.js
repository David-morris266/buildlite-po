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
});
