/** @vitest-environment jsdom */
import React, { useState } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  refreshReadiness: vi.fn(async () => ({})),
  refreshPrincipal: vi.fn(async () => ({})),
}));

vi.mock('../../auth/BuildLiteAuthProvider', () => ({
  useBuildLitePrincipal: () => ({
    activeTenant: { clientId: 'willow', name: 'Willow Homes UAT Ltd' },
    permissions: ['commercial_structure.manage'],
    refreshTenantReadiness: auth.refreshReadiness,
    refreshPrincipal: auth.refreshPrincipal,
    tenantReadiness: {
      tenant: { name: 'Willow Homes UAT Ltd' },
      companySettingsReady: true,
      hierarchyReviewComplete: false,
      headCategoriesReviewed: true,
      commerciallyReady: false,
      developmentExists: false,
      counts: { activeCostCodes: 29, allocatedCostCodes: 5, notReviewedCostCodes: 24, needsAttentionCostCodes: 0, activeHeads: 9, categorizedHeads: 9, developments: 0 },
    },
  }),
}));
vi.mock('./AdminCostCodesPage', () => ({ default: ({ onBack, hierarchyOnly, onHierarchyExit }) => <div data-testid={hierarchyOnly ? 'cost-code-hierarchy' : 'cost-codes'}>{hierarchyOnly ? 'Cost Code Commercial Hierarchy' : 'Cost Codes'}<button onClick={hierarchyOnly ? onHierarchyExit : onBack}>{hierarchyOnly ? 'Back to Company Readiness' : 'Back to Administration'}</button></div> }));

import AdministrationModule from './AdministrationModule';

function Harness() {
  const [section, setSection] = useState('company-readiness');
  return <AdministrationModule initialView={section} onViewChange={setSection} onViewReplace={setSection} />;
}

describe('Company Readiness Administration round trip', () => {
  let container;
  let root;
  beforeEach(() => {
    auth.refreshReadiness.mockClear(); auth.refreshPrincipal.mockClear();
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it('returns promptly through repeated Readiness → Cost Codes → Readiness transitions in one mounted shell', async () => {
    await act(async () => { root.render(<Harness />); await Promise.resolve(); });
    expect(container.textContent).toContain('Company Readiness');
    expect(auth.refreshReadiness).not.toHaveBeenCalled();
    expect(auth.refreshPrincipal).not.toHaveBeenCalled();

    const click = async label => act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === label).click(); await Promise.resolve(); });
    await click('Review Cost Code hierarchy');
    expect(container.querySelector('[data-testid="cost-code-hierarchy"]')).toBeTruthy();
    await click('Back to Company Readiness');
    expect(container.textContent).toContain('5 Allocated');
    expect(auth.refreshReadiness).not.toHaveBeenCalled();

    await click('Review Cost Code hierarchy');
    await click('Back to Company Readiness');
    expect(container.textContent).toContain('5 Allocated');
    expect(auth.refreshReadiness).not.toHaveBeenCalled();
    expect(auth.refreshPrincipal).not.toHaveBeenCalled();
  });
});
