/** @vitest-environment jsdom */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workbook = vi.hoisted(() => ({
  SheetNames: ['Read Me', 'Sales Register', 'Order Matrices'],
  Sheets: {
    'Read Me': { rows: [['Willow Test Pack'], ['Area', 'Purpose'], ['Order Matrices', 'Trade/plot values']] },
    'Sales Register': { rows: [['Willow — Sales Register'], ['Plot', 'House Type', 'Selling Price (£)', 'Extras (£)', 'Incentives (£)', 'Net Revenue (£)', 'Status', 'Forecast Completion'], ['1', 'Ash', '325000', '0', '0', '325000', 'Completed', '30-Oct-2026']] },
    'Order Matrices': { rows: [['Willow — Order Matrices'], ['Package Ref', 'Trade', 'Plot', 'Value (£)'], ['WG-GW-001', 'Groundworks', '1', '6500']] },
  },
}));

vi.mock('../payments/excelImport', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    parseExcelFile: vi.fn(async () => workbook),
    getWorksheetSummaries: vi.fn((source) => source.SheetNames.map((name) => ({ name, rowCount: source.Sheets[name].rows.length }))),
    sheetToRawRows: vi.fn((sheet) => sheet.rows),
  };
});

import SalesRegisterImportWizard from './SalesRegisterImportWizard';

describe('SalesRegisterImportWizard worksheet ownership', () => {
  let container;
  let root;
  beforeEach(() => {
    vi.stubGlobal('crypto', { subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) } });
    if (!File.prototype.arrayBuffer) File.prototype.arrayBuffer = vi.fn(async () => new Uint8Array([1]).buffer);
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });

  function clickButton(label) {
    const button = [...container.querySelectorAll('button')].find((item) => item.textContent === label);
    expect(button).toBeTruthy();
    act(() => button.click());
  }

  function selectSheet(name) {
    const input = [...container.querySelectorAll('input[type="radio"]')].find((item) => item.parentElement.textContent.includes(name));
    expect(input).toBeTruthy();
    act(() => input.click());
  }

  it('uses the selected multi-sheet rows downstream and never retains the adjacent sheet', async () => {
    act(() => root.render(<SalesRegisterImportWizard plots={[{ id: 'p1', plotNumber: '1', houseType: 'Ash', revenueStatus: 'Available' }]} developmentVersion={1} onCancel={vi.fn()} onApply={vi.fn()} />));
    const file = new File(['workbook'], 'willow.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const input = container.querySelector('input[type="file"]');
    await act(async () => { Object.defineProperty(input, 'files', { value: [file], configurable: true }); input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); });

    selectSheet('Sales Register'); clickButton('Continue');
    expect(document.body.textContent).toContain('Worksheet: Sales Register');
    expect(container.querySelector('select[aria-label="Map column Plot"]')?.value).toBe('plotNumber');
    expect(container.querySelector('select[aria-label="Map column Status"]')?.value).toBe('salesStatus');
    expect(container.querySelector('select[aria-label="Map column Selling Price (£)"]')?.value).toBe('sellingPrice');
    expect(container.querySelector('select[aria-label="Map column Extras (£)"]')?.value).toBe('unsupportedExtras');

    clickButton('Back'); selectSheet('Order Matrices'); clickButton('Continue');
    expect(document.body.textContent).toContain('Worksheet: Order Matrices');
    expect(container.querySelector('select[aria-label="Map column Package Ref"]')).toBeTruthy();
    expect(container.querySelector('select[aria-label="Map column Selling Price (£)"]')).toBeFalsy();

    clickButton('Back'); selectSheet('Sales Register'); clickButton('Continue');
    expect(document.body.textContent).toContain('Worksheet: Sales Register');
    expect(container.querySelector('select[aria-label="Map column Net Revenue (£)"]')?.value).toBe('unsupportedNetRevenue');
    expect(document.body.textContent).not.toContain('Trade/plot values');
  });

  it('keeps single-sheet/CSV-shaped input on the only sheet', async () => {
    const single = { SheetNames: ['Sheet1'], Sheets: { Sheet1: workbook.Sheets['Sales Register'] } };
    const { parseExcelFile } = await import('../payments/excelImport');
    parseExcelFile.mockResolvedValueOnce(single);
    act(() => root.render(<SalesRegisterImportWizard plots={[]} developmentVersion={1} onCancel={vi.fn()} onApply={vi.fn()} />));
    const input = container.querySelector('input[type="file"]');
    const file = new File(['csv'], 'sales.csv', { type: 'text/csv' });
    await act(async () => { Object.defineProperty(input, 'files', { value: [file], configurable: true }); input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); });
    expect(document.body.textContent).toContain('Worksheet: Sheet1');
    expect(container.querySelector('select[aria-label="Map column Plot"]')?.value).toBe('plotNumber');
  });

  it('shows authoritative reconciliation before collapsible row detail and requires confirmation before Apply', async () => {
    const single = { SheetNames: ['Sheet1'], Sheets: { Sheet1: { rows: [['Plot', 'House Type', 'Forecast Price'], ['1', 'Birch', 325000]] } } };
    const { parseExcelFile } = await import('../payments/excelImport');
    parseExcelFile.mockResolvedValueOnce(single);
    const onPreview = vi.fn(async () => ({ preview: {
      sourceRowCount: 1,
      acceptedRowCount: 1,
      rejectedRowCount: 0,
      excludedRowCount: 0,
      sourceTotal: 325000,
      projectedAuthoritativeGdv: 325000,
      difference: 0,
      canApply: true,
      fingerprint: 'reviewed-fingerprint',
      errors: [],
      authorityBlockers: [],
    } }));
    const onApply = vi.fn(async () => undefined);
    act(() => root.render(<SalesRegisterImportWizard plots={[{ id: 'p1', plotNumber: '1', houseType: 'Ash', revenueStatus: 'Available' }]} developmentVersion={1} onCancel={vi.fn()} onPreview={onPreview} onApply={onApply} />));
    const input = container.querySelector('input[type="file"]');
    const file = new File(['csv'], 'sales.csv', { type: 'text/csv' });
    await act(async () => { Object.defineProperty(input, 'files', { value: [file], configurable: true }); input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); });
    const treatment = container.querySelector('select[aria-label="Imported price treatment"]');
    act(() => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(treatment, 'forecast_manual_value'); treatment.dispatchEvent(new Event('change', { bubbles: true })); });
    clickButton('Review proposed changes');
    const reason = container.querySelector('textarea');
    act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(reason, 'Reviewed customer sales evidence'); reason.dispatchEvent(new Event('input', { bubbles: true })); });
    const previewButton = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Preview authoritative GDV');
    expect(previewButton.disabled, document.body.textContent).toBe(false);
    await act(async () => { previewButton.click(); await Promise.resolve(); });

    const reconciliation = container.querySelector('.revenue-sales-import__reconciliation');
    const rows = container.querySelector('.revenue-sales-import__rows');
    expect(reconciliation).toBeTruthy();
    expect(rows).toBeTruthy();
    expect(rows.querySelector('summary').textContent).toContain('1 House Type mismatch');
    expect(reconciliation.compareDocumentPosition(rows) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rows.open).toBe(false);
    const apply = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Apply 1 reviewed rows');
    expect(apply.disabled).toBe(true);
    const confirmation = container.querySelector('.revenue-sales-import__confirmation input[type="checkbox"]');
    act(() => confirmation.click());
    expect(apply.disabled).toBe(false);
    await act(async () => { apply.click(); await Promise.resolve(); });
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ previewFingerprint: 'reviewed-fingerprint' }));
  });
});
