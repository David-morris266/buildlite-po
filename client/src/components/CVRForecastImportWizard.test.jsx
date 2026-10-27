// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CVRForecastImportWizard from './CVRForecastImportWizard';

const preview = vi.fn(); const apply = vi.fn();
vi.mock('../api/cvrPeriods', () => ({ previewCvrForecastOnboarding: (...args) => preview(...args), applyCvrForecastOnboarding: (...args) => apply(...args) }));
vi.mock('../cvr/forecastOnboardingImport', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, parseForecastFile: vi.fn(async () => ({ fileName: 'Matt CVR.xlsx', sourceFingerprint: 'b'.repeat(64), worksheet: 'CVR Reconciliation', worksheets: [{ name: 'CVR Reconciliation', rows: [['Cost Code', '', '', '', '', 'EFC'], ['1000', '', '', '', '', 1234.56]], displayRows: [['Cost Code', '', '', '', '', 'EFC'], ['1000', '', '', '', '', '£1,235']], headerRowIndex: 0, headers: ['Cost Code', '', '', '', '', 'EFC'], fieldByColumn: ['costCode', 'ignore', 'ignore', 'ignore', 'ignore', 'targetEfc'] }] })) };
});

describe('CVRForecastImportWizard', () => {
  let host; let root;
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    preview.mockReset().mockResolvedValue({ preview: { fingerprint: 'a'.repeat(64), sourceEvidence: { fileName: 'Matt CVR.xlsx', worksheet: 'CVR Reconciliation', sha256: 'b'.repeat(64), targetEfcColumn: 'F', targetEfcHeading: 'EFC' }, excludedRows: [], excludedMonetaryTotal: 0, canApply: true, exceptions: [], rows: [{ costCodeKey: '1000', description: 'Land', currentEfc: 1000, targetEfc: 1234.56, requiredAdjustment: 234.56, movement: 234.56, currentAdjustment: 0, replacesExistingAdjustment: false }], totals: { currentEfc: 1000, targetEfc: 1234.56, requiredAdjustment: 234.56, movement: 234.56 } } });
    apply.mockReset().mockResolvedValue({ result: { importedCount: 1, reconciled: true, totals: { targetEfc: 1234.56, movement: 234.56 } } });
  });
  afterEach(() => { if (root) act(() => root.unmount()); host?.remove(); });
  it('requires governed preview, reason and explicit confirmation before applying', async () => {
    await act(async () => root.render(<CVRForecastImportWizard development={{ id: 'dev-1' }} period={{ id: 'period-1', periodKey: 'P01' }} onCancel={() => {}} />));
    const input = host.querySelector('input[type="file"]');
    await act(async () => { Object.defineProperty(input, 'files', { value: [new File(['x'], 'Matt CVR.xlsx')] }); input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); });
    const button = label => [...host.querySelectorAll('button')].find(item => item.textContent.includes(label));
    await act(async () => { button('Preview differences').click(); await Promise.resolve(); });
    expect(preview).toHaveBeenCalledWith('dev-1', 'period-1', { rows: [{ costCodeKey: '1000', targetEfc: 1234.56, rowNumber: 2, importedValue: '£1,235' }], excludedRows: [], sourceEvidence: { fileName: 'Matt CVR.xlsx', worksheet: 'CVR Reconciliation', sha256: 'b'.repeat(64), targetEfcColumn: 'F', targetEfcHeading: 'EFC' } });
    expect(button('Apply Forecast').disabled).toBe(true);
    await act(async () => { const textarea = host.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, 'Reviewed October forecast'); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => host.querySelector('input[type="checkbox"]').click());
    expect(button('Apply Forecast').disabled).toBe(false);
    await act(async () => { button('Apply Forecast').click(); await Promise.resolve(); });
    expect(apply).toHaveBeenCalledWith('dev-1', 'period-1', expect.objectContaining({ previewFingerprint: 'a'.repeat(64), reason: 'Reviewed October forecast', confirmed: true }));
    expect(host.textContent).toContain('Forecast onboarding reconciled successfully.');
  });
});
