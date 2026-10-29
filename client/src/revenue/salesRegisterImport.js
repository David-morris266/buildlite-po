import { mappingToFieldByColumn, parseMoneyCell } from '../payments/excelImport.js';

const CURRENCY_FLOAT_TOLERANCE_PENCE = 0.000001;

export function canonicalCurrencyValue(value, { positive = false } = {}) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  const scaled = amount * 100;
  const integerPence = Math.round(scaled);
  if (Math.abs(scaled - integerPence) > CURRENCY_FLOAT_TOLERANCE_PENCE) return null;
  if (positive ? integerPence <= 0 : integerPence < 0) return null;
  return integerPence / 100;
}

export const SALES_REGISTER_FIELDS = {
  plotNumber: { label: 'Plot Number', required: true },
  salesStatus: { label: 'Sales Status', required: false },
  sellingPrice: { label: 'Selling Price (contractual evidence)', required: false },
  forecastPrice: { label: 'Forecast Price (adopt as Manual Value)', required: false },
  houseTypeEvidence: { label: 'House Type (evidence only)', required: false },
  unsupportedExtras: { label: 'Extras — not imported', unsupported: true },
  unsupportedIncentives: { label: 'Incentives — not imported', unsupported: true },
  unsupportedNetRevenue: { label: 'Net Revenue — not imported', unsupported: true },
  unsupportedForecastCompletion: { label: 'Forecast Completion — not imported', unsupported: true },
  ignore: { label: 'Ignore', required: false },
};

export const CONTROLLED_SALES_STATUSES = ['Available', 'Reserved', 'Exchanged', 'Completed', 'Cancelled'];

const ALIASES = {
  plotNumber: ['plot', 'plot no', 'plot no.', 'plot number', 'unit'],
  salesStatus: ['status', 'sales status', 'sale status'],
  sellingPrice: ['selling price', 'sale price', 'contract price'],
  forecastPrice: ['forecast price', 'forecast selling price', 'forecast gdv', 'revenue', 'revenues'],
  houseTypeEvidence: ['house type', 'type', 'dwelling type'],
  unsupportedExtras: ['extras', 'extra'],
  unsupportedIncentives: ['incentives', 'incentive'],
  unsupportedNetRevenue: ['net revenue', 'net sales revenue'],
  unsupportedForecastCompletion: ['forecast completion', 'forecast completion date'],
};

function headerText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[£$€]/g, '')
    .replace(/[()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function autoDetectSalesRegisterColumns(headers = []) {
  const mapping = {};
  const used = new Set();
  for (const [field, aliases] of Object.entries(ALIASES)) {
    const index = headers.findIndex((header, column) => {
      if (used.has(column)) return false;
      const text = headerText(header);
      return aliases.some((alias) => text === alias);
    });
    if (index >= 0) {
      mapping[field] = index;
      used.add(index);
    }
  }
  return mappingToFieldByColumn(headers, mapping);
}

export function isAcceptedSalesRegisterFile(file) {
  const name = String(file?.name || '').toLowerCase();
  return ['.xlsx', '.xls', '.csv'].some((extension) => name.endsWith(extension));
}

export function sourceSalesStatuses(rows = [], headerRowIndex = 0, fieldByColumn = []) {
  const index = fieldByColumn.indexOf('salesStatus');
  if (index < 0) return [];
  return [...new Set(rows.slice(headerRowIndex + 1).map((row) => String(row[index] || '').trim()).filter(Boolean))];
}

export function buildSalesRegisterReview({
  rows = [],
  headerRowIndex = 0,
  fieldByColumn = [],
  plots = [],
  statusMapping = {},
  treatment = 'contractual_selling_price',
} = {}) {
  const plotIndex = fieldByColumn.indexOf('plotNumber');
  const statusIndex = fieldByColumn.indexOf('salesStatus');
  const priceIndex = fieldByColumn.indexOf('sellingPrice');
  const forecastIndex = fieldByColumn.indexOf('forecastPrice');
  const importedPriceIndex = treatment === 'forecast_manual_value' ? forecastIndex : priceIndex;
  const houseTypeIndex = fieldByColumn.indexOf('houseTypeEvidence');
  const errors = [];
  const changes = [];
  const sourceSeen = new Set();
  const targetSeen = new Set();
  const byNumber = new Map();
  for (const plot of plots) {
    const key = String(plot.plotNumber || '').trim().toLowerCase();
    const matches = byNumber.get(key) || [];
    matches.push(plot);
    byNumber.set(key, matches);
  }

  if (plotIndex < 0) errors.push('Map a Plot Number column.');
  if (statusIndex < 0 && importedPriceIndex < 0) errors.push('Map Sales Status or the price column required by the selected treatment.');
  if (treatment === 'forecast_manual_value' && importedPriceIndex < 0) {
    errors.push('Map a Forecast Price column.');
  }
  if (errors.length) return { ready: false, errors, changes: [], unsupportedColumns: [] };

  rows.slice(headerRowIndex + 1).forEach((row, offset) => {
    if ((row || []).every((cell) => !String(cell || '').trim())) return;
    const sourceRow = headerRowIndex + offset + 2;
    const plotNumber = String(row[plotIndex] || '').trim();
    if (!plotNumber) {
      errors.push(`Row ${sourceRow}: Plot Number is blank.`);
      return;
    }
    const key = plotNumber.toLowerCase();
    if (sourceSeen.has(key)) {
      errors.push(`Row ${sourceRow}: Plot ${plotNumber} appears more than once in the source.`);
      return;
    }
    sourceSeen.add(key);
    const matches = byNumber.get(key) || [];
    if (matches.length !== 1) {
      errors.push(`Row ${sourceRow}: Plot ${plotNumber} ${matches.length ? 'is ambiguous' : 'does not exist in Plot Master'}.`);
      return;
    }
    const plot = matches[0];
    if (targetSeen.has(plot.id)) {
      errors.push(`Row ${sourceRow}: Plot ${plotNumber} matches an already reviewed target.`);
      return;
    }
    targetSeen.add(plot.id);
    const update = { plotId: plot.id, plotNumber };
    const proposed = [];
    if (statusIndex >= 0) {
      const sourceStatus = String(row[statusIndex] || '').trim();
      const mapped = statusMapping[sourceStatus] || '';
      if (!mapped) errors.push(`Row ${sourceRow}: Map source status “${sourceStatus || '(blank)'}” to a controlled Sales Status.`);
      else {
        update.revenueStatus = mapped;
        proposed.push(`Sales Status: ${plot.revenueStatus || 'Available'} → ${mapped}`);
      }
    }
    if (importedPriceIndex >= 0 && String(row[importedPriceIndex] ?? '').trim() !== '') {
      const parsedPrice = parseMoneyCell(row[importedPriceIndex]);
      const price = canonicalCurrencyValue(parsedPrice, {
        positive: treatment === 'forecast_manual_value',
      });
      if (price == null) errors.push(`Row ${sourceRow}: Imported price must be ${treatment === 'forecast_manual_value' ? 'greater than zero and ' : ''}valid to exact pence.`);
      else {
        update.importedPrice = price;
        if (treatment === 'contractual_selling_price') update.sellingPrice = price;
        proposed.push(`${treatment === 'forecast_manual_value' ? 'Forecast Manual Value' : 'Contractual Selling Price'}: £${price.toLocaleString('en-GB')}`);
      }
    }
    if (treatment === 'forecast_manual_value' && update.importedPrice == null) {
      errors.push(`Row ${sourceRow}: Forecast Price is blank.`);
    }
    if ((update.revenueStatus === 'Exchanged' || update.revenueStatus === 'Completed') && !(Number(update.sellingPrice ?? plot.sellingPrice) > 0)) {
      errors.push(`Row ${sourceRow}: Plot ${plotNumber} requires a positive Selling Price for ${update.revenueStatus}.`);
    }
    changes.push({
      ...update,
      sourceRowNumber: sourceRow,
      houseTypeEvidence: houseTypeIndex >= 0 ? String(row[houseTypeIndex] || '').trim() : '',
      currentHouseType: plot.houseType || '',
      houseTypeMismatch:
        houseTypeIndex >= 0 &&
        Boolean(String(row[houseTypeIndex] || '').trim()) &&
        String(row[houseTypeIndex] || '').trim().toLocaleLowerCase('en-GB') !==
          String(plot.houseType || '').trim().toLocaleLowerCase('en-GB'),
      proposed,
    });
  });

  const unsupportedColumns = fieldByColumn
    .map((field, index) => ({ field, index }))
    .filter(({ field }) => SALES_REGISTER_FIELDS[field]?.unsupported)
    .map(({ field, index }) => ({ field, label: SALES_REGISTER_FIELDS[field].label, index }));
  return { ready: errors.length === 0 && changes.length > 0, errors, changes, unsupportedColumns };
}
