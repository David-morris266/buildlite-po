import { describe, expect, it } from 'vitest';
import {
  autoDetectSalesRegisterColumns,
  buildSalesRegisterReview,
  sourceSalesStatuses,
} from './salesRegisterImport';

const plots = [
  { id: 'p1', plotNumber: '1', houseType: 'A', revenueStatus: 'Available', sellingPrice: 0 },
  { id: 'p2', plotNumber: '2', houseType: 'B', revenueStatus: 'Available', sellingPrice: 0 },
];

describe('reviewed Sales Register import', () => {
  it('detects supported and unsupported Willow columns', () => {
    const headers = ['Plot', 'House Type', 'Selling Price', 'Extras', 'Incentives', 'Net Revenue', 'Status', 'Forecast Completion'];
    expect(autoDetectSalesRegisterColumns(headers)).toEqual([
      'plotNumber', 'houseTypeEvidence', 'sellingPrice', 'unsupportedExtras',
      'unsupportedIncentives', 'unsupportedNetRevenue', 'salesStatus', 'unsupportedForecastCompletion',
    ]);
  });

  it('matches existing plots and maps controlled status without mutating source plots', () => {
    const rows = [['Plot', 'Status', 'Selling Price'], ['1', 'Completed', '£250,000'], ['2', 'Reserved', '260000']];
    const fields = ['plotNumber', 'salesStatus', 'sellingPrice'];
    const result = buildSalesRegisterReview({
      rows, headerRowIndex: 0, fieldByColumn: fields, plots,
      statusMapping: { Completed: 'Completed', Reserved: 'Reserved' },
    });
    expect(sourceSalesStatuses(rows, 0, fields)).toEqual(['Completed', 'Reserved']);
    expect(result.ready).toBe(true);
    expect(result.changes[0]).toMatchObject({ plotId: 'p1', revenueStatus: 'Completed', sellingPrice: 250000 });
    expect(plots[0]).toMatchObject({ revenueStatus: 'Available', sellingPrice: 0 });
  });

  it('fails closed for unknown, duplicate and unmapped status rows', () => {
    const unknown = buildSalesRegisterReview({ rows: [['Plot', 'Status'], ['99', 'Sold']], headerRowIndex: 0, fieldByColumn: ['plotNumber', 'salesStatus'], plots, statusMapping: {} });
    expect(unknown.ready).toBe(false);
    expect(unknown.errors.join(' ')).toContain('does not exist');
    const duplicate = buildSalesRegisterReview({ rows: [['Plot', 'Status'], ['1', 'Available'], ['1', 'Available']], headerRowIndex: 0, fieldByColumn: ['plotNumber', 'salesStatus'], plots, statusMapping: { Available: 'Available' } });
    expect(duplicate.errors.join(' ')).toContain('more than once');
  });

  it('reports unsupported mapped columns rather than importing them', () => {
    const result = buildSalesRegisterReview({
      rows: [['Plot', 'Status', 'Extras'], ['1', 'Available', '500']], headerRowIndex: 0,
      fieldByColumn: ['plotNumber', 'salesStatus', 'unsupportedExtras'], plots,
      statusMapping: { Available: 'Available' },
    });
    expect(result.unsupportedColumns).toEqual([{ field: 'unsupportedExtras', label: 'Extras — not imported', index: 2 }]);
    expect(result.changes[0]).not.toHaveProperty('extras');
  });
});
