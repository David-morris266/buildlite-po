// @vitest-environment jsdom
import React from 'react';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import AdminSubcontractTermsPage from './AdminSubcontractTermsPage';
import {listSubcontractTerms,setTenantSubcontractTermsDefault} from '../../api/subcontractTerms';

vi.mock('../../api/subcontractTerms',()=>({
  listSubcontractTerms:vi.fn(),createSubcontractTerms:vi.fn(),updateSubcontractTermsDraft:vi.fn(),
  publishSubcontractTerms:vi.fn(),cloneSubcontractTerms:vi.fn(),retireSubcontractTerms:vi.fn(),
  setTenantSubcontractTermsDefault:vi.fn(),
}));
const version=(id,label,status='published',isCompanyDefault=false)=>({id,revision_number:id==='v1'?1:2,version_label:label,status,isCompanyDefault,payment_rules:{configurationState:'incomplete'},source_document:{},record_version:1,rules_schema_version:1});
async function render(){const host=document.createElement('div');document.body.append(host);const root=createRoot(host);await act(async()=>{root.render(<AdminSubcontractTermsPage onBack={()=>{}}/>);});return {host,root};}

describe('Admin subcontract terms default state',()=>{
  beforeEach(()=>{vi.clearAllMocks();document.body.innerHTML='';});
  it('shows the authoritative default badge and suppresses its Set action',async()=>{
    vi.mocked(listSubcontractTerms).mockResolvedValue({defaultVersionId:'v1',families:[{id:'f1',name:'Standard Subcontract Terms',versions:[version('v1','Standard 2026', 'published', true),version('v2','Standard 2027')]}]});
    const {host}=await render();expect(host.textContent).toContain('Company default');
    const articles=[...host.querySelectorAll('.admin-terms-version')];
    expect(articles[0].textContent).toContain('Revision 1');
    expect(articles[0].textContent).toContain('published');
    expect(articles[0].textContent).not.toContain('Set company default');expect(articles[1].textContent).toContain('Set company default');
  });
  it('changes default then reloads and reconciles from server authority',async()=>{
    vi.mocked(listSubcontractTerms)
      .mockResolvedValueOnce({defaultVersionId:'v1',families:[{id:'f1',name:'Terms',versions:[version('v1','2026', 'published', true),version('v2','2027')]}]})
      .mockResolvedValueOnce({defaultVersionId:'v2',families:[{id:'f1',name:'Terms',versions:[version('v1','2026'),version('v2','2027','published',true)]}]});
    vi.mocked(setTenantSubcontractTermsDefault).mockResolvedValue({ok:true});const {host}=await render();
    const button=[...host.querySelectorAll('button')].find(item=>item.textContent==='Set company default');
    await act(async()=>{button.click();});expect(setTenantSubcontractTermsDefault).toHaveBeenCalledWith('v2');expect(listSubcontractTerms).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('Company default updated.');const articles=[...host.querySelectorAll('.admin-terms-version')];expect(articles[1].textContent).toContain('Company default');expect(articles[1].textContent).not.toContain('Set company default');
  });
  it('keeps structured rules and checksum behind a closed Advanced disclosure',async()=>{
    vi.mocked(listSubcontractTerms).mockResolvedValue({defaultVersionId:null,families:[{id:'f1',name:'Terms',versions:[version('v1','Draft 1','draft')]}]});
    const {host}=await render();expect(host.textContent).toContain('Payment rules');expect(host.textContent).toContain('Not yet configured');
    const details=host.querySelector('details.admin-terms-advanced');expect(details.open).toBe(false);expect(details.querySelector('textarea')).not.toBeNull();expect(details.textContent).toContain('SHA-256 checksum');
  });
});
