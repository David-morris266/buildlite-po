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
    sheetToRows: vi.fn((sheet) => sheet.rows),
  };
});

import SalesRegisterImportWizard from './SalesRegisterImportWizard';

describe('SalesRegisterImportWizard worksheet ownership', () => {
  let container;
  let root;
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
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
});
