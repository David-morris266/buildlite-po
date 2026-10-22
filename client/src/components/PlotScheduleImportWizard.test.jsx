// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import * as XLSX from 'xlsx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/developments', () => import('../test/mockDevelopmentApi'));

import { resetDevelopmentApiStore } from '../test/mockDevelopmentApi';
import PlotScheduleImportWizard from './PlotScheduleImportWizard';
import {
  __resetDevelopmentsStoreForTests,
  createDevelopment,
  getDevelopment,
} from '../developments/developmentStore';
import { bulkUpdatePlots } from '../developments/plotMaster';

function button(host, label) {
  return [...host.querySelectorAll('button')].find((item) => item.textContent.trim() === label);
}

describe('Plot Schedule update wizard persistence', () => {
  let host;
  let root;

  beforeEach(() => {
    localStorage.clear();
    resetDevelopmentApiStore();
    __resetDevelopmentsStoreForTests();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('previews and atomically applies a real spreadsheet while preserving IDs and commercial fields', async () => {
    const existingPlots = Array.from({ length: 75 }, (_, index) => ({
      id: `stable-${index + 1}`,
      plotNumber: String(index + 1),
      houseType: index === 0 ? 'Wrong Type' : `Type ${index % 5}`,
      bedrooms: 3,
      gia: 850 + index,
      niaFt2: index === 0 ? 800 : null,
      tenure: 'Open Market',
      tenureCode: 'OPEN_MARKET',
      sellingPrice: 325000,
      forecastSellingPrice: 300000,
      revenueStatus: 'Exchanged',
      revenueSource: 'Manual Value',
      manualForecastValue: 300000,
    }));
    const development = await createDevelopment({
      jobNumber: 'WIZARD-75',
      developmentName: 'Wizard Update',
      plotMaster: { plots: existingPlots },
    });
    const rows = [
      ['Plot', 'House Type', 'Beds', 'Ft2'],
      ...existingPlots.map((plot, index) => [
        plot.plotNumber,
        index === 0 ? 'Correct Type' : plot.houseType,
        plot.bedrooms,
        index === 0 ? 1172 : plot.gia,
      ]),
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Plot Master');
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const file = new File([bytes], 'welford-correction.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const onImport = vi.fn(async (result) => bulkUpdatePlots(
      development.id,
      result.updatePreview.updates,
      { expectedVersion: result.reviewedDevelopmentVersion }
    ));

    await act(async () => root.render(
      <PlotScheduleImportWizard
        developmentName={development.developmentName}
        importMode="update"
        existingPlots={existingPlots}
        developmentVersion={development.version}
        onCancel={() => {}}
        onImport={onImport}
      />
    ));
    const input = host.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    for (let step = 0; step < 2; step += 1) {
      await act(async () => button(host, 'Continue').click());
    }

    expect(host.textContent).toContain('75');
    expect(host.textContent).toContain('Correct Type');
    expect(host.textContent).toContain('Stored NIA differs from GIA and is preserved');
    await act(async () => {
      button(host, 'Apply Reviewed Plot Updates').click();
      await Promise.resolve();
    });

    expect(onImport).toHaveBeenCalledOnce();
    const persisted = getDevelopment(development.id).plotMaster.plots;
    expect(persisted).toHaveLength(75);
    expect(persisted[0]).toMatchObject({
      id: 'stable-1', houseType: 'Correct Type', gia: 1172, niaFt2: 800,
      sellingPrice: 325000, manualForecastValue: 300000, revenueStatus: 'Exchanged',
    });
  });

  it('fails closed before preview when the Development version is unavailable', async () => {
    const existingPlots = [{ id: 'stable-1', plotNumber: '1', houseType: 'Ash', gia: 900 }];
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['Plot', 'House Type', 'Ft2'],
      ['1', 'Oak', 950],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Plot Master');
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const file = new File([bytes], 'missing-version.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const onImport = vi.fn();
    await act(async () => root.render(
      <PlotScheduleImportWizard
        developmentName="Missing Version"
        importMode="update"
        existingPlots={existingPlots}
        developmentVersion={null}
        onCancel={() => {}}
        onImport={onImport}
      />
    ));
    const input = host.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await act(async () => button(host, 'Continue').click());
    await act(async () => button(host, 'Continue').click());
    expect(host.textContent).toContain('Development version is unavailable');
    expect(host.textContent).toContain('Map your columns');
    expect(onImport).not.toHaveBeenCalled();
  });
});
