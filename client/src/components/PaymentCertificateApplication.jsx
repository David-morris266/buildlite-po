import { useEffect, useMemo, useState } from 'react';
import { createPaymentApplication, listPaymentApplications, revisePaymentApplication } from '../api/paymentApplications';
import { APPLICATION_BASES, comparePaymentApplication } from '../payments/paymentApplicationComparison';
import PaymentApplicationVariations from './PaymentApplicationVariations';

const labels = {
  [APPLICATION_BASES.currentPeriodGross]: 'Current-period gross',
  [APPLICATION_BASES.cumulativeLessPreviousApplication]: 'Cumulative less previous application',
  [APPLICATION_BASES.cumulativeLessPreviousCertified]: 'Cumulative less previous certified',
  [APPLICATION_BASES.netOnly]: 'Net only / insufficiently structured',
};
const pounds = (value) => value == null ? 'Not supplied' : new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(value);
const today = () => new Date().toISOString().slice(0,10);
const initial = { applicationReference:'',receivedAt:today(),applicationBasis:APPLICATION_BASES.currentPeriodGross,currentPeriodGrossClaimed:'',cumulativeGrossClaimed:'',previousApplicationStated:'',previousCertifiedStated:'',retentionStated:'',contraDeductionsStated:'',vatStated:'',netRequestedStated:'',notes:'' };

export default function PaymentCertificateApplication({ packageId, certificate, assessmentGross, editable, onChanged }) {
  const certificateStatus = String(certificate?.status || '').toLowerCase();
  const frozen = certificateStatus === 'locked'
    ? certificate?.lockedApplicationSnapshot || null
    : certificateStatus === 'submitted'
      ? certificate?.submissionApplicationSnapshot || null
      : null;
  const [application,setApplication]=useState(frozen?.application || null);
  const [form,setForm]=useState(initial);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [advanced,setAdvanced]=useState(false);

  useEffect(()=>{
    if (frozen?.application) { setApplication(frozen.application); return; }
    if (!packageId || !certificate?.id) return;
    listPaymentApplications(packageId,certificate.id).then((items)=>setApplication(items.find((item)=>item.status==='recorded')||null)).catch((err)=>setError(err.message));
  },[packageId,certificate?.id,certificate?.version,frozen?.application?.id]);

  useEffect(()=>{ if(application && editable) setForm({...initial,...application,receivedAt:String(application.receivedAt||'').slice(0,10)}); },[application?.id,editable]);
  const comparison=useMemo(()=>frozen?.comparison || comparePaymentApplication(application,assessmentGross),[frozen,application,assessmentGross]);
  const field=(key)=>(event)=>setForm((value)=>({...value,[key]:event.target.value}));
  const moneyField=(key,label)=><label><span>{label}</span><input className="input" type="number" step="0.01" value={form[key]??''} onChange={field(key)} /></label>;
  const save=async()=>{ setBusy(true);setError('');try{const body={...form,certificateId:certificate.id,actor:localStorage.getItem('userName')||localStorage.getItem('userEmail')||null};const saved=application?await revisePaymentApplication(packageId,application.id,body):await createPaymentApplication(packageId,body);setApplication(saved);onChanged?.();}catch(err){setError(err.message);}finally{setBusy(false);}};

  return <section className="po-module-card po-cert-application">
    <div className="po-cert-application__heading"><div><h3>Subcontractor Application</h3><p>Record what the subcontractor applied for. BuildLite assessment remains separate.</p></div><span className="po-status-badge po-status-badge--pending">Notice readiness not yet configured</span></div>
    {editable ? <div className="po-cert-application__form">
      <label><span>Application Ref</span><input className="input" value={form.applicationReference} onChange={field('applicationReference')} /></label>
      <label><span>Received Date</span><input className="input" type="date" value={form.receivedAt} onChange={field('receivedAt')} /></label>
      <label><span>Application Format / Basis</span><select className="input" value={form.applicationBasis} onChange={field('applicationBasis')}>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      {form.applicationBasis===APPLICATION_BASES.currentPeriodGross?moneyField('currentPeriodGrossClaimed','Current-period gross'):null}
      {form.applicationBasis===APPLICATION_BASES.cumulativeLessPreviousApplication?<>{moneyField('cumulativeGrossClaimed','Cumulative gross')}{moneyField('previousApplicationStated','Previous application')}</>:null}
      {form.applicationBasis===APPLICATION_BASES.cumulativeLessPreviousCertified?<>{moneyField('cumulativeGrossClaimed','Cumulative gross')}{moneyField('previousCertifiedStated','Previous certified')}</>:null}
      {form.applicationBasis===APPLICATION_BASES.netOnly?moneyField('netRequestedStated','Net requested'):null}
      <button type="button" className="po-list-btn-secondary" disabled={busy} onClick={save}>{application?'Record revised application':'Record application'}</button>
    </div>:null}
    {error?<div className="po-list-feedback po-list-feedback--error" role="alert">{error}</div>:null}
    {application?<>
      <dl className="po-cert-application__source-meta"><div><dt>Application Ref</dt><dd>{application.applicationReference}</dd></div><div><dt>Received</dt><dd>{String(application.receivedAt||'').slice(0,10)||'—'}</dd></div><div><dt>Basis</dt><dd>{labels[application.applicationBasis]||application.applicationBasis}</dd></div><div><dt>Revision</dt><dd>{application.revisionNumber||1}</dd></div></dl>
      <dl className="po-cert-application__comparison">
        <div><dt>Application</dt><dd>{comparison.comparable?pounds(comparison.applicationCurrentGross):'Not comparable'}</dd></div>
        <div><dt>BuildLite Assessment</dt><dd>{pounds(comparison.assessmentCurrentGross)}</dd></div>
        <div><dt>Difference</dt><dd>{comparison.comparable?pounds(comparison.difference):'Not comparable'}</dd></div>
        <div><dt>Comparison basis</dt><dd>{comparison.comparisonBasis||comparison.reason}</dd></div>
      </dl>
      {comparison.comparable && comparison.difference!==0?<p className="po-cert-application__variance">Assessment differs from application.</p>:null}
      <button type="button" className="po-cert-workspace__link" onClick={()=>setAdvanced((value)=>!value)}>{advanced?'Hide source breakdown':'Show source breakdown'}</button>
      {advanced?<dl className="po-cert-application__breakdown"><div><dt>Gross claimed</dt><dd>{pounds(application.currentPeriodGrossClaimed??application.cumulativeGrossClaimed)}</dd></div><div><dt>Retention stated</dt><dd>{pounds(application.retentionStated)}</dd></div><div><dt>Contra / deductions</dt><dd>{pounds(application.contraDeductionsStated)}</dd></div><div><dt>VAT stated</dt><dd>{pounds(application.vatStated)}</dd></div><div><dt>Net requested</dt><dd>{pounds(application.netRequestedStated)}</dd></div></dl>:null}
      <PaymentApplicationVariations packageId={packageId} application={application} editable={editable} onChanged={onChanged}/>
    </>:<p>No subcontractor application recorded.</p>}
  </section>;
}
