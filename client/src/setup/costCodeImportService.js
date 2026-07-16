/**

 * BL-016F / BL-018A — Setup cost code import orchestration.

 */



import { parseCsvFile, extractHeaders, isBlankRow, isAcceptedCsvFile } from '../ledger/csvImport';

import { isAcceptedExcelFile, parseExcelFile, sheetToRows } from '../payments/excelImport';

import {

  ensureCommercialFamily,

  ensureCommercialHead,

  ensureReportingGroup,

  getActiveHeadNames,

} from '../admin/commercialStructureStore';

import {

  addCostCodeMasterRecord,

  getCostCodeMasterStore,

  listCostCodeMasterRecords,

  updateCostCodeMasterRecord,

} from '../admin/costCodeMasterStore';

import {

  buildImportMetadata,

  detectImportHierarchyMapping,

  HIERARCHY_MODE_LABELS,

  HIERARCHY_MODE_THREE_LEVEL,

  HIERARCHY_MODE_THREE_LEVEL_DEFAULT_FAMILY,

  HIERARCHY_MODE_TWO_LEVEL,

  inferDefaultHierarchyMode,

  resolveCostCodeReportingPath,

  resolveHierarchyModeSelection,

} from '../admin/costCodeHierarchy';

import {

  autoDetectCostCodeColumnMapping,

  buildCostCodeImportPreview,

  buildCostCodeMappedRow,

  costCodeMappingToFieldByColumn,

  detectCostCodeHeaderRowIndex,

  getMissingCostCodeFields,

} from './costCodeImportFields';



export {

  detectImportHierarchyMapping,

  HIERARCHY_MODE_TWO_LEVEL,

  HIERARCHY_MODE_THREE_LEVEL,

  HIERARCHY_MODE_THREE_LEVEL_DEFAULT_FAMILY,

  inferDefaultHierarchyMode,

} from '../admin/costCodeHierarchy';



export function resolveCostCodeHierarchy(mapped, activeHeads, options = {}) {

  const hierarchyMode =

    options.hierarchyMode || inferDefaultHierarchyMode(options.detection || {});

  const selection = resolveHierarchyModeSelection({

    detection: options.detection,

    selectedMode: hierarchyMode,

    defaultFamilyName: options.defaultFamilyName,

  });



  const resolved = resolveCostCodeReportingPath(mapped, {

    activeHeads,

    hierarchyMode: selection.mode,

    defaultFamilyName: selection.defaultFamilyName,

    defaultHead: options.defaultHead || getActiveHeadNames()[0] || '',

  });



  return {

    commercialHead: resolved.commercialHead,

    commercialFamily: resolved.commercialFamily,

    trade: resolved.trade,

    reportingGroup: resolved.reportingGroup,

    hierarchyMode: resolved.hierarchyMode,

    systemGeneratedFamily: resolved.systemGeneratedFamily,

    warnings: resolved.warnings,

  };

}



function parseActiveValue(value) {

  const raw = String(value ?? '').trim().toLowerCase();

  if (!raw) return true;

  if (['no', 'n', 'false', 'inactive', '0'].includes(raw)) return false;

  return true;

}



function parseOrderType(value) {

  const raw = String(value || '').trim().toUpperCase();

  if (raw === 'M' || raw.startsWith('MAT')) return 'M';

  if (raw === 'P' || raw.startsWith('PLA')) return 'P';

  if (raw === 'S' || raw.startsWith('SUB')) return 'S';

  return 'S';

}



function parseVatTreatment(value) {

  const raw = String(value || '').trim().toLowerCase();

  if (raw.includes('zero')) return 'Zero Rated';

  if (raw.includes('reverse')) return 'Reverse Charge';

  return 'Standard';

}



export async function parseCostCodeImportFile(file) {

  let rows = [];

  const fileName = file.name;



  if (isAcceptedCsvFile(file)) {

    rows = await parseCsvFile(file);

  } else if (isAcceptedExcelFile(file)) {

    const workbook = await parseExcelFile(file);

    const sheetName = workbook.SheetNames[0];

    rows = sheetToRows(workbook.Sheets[sheetName]);

  } else {

    throw new Error('Please upload a CSV or Excel (.xlsx) file.');

  }



  const headerRowIndex = detectCostCodeHeaderRowIndex(rows);

  const headers = extractHeaders(rows[headerRowIndex] || []);

  const autoMapping = autoDetectCostCodeColumnMapping(headers);

  const fieldByColumn = costCodeMappingToFieldByColumn(headers, autoMapping);

  const hierarchyDetection = detectImportHierarchyMapping(fieldByColumn);



  return {

    fileName,

    rows,

    headerRowIndex,

    headers,

    fieldByColumn,

    hierarchyDetection,

    defaultHierarchyMode: inferDefaultHierarchyMode(hierarchyDetection),

  };

}



export function validateCostCodeImport(parsed, context = {}) {

  const missingMappings = getMissingCostCodeFields(parsed.fieldByColumn);

  const existingRecords = context.existingRecords || listCostCodeMasterRecords();

  const existingByCode = new Map(

    existingRecords.map((item) => [String(item.code || '').trim().toLowerCase(), item])

  );

  const activeHeads = new Set(getActiveHeadNames().map((item) => item.toLowerCase()));

  const hierarchyDetection =

    context.hierarchyDetection || detectImportHierarchyMapping(parsed.fieldByColumn);

  const hierarchyMode = context.hierarchyMode || inferDefaultHierarchyMode(hierarchyDetection);

  const defaultFamilyName = context.defaultFamilyName || 'General';



  const validRows = [];

  const errors = [];

  const warnings = [];

  const seenCodes = new Set();



  const bodyRows = parsed.rows.slice(parsed.headerRowIndex + 1);

  for (let index = 0; index < bodyRows.length; index += 1) {

    const row = bodyRows[index];

    if (isBlankRow(row)) continue;



    const rowNumber = parsed.headerRowIndex + index + 2;

    const mapped = buildCostCodeMappedRow(row, parsed.fieldByColumn);

    const code = String(mapped.costCode || '').trim();

    const description = String(mapped.description || '').trim();

    const rowIssues = [];

    const rowWarnings = [];



    if (!code) rowIssues.push('Blank cost code');

    if (!description) rowIssues.push('Blank description');



    const codeKey = code.toLowerCase();

    if (code && seenCodes.has(codeKey)) rowIssues.push('Duplicate cost code in file');

    if (code) seenCodes.add(codeKey);



    const existing = existingByCode.get(codeKey);

    if (code && existing) rowWarnings.push('Cost code already exists in master data');



    const resolved = resolveCostCodeHierarchy(mapped, activeHeads, {

      hierarchyMode,

      defaultFamilyName,

      detection: hierarchyDetection,

    });

    rowWarnings.push(...resolved.warnings);



    if (!resolved.commercialHead) rowIssues.push('Commercial Head is required');

    if (!resolved.reportingGroup) rowIssues.push('Reporting Group is required');



    if (!parseActiveValue(mapped.active)) {

      rowWarnings.push('Inactive cost code');

    }



    if (rowIssues.length) {

      errors.push({ rowNumber, code, description, issues: rowIssues });

    } else {

      validRows.push({

        rowNumber,

        code,

        description,

        commercialHead: resolved.commercialHead,

        commercialFamily: resolved.commercialFamily,

        trade: resolved.trade,

        reportingGroup: resolved.reportingGroup,

        hierarchyMode: resolved.hierarchyMode,

        systemGeneratedFamily: resolved.systemGeneratedFamily,

        isUpdate: Boolean(existing),

        defaultOrderType: parseOrderType(mapped.defaultOrderType),

        defaultVatTreatment: parseVatTreatment(mapped.defaultVatTreatment),

        reportingOrder: Number.parseInt(String(mapped.reportingOrder || '0'), 10) || 0,

        active: parseActiveValue(mapped.active),

        warnings: rowWarnings,

      });

      warnings.push(...rowWarnings.map((message) => ({ rowNumber, code, message })));

    }

  }



  return {

    missingMappings,

    validRows,

    errors,

    warnings,

    canImport: missingMappings.length === 0 && validRows.length > 0,

    hierarchyDetection,

    hierarchyMode,

    hierarchyModeLabel: HIERARCHY_MODE_LABELS[hierarchyMode] || hierarchyMode,

    summary: {

      totalRows: bodyRows.filter((row) => !isBlankRow(row)).length,

      validCount: validRows.length,

      errorCount: errors.length,

      warningCount: warnings.length,

      updateCount: validRows.filter((row) => row.isUpdate).length,

      createCount: validRows.filter((row) => !row.isUpdate).length,

    },

  };

}



function ensureStructureForRow(row, stats) {

  const headResult = ensureCommercialHead(row.commercialHead);

  if (headResult.created) stats.headsCreated += 1;

  else stats.headsMatched += 1;



  if (row.commercialFamily) {

    const familyResult = ensureCommercialFamily(row.commercialHead, row.commercialFamily);

    if (familyResult.created) stats.familiesCreated += 1;

    else stats.familiesMatched += 1;

  }



  const groupResult = ensureReportingGroup({

    headName: row.commercialHead,

    familyName: row.commercialFamily || null,

    groupName: row.reportingGroup || row.trade,

  });

  if (groupResult.created) stats.reportingGroupsCreated += 1;

  else stats.reportingGroupsMatched += 1;

}



export function executeCostCodeImport(

  validationResult,

  { skipExisting = false, hierarchyMode = null, defaultFamilyName = 'General' } = {}

) {

  if (!validationResult?.canImport) {

    return { ok: false, errors: ['No valid rows to import.'] };

  }



  const existing = new Map(

    listCostCodeMasterRecords().map((item) => [

      String(item.code || '').trim().toLowerCase(),

      item,

    ])

  );



  const resolvedMode = hierarchyMode || validationResult.hierarchyMode || HIERARCHY_MODE_TWO_LEVEL;

  const hadFamilyMapping = Boolean(validationResult.hierarchyDetection?.hasCommercialFamily);



  let imported = 0;

  let updated = 0;

  let skipped = 0;

  let rejected = 0;

  const importErrors = [];

  const importWarnings = [];

  const stats = {

    rowsRead: validationResult.summary?.totalRows || 0,

    headsCreated: 0,

    headsMatched: 0,

    familiesCreated: 0,

    familiesMatched: 0,

    reportingGroupsCreated: 0,

    reportingGroupsMatched: 0,

  };



  for (const row of validationResult.validRows) {

    const codeKey = row.code.toLowerCase();

    const existingRecord = existing.get(codeKey);



    if (skipExisting && existingRecord) {

      skipped += 1;

      continue;

    }



    ensureStructureForRow(row, stats);



    const payload = {

      code: row.code,

      description: row.description,

      commercialHead: row.commercialHead,

      commercialFamily: row.commercialFamily || '',

      trade: row.reportingGroup || row.trade,

      reportingGroup: row.reportingGroup || row.trade,

      hierarchyMode: row.hierarchyMode || resolvedMode,

      defaultOrderType: row.defaultOrderType,

      defaultVatTreatment: row.defaultVatTreatment,

      reportingOrder: row.reportingOrder,

      active: row.active,

      importMetadata: buildImportMetadata({

        hierarchyMode: row.hierarchyMode || resolvedMode,

        hadFamilyMapping,

        systemGeneratedFamily: Boolean(row.systemGeneratedFamily),

      }),

    };



    const result = existingRecord

      ? updateCostCodeMasterRecord(existingRecord.id, payload)

      : addCostCodeMasterRecord(payload);



    if (!result.ok) {

      rejected += 1;

      importErrors.push(`${row.code}: ${result.errors?.[0] || 'Import failed'}`);

      continue;

    }



    if (existingRecord) updated += 1;

    else imported += 1;



    existing.set(codeKey, result.record);

    importWarnings.push(...(row.warnings || []).map((message) => ({ code: row.code, message })));

  }



  const store = getCostCodeMasterStore();

  return {

    ok: importErrors.length === 0 || imported > 0 || updated > 0,

    imported,

    updated,

    skipped,

    rejected,

    rowsRead: stats.rowsRead,

    headsCreated: stats.headsCreated,

    headsMatched: stats.headsMatched,

    familiesCreated: stats.familiesCreated,

    familiesMatched: stats.familiesMatched,

    reportingGroupsCreated: stats.reportingGroupsCreated,

    reportingGroupsMatched: stats.reportingGroupsMatched,

    hierarchyMode: resolvedMode,

    hierarchyModeLabel: HIERARCHY_MODE_LABELS[resolvedMode] || resolvedMode,

    warnings: importWarnings,

    errors: importErrors,

    totalInStore: store.costCodes.length,

  };

}



export { buildCostCodeImportPreview };

