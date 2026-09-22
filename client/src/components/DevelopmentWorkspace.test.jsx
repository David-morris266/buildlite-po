/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listPOs = vi.hoisted(() => vi.fn());
const ensurePackagesReadyForDevelopment = vi.hoisted(() => vi.fn());
const ensureCommercialEventsReadyForDevelopment = vi.hoisted(() => vi.fn());
const getCommercialEventsLoadState = vi.hoisted(() => vi.fn());
const getCommercialEventsLoadError = vi.hoisted(() => vi.fn());
const ensureMatricesReadyForDevelopment = vi.hoisted(() => vi.fn());
const getOrderMatricesLoadState = vi.hoisted(() => vi.fn());
const getOrderMatricesLoadError = vi.hoisted(() => vi.fn());
const buildDevelopmentWorkspaceModel = vi.hoisted(() => vi.fn());
const getDevelopmentBudget = vi.hoisted(() => vi.fn());
const listServerCostCodes = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  listPOs,
}));

vi.mock('../payments/packageStore', () => ({
  ensurePackagesReadyForDevelopment,
}));

vi.mock('../commercialEvents/commercialEventServerCache', () => ({
  ensureCommercialEventsReadyForDevelopment,
  getCommercialEventsLoadState,
  getCommercialEventsLoadError,
}));

vi.mock('../payments/orderMatrixServerCache', () => ({
  ensureMatricesReadyForDevelopment,
  getOrderMatricesLoadState,
  getOrderMatricesLoadError,
}));

vi.mock('../developments/developmentHelpers', () => ({
  buildDevelopmentWorkspaceModel,
}));

vi.mock('../api/developmentBudget', () => ({
  getDevelopmentBudget,
  postDevelopmentBudgetEvent: vi.fn(),
}));

vi.mock('../api/costCodes', () => ({
  listServerCostCodes,
}));

vi.mock('../auth/BuildLiteAuthProvider', () => ({
  useBuildLitePermission: () => true,
}));

vi.mock('../commercialAssistant/CommercialAssistantContext', () => ({
  useCommercialAssistantScope: vi.fn(),
}));

vi.mock('./DevelopmentOverview', () => ({
  default: ({ onOpenPackage, onResolveReadiness, onStartFirstCvr }) => (
    <div>
      <span>Overview panel</span>
      <button type="button" onClick={() => onResolveReadiness?.({ tab: 'budget' })}>Resolve Budget</button>
      <button type="button" onClick={onStartFirstCvr}>Start first CVR</button>
      <button
        type="button"
        onClick={() =>
          onOpenPackage?.('order-key-1', {
            orderKey: 'order-key-1',
            openedFrom: 'DevelopmentPackages',
            initialTab: 'overview',
          })
        }
      >
        Open package
      </button>
    </div>
  ),
  DevelopmentPackagesTab: () => <div>Packages panel</div>,
  SummaryDashboard: () => null,
}));

vi.mock('./PlotMaster', () => ({ default: () => <div>Plot Master panel</div> }));
vi.mock('./DevelopmentCommercialEvents', () => ({
  default: () => <div>Commercial Events panel</div>,
}));
vi.mock('./PurchaseLedger', () => ({ default: () => <div>Ledger panel</div> }));
vi.mock('./RevenueWorkspace', () => ({
  default: () => <div data-testid="revenue-panel">Revenue panel</div>,
}));
vi.mock('./DevelopmentSellingCostsWorkspace', () => ({
  default: () => <div data-testid="selling-costs-panel">Selling Costs panel</div>,
}));
vi.mock('./DevelopmentPrelimsWorkspace', () => ({
  default: () => <div data-testid="prelims-panel">Prelims panel</div>,
}));
vi.mock('./CVRRegister', () => ({ default: ({ onOpenPeriod }) => <div data-testid="cvr-panel">CVR panel<button onClick={() => onOpenPeriod?.('P04')}>Open P04</button></div> }));
vi.mock('./CVRSummaryPage', () => ({ default: () => null }));
vi.mock('./CVRWorkspace', () => ({ default: () => null }));
vi.mock('./SubcontractPackageWorkspace', () => ({
  default: () => <div data-testid="package-workspace">Package workspace</div>,
}));
vi.mock('./PackageWorkspaceNotFound', () => ({
  default: () => <div>Package unavailable</div>,
}));
vi.mock('./layout/ApplicationPageHeader', () => ({
  default: ({ onBack }) => <button type="button" onClick={onBack}>Header back</button>,
}));

import DevelopmentWorkspace from './DevelopmentWorkspace';
import { UnsavedChangesProvider } from '../navigation/UnsavedChangesProvider.jsx';
import { useUnsavedChanges } from '../navigation/UnsavedChangesContext.js';

function DirtyRegistration({ dirty }) {
  const { registerUnsavedChanges } = useUnsavedChanges();
  React.useEffect(() => {
    if (!dirty) return undefined;
    return registerUnsavedChanges({ title: 'Unsaved Prelims setup', message: 'Leave?' });
  }, [dirty, registerUnsavedChanges]);
  return null;
}

const sampleDevelopment = {
  id: 'dev-1',
  developmentName: 'Test Site 1',
  jobNumber: 'TS1',
  status: 'live',
  version: 1,
};

const sampleModel = {
  id: 'dev-1',
  developmentName: 'Test Site 1',
  jobNumber: 'TS1',
  statusMeta: { label: 'Live', modifier: 'live' },
  summaryCards: [],
  packages: [
    {
      orderKey: 'order-key-1',
      packageId: 'package-1',
      developmentId: 'dev-1',
      supplierId: 'supplier-1',
      costCode: '3640',
      supplierLabel: 'Sparktastic',
      projectLabel: 'Drylining',
    },
  ],
};

describe('DevelopmentWorkspace stability guards', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    listPOs.mockResolvedValue({ items: [] });
    ensurePackagesReadyForDevelopment.mockResolvedValue(sampleModel.packages);
    ensureCommercialEventsReadyForDevelopment.mockResolvedValue([]);
    getCommercialEventsLoadState.mockReturnValue('loaded');
    getCommercialEventsLoadError.mockReturnValue(null);
    ensureMatricesReadyForDevelopment.mockResolvedValue([]);
    getOrderMatricesLoadState.mockReturnValue('loaded');
    getOrderMatricesLoadError.mockReturnValue(null);
    buildDevelopmentWorkspaceModel.mockReturnValue(sampleModel);
    getDevelopmentBudget.mockResolvedValue({
      exists: true,
      totalOriginalBudget: 100,
      totalCurrentBudget: 110,
      perCostCode: [],
      events: [
        { id: 'open', eventType: 'opening_budget', effectiveDate: '2026-09-09', reference: 'OPEN', reason: 'Approved baseline', lines: [{ costCode: '4120', description: 'Brickwork', signedAmount: 100 }] },
        { id: 'add', eventType: 'addition', effectiveDate: '2026-09-09', reference: 'ADD-1', reason: 'Allowance', lines: [{ costCode: '4120', description: 'Brickwork', signedAmount: 10 }] },
        { id: 'omit', eventType: 'omission', effectiveDate: '2026-09-09', reference: 'OMIT-1', reason: 'Saving', lines: [{ costCode: '4130', description: 'Carpentry', signedAmount: -5 }] },
      ],
    });
    listServerCostCodes.mockResolvedValue({ costCodes: [] });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  function renderWorkspace(props = {}, { dirty = false } = {}) {
    act(() => {
      root.render(
        <UnsavedChangesProvider>
          <DirtyRegistration dirty={dirty} />
          <DevelopmentWorkspace
            development={sampleDevelopment}
            onBackToList={vi.fn()}
            {...props}
          />
        </UnsavedChangesProvider>
      );
    });
  }

  function clickTab(label) {
    const tab = Array.from(document.querySelectorAll('.po-package-tabs__tab')).find(
      (button) => button.textContent === label
    );
    act(() => {
      tab?.click();
    });
  }

  it('shows a visible defensive state when the workspace model is missing', () => {
    buildDevelopmentWorkspaceModel.mockReturnValue(null);

    renderWorkspace();

    expect(document.body.textContent).toContain(
      'Development workspace data is unavailable'
    );
    expect(document.body.textContent).toContain('Back to Developments');
  });

  it('switches to Revenue when selecting the Revenue tab from the workspace shell', async () => {
    renderWorkspace();

    await act(async () => {
      await Promise.resolve();
    });

    clickTab('Revenue');

    expect(container.querySelector('.dev-workspace-shell')).not.toBeNull();
    expect(document.querySelector('[data-testid="revenue-panel"]')).not.toBeNull();
  });

  it('switches to Selling Costs when selecting the Selling Costs tab', async () => {
    const onNavigationStateChange = vi.fn();
    renderWorkspace({ onNavigationStateChange });

    await act(async () => {
      await Promise.resolve();
    });

    clickTab('Selling Costs');

    expect(document.querySelector('[data-testid="selling-costs-panel"]')).not.toBeNull();
    expect(onNavigationStateChange).toHaveBeenCalledWith({ workspaceTab: 'selling-costs' });
  });

  it('restores package workspace identity and reports CVR period navigation', async () => {
    const onNavigationStateChange = vi.fn();
    renderWorkspace({
      initialActiveTab: 'packages',
      initialPackageKey: 'order-key-1',
      initialPackageTab: 'variations',
      onNavigationStateChange,
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(document.querySelector('[data-testid="package-workspace"]')).not.toBeNull();

    renderWorkspace({ onNavigationStateChange });
    await act(async () => { await Promise.resolve(); });
    clickTab('CVR');
    act(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'Open P04').click());
    expect(onNavigationStateChange).toHaveBeenCalledWith({ workspaceTab: 'cvr', periodKey: 'P04' });
  });

  it('guards Development tab navigation while Prelims setup is dirty', async () => {
    renderWorkspace({}, { dirty: true });
    await act(async () => { await Promise.resolve(); });
    clickTab('Prelims');
    expect(document.querySelector('[data-testid="prelims-panel"]')).toBeNull();
    expect(document.body.textContent).toContain('Unsaved Prelims setup');
    act(() => Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Stay').click());
    expect(document.body.textContent).toContain('Overview panel');
    clickTab('Prelims');
    act(() => Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Leave without saving').click());
    expect(document.querySelector('[data-testid="prelims-panel"]')).not.toBeNull();
  });

  it('guards Back to Developments while Prelims setup is dirty', async () => {
    const onBackToList = vi.fn();
    renderWorkspace({ onBackToList }, { dirty: true });
    await act(async () => { await Promise.resolve(); });
    act(() => Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Header back').click());
    expect(onBackToList).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Unsaved Prelims setup');
    act(() => Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Leave without saving').click());
    expect(onBackToList).toHaveBeenCalledTimes(1);
  });

  it('opens the Development Budget from the development workspace tabs', async () => {
    renderWorkspace();
    await act(async () => { await Promise.resolve(); });
    clickTab('Budget');
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(document.body.textContent).toContain('Development Budget');
    expect(document.body.textContent).toContain('ADD-1');
    expect(document.body.textContent).toContain('OMIT-1');
    expect(getDevelopmentBudget).toHaveBeenCalledWith('dev-1');
  });

  it('uses existing Development tabs for Budget resolution and first-CVR handoff', async () => {
    renderWorkspace();
    await act(async () => { await Promise.resolve(); });
    act(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'Resolve Budget').click());
    expect(document.body.textContent).toContain('Development Budget');
    clickTab('Overview');
    act(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'Start first CVR').click());
    expect(document.querySelector('[data-testid="cvr-panel"]')).not.toBeNull();
  });
});
