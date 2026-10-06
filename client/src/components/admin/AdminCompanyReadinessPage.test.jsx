/* @vitest-environment jsdom */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let principal;
vi.mock('../../auth/BuildLiteAuthProvider', () => ({ useBuildLitePrincipal: () => principal }));
import AdminCompanyReadinessPage from './AdminCompanyReadinessPage';

describe('modern Company Readiness', () => {
  let container;
  let root;
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it('shows provisioned identity and truthful empty-tenant actions without legacy requirements', () => {
    principal = { activeTenant: { name: 'Willow Homes UAT Ltd' }, tenantReadiness: { tenant: { name: 'Willow Homes UAT Ltd' }, companySettingsReady: true, commerciallyReady: false, developmentExists: false, counts: {} } };
    const onOpen = vi.fn(); const onOpenDevelopments = vi.fn();
    act(() => root.render(<AdminCompanyReadinessPage onOpen={onOpen} onOpenDevelopments={onOpenDevelopments} />));
    expect(container.textContent).toContain('Willow Homes UAT Ltd');
    expect(container.textContent).toContain('No demonstration chart is installed');
    expect(container.textContent).not.toContain('Forecast Behaviour');
    expect(container.textContent).not.toContain('First Supplier');
    expect(container.textContent).not.toContain('Approval Defaults');
    const click = (label) => act(() => [...container.querySelectorAll('button')].find(button => button.textContent === label).click());
    click('Open Company Settings'); expect(onOpen).toHaveBeenLastCalledWith('company');
    click('Set up / Review Commercial Structure'); expect(onOpen).toHaveBeenLastCalledWith('commercial-structure');
    click('Import Cost Codes'); expect(onOpen).toHaveBeenLastCalledWith('cost-code-import');
    click('Review Cost Code hierarchy'); expect(onOpen).toHaveBeenLastCalledWith('cost-code-hierarchy');
    click('Create Development'); expect(onOpenDevelopments).toHaveBeenCalledOnce();
  });

  it('presents allocated and Not Applicable as reviewed while attention blocks readiness', () => {
    principal = { tenantReadiness: { tenant: { name: 'Tenant' }, companySettingsReady: true, hierarchyReviewComplete: false, headCategoriesReviewed: true, commerciallyReady: false, developmentExists: true, counts: { activeCostCodes: 4, allocatedCostCodes: 2, notApplicableCostCodes: 1, notReviewedCostCodes: 0, needsAttentionCostCodes: 1, activeHeads: 2, categorizedHeads: 2, developments: 1 } } };
    act(() => root.render(<AdminCompanyReadinessPage onOpen={() => {}} onOpenDevelopments={() => {}} />));
    expect(container.textContent).toContain('2 Allocated · 1 Not Applicable · 0 Not Reviewed · 1 Needs Attention');
    expect(container.textContent).toContain('Action required');
  });

  it('requests one tenant-scoped readiness refresh without reloading the principal', async () => {
    const refreshPrincipal = vi.fn();
    const refreshTenantReadiness = vi.fn().mockResolvedValue({});
    principal = { activeTenant: { clientId: 'willow', name: 'Willow Homes UAT Ltd' }, refreshPrincipal, refreshTenantReadiness, readinessFreshness:{state:'fresh',clientId:'willow'}, tenantReadiness: { tenant: { name: 'Willow Homes UAT Ltd' }, counts: { activeCostCodes: 29, allocatedCostCodes: 5, notReviewedCostCodes: 24, needsAttentionCostCodes: 0, activeHeads: 9 } } };
    await act(async () => { root.render(<AdminCompanyReadinessPage onOpen={() => {}} onOpenDevelopments={() => {}} />); await Promise.resolve(); });
    expect(refreshTenantReadiness).not.toHaveBeenCalled();
    expect(refreshPrincipal).not.toHaveBeenCalled();
    expect(container.textContent).toContain('5 Allocated');
    expect(container.textContent).toContain('24 Not Reviewed');
    await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent.includes('Refresh readiness')).click(); await Promise.resolve(); });
    expect(refreshTenantReadiness).toHaveBeenCalledOnce();
  });

  it('keeps existing readiness visible and offers retry when refresh fails', async () => {
    const refreshTenantReadiness = vi.fn().mockRejectedValue(new Error('Readiness service unavailable.'));
    principal = { activeTenant: { clientId: 'willow', name: 'Willow Homes UAT Ltd' }, refreshTenantReadiness, readinessFreshness:{state:'fresh',clientId:'willow'}, tenantReadiness: { tenant: { name: 'Willow Homes UAT Ltd' }, counts: { activeCostCodes: 29, allocatedCostCodes: 5, notReviewedCostCodes: 24, activeHeads: 9 } } };
    await act(async () => { root.render(<AdminCompanyReadinessPage onOpen={() => {}} onOpenDevelopments={() => {}} />); await Promise.resolve(); await Promise.resolve(); });
    expect(refreshTenantReadiness).not.toHaveBeenCalled();
    await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent.includes('Refresh readiness')).click(); await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toContain('Readiness service unavailable.');
    expect(container.textContent).toContain('Existing readiness remains visible');
    expect(container.textContent).toContain('29');
    expect(refreshTenantReadiness).toHaveBeenCalledOnce();
  });

  it('does not present stale readiness as authoritative zero but preserves genuine fresh zero', async () => {
    const refreshTenantReadiness = vi.fn(() => new Promise(() => {}));
    principal = { activeTenant:{clientId:'willow',name:'Willow'},refreshTenantReadiness,readinessFreshness:{state:'stale',clientId:'willow'},tenantReadiness:{tenant:{name:'Willow'},counts:{activeCostCodes:0,activeHeads:0}} };
    await act(async()=>{root.render(<AdminCompanyReadinessPage onOpen={()=>{}} onOpenDevelopments={()=>{}}/>);await Promise.resolve();});
    expect(container.textContent).toContain('Loading current company readiness');
    expect(container.textContent).not.toContain('None imported');
    expect(container.textContent).not.toContain('Active Cost Codes0');
    act(()=>root.unmount());root=createRoot(container);
    principal={...principal,readinessFreshness:{state:'fresh',clientId:'willow'}};
    act(()=>root.render(<AdminCompanyReadinessPage onOpen={()=>{}} onOpenDevelopments={()=>{}}/>));
    expect(container.textContent).toContain('None imported');
    expect(container.textContent).toContain('Active Cost Codes0');
  });

  it('does not reuse readiness freshness from another tenant', async () => {
    const refreshTenantReadiness = vi.fn(() => new Promise(() => {}));
    principal = {
      activeTenant: { clientId: 'willow', name: 'Willow' },
      refreshTenantReadiness,
      readinessFreshness: { state: 'fresh', clientId: 'hawthorn', hasAuthoritativeData: true },
      tenantReadiness: { tenant: { name: 'Hawthorn' }, counts: { activeCostCodes: 210, activeHeads: 9 } },
    };
    await act(async () => { root.render(<AdminCompanyReadinessPage onOpen={() => {}} onOpenDevelopments={() => {}} />); await Promise.resolve(); });
    expect(refreshTenantReadiness).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Loading current company readiness');
    expect(container.textContent).not.toContain('Hawthorn');
    expect(container.textContent).not.toContain('Active Cost Codes210');
  });
});
