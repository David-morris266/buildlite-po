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
vi.mock('./AdminCostCodesPage', () => ({ default: ({ onBack }) => <div data-testid="cost-codes">Cost Codes<button onClick={onBack}>Back to Administration</button></div> }));

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
    expect(auth.refreshReadiness).toHaveBeenCalledTimes(1);
    expect(auth.refreshPrincipal).not.toHaveBeenCalled();

    const click = async label => act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === label).click(); await Promise.resolve(); });
    const openReadiness = async () => act(async () => { [...container.querySelectorAll('.admin-module-card')].find(card => card.textContent.includes('Company Readiness')).click(); await Promise.resolve(); });
    await click('Review Cost Code hierarchy');
    expect(container.querySelector('[data-testid="cost-codes"]')).toBeTruthy();
    await click('Back to Administration');
    expect(container.textContent).toContain('Administration');
    await openReadiness();
    expect(container.textContent).toContain('5 Allocated');
    expect(auth.refreshReadiness).toHaveBeenCalledTimes(2);

    await click('Review Cost Code hierarchy');
    await click('Back to Administration');
    await openReadiness();
    expect(container.textContent).toContain('5 Allocated');
    expect(auth.refreshReadiness).toHaveBeenCalledTimes(3);
    expect(auth.refreshPrincipal).not.toHaveBeenCalled();
  });
});
