// @vitest-environment jsdom
import React from 'react';import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';import {act} from 'react';import {createRoot} from 'react-dom/client';
import PaymentCertificateNotices from './PaymentCertificateNotices';
vi.mock('../api/paymentNotices',()=>({getPaymentAuthority:vi.fn(),createPaymentNotice:vi.fn(),updatePaymentNotice:vi.fn(),preparePaymentNotice:vi.fn(),issuePaymentNotice:vi.fn(),confirmIntendedPayment:vi.fn(),proposeIntendedPayment:vi.fn(),createPayLessNotice:vi.fn()}));
import {getPaymentAuthority,createPaymentNotice,issuePaymentNotice,proposeIntendedPayment,confirmIntendedPayment} from '../api/paymentNotices';
describe('Payment Certificate notice authority',()=>{let host,root;beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);});afterEach(()=>{act(()=>root.unmount());host.remove();vi.clearAllMocks();});async function render(value,props={}){getPaymentAuthority.mockResolvedValue(value);await act(async()=>root.render(<PaymentCertificateNotices certificate={{id:'c1',status:'locked'}} packageId="p1" {...props}/>));await act(async()=>{});}
it('states V1 is timetable-only without fabricating notice authority',async()=>{await render({noticeConfiguration:{state:'configuration_unavailable',reasons:['Payment Rules V1 is timetable-capable but has no Payment Notice configuration.']},notices:[],payLess:{state:'configuration_unavailable'}});expect(host.textContent).toContain('Payment Rules V1');expect(host.textContent).not.toContain('Notified sum£');});
it('distinguishes notified sum, intended payment and factual Pay Less review',async()=>{await render({noticeConfiguration:{state:'ready',mode:'separate_payment_notice'},notices:[{id:'n1',type:'payment_notice',status:'issued',reference:'PN-1',issuedSnapshot:{notifiedSum:1000,assessedNet:900,basisOfCalculation:'Assessment'}}],payLess:{state:'review_required',notifiedSum:1000,intendedPayment:800,reduction:200,deadline:'2026-09-29'}});expect(host.textContent).toContain('Notified £1,000.00');expect(host.textContent).toContain('Intended £800.00');expect(host.textContent).toContain('Reduction £200.00');expect(host.textContent).toContain('Prepare Pay Less Notice');});
it('shows frozen Prepared notified sum and basis before Payment Notice Issue',async()=>{await render({noticeConfiguration:{state:'ready',mode:'certificate_as_payment_notice'},notices:[{id:'n1',type:'payment_notice',status:'prepared',reference:'PN-1',preparedSnapshot:{notifiedSum:1140,assessedNet:1140,basisOfCalculation:'Payment Certificate No. 1 assessment'}}],payLess:{state:'no_intended_payment',notifiedSum:1140,intendedPayment:null,reduction:null,deadline:'2026-09-29'}});expect(host.textContent).toContain('£1,140.00');expect(host.textContent).toContain('Payment Certificate No. 1 assessment');expect(host.textContent).toContain('Issue Payment Notice');});
it('blocks Pay Less Issue and requests human basis when a legacy Prepared attempt lacks confirmation provenance',async()=>{await render({noticeConfiguration:{state:'ready',mode:'certificate_as_payment_notice'},notices:[{id:'pn',type:'payment_notice',status:'issued',reference:'PN-1',issuedSnapshot:{notifiedSum:1140,assessedNet:1140,basisOfCalculation:'Assessment'}},{id:'pl',type:'pay_less_notice',status:'prepared',version:2,reference:'PLN-1',draft:{basisOfCalculation:'Payment decision below notified sum'},preparedSnapshot:{notifiedSum:1140,intendedPayment:900,reduction:240,basisOfCalculation:'Payment decision below notified sum'}}],payLess:{state:'draft_prepared',notifiedSum:1140,intendedPayment:900,reduction:240,deadline:'2026-09-29'}});expect(host.textContent).toContain('Pay Less basis of calculation');expect(host.textContent).toContain('Confirm Basis & Prepare');expect(host.textContent).not.toContain('Issue Pay Less Notice');});
it('shows frozen Pay Less basis and Issue only after explicit confirmation',async()=>{await render({noticeConfiguration:{state:'ready',mode:'certificate_as_payment_notice'},notices:[{id:'pn',type:'payment_notice',status:'issued',reference:'PN-1',issuedSnapshot:{notifiedSum:1140,assessedNet:1140,basisOfCalculation:'Assessment'}},{id:'pl',type:'pay_less_notice',status:'prepared',version:5,reference:'PLN-1',draft:{basisOfCalculation:'£240 reduction agreed following QS review',basisConfirmed:true},preparedSnapshot:{notifiedSum:1140,intendedPayment:900,reduction:240,basisOfCalculation:'£240 reduction agreed following QS review'}}],payLess:{state:'draft_prepared',notifiedSum:1140,intendedPayment:900,reduction:240,deadline:'2026-09-29'}});expect(host.textContent).toContain('£240 reduction agreed following QS review');expect(host.textContent).toContain('Issue Pay Less Notice');});
it('renders Issued Pay Less review from its frozen Issued snapshot',async()=>{await render({noticeConfiguration:{state:'ready',mode:'certificate_as_payment_notice'},notices:[{id:'pn',type:'payment_notice',status:'issued',reference:'PN-1',issuedSnapshot:{notifiedSum:1140,assessedNet:1140,basisOfCalculation:'Assessment'}},{id:'pl',type:'pay_less_notice',status:'issued',version:5,reference:'PLN-1',draft:{basisOfCalculation:'mutable text'},issuedSnapshot:{reference:'PLN-1',notifiedSum:1140,intendedPayment:900,reduction:240,basisOfCalculation:'£240 withheld pending resolution of outstanding defects',payLessDeadline:'2026-09-29'}}],payLess:{state:'issued',notifiedSum:999,intendedPayment:999,reduction:0,deadline:'2026-10-01'}});expect(host.textContent).toContain('StatusIssued');expect(host.textContent).toContain('ReferencePLN-1');expect(host.textContent).toContain('Notified sum£1,140.00');expect(host.textContent).toContain('Intended payment£900.00');expect(host.textContent).toContain('Reduction£240.00');expect(host.textContent).toContain('£240 withheld pending resolution of outstanding defects');expect(host.textContent).toContain('29 Sept 2026');expect(host.textContent).not.toContain('Issue Pay Less Notice');});
it('renders the real PostgreSQL DATE response shape without crashing',async()=>{await render({noticeConfiguration:{state:'ready',mode:'certificate_as_payment_notice',reasons:[]},notices:[],decisions:[],payLess:{state:'no_notified_sum',notifiedSum:null,intendedPayment:null,reduction:null,deadline:'2026-09-28T23:00:00.000Z'}});expect(host.textContent).toContain('Prepare Payment Notice');expect(host.textContent).toContain('29 Sept 2026');});
it('fails closed when Pay Less authority is absent',async()=>{await render({noticeConfiguration:{state:'configuration_unavailable',reasons:['Notice configuration unavailable']},notices:[]});expect(host.textContent).toContain('configuration unavailable');expect(host.textContent).toContain('Pay Less deadline: Not captured');});
const readiness=()=>({asOfDate:'2026-11-10',clockSource:'server',terms:{familyName:'Frozen Company Terms',revisionNumber:2,evidenceState:'locked',frozen:true},configuration:{state:'ready',mode:'separate_payment_notice'},paymentNotice:{state:'missing',deadline:{date:'2026-11-13',state:'upcoming'}},payLess:{state:'missing',deadline:{date:'2026-11-29',state:'upcoming'}},finalPayment:{date:'2026-12-06',state:'upcoming'},permissions:{preparePaymentNotice:{permission:'payment_notice.prepare',granted:true,allowed:true},issuePaymentNotice:{permission:'payment_notice.issue',granted:false,allowed:false}},warnings:[],serviceMessage:'Service is unverified. Internal notice Issue and document Issue do not prove dispatch, delivery or service.'});
const workspace=()=>({readiness:readiness(),noticeConfiguration:{state:'ready',mode:'separate_payment_notice'},notices:[],payLess:{state:'no_notified_sum',deadline:'2026-11-29'}});
it('uses server deadline classification and all three deadlines without sending a browser as-of date',async()=>{
  await render(workspace(),{asOfDate:'1900-01-01'});
  expect(getPaymentAuthority).toHaveBeenCalledWith('p1','c1');
  expect(host.textContent).toContain('Frozen governing terms');expect(host.textContent).toContain('Frozen Company Terms');expect(host.textContent).toContain('Revision 2');
  expect(host.textContent).toContain('10 Nov 2026');expect(host.textContent).toContain('13 Nov 2026');expect(host.textContent).toContain('29 Nov 2026');expect(host.textContent).toContain('6 Dec 2026');expect(host.textContent).toContain('upcoming');
});
it('shows pre-approval warnings without enabling a notice write',async()=>{
  const w=workspace();w.readiness.terms.evidenceState='submission';w.readiness.permissions.preparePaymentNotice.allowed=false;w.readiness.warnings=[{code:'pre_approval',message:'Notice deadline is overdue. Escalate before internal approval.'}];
  await render(w,{certificate:{id:'c1',status:'submitted'}});
  expect(host.textContent).toContain('Notice deadline is overdue');expect(host.textContent).toContain('Readiness only before approval');
  expect(host.textContent).not.toContain('Prepare Payment Notice');expect(createPaymentNotice).not.toHaveBeenCalled();
});
it('shows issued and prepared record states with service unverified and permission-specific disabled issue',async()=>{
  const w=workspace();w.readiness.paymentNotice.state='prepared';w.notices=[{id:'pn',type:'payment_notice',status:'prepared',preparedSnapshot:{notifiedSum:5890,basisOfCalculation:'Locked assessment'}}];
  await render(w);const issue=[...host.querySelectorAll('button')].find(b=>b.textContent==='Issue Payment Notice');expect(issue.disabled).toBe(true);expect(host.textContent).toContain('payment_notice.issue');
  await act(async()=>issue.click());expect(issuePaymentNotice).not.toHaveBeenCalled();
  w.readiness.paymentNotice.state='issued';w.notices[0]={...w.notices[0],status:'issued',issuedSnapshot:w.notices[0].preparedSnapshot};await render(w);
  expect(host.textContent).toContain('Service is unverified');expect(host.textContent).toContain('document Issue do not prove dispatch');
});
it('permits the same authenticated user with both existing grants without hard-coded QS-to-manager workflow',async()=>{
  const w=workspace();w.readiness.permissions.issuePaymentNotice={permission:'payment_notice.issue',granted:true,allowed:true};w.notices=[{id:'pn',type:'payment_notice',status:'prepared',preparedSnapshot:{notifiedSum:5890}}];await render(w);
  const issue=[...host.querySelectorAll('button')].find(b=>b.textContent==='Issue Payment Notice');expect(issue.disabled).toBe(false);
});
it('fails closed when readiness permissions are absent',async()=>{
  const w=workspace();delete w.readiness;await render(w);expect(host.textContent).toContain('Server notice readiness is unavailable');expect([...host.querySelectorAll('button')].find(b=>b.textContent==='Prepare Payment Notice').disabled).toBe(true);
});
it('refreshes readiness with GET only and discards delayed state from the previous certificate',async()=>{
  let resolveOld;getPaymentAuthority.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;}));
  await act(async()=>root.render(<PaymentCertificateNotices certificate={{id:'old',status:'draft'}} packageId="p1"/>));
  const w=workspace();w.readiness.terms.familyName='Current company evidence';getPaymentAuthority.mockResolvedValue(w);
  await act(async()=>root.render(<PaymentCertificateNotices certificate={{id:'new',status:'locked'}} packageId="p1"/>));
  await act(async()=>resolveOld({...workspace(),readiness:{...readiness(),terms:{familyName:'Obsolete evidence'}}}));
  expect(host.textContent).toContain('Current company evidence');expect(host.textContent).not.toContain('Obsolete evidence');
  await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Refresh notice readiness').click());
  expect(createPaymentNotice).not.toHaveBeenCalled();expect(issuePaymentNotice).not.toHaveBeenCalled();
});

it('refreshes deadline evidence after an application or certificate source refresh',async()=>{
  const w=workspace();await render(w,{refreshKey:1});const initial=getPaymentAuthority.mock.calls.length;
  w.readiness.terms.familyName='Refreshed terms evidence';getPaymentAuthority.mockResolvedValue(w);
  await act(async()=>root.render(<PaymentCertificateNotices certificate={{id:'c1',status:'locked'}} packageId="p1" refreshKey={2}/>));
  expect(getPaymentAuthority.mock.calls.length).toBe(initial+1);expect(host.textContent).toContain('Refreshed terms evidence');
});

it('disables actions when refreshing server readiness fails and never replays writes',async()=>{
  await render(workspace());getPaymentAuthority.mockRejectedValueOnce(new Error('Readiness unavailable'));
  await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Refresh notice readiness').click());
  expect(host.textContent).toContain('Server notice readiness is unavailable');expect(host.textContent).toContain('Readiness unavailable');
  expect([...host.querySelectorAll('button')].find(b=>b.textContent==='Prepare Payment Notice').disabled).toBe(true);expect(createPaymentNotice).not.toHaveBeenCalled();
});

it('allows the propose-only QS action and keeps authorised confirmation separate',async()=>{
  const w=workspace();w.notices=[{id:'pn',type:'payment_notice',status:'issued',issuedSnapshot:{notifiedSum:5890}}];
  w.readiness.permissions.proposeIntendedPayment={permission:'intended_payment.propose',granted:true,allowed:true};
  await render(w);const proposal=[...host.querySelectorAll('button')].find(b=>b.textContent==='Propose Intended Payment');
  expect(proposal.disabled).toBe(false);expect(host.textContent).not.toContain('Confirm Intended Payment');
  await act(async()=>proposal.click());
  expect(proposeIntendedPayment).toHaveBeenCalledWith('p1','c1',{intendedAmount:5890,source:'manual'});expect(confirmIntendedPayment).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Authorised confirmation is still required.');
});
it('lets a confirm-only user confirm the latest proposal without proposing',async()=>{
  const w=workspace();w.notices=[{id:'pn',type:'payment_notice',status:'issued',issuedSnapshot:{notifiedSum:5890}}];
  w.decisions=[{id:'proposal-2',version:2,state:'proposed',intendedAmount:5000},{id:'confirmed-1',version:1,state:'confirmed',intendedAmount:5890}];
  w.readiness.permissions.proposeIntendedPayment={permission:'intended_payment.propose',granted:false,allowed:false};
  w.readiness.permissions.confirmIntendedPayment={permission:'intended_payment.confirm',granted:true,allowed:true};
  await render(w);expect(host.textContent).not.toContain('Propose Intended Payment');
  const input=host.querySelector('.po-cert-notices__form input');expect(input.value).toBe('5000');
  const confirm=[...host.querySelectorAll('button')].find(b=>b.textContent==='Confirm Intended Payment');expect(confirm.disabled).toBe(false);
  await act(async()=>confirm.click());expect(proposeIntendedPayment).not.toHaveBeenCalled();expect(confirmIntendedPayment).toHaveBeenCalledWith('p1','c1',{intendedAmount:5000,source:'manual'});
  expect(host.textContent).toContain('Intended payment confirmed.');
});
it('provides one shared amount input and one of each action to a user with both permissions',async()=>{
  const w=workspace();w.notices=[{id:'pn',type:'payment_notice',status:'issued',issuedSnapshot:{notifiedSum:5890}}];
  for(const action of ['proposeIntendedPayment','confirmIntendedPayment'])w.readiness.permissions[action]={granted:true,allowed:true};
  await render(w);expect(host.querySelectorAll('.po-cert-notices__form input')).toHaveLength(1);
  for(const name of ['Propose Intended Payment','Confirm Intended Payment'])expect([...host.querySelectorAll('button')].filter(b=>b.textContent===name)).toHaveLength(1);
});
it('provides no intended-payment write action when neither permission is granted',async()=>{
  const w=workspace();w.notices=[{id:'pn',type:'payment_notice',status:'issued',issuedSnapshot:{notifiedSum:5890}}];await render(w);
  expect(host.textContent).not.toContain('Propose Intended Payment');expect(host.textContent).not.toContain('Confirm Intended Payment');expect(host.querySelector('.po-cert-notices__form input').disabled).toBe(true);
  expect(proposeIntendedPayment).not.toHaveBeenCalled();expect(confirmIntendedPayment).not.toHaveBeenCalled();
});
it('a proposal alone does not enable Pay Less, while confirmation refresh exposes existing preparation',async()=>{
  let decision=null;
  const w=workspace();w.notices=[{id:'pn',type:'payment_notice',status:'issued',issuedSnapshot:{notifiedSum:5890}}];
  for(const action of ['proposeIntendedPayment','confirmIntendedPayment','preparePayLess'])w.readiness.permissions[action]={granted:true,allowed:true};
  const current=()=>({...w,decisions:decision?[decision]:[],payLess:{state:decision?.state==='confirmed'?'review_required':'no_intended_payment',notifiedSum:5890,intendedPayment:decision?.state==='confirmed'?5000:null,reduction:decision?.state==='confirmed'?890:null,deadline:'2026-11-29'}});
  await render(current());getPaymentAuthority.mockImplementation(async()=>current());
  proposeIntendedPayment.mockImplementationOnce(async()=>{decision={id:'proposal',state:'proposed',intendedAmount:5000};});
  confirmIntendedPayment.mockImplementationOnce(async()=>{decision={id:'confirmation',state:'confirmed',intendedAmount:5000};});
  host.querySelector('.po-cert-notices__form input').value='5000';
  await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Propose Intended Payment').click());
  expect(host.textContent).toContain('Latest intended-payment decision: Proposed');expect(host.textContent).not.toContain('Prepare Pay Less Notice');
  await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Confirm Intended Payment').click());
  expect(host.textContent).toContain('Latest intended-payment decision: Confirmed');
  const prepare=[...host.querySelectorAll('button')].find(b=>b.textContent==='Prepare Pay Less Notice');expect(prepare.disabled).toBe(false);
});
});
