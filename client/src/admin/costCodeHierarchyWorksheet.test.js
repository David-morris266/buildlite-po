import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { buildHierarchyWorksheet, HIERARCHY_WORKSHEET_HEADER_ROW, parseHierarchyWorksheet } from './costCodeHierarchyWorksheet';

function fileOf(bytes, name = 'mapping.xlsx') {
  return { name, arrayBuffer: async () => bytes };
}

function setByHeader(sheet, dataRow, header, value) {
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  const headers = grid[HIERARCHY_WORKSHEET_HEADER_ROW - 1];
  const column = headers.indexOf(header);
  const address = XLSX.utils.encode_cell({ r: dataRow - 1, c: column });
  sheet[address] = { t: 's', v: value };
}

describe('Cost Code hierarchy mapping workbook', () => {
  it('exports a professional owner worksheet while hidden identity and evidence round-trip exactly', async () => {
    const bytes = await buildHierarchyWorksheet({ rows: [
      { id: '11111111-1111-4111-8111-111111111111', code: '0010', description: 'Compound  - Groundworks', version: 7, currentReviewState: 'not_reviewed', sourceEvidence: { legacy: { subHeading: 'Land', trade: 'Acquisition', element: 'Compound  - Groundworks' } } },
      { id: '22222222-2222-4222-8222-222222222222', code: 'ALPHA-1', description: 'Alpha', version: 2, currentReviewState: 'allocated', currentCommercialHead: 'House Build', currentCommercialFamily: '', currentReportingGroup: 'Brickwork' },
    ] });
    const styled = new ExcelJS.Workbook(); await styled.xlsx.load(bytes);
    const mapping = styled.getWorksheet('Hierarchy Mapping');
    expect(styled.getWorksheet('Instructions')).toBeTruthy();
    expect(mapping.getCell('A1').value).toContain('BuildLite');
    expect(mapping.views[0]).toMatchObject({ state: 'frozen', xSplit: 2, ySplit: HIERARCHY_WORKSHEET_HEADER_ROW });
    expect(mapping.autoFilter).toBeTruthy();
    expect(mapping.getColumn(11).hidden).toBe(true);
    expect(mapping.getColumn(12).hidden).toBe(true);
    expect(mapping.getColumn(13).hidden).toBe(true);
    expect(mapping.getCell('G8').fill.fgColor.argb).toBe('FFF0FDF4');
    expect(mapping.getCell('A8').fill.fgColor.argb).toBe('FFF8FAFC');
    expect(mapping.getCell('J8').dataValidation.formulae[0]).toContain('Not Applicable');
    expect(mapping.getCell('C8').value).toBe('Land');
    expect(mapping.getCell('D8').value).toBe('Acquisition');
    expect(mapping.getCell('E8').value).toBe('Compound  - Groundworks');
    expect(mapping.getCell('F8').value).toBe('Not reviewed');
    expect(String(mapping.getCell('M8').value)).toContain('"legacy"');

    const parsed = await parseHierarchyWorksheet(fileOf(bytes));
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ id: '11111111-1111-4111-8111-111111111111', code: '0010', description: 'Compound  - Groundworks', version: 7, commercialHead: '', reportingGroup: '', reviewDecision: '' });
    expect(parsed[0].sourceEvidence.legacy.trade).toBe('Acquisition');
    expect(parsed[1]).toMatchObject({ code: 'ALPHA-1', commercialHead: 'House Build', reportingGroup: 'Brickwork', reviewDecision: 'Keep Existing' });
  });

  it('sorts Cost Codes deterministically without changing string identity', async () => {
    const bytes = await buildHierarchyWorksheet({ rows: [
      { id: '33333333-3333-4333-8333-333333333333', code: 'A10', description: 'A10', version: 1, currentReviewState: 'not_reviewed' },
      { id: '22222222-2222-4222-8222-222222222222', code: '10', description: 'Ten', version: 1, currentReviewState: 'not_reviewed' },
      { id: '11111111-1111-4111-8111-111111111111', code: '0010', description: 'Leading zero', version: 1, currentReviewState: 'not_reviewed' },
      { id: '44444444-4444-4444-8444-444444444444', code: '2', description: 'Two', version: 1, currentReviewState: 'not_reviewed' },
    ] });
    expect((await parseHierarchyWorksheet(fileOf(bytes))).map((row) => row.code)).toEqual(['2', '0010', '10', 'A10']);
  });

  it('round-trips two/three-level targets in owner-facing column order and explicit Not Applicable', async () => {
    const bytes = await buildHierarchyWorksheet({ rows: [
      { id: '11111111-1111-4111-8111-111111111111', code: 'A', description: 'A', version: 1, currentReviewState: 'not_reviewed' },
      { id: '22222222-2222-4222-8222-222222222222', code: 'B', description: 'B', version: 1, currentReviewState: 'not_reviewed' },
      { id: '33333333-3333-4333-8333-333333333333', code: 'C', description: 'C', version: 1, currentReviewState: 'not_reviewed' },
    ] });
    const workbook = XLSX.read(bytes, { type: 'array' }); const sheet = workbook.Sheets['Hierarchy Mapping'];
    setByHeader(sheet, 8, 'Commercial Head', 'House Build'); setByHeader(sheet, 8, 'Reporting Group', 'Brickwork');
    setByHeader(sheet, 9, 'Commercial Head', 'External Works'); setByHeader(sheet, 9, 'Reporting Group', 'Roads'); setByHeader(sheet, 9, 'Commercial Family (optional)', 'Infrastructure');
    setByHeader(sheet, 10, 'Review Decision', 'Not Applicable');
    const parsed = await parseHierarchyWorksheet(fileOf(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })));
    expect(parsed[0]).toMatchObject({ commercialHead: 'House Build', commercialFamily: '', reportingGroup: 'Brickwork' });
    expect(parsed[1]).toMatchObject({ commercialHead: 'External Works', commercialFamily: 'Infrastructure', reportingGroup: 'Roads' });
    expect(parsed[2].reviewDecision).toBe('Not Applicable');
  });

  it('keeps a realistic 300-row worksheet complete and parseable', async () => {
    const rows = Array.from({ length: 300 }, (_, index) => ({
      id: `${String(index + 1).padStart(8, '0')}-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
      code: index === 0 ? '0001' : `CC-${String(index + 1).padStart(3, '0')}`,
      description: `Cost Code ${index + 1}`,
      version: 1,
      currentReviewState: 'not_reviewed',
      sourceEvidence: { legacy: { subHeading: `Section ${index % 8}`, trade: `Trade ${index % 25}` } },
    }));
    const parsed = await parseHierarchyWorksheet(fileOf(await buildHierarchyWorksheet({ rows })));
    expect(parsed).toHaveLength(300);
    expect(parsed[0]).toMatchObject({ code: '0001', description: 'Cost Code 1' });
    expect(new Set(parsed.map((row) => row.id)).size).toBe(300);
  });

  it('rejects malformed worksheet contracts', async () => {
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Cost Code']]), 'Hierarchy Mapping');
    await expect(parseHierarchyWorksheet(fileOf(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })))).rejects.toThrow('missing required columns');
  });
});
