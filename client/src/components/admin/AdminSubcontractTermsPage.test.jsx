// @vitest-environment jsdom
import React from 'react';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import AdminSubcontractTermsPage from './AdminSubcontractTermsPage';
import {listSubcontractTerms,publishSubcontractTerms,setTenantSubcontractTermsDefault,updateSubcontractTermsDraft} from '../../api/subcontractTerms';

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
  it('uses a structured rules editor, plain-English preview, and read-only Advanced JSON',async()=>{
    vi.mocked(listSubcontractTerms).mockResolvedValue({defaultVersionId:null,families:[{id:'f1',name:'Terms',versions:[version('v1','Draft 1','draft')]}]});
    const {host}=await render();expect(host.textContent).toContain('Payment rules');expect(host.textContent).toContain('Configuration state');expect(host.textContent).toContain('Payment-cycle anchor');expect(host.textContent).toContain('Plain-English preview');expect(host.textContent).toContain('Due date: — calendar days after contractual valuation date');
    const details=host.querySelector('details.admin-terms-advanced');expect(details.open).toBe(false);expect(details.querySelector('textarea').readOnly).toBe(true);expect(details.textContent).toContain('Normal administration does not require JSON');expect(details.textContent).toContain('SHA-256 checksum');
  });
  it('saves the exact incomplete UAT rules, reloads authority, and confirms locally',async()=>{
    const exact={configurationState:'incomplete',ruleType:'uk_subcontract_payment_cycle',jurisdiction:'england_wales',timezone:'Europe/London',anchor:{type:'contractual_valuation_date'},dueDate:{relativeTo:'anchor',direction:'after',days:7,dayBasis:'calendar'},paymentNoticeDeadline:{relativeTo:'due_date',direction:'after',days:5,dayBasis:'calendar'},finalDateForPayment:{relativeTo:'due_date',direction:'after',days:28,dayBasis:'calendar'},payLessNoticeDeadline:{relativeTo:'final_date_for_payment',direction:'before',days:7,dayBasis:'calendar'}};
    const initial={...version('v3','Draft 3','draft'),payment_rules:exact};
    const refreshed={...initial,record_version:2,payment_rules:exact};
    vi.mocked(listSubcontractTerms).mockResolvedValueOnce({families:[{id:'f1',name:'Terms',versions:[initial]}]}).mockResolvedValueOnce({families:[{id:'f1',name:'Terms',versions:[refreshed]}]});
    vi.mocked(updateSubcontractTermsDraft).mockResolvedValue({id:'v3'});
    const {host}=await render();expect(host.textContent).toContain('Due date: 7 calendar days after contractual valuation date');
    await act(async()=>{host.querySelector('.admin-terms-save-row button').click();});
    expect(updateSubcontractTermsDraft).toHaveBeenCalledWith('v3',expect.objectContaining({recordVersion:1,rulesSchemaVersion:1,paymentRules:exact}));expect(listSubcontractTerms).toHaveBeenCalledTimes(2);expect(host.querySelector('[role="status"]').textContent).toContain('Draft saved.');
  });
  it('shows a save error beside the Draft action and does not claim success',async()=>{
    vi.mocked(listSubcontractTerms).mockResolvedValue({families:[{id:'f1',name:'Terms',versions:[version('v3','Draft 3','draft')]}]});vi.mocked(updateSubcontractTermsDraft).mockRejectedValue(new Error('Version conflict. Refresh and try again.'));
    const {host}=await render();await act(async()=>{host.querySelector('.admin-terms-save-row button').click();});expect(host.querySelector('[role="alert"]').textContent).toBe('Version conflict. Refresh and try again.');expect(listSubcontractTerms).toHaveBeenCalledTimes(1);
  });
  it('rejects an Incomplete publish visibly beside the unchanged Draft and clears busy state',async()=>{
    vi.mocked(listSubcontractTerms).mockResolvedValue({families:[{id:'f1',name:'Terms',versions:[version('v3','Draft 3','draft')]}]});vi.mocked(publishSubcontractTerms).mockRejectedValue(new Error('Payment rules must be Complete and valid.'));
    const {host}=await render();const publish=[...host.querySelectorAll('button')].find(button=>button.textContent==='Publish');await act(async()=>{publish.click();});expect(publishSubcontractTerms).toHaveBeenCalledWith('v3');expect(host.querySelector('.admin-terms-version [role="alert"]').textContent).toBe('Cannot publish — Payment rules must be Complete and valid.');expect(host.querySelector('.admin-terms-version').textContent).toContain('draft');expect(publish.disabled).toBe(false);expect(publish.textContent).toBe('Publish');expect(listSubcontractTerms).toHaveBeenCalledTimes(1);
  });
  it('shows Publishing while pending, then a valid Complete publish reloads authoritative state and confirms success',async()=>{
    const complete={...version('v3','Draft 3','draft'),payment_rules:{configurationState:'complete'}};const published={...complete,status:'published'};let resolvePublish;const pending=new Promise(resolve=>{resolvePublish=resolve;});
    vi.mocked(listSubcontractTerms).mockResolvedValueOnce({families:[{id:'f1',name:'Terms',versions:[complete]}]}).mockResolvedValueOnce({families:[{id:'f1',name:'Terms',versions:[published]}]});vi.mocked(publishSubcontractTerms).mockReturnValue(pending);
    const {host}=await render();const publish=[...host.querySelectorAll('button')].find(button=>button.textContent==='Publish');act(()=>{publish.click();});expect(publish.textContent).toBe('Publishing…');expect(publish.disabled).toBe(true);await act(async()=>{resolvePublish({id:'v3'});await pending;});expect(listSubcontractTerms).toHaveBeenCalledTimes(2);expect(host.querySelector('.admin-terms-version').textContent).toContain('published');expect(host.querySelector('.admin-terms-version [role="status"]').textContent).toBe('Revision published.');
  });
});
