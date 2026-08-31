/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PaymentCertificateTimetable from './PaymentCertificateTimetable';
import { updateCertificateMetadataOnServer } from '../payments/paymentCertificateServerMutations';

vi.mock('../payments/paymentCertificateServerMutations', () => ({ updateCertificateMetadataOnServer: vi.fn() }));
const terms={familyName:'Standard Subcontract Terms',versionLabel:'Standard 2026',revisionNumber:3,paymentRules:{anchor:{type:'contractual_valuation_date'}}};
const ready={state:'live',readiness:'ready',governingTermsSnapshot:terms,resolvedAnchor:{type:'contractual_valuation_date',value:'2026-09-01'},dates:{dueDate:'2026-09-08',paymentNoticeDeadline:'2026-09-13',finalDateForPayment:'2026-10-06',payLessNoticeDeadline:'2026-09-29'},reasons:[]};

describe('PaymentCertificateTimetable',()=>{
  let host; let root;
  afterEach(()=>{act(()=>root?.unmount());host?.remove();vi.clearAllMocks();});
  function render(certificate,onChanged=vi.fn()){host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);act(()=>root.render(<PaymentCertificateTimetable certificate={certificate} orderKey="order" order={{orderKey:'order'}} onChanged={onChanged}/>));return{host,onChanged};}
  it('renders BST date-only facts without timezone drift and exposes Draft contractual-date editing',()=>{const {host}=render({id:'c1',status:'draft',contractualValuationDate:'2026-09-01',paymentTimetable:ready});expect(host.textContent).toContain('Live provisional timetable');for(const date of ['1 Sept 2026','8 Sept 2026','13 Sept 2026','6 Oct 2026','29 Sept 2026'])expect(host.textContent).toContain(date);expect(host.querySelector('input[type=date]').value).toBe('2026-09-01');});
  it('renders GMT date-only facts without timezone drift',()=>{const gmt={...ready,resolvedAnchor:{...ready.resolvedAnchor,value:'2026-12-01'},dates:{dueDate:'2026-12-08',paymentNoticeDeadline:'2026-12-13',finalDateForPayment:'2027-01-05',payLessNoticeDeadline:'2026-12-29'}};const {host}=render({id:'c-gmt',status:'draft',contractualValuationDate:'2026-12-01',paymentTimetable:gmt});for(const date of ['1 Dec 2026','8 Dec 2026','13 Dec 2026','5 Jan 2027','29 Dec 2026'])expect(host.textContent).toContain(date);});
  it('renders submitted and locked snapshots read-only',()=>{for(const [state,label] of [['submission','Submitted timetable snapshot'],['locked','Locked timetable snapshot']]){const currentHost=render({id:'c1',status:state==='locked'?'locked':'submitted',paymentTimetable:{...ready,state}}).host;expect(currentHost.textContent).toContain(label);expect(currentHost.querySelector('input')).toBeNull();act(()=>root.unmount());currentHost.remove();root=null;}});
  it('renders missing anchors and pre-feature history neutrally',()=>{let rendered=render({id:'c1',status:'draft',paymentTimetable:{...ready,readiness:'missing_anchor_date',dates:null,reasons:['Required contractual_valuation_date is unavailable.']}});expect(rendered.host.textContent).toContain('Payment deadlines unavailable');act(()=>root.unmount());rendered.host.remove();root=null;rendered=render({id:'c2',status:'locked',paymentTimetable:{state:'not_captured',readiness:'not_captured',reasons:['Payment timetable was not captured.']}});expect(rendered.host.textContent).toContain('Not captured');});
  it('saves through the authoritative mutation and refreshes',async()=>{updateCertificateMetadataOnServer.mockResolvedValue({ok:true});const {host,onChanged}=render({id:'c1',status:'draft',paymentTimetable:ready});const input=host.querySelector('input');await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'2026-09-01');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});await act(async()=>host.querySelector('button').click());expect(updateCertificateMetadataOnServer).toHaveBeenCalledWith('order','c1',{contractualValuationDate:'2026-09-01'},{orderKey:'order'});expect(onChanged).toHaveBeenCalled();});
});
