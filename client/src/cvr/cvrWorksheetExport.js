const MONEY_FORMAT = '£#,##0.00;[Red]-£#,##0.00;£0.00';
const HEADER_ROW = 7;

async function exceljs() {
  const module = await import('exceljs');
  return module.default || module;
}

function safeName(value) {
  return String(value || 'CVR').trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'CVR';
}

function money(value) {
  return value == null || !Number.isFinite(Number(value)) ? null : Number(value);
}

function authorityLabel(report) {
  if (!report.period?.provisional) return 'LOCKED — APPROVED EVIDENCE';
  const status = String(report.period?.status || 'Draft').toUpperCase();
  return `${status} — PROVISIONAL`;
}

function setMetadata(sheet, report) {
  sheet.mergeCells('A1:O1');
  sheet.getCell('A1').value = `${report.brand?.company || 'BuildLite'} — Full CVR Worksheet`;
  sheet.getCell('A1').font = { size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17372B' } };
  sheet.getCell('A1').alignment = { vertical: 'middle' };
  sheet.getRow(1).height = 28;

  const status = authorityLabel(report);
  const values = [
    ['Development', `${report.development?.number || '—'} — ${report.development?.name || '—'}`, 'Reporting period', report.period?.label || report.period?.key || '—'],
    ['CVR status', status, 'Generated', report.generatedAt ? new Date(report.generatedAt) : null],
    ['Financial authority', report.authority?.financial === 'immutable_snapshot' ? 'Immutable locked snapshot' : 'Governed provisional close evidence', 'Movement basis', report.worksheet?.movementLabel || 'Unavailable'],
  ];
  values.forEach((row, index) => {
    const excelRow = sheet.getRow(index + 3);
    excelRow.values = row;
    excelRow.getCell(1).font = { bold: true, color: { argb: 'FF17372B' } };
    excelRow.getCell(3).font = { bold: true, color: { argb: 'FF17372B' } };
    if (index === 1 && row[3] instanceof Date) excelRow.getCell(4).numFmt = 'dd mmm yyyy hh:mm';
  });
}

export async function buildCvrWorksheetWorkbook(report) {
  if (!report?.worksheet?.rows || !Array.isArray(report.worksheet.rows)) throw new Error('Authoritative CVR Worksheet evidence is unavailable.');
  const ExcelJS = await exceljs();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BuildLite';
  workbook.company = report.brand?.company || 'BuildLite';
  workbook.title = `${report.development?.number || ''} ${report.period?.key || ''} CVR Worksheet`.trim();
  workbook.created = report.generatedAt ? new Date(report.generatedAt) : new Date();
  const sheet = workbook.addWorksheet('CVR Worksheet', {
    properties: { tabColor: { argb: 'FF2F855A' } },
    views: [{ state: 'frozen', ySplit: HEADER_ROW, xSplit: 3 }],
    pageSetup: { paperSize: 8, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
  });
  sheet.headerFooter.oddHeader = `&LBuildLite · ${report.development?.number || ''} ${report.period?.key || ''}&R${authorityLabel(report)}`;
  sheet.headerFooter.oddFooter = `BuildLite · ${report.development?.number || ''} ${report.period?.key || ''} · Page &P of &N`;
  setMetadata(sheet, report);

  const movementHeading = report.worksheet.movementLabel || 'Movement';
  const columns = [
    ['Commercial Head', 22], ['Cost Code', 13], ['Description', 32], ['Approved Site Start Budget', 18],
    ['Actual Cost to Date', 17], ['Committed', 15], ['Certified', 15], ['Cost to Complete', 17],
    ['Uncommitted', 15], ['Change Exposure', 16], ['Projected Adjustment', 18], ['Final EFC', 17],
    ['Previous EFC / Site Start', 19], [movementHeading, 18], ['Variance against Site Start', 19],
  ];
  const header = sheet.getRow(HEADER_ROW);
  header.values = columns.map(([label]) => label);
  header.height = 30;
  header.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF245B45' } };
    cell.alignment = { wrapText: true, vertical: 'middle' };
  });
  columns.forEach(([, width], index) => { sheet.getColumn(index + 1).width = width; });

  report.worksheet.rows.forEach(item => {
    const comparator = item.previousEfc ?? item.siteStartBudget;
    const row = sheet.addRow([
      item.commercialHead, item.costCode, item.description, money(item.siteStartBudget), money(item.actualCost),
      money(item.committed), money(item.certified), money(item.costToComplete), money(item.uncommitted),
      money(item.changeExposure), money(item.projectedAdjustment), money(item.finalEfc), money(comparator),
      money(item.movement), money(item.benchmarkVariance),
    ]);
    row.height = 19;
    row.getCell(2).numFmt = '@';
    for (let column = 4; column <= 15; column += 1) row.getCell(column).numFmt = MONEY_FORMAT;
  });

  const totals = report.worksheet.totals || {};
  const totalRow = sheet.addRow([
    'TOTAL', '', '', money(totals.siteStartBudget), money(totals.actualCost), money(totals.committed),
    money(totals.certified), money(totals.costToComplete), money(totals.uncommitted), money(totals.changeExposure),
    money(totals.projectedAdjustment), money(totals.finalEfc), money(totals.previousEfc ?? totals.siteStartBudget),
    money(totals.movement), money(totals.benchmarkVariance),
  ]);
  totalRow.height = 22;
  totalRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FF17372B' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7F3ED' } };
  });
  for (let column = 4; column <= 15; column += 1) totalRow.getCell(column).numFmt = MONEY_FORMAT;

  sheet.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: totalRow.number - 1, column: 15 } };
  sheet.pageSetup.printArea = `A1:O${totalRow.number}`;
  sheet.pageSetup.printTitlesRow = `${HEADER_ROW}:${HEADER_ROW}`;
  sheet.eachRow({ includeEmpty: false }, row => row.eachCell(cell => {
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFDDE5E1' } } };
    if (cell.col >= 4) cell.alignment = { ...cell.alignment, horizontal: 'right', vertical: 'middle' };
  }));
  return workbook;
}

export async function downloadCvrWorksheet(report) {
  const workbook = await buildCvrWorksheetWorkbook(report);
  const bytes = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = globalThis.document.createElement('a');
  link.href = url;
  link.download = `${safeName(report.development?.number)}-${safeName(report.period?.key)}-CVR-Worksheet.xlsx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { HEADER_ROW, MONEY_FORMAT };
