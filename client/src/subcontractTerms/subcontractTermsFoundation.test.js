import {beforeEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createSubcontractTerms,listSubcontractTerms,publishSubcontractTerms,setTenantSubcontractTermsDefault} from '../api/subcontractTerms';

describe('subcontract terms foundation',()=>{
  beforeEach(()=>{global.fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({families:[]})});});
  it('uses tenant-scoped server authority for list and lifecycle commands',async()=>{
    await listSubcontractTerms();await createSubcontractTerms({name:'Standard'});await publishSubcontractTerms('v1');await setTenantSubcontractTermsDefault('v1');
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/subcontract-terms\/$/);
    expect(fetch.mock.calls[1][1].method).toBe('POST');
    expect(fetch.mock.calls[2][0]).toMatch(/versions\/v1\/publish$/);
    expect(JSON.parse(fetch.mock.calls[3][1].body).termsVersionId).toBe('v1');
  });
  it('presents configured, unconfigured, legacy and mixed provenance distinctly',()=>{
    const po=readFileSync(new URL('../components/POReviewDrawerContent.jsx',import.meta.url),'utf8');
    const pkg=readFileSync(new URL('../components/SubcontractPackageOverview.jsx',import.meta.url),'utf8');
    expect(po).toContain('Legacy / not formally configured');
    expect(po).toContain('Contract terms: Not configured');
    expect(pkg).toContain('Mixed contract terms — payment-rule readiness unavailable');
  });
  it('does not introduce legal deadline or notice conclusions',()=>{
    const page=readFileSync(new URL('../components/admin/AdminSubcontractTermsPage.jsx',import.meta.url),'utf8');
    expect(page).not.toMatch(/due date|pay less|payment notice/i);
    expect(page).toContain('authoritative role security is a future slice');
  });
});
