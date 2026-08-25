/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listActiveCostCodesForSelect = vi.hoisted(() => vi.fn());
const executeBudgetImport = vi.hoisted(() => vi.fn());
const parseBudgetImportFile = vi.hoisted(() => vi.fn());

vi.mock('../admin/costCodeMasterStore', () => ({
  listActiveCostCodesForSelect,
}));

vi.mock('../cvr/budgetImportService', async () => {
  const actual = await vi.importActual('../cvr/budgetImportService');
  return {
    ...actual,
    executeBudgetImport,
    parseBudgetImportFile,
  };
});

import CVRBudgetImportWizard from './CVRBudgetImportWizard';

const PARSED = {
  fileName: 'budget.csv',
  rows: [
    ['Cost Code', 'Description', 'Budget'],
    ['1110', 'Stamp Duty', '25000'],
    ['9999', 'Miscellaneous', '10'],
  ],
  headerRowIndex: 0,
  headers: ['Cost Code', 'Description', 'Budget'],
  fieldByColumn: ['costCode', 'description', 'originalBudget'],
};

const VALID_PARSED = {
  ...PARSED,
  rows: [
    ['Cost Code', 'Description', 'Budget'],
    ['1110', 'Stamp Duty', '25000'],
  ],
};

describe('CVRBudgetImportWizard', () => {
  let container;
  let root;

  beforeEach(() => {
    listActiveCostCodesForSelect.mockResolvedValue([{ code: '1110', label: '1110' }]);
    executeBudgetImport.mockReset();
    parseBudgetImportFile.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  async function flush() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function renderWizard() {
    await act(async () => {
      root.render(
        <CVRBudgetImportWizard
          development={{ id: 'dev-1', developmentName: 'Fixture Site' }}
          periodKey="P01"
          onCancel={vi.fn()}
          onImportComplete={vi.fn()}
        />
      );
    });
    await flush();
  }

  async function upload(parsed) {
    parseBudgetImportFile.mockResolvedValue(parsed);
    const input = container.querySelector('input[type="file"]');
    const file = new File(['x'], 'budget.csv', { type: 'text/csv' });
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    await flush();
  }

  it('blocks unknown Master codes and does not offer to create headings', async () => {
    await renderWizard();
    await upload(PARSED);
    const continueBtn = [...container.querySelectorAll('button')].find((btn) =>
      btn.textContent.includes('Continue')
    );
    await act(async () => {
      continueBtn.click();
    });
    await flush();
    expect(container.textContent).toMatch(/not available in your Cost Code Master/);
    expect(container.textContent).toMatch(/9999 — Miscellaneous/);
    expect(container.textContent).not.toMatch(/Create new Cost Codes/);
    const toImport = [...container.querySelectorAll('button')].find((btn) =>
      btn.textContent.includes('Continue to Import')
    );
    expect(toImport?.disabled).toBe(true);
    expect(executeBudgetImport).not.toHaveBeenCalled();
  });

  it('shows success only after the awaited server import completes', async () => {
    let resolveImport;
    executeBudgetImport.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveImport = resolve;
        })
    );
    await renderWizard();
    await upload(VALID_PARSED);
    const continueBtn = [...container.querySelectorAll('button')].find((btn) =>
      btn.textContent.includes('Continue')
    );
    await act(async () => {
      continueBtn.click();
    });
    await flush();
    const toImport = [...container.querySelectorAll('button')].find((btn) =>
      btn.textContent.includes('Continue to Import')
    );
    await act(async () => {
      toImport.click();
    });
    await flush();
    expect(container.textContent).not.toContain('Budget Import Complete');
    const importBtn = [...container.querySelectorAll('button')].find((btn) =>
      btn.textContent.includes('Import Budget')
    );
    await act(async () => {
      importBtn.click();
    });
    await flush();
    expect(container.textContent).toContain('Importing');
    expect(container.textContent).not.toContain('Budget Import Complete');
    await act(async () => {
      resolveImport({
        ok: true,
        importedCount: 1,
        created: 1,
        updated: 0,
        totalOriginalBudget: 25000,
        totalCurrentBudget: 25000,
      });
      await Promise.resolve();
    });
    await flush();
    expect(container.textContent).toContain('Budget Import Complete');
    expect(executeBudgetImport).toHaveBeenCalledTimes(1);
  });

  it('shows a server failure instead of success', async () => {
    executeBudgetImport.mockResolvedValue({
      ok: false,
      errors: ['Budget cannot be imported.\nThe following cost codes are inactive and cannot be added to a CVR:\n8888'],
    });
    await renderWizard();
    await upload(VALID_PARSED);
    const continueBtn = [...container.querySelectorAll('button')].find((btn) =>
      btn.textContent.includes('Continue')
    );
    await act(async () => {
      continueBtn.click();
    });
    await flush();
    const toImport = [...container.querySelectorAll('button')].find((btn) =>
      btn.textContent.includes('Continue to Import')
    );
    await act(async () => {
      toImport.click();
    });
    await flush();
    const importBtn = [...container.querySelectorAll('button')].find((btn) =>
      btn.textContent.includes('Import Budget')
    );
    await act(async () => {
      importBtn.click();
    });
    await flush();
    expect(container.textContent).toMatch(/inactive/);
    expect(container.textContent).not.toContain('Budget Import Complete');
  });
});
