const VISIBLE_HEADERS = [
  'Cost Code', 'Description', 'Source Section', 'Source Trade / Group', 'Source Element',
  'Current Status', 'Commercial Head', 'Reporting Group', 'Commercial Family (optional)', 'Review Decision',
];
const TECHNICAL_HEADERS = ['Cost Code ID', 'Version', 'Source Evidence'];
const HEADERS = [...VISIBLE_HEADERS, ...TECHNICAL_HEADERS];
const HEADER_ROW = 7;
const DATA_ROW = HEADER_ROW + 1;
const EDITABLE_COLUMNS = new Set(['Commercial Head', 'Reporting Group', 'Commercial Family (optional)', 'Review Decision']);
const STATUS_LABELS = {
  allocated: 'Allocated',
  not_reviewed: 'Not reviewed',
  not_applicable: 'Not applicable',
  needs_attention: 'Needs attention',
};

async function exceljs() { return import('exceljs'); }
async function xlsx() { return import('xlsx'); }

function compactEvidence(value = {}) {
  const legacy = value.legacy || {}; const imported = value.import || {};
  return JSON.stringify({
    ...(legacy.subHeading || legacy.trade || legacy.element ? { legacy } : {}),
    ...(imported.sourceFilename || imported.hierarchyEvidence ? { import: imported } : {}),
  }).slice(0, 4000);
}

function evidenceValue(evidence, candidates) {
  const legacy = evidence?.legacy || {};
  const imported = evidence?.import?.hierarchyEvidence || {};
  const entries = Object.entries(imported);
  for (const candidate of candidates) {
    const legacyValue = legacy[candidate];
    if (legacyValue != null && String(legacyValue).trim()) return String(legacyValue).trim();
    const match = entries.find(([key]) => key.toLowerCase().replace(/[^a-z0-9]/g, '') === candidate.toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (match?.[1] != null && String(match[1]).trim()) return String(match[1]).trim();
  }
  return '';
}

function visibleEvidence(sourceEvidence = {}) {
  return {
    section: evidenceValue(sourceEvidence, ['subHeading', 'section', 'heading']),
    trade: evidenceValue(sourceEvidence, ['trade', 'group', 'sourceGroup', 'reportingGroup']),
    element: evidenceValue(sourceEvidence, ['element', 'sourceElement']),
  };
}

function compareCodes(left, right) {
  const collator = new Intl.Collator('en-GB', { numeric: true, sensitivity: 'base' });
  const result = collator.compare(String(left.code), String(right.code));
  return result || String(left.code).localeCompare(String(right.code), 'en-GB');
}

function humanStatus(value) { return STATUS_LABELS[value] || 'Needs attention'; }

function ownerRow(row) {
  const evidence = visibleEvidence(row.sourceEvidence);
  return [
    String(row.code), row.description || '', evidence.section, evidence.trade, evidence.element,
    humanStatus(row.currentReviewState),
    row.currentReviewState === 'allocated' ? row.currentCommercialHead || '' : '',
    row.currentReviewState === 'allocated' ? row.currentReportingGroup || '' : '',
    row.currentReviewState === 'allocated' ? row.currentCommercialFamily || '' : '',
    ['allocated', 'not_applicable'].includes(row.currentReviewState) ? 'Keep Existing' : '',
    String(row.id), Number(row.version), compactEvidence(row.sourceEvidence),
  ];
}

function border(color = 'FFD1D5DB') {
  return { top: { style: 'thin', color: { argb: color } }, left: { style: 'thin', color: { argb: color } }, bottom: { style: 'thin', color: { argb: color } }, right: { style: 'thin', color: { argb: color } } };
}

async function styleMappingSheet(sheet, rowCount) {
  sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: HEADER_ROW, topLeftCell: `C${DATA_ROW}`, activeCell: `G${DATA_ROW}` }];
  sheet.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW + rowCount, column: VISIBLE_HEADERS.length } };
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  sheet.properties.defaultRowHeight = 20;

  sheet.mergeCells('A1:J1');
  const title = sheet.getCell('A1');
  title.value = 'BuildLite — Commercial Hierarchy Mapping';
  title.font = { name: 'Aptos Display', size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17372B' } };
  title.alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(1).height = 31;

  sheet.mergeCells('A2:J2');
  const intro = sheet.getCell('A2');
  intro.value = 'Review your Cost Codes and complete the green mapping columns. Source information is guidance only and is never applied automatically. Upload this workbook to Preview before anything changes.';
  intro.font = { name: 'Aptos', size: 10, color: { argb: 'FF334155' } };
  intro.alignment = { wrapText: true, vertical: 'middle' };
  intro.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F3' } };
  sheet.getRow(2).height = 34;

  sheet.mergeCells('A3:F3');
  sheet.getCell('A3').value = 'Grey columns are read-only evidence';
  sheet.getCell('A3').font = { italic: true, color: { argb: 'FF64748B' } };
  sheet.mergeCells('G3:J3');
  sheet.getCell('G3').value = 'Complete the green columns';
  sheet.getCell('G3').font = { bold: true, color: { argb: 'FF166534' } };
  sheet.getCell('G3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };

  const summary = sheet.getCell('A5');
  summary.value = 'Active Cost Codes'; summary.font = { bold: true, color: { argb: 'FF475569' } };
  sheet.getCell('B5').value = rowCount;
  const counts = { Allocated: 0, 'Not reviewed': 0, 'Not applicable': 0, 'Needs attention': 0 };
  for (let row = DATA_ROW; row < DATA_ROW + rowCount; row += 1) counts[sheet.getCell(row, 6).value] += 1;
  [['D5', 'Allocated'], ['F5', 'Not reviewed'], ['H5', 'Not applicable'], ['J5', 'Needs attention']].forEach(([cell, label]) => {
    sheet.getCell(cell).value = `${label}: ${counts[label]}`;
    sheet.getCell(cell).font = { bold: true, color: { argb: label === 'Needs attention' ? 'FFB45309' : 'FF475569' } };
  });

  const header = sheet.getRow(HEADER_ROW);
  header.height = 32;
  header.eachCell((cell, column) => {
    const editable = column >= 7 && column <= 10;
    cell.font = { bold: true, color: { argb: editable ? 'FF14532D' : 'FF334155' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: editable ? 'FFBBF7D0' : 'FFE2E8F0' } };
    cell.alignment = { wrapText: true, vertical: 'middle' };
    cell.border = border();
  });

  for (let rowNumber = DATA_ROW; rowNumber < DATA_ROW + rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber); row.height = 26;
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      const editable = column >= 7 && column <= 10;
      cell.font = { name: 'Aptos', size: 10, color: { argb: 'FF1F2937' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: editable ? 'FFF0FDF4' : 'FFF8FAFC' } };
      cell.alignment = { vertical: 'top', wrapText: column !== 1 };
      cell.border = border('FFE5E7EB');
      cell.protection = { locked: !editable };
    });
    sheet.getCell(rowNumber, 1).numFmt = '@';
    sheet.getCell(rowNumber, 10).dataValidation = {
      type: 'list', allowBlank: true, showErrorMessage: true,
      formulae: ['"Keep Existing,Not Applicable"'],
      errorTitle: 'Choose a review decision', error: 'Use Keep Existing, Not Applicable, or leave blank when entering a hierarchy path.',
    };
  }

  const widths = [16, 34, 22, 24, 22, 18, 25, 27, 25, 20, 12, 10, 12];
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  [11, 12, 13].forEach((column) => { sheet.getColumn(column).hidden = true; });
  await sheet.protect('', { selectLockedCells: true, selectUnlockedCells: true, autoFilter: true, sort: true });
}

function styleInstructions(sheet) {
  sheet.views = [{ state: 'frozen', ySplit: 2 }];
  sheet.getColumn(1).width = 24; sheet.getColumn(2).width = 95;
  sheet.mergeCells('A1:B1');
  const title = sheet.getCell('A1');
  title.value = 'BuildLite — Completing your hierarchy mapping';
  title.font = { name: 'Aptos Display', size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17372B' } };
  title.alignment = { vertical: 'middle' }; sheet.getRow(1).height = 31;
  const guidance = [
    ['Workbook guide', 'Grey columns contain BuildLite identity, current state and source evidence. Green columns are the owner-input area. Source evidence is guidance only, not authority.'],
    ['Allocate a Cost Code', 'Complete Commercial Head and Reporting Group. Commercial Family is optional. You do not need to enter Allocate.'],
    ['Not Applicable', 'Use Review Decision = Not Applicable only where the Cost Code deliberately does not belong in the commercial cost hierarchy; leave hierarchy targets blank.'],
    ['Keep Existing', 'Do not change existing reviewed mappings marked Keep Existing unless you intend to propose a different complete path.'],
    ['Required completion', 'Blank unresolved rows block final Apply. Do not alter Cost Code or Description.'],
    ['Finish', 'Save the XLSX, return to BuildLite and choose Import completed mapping. Uploading creates a Preview only; nothing changes until Apply reviewed mapping.'],
  ];
  guidance.forEach(([heading, copy], index) => {
    const row = sheet.getRow(index + 3); row.values = [heading, copy]; row.height = index === 2 ? 44 : 38;
    row.getCell(1).font = { bold: true, color: { argb: 'FF17372B' } };
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index === 0 ? 'FFE2E8F0' : 'FFF1F5F3' } };
    row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    row.eachCell((cell) => { cell.border = border('FFE5E7EB'); cell.alignment = { ...cell.alignment, wrapText: true, vertical: 'top' }; });
  });
}

export async function buildHierarchyWorksheet(document) {
  const ExcelJS = await exceljs();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BuildLite'; workbook.company = 'BuildLite';
  workbook.title = 'Commercial Hierarchy Mapping';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Hierarchy Mapping', { properties: { tabColor: { argb: 'FF2F855A' } } });
  const rows = [...(document?.rows || [])].sort(compareCodes);
  sheet.addRows(Array.from({ length: HEADER_ROW - 1 }, () => []));
  sheet.addRow(HEADERS);
  rows.forEach((row) => sheet.addRow(ownerRow(row)));
  await styleMappingSheet(sheet, rows.length);
  const instructions = workbook.addWorksheet('Instructions', { properties: { tabColor: { argb: 'FF17372B' } } });
  styleInstructions(instructions);
  return workbook.xlsx.writeBuffer();
}

export async function downloadHierarchyWorksheet(document, filename = 'BuildLite Cost Code Hierarchy Mapping.xlsx') {
  const bytes = await buildHierarchyWorksheet(document);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = documentGlobal().createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function documentGlobal() { return globalThis.document; }

export async function parseHierarchyWorksheet(file) {
  const XLSX = await xlsx();
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: false });
  const sheet = workbook.Sheets['Hierarchy Mapping'];
  if (!sheet) throw new Error('The workbook does not contain a Hierarchy Mapping sheet.');
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  const headerIndex = grid.findIndex((row) => HEADERS.every((header) => row.map((value) => String(value).trim()).includes(header)));
  if (headerIndex < 0) throw new Error(`Worksheet is missing required columns: ${HEADERS.join(', ')}.`);
  const headers = grid[headerIndex].map((value) => String(value).trim());
  const at = (row, header) => String(row[headers.indexOf(header)] ?? '').trim();
  const exactAt = (row, header) => String(row[headers.indexOf(header)] ?? '');
  return grid.slice(headerIndex + 1).filter((row) => exactAt(row, 'Cost Code ID') || exactAt(row, 'Cost Code')).map((row, index) => {
    let sourceEvidence = {}; try { sourceEvidence = JSON.parse(at(row, 'Source Evidence') || '{}'); } catch { sourceEvidence = {}; }
    return {
      rowNumber: headerIndex + index + 2,
      id: exactAt(row, 'Cost Code ID'), code: exactAt(row, 'Cost Code'), description: exactAt(row, 'Description'), version: Number(exactAt(row, 'Version')),
      commercialHead: at(row, 'Commercial Head'), commercialFamily: at(row, 'Commercial Family (optional)'), reportingGroup: at(row, 'Reporting Group'),
      reviewDecision: at(row, 'Review Decision'), sourceEvidence,
    };
  });
}

export { HEADERS as HIERARCHY_WORKSHEET_HEADERS, HEADER_ROW as HIERARCHY_WORKSHEET_HEADER_ROW };
