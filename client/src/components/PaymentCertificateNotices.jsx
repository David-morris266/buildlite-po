import {useEffect,useRef,useState} from 'react';
import {proposeIntendedPayment,confirmIntendedPayment,createPayLessNotice,createPaymentNotice,getPaymentAuthority,issuePaymentNotice,preparePaymentNotice,updatePaymentNotice} from '../api/paymentNotices';

const pounds=value=>value==null?'Not set':new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',minimumFractionDigits:2}).format(value);
const proposalSaved='Intended payment proposed. Authorised confirmation is still required.';
const confirmationSaved='Intended payment confirmed. Pay Less readiness has been refreshed.';
const date=value=>{if(typeof value!=='string')return 'Not captured';const exact=/^\d{4}-\d{2}-\d{2}$/.test(value),parsed=new Date(exact?`${value}T12:00:00Z`:value);return Number.isNaN(parsed.valueOf())?'Not captured':new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:exact?'UTC':'Europe/London'}).format(parsed);};
function deadlineText(label,value){return `${label}: ${date(value)}`;}

function NoticeReadiness({value}){
  if(!value)return <p role="alert">Server notice readiness is unavailable. Refresh before acting.</p>;
  const terms=value.terms||{},name=[terms.familyName,terms.versionLabel,terms.revisionNumber?`Revision ${terms.revisionNumber}`:null].filter(Boolean).join(' · ');
  const deadlineLabel=item=>!item?.date?'Not captured':`${date(item.date)} — ${item.state==='overdue'?'configured date passed':item.state==='today'?'today':'upcoming'}`;
  return <section aria-label="Notice readiness">
    <p><strong>{terms.evidenceState==='not_captured'?'Governing terms not captured':terms.frozen?'Frozen governing terms':'Provisional governing terms'}:</strong> {name||'Unavailable'}{terms.frozen?` (${terms.evidenceState} snapshot)`:null}</p>
    <p>Notice mode: {String(value.configuration?.mode||'not configured').replaceAll('_',' ')}</p>
    <p>Server date: {date(value.asOfDate)} (Europe/London)</p>
    <dl className="po-cert-notices__facts">
      <div><dt>Payment Notice deadline</dt><dd>{deadlineLabel(value.paymentNotice?.deadline)}</dd></div>
      <div><dt>Pay Less Notice deadline</dt><dd>{deadlineLabel(value.payLess?.deadline)}</dd></div>
      <div><dt>Final-payment deadline</dt><dd>{deadlineLabel(value.finalPayment)}</dd></div>
      <div><dt>Payment Notice record</dt><dd>{value.paymentNotice?.state||'missing'}</dd></div>
      <div><dt>Pay Less Notice record</dt><dd>{value.payLess?.state||'missing'}</dd></div>
    </dl>
    <p>{value.serviceMessage}</p>
    <p>Company-configurable pre-approval notified-sum authorisation and service-recording authority are not configured. No pre-approval issue or service-recording action is enabled.</p>
    {value.warnings?.length?<ul aria-label="Notice readiness warnings">{value.warnings.map((warning,index)=><li key={`${warning.code}-${index}`}>{warning.message}</li>)}</ul>:null}
    <ul aria-label="Required notice permissions">{Object.entries(value.permissions||{}).filter(([,item])=>!item.granted).map(([action,item])=><li key={action}>Permission required: <code>{item.permission}</code></li>)}</ul>
  </section>;
}

export default function PaymentCertificateNotices({certificate,packageId,refreshKey}){
  const [workspace,setWorkspace]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [amount,setAmount]=useState(''),[basis,setBasis]=useState(''),[payLessBasis,setPayLessBasis]=useState('');
  const request=useRef(0);
  const identity=`${packageId}/${certificate?.id}`,currentIdentity=useRef(identity);currentIdentity.current=identity;
  useEffect(()=>{setBusy(false);},[identity]);
  async function load(){if(!packageId||!certificate?.id||currentIdentity.current!==identity)return;const sequence=++request.current;let value;try{value=await getPaymentAuthority(packageId,certificate.id);}catch(error){if(sequence===request.current&&currentIdentity.current===identity){setWorkspace(previous=>previous?{...previous,readiness:null}:previous);throw error;}return;}if(sequence!==request.current||currentIdentity.current!==identity)return;setWorkspace(value);const pn=value.notices?.find(n=>n.type==='payment_notice'&&!['superseded','voided'].includes(n.status)),pl=value.notices?.find(n=>n.type==='pay_less_notice'&&!['superseded','voided'].includes(n.status));if(pn?.draft?.notifiedSum!=null)setAmount(String(pn.draft.notifiedSum));setPayLessBasis(pl?.draft?.basisConfirmed===true?pl.draft.basisOfCalculation||'':'');}
  useEffect(()=>{setWorkspace(null);setMessage('');load().catch(e=>setMessage(e.message));return()=>{request.current++;};},[packageId,certificate?.id,certificate?.version,certificate?.status,certificate?.contractualValuationDate,refreshKey]);
  async function act(fn,successMessage='Authority updated.'){setBusy(true);setMessage('');try{await fn();await load();if(currentIdentity.current===identity)setMessage(successMessage);}catch(e){if(currentIdentity.current===identity)setMessage(e.message);}finally{if(currentIdentity.current===identity)setBusy(false);}}
  async function refreshReadiness(){setBusy(true);setMessage('');try{await load();}catch(error){if(currentIdentity.current===identity)setMessage(error.message);}finally{if(currentIdentity.current===identity)setBusy(false);}}
  if(!workspace)return <section className="po-module-card"><h3>Payment notice</h3><p>{message||'Loading payment authority…'}</p></section>;
  const config=workspace.noticeConfiguration||{},payment=workspace.notices?.find(n=>n.type==='payment_notice'&&!['superseded','voided'].includes(n.status)),payLess=workspace.notices?.find(n=>n.type==='pay_less_notice'&&!['superseded','voided'].includes(n.status)),payLessAuthority=workspace.payLess||{state:'configuration_unavailable',deadline:null},frozenPayment=payment?.issuedSnapshot||payment?.preparedSnapshot||null,frozenIssuedPayLess=payLess?.status==='issued'?payLess.issuedSnapshot:null;
  const locked=certificate.status==='locked';
  const displayConfig=workspace.readiness?.configuration||config;
  const can=action=>locked&&workspace.readiness?.permissions?.[action]?.allowed===true;
  const latestDecision=workspace.decisions?.[0]||null;
  return <section className="po-module-card po-cert-notices" aria-labelledby="payment-notice-heading">
    <div className="po-cert-notices__heading"><div><h3 id="payment-notice-heading">Payment notice</h3><p>{displayConfig.state==='ready'?`Configured mode: ${String(displayConfig.mode).replaceAll('_',' ')}`:displayConfig.reasons?.[0]||'Notice configuration unavailable'}</p></div>{payment?<span className="admin-chip">{payment.status}</span>:null}</div>
    <NoticeReadiness value={workspace.readiness}/>
    <button type="button" disabled={busy} onClick={refreshReadiness}>{busy?'Refreshing notice readiness…':'Refresh notice readiness'}</button>
    {!locked?<p>Readiness only before approval. Notice creation and issue still require the existing Locked certificate authority.</p>:config.state!=='ready'?<p>No Payment Notice authority is inferred from timetable dates.</p>:config.mode==='certificate_only'?<p>Certificate-only mode is configured. BuildLite does not assert that this certificate is a Payment Notice.</p>:<>
      {!payment&&locked?<button disabled={busy||!can('preparePaymentNotice')} onClick={()=>act(()=>createPaymentNotice(packageId,certificate.id,{}))}>Prepare Payment Notice</button>:null}
      {payment?.status==='draft'?<div className="po-cert-notices__form"><label>Explicit notified sum<input className="input" type="number" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label><label>Basis of calculation<textarea className="input" value={basis} onChange={e=>setBasis(e.target.value)}/></label><button disabled={busy||!can('preparePaymentNotice')} onClick={()=>act(async()=>{await updatePaymentNotice(payment.id,{version:payment.version,notifiedSum:Number(amount),notifiedSumConfirmed:true,basisOfCalculation:basis});await preparePaymentNotice(payment.id);})}>Confirm &amp; Prepare</button></div>:null}
      {payment?.status==='prepared'?<button disabled={busy||!can('issuePaymentNotice')} onClick={()=>act(()=>issuePaymentNotice(payment.id))}>Issue Payment Notice</button>:null}
      {frozenPayment?<dl className="po-cert-notices__facts"><div><dt>Notified sum</dt><dd>{pounds(frozenPayment.notifiedSum)}</dd></div><div><dt>Basis of calculation</dt><dd>{frozenPayment.basisOfCalculation||'Not captured'}</dd></div><div><dt>Assessed net basis</dt><dd>{pounds(frozenPayment.assessedNet)}</dd></div><div><dt>Reference</dt><dd>{payment.reference}</dd></div></dl>:null}
    </>}
    <div className="po-cert-notices__payless"><h4>Intended payment &amp; Pay Less review</h4><p>{String(payLessAuthority.state||'configuration_unavailable').replaceAll('_',' ')}</p><p>{deadlineText('Pay Less deadline',payLessAuthority.deadline)}</p>
      {payment?.status==='issued'?<div className="po-cert-notices__form">
        <label>Intended payment<input className="input" type="number" step="0.01" disabled={!can('proposeIntendedPayment')&&!can('confirmIntendedPayment')} defaultValue={latestDecision?.intendedAmount??payLessAuthority.intendedPayment??payment.issuedSnapshot.notifiedSum}/></label>
        {can('proposeIntendedPayment')?<button disabled={busy} onClick={e=>{const input=e.currentTarget.parentElement.querySelector('input');act(()=>proposeIntendedPayment(packageId,certificate.id,{intendedAmount:Number(input.value),source:'manual'}),proposalSaved);}}>Propose Intended Payment</button>:null}
        {can('confirmIntendedPayment')?<button disabled={busy} onClick={e=>{const input=e.currentTarget.parentElement.querySelector('input');act(()=>confirmIntendedPayment(packageId,certificate.id,{intendedAmount:Number(input.value),source:'manual'}),confirmationSaved);}}>Confirm Intended Payment</button>:null}
        {!can('proposeIntendedPayment')&&!can('confirmIntendedPayment')?<p>You do not have authority to propose or confirm intended payment with the current notice readiness.</p>:null}
        {latestDecision?<p>Latest intended-payment decision: {latestDecision.state==='confirmed'?'Confirmed':'Proposed'} — {pounds(latestDecision.intendedAmount)}</p>:null}
        <p>A proposal does not confirm or authorise the intended payment. Only a confirmed decision is used for Pay Less readiness.</p>
      </div>:null}
      {payLessAuthority.state==='review_required'&&!payLess?<button disabled={busy||!can('preparePayLess')} onClick={()=>act(()=>createPayLessNotice(packageId,certificate.id,{}))}>Prepare Pay Less Notice</button>:null}
      {payLess&&['draft','prepared'].includes(payLess.status)&&payLess.draft?.basisConfirmed!==true?<div className="po-cert-notices__form"><p>Notified {pounds(payLessAuthority.notifiedSum)} · Intended {pounds(payLessAuthority.intendedPayment)} · Reduction {pounds(payLessAuthority.reduction)}</p><label>Pay Less basis of calculation<textarea className="input" value={payLessBasis} onChange={e=>setPayLessBasis(e.target.value)}/></label><button disabled={busy||!can('preparePayLess')||!payLessBasis.trim()} onClick={()=>act(async()=>{await updatePaymentNotice(payLess.id,{version:payLess.version,basisOfCalculation:payLessBasis});await preparePaymentNotice(payLess.id);})}>Confirm Basis &amp; Prepare</button></div>:null}
      {payLess?.status==='prepared'&&payLess.draft?.basisConfirmed===true?<><dl className="po-cert-notices__facts"><div><dt>Notified sum</dt><dd>{pounds(payLess.preparedSnapshot?.notifiedSum)}</dd></div><div><dt>Intended payment</dt><dd>{pounds(payLess.preparedSnapshot?.intendedPayment)}</dd></div><div><dt>Reduction</dt><dd>{pounds(payLess.preparedSnapshot?.reduction)}</dd></div><div><dt>Basis of calculation</dt><dd>{payLess.preparedSnapshot?.basisOfCalculation||'Not captured'}</dd></div></dl><button disabled={busy||!can('issuePayLess')} onClick={()=>act(()=>issuePaymentNotice(payLess.id))}>Issue Pay Less Notice</button></>:null}
      {frozenIssuedPayLess?<dl className="po-cert-notices__facts"><div><dt>Status</dt><dd>Issued</dd></div><div><dt>Reference</dt><dd>{frozenIssuedPayLess.reference||payLess.reference}</dd></div><div><dt>Notified sum</dt><dd>{pounds(frozenIssuedPayLess.notifiedSum)}</dd></div><div><dt>Intended payment</dt><dd>{pounds(frozenIssuedPayLess.intendedPayment)}</dd></div><div><dt>Reduction</dt><dd>{pounds(frozenIssuedPayLess.reduction)}</dd></div><div><dt>Basis of calculation</dt><dd>{frozenIssuedPayLess.basisOfCalculation||'Not captured'}</dd></div><div><dt>Pay Less deadline</dt><dd>{date(frozenIssuedPayLess.payLessDeadline)}</dd></div></dl>:null}
      {payLessAuthority.notifiedSum!=null?<p>Notified {pounds(payLessAuthority.notifiedSum)} · Intended {pounds(payLessAuthority.intendedPayment)} · Reduction {pounds(payLessAuthority.reduction)}</p>:null}
    </div>{message?<p role={message==='Authority updated.'||message===proposalSaved||message===confirmationSaved?'status':'alert'}>{message}</p>:null}
  </section>;
}
