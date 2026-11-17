// @vitest-environment jsdom
import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({certificate:null,resolution:null,prior:[]}));
vi.mock('./paymentCertificateStore',()=>({getCertificate:()=>state.certificate,isApprovedCommercialCertificate:c=>c.status==='locked',resolveCertificatesForPackage:()=>({ready:true,certificates:state.prior})}));
vi.mock('./orderMatrixStore',()=>({resolveOrderMatrixForPackage:()=>state.resolution}));
vi.mock('../commercialEvents/commercialEventPackageValue',()=>({buildPackageCommercialDisplayFields:()=>({currentPackageValue:50000})}));
vi.mock('../developments/plotMaster',()=>({getPlots:()=>[]}));
import {summarizeCertificateProgress} from './paymentCertificateProgress';
import {comparePaymentApplication} from './paymentApplicationComparison';
import {buildReconcileFacts} from '../components/PaymentCertificateReconcile';
const order={orderKey:'order',developmentId:'dev'};
beforeEach(()=>{
 state.prior=[];state.resolution={ready:true,matrix:null,loadState:'loaded',present:false};
 state.certificate={id:'cert',status:'draft',certificateNumber:1,progress:{},commercialLines:[],variationOnlyConfirmation:{orderedWorks:0,confirmedAt:'2026-11-17',confirmedBy:{userId:'qs'}},
   variationAssessments:[{id:'assessment',currentAssessment:6200}],
   totals:{matrixGrossThisCertificate:0,commercialEventGrossThisCertificate:6200,grossWorksThisCertificate:6200,retention:310,vat:1178,netPayment:7068,previousCertified:0,certifiedToDate:6200},
   sourceAuthority:{variationAssessmentGross:6200,unapprovedCertifiedGross:6200,evidence:{variationAssessments:[{signedAmount:6200,unapprovedAmount:6200}]}},
 };
});
it('uses persisted server totals and counts the overall 8500 application once',()=>{
 const summary=summarizeCertificateProgress('order','cert',order);
 const comparison=comparePaymentApplication({applicationBasis:'current_period_gross',currentPeriodGrossClaimed:8500},summary.totals.grossWorksThisCertificate);
 const facts=buildReconcileFacts({totals:summary.totals,sourceAuthority:summary.certificate.sourceAuthority,applicationComparison:comparison});
 expect(summary.variationOnly).toBe(true);expect(summary.matrix).toBeNull();expect(summary.totals.previousCertified).toBe(0);expect(summary.totals.certifiedToDate).toBe(6200);
 expect(facts.applicationGross).toBe(8500);expect(facts.orderedWorks).toBe(0);expect(facts.variationAssessments).toBe(6200);expect(facts.difference).toBe(-2300);
 expect(summary.certificate.sourceAuthority.unapprovedCertifiedGross).toBe(6200);
});
it.each(['loading','error'])('blocks %s matrix evidence even when cached totals exist',loadState=>{
 state.resolution={ready:false,matrix:null,loadState};const summary=summarizeCertificateProgress('order','cert',order);
 expect(summary.totals).toBeNull();expect(summary.matrixReady).toBe(false);
});
it('requires explicit confirmation and persisted totals, rejecting progress',()=>{
 state.certificate.variationOnlyConfirmation=null;expect(summarizeCertificateProgress('order','cert',order).totals).toBeNull();
 state.certificate.variationOnlyConfirmation={orderedWorks:0};state.certificate.progress={'plot::stage':0};expect(summarizeCertificateProgress('order','cert',order).totals).toBeNull();
 state.certificate.progress={};state.certificate.totals=null;expect(summarizeCertificateProgress('order','cert',order).totals).toBeNull();
});
it('requires removal of confirmation when a matrix appears',()=>{
 state.resolution.matrix={layout:'plot-stage',plots:[],stages:[]};const summary=summarizeCertificateProgress('order','cert',order);
 expect(summary.totals).toBeNull();expect(summary.valuationUnavailableReason).toContain('Remove');
});
it('uses authoritative previous certification even before older certificates are cached',()=>{
 state.certificate.totals.previousCertified=1000;state.certificate.totals.certifiedToDate=7200;
 const summary=summarizeCertificateProgress('order','cert',order);expect(summary.totals.previousCertified).toBe(1000);expect(summary.totals.certifiedToDate).toBe(7200);
});
it('renders frozen empty-cell snapshots without consulting later live matrix or assessment values',()=>{
 state.certificate={...state.certificate,status:'locked',grossValue:6200,netValue:7068,matrixGross:0,commercialEventGross:6200,valuationSnapshot:{valuationBasis:'variation_only',cells:[],totals:{...state.certificate.totals}}};
 state.resolution={ready:false,loadState:'error'};state.certificate.variationAssessments[0].currentAssessment=99999;
 const summary=summarizeCertificateProgress('order','cert',order);expect(summary.fromValuationSnapshot).toBe(true);expect(summary.totals.grossWorksThisCertificate).toBe(6200);expect(summary.totals.previousCertified).toBe(0);
});
