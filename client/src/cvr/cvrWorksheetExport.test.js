import { describe, expect, it } from 'vitest';
import { buildCvrWorksheetWorkbook, HEADER_ROW, MONEY_FORMAT } from './cvrWorksheetExport';

const report = {
  brand: { company: 'Levison Rose Homes Ltd' },
  development: { number: 'DEV-002', name: 'Poplar Road' },
  period: { key: 'P01', label: 'October 2026', status: 'draft', provisional: true },
  generatedAt: '2026-10-28T10:30:00.000Z',
  authority: { financial: 'governed_provisional' },
  worksheet: {
    movementLabel: 'Movement from Site Start',
    rows: [
      { commercialHead: 'Groundworks', costCode: '5001', description: 'Groundworks', siteStartBudget: 64800, actualCost: 72838.50, committed: 0, certified: 0, costToComplete: 0, uncommitted: 0, changeExposure: 0, projectedAdjustment: 0, finalEfc: 72838.50, previousEfc: null, movement: 8038.50, benchmarkVariance: 8038.50 },
      { commercialHead: 'Other', costCode: '5999', description: 'Remaining governed position', siteStartBudget: 650637.88, actualCost: 332731.04, committed: 100000, certified: 75000, costToComplete: 362142.48, uncommitted: 300000, changeExposure: 5000, projectedAdjustment: 1200, finalEfc: 694873.52, previousEfc: null, movement: 44235.64, benchmarkVariance: 44235.64 },
    ],
    totals: { siteStartBudget: 715437.88, actualCost: 405569.54, committed: 100000, certified: 75000, costToComplete: 362142.48, uncommitted: 300000, changeExposure: 5000, projectedAdjustment: 1200, finalEfc: 767712.02, previousEfc: null, movement: 52274.14, benchmarkVariance: 52274.14 },
  },
};

describe('CVR Worksheet Excel export', () => {
  it('creates a professional landscape workbook with exact numeric known-answer totals', async () => {
    const workbook = await buildCvrWorksheetWorkbook(report);
    const sheet = workbook.getWorksheet('CVR Worksheet');
    expect(sheet.pageSetup.orientation).toBe('landscape');
    expect(sheet.pageSetup.paperSize).toBe(8);
    expect(sheet.pageSetup.fitToWidth).toBe(1);
    expect(sheet.pageSetup.fitToHeight).toBe(0);
    expect(sheet.pageSetup.printArea).toBe(`A1:O${sheet.lastRow.number}`);
    expect(sheet.pageSetup.printTitlesRow).toBe(`${HEADER_ROW}:${HEADER_ROW}`);
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: HEADER_ROW, xSplit: 3 });
    expect(sheet.autoFilter.from).toEqual({ row: HEADER_ROW, column: 1 });
    expect(sheet.getRow(HEADER_ROW).values).toContain('Movement from Site Start');
    const totalRow = sheet.lastRow;
    expect(totalRow.getCell(5).value).toBe(405569.54);
    expect(totalRow.getCell(12).value).toBe(767712.02);
    expect(totalRow.getCell(12).numFmt).toBe(MONEY_FORMAT);
    expect(sheet.getCell('B4').value).toContain('PROVISIONAL');
    expect(sheet.headerFooter.oddHeader).toContain('DRAFT — PROVISIONAL');
    const bytes = await workbook.xlsx.writeBuffer();
    expect(bytes.byteLength).toBeGreaterThan(5000);
  });

  it('labels immutable Locked evidence distinctly', async () => {
    const workbook = await buildCvrWorksheetWorkbook({ ...report, period: { ...report.period, status: 'locked', provisional: false }, authority: { financial: 'immutable_snapshot' } });
    const sheet = workbook.getWorksheet('CVR Worksheet');
    expect(sheet.getCell('B4').value).toBe('LOCKED — APPROVED EVIDENCE');
    expect(sheet.getCell('B5').value).toBe('Immutable locked snapshot');
    expect(sheet.headerFooter.oddHeader).toContain('LOCKED — APPROVED EVIDENCE');
  });

  it('prints Submitted evidence with a repeating provisional authority label', async () => {
    const workbook = await buildCvrWorksheetWorkbook({ ...report, period: { ...report.period, status: 'submitted', provisional: true } });
    expect(workbook.getWorksheet('CVR Worksheet').headerFooter.oddHeader).toContain('SUBMITTED — PROVISIONAL');
  });
});
