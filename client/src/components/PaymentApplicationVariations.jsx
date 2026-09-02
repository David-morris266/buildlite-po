import {useEffect,useMemo,useState} from 'react';
import {useBuildLitePermission} from '../auth/BuildLiteAuthProvider';
import {addApplicationVariation,createVariationFromApplication,listApplicationVariations,listPackageVariationAccount,matchApplicationVariation,confirmApplicationContractorPosition} from '../api/paymentApplications';

const pounds=value=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(Number(value||0));
const blank={contractorReference:'',description:'',contractorValue:'',previousClaim:'',currentClaim:'',cumulativeClaim:''};

export default function PaymentApplicationVariations({packageId,application,editable,onChanged}){
  const canCreate=useBuildLitePermission('variation_account.create'),canForecast=useBuildLitePermission('variation_account.forecast_edit');
  const [lines,setLines]=useState([]),[items,setItems]=useState([]),[form,setForm]=useState(blank),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const load=async()=>{if(!application?.id)return;const [nextLines,nextItems]=await Promise.all([listApplicationVariations(packageId,application.id),listPackageVariationAccount(packageId)]);setLines(nextLines);setItems(nextItems);};
  useEffect(()=>{load().catch(e=>setError(e.message));},[packageId,application?.id,application?.revisionNumber]);
  const variationClaim=useMemo(()=>lines.reduce((sum,line)=>sum+Number(line.currentClaim||0),0),[lines]);
  const applicationGross=application?.comparison?.applicationCurrentGross??application?.currentPeriodGrossClaimed??null;
  const residual=applicationGross==null?null:Number(applicationGross)-variationClaim;
  const set=(key)=>(event)=>setForm(value=>({...value,[key]:event.target.value}));
  const run=async(action)=>{setBusy(true);setError('');try{await action();await load();onChanged?.();}catch(e){setError(e.message);}finally{setBusy(false);}};
  const add=()=>run(async()=>{await addApplicationVariation(packageId,application.id,form);setForm(blank);});
  return <section className="po-cert-application-variations">
    <div className="po-cert-application__heading"><div><h4>Application Variations</h4><p>Contractor evidence only. Matching does not change the QS Forecast or certificate.</p></div></div>
    <div className="po-cert-application__comparison"><div><dt>Application gross</dt><dd>{applicationGross==null?'Not comparable':pounds(applicationGross)}</dd></div><div><dt>Variation claims</dt><dd>{pounds(variationClaim)}</dd></div><div><dt>Original / other works</dt><dd>{residual==null?'Not comparable':pounds(residual)}</dd></div></div>
    {editable&&canCreate?<div className="po-cert-application__form po-cert-application-variations__form">
      <label><span>Contractor Ref</span><input className="input" value={form.contractorReference} onChange={set('contractorReference')}/></label>
      <label><span>Description</span><input className="input" value={form.description} onChange={set('description')}/></label>
      {['contractorValue','previousClaim','currentClaim','cumulativeClaim'].map(key=><label key={key}><span>{{contractorValue:'Contractor Value',previousClaim:'Previous',currentClaim:'This Claim',cumulativeClaim:'Cumulative'}[key]}</span><input className="input" type="number" step="0.01" value={form[key]} onChange={set(key)}/></label>)}
      <button type="button" className="po-list-btn-secondary" disabled={busy} onClick={add}>Add variation line</button>
    </div>:null}
    {error?<div role="alert" className="po-list-feedback po-list-feedback--error">{error}</div>:null}
    {lines.length?<div className="po-table-scroll"><table className="po-table"><thead><tr><th>Type / Ref</th><th>Description</th><th>Contractor Value</th><th>Previous</th><th>This Claim</th><th>Cumulative</th><th>Reconciliation</th></tr></thead><tbody>{lines.map(line=><ApplicationLine key={line.id} line={line} items={items} editable={editable} canCreate={canCreate} canForecast={canForecast} busy={busy} run={run} packageId={packageId} applicationId={application.id}/>)}</tbody></table></div>:<p>No application variation lines recorded.</p>}
  </section>;
}

function ApplicationLine({line,items,editable,canCreate,canForecast,busy,run,packageId,applicationId}){
  const [selection,setSelection]=useState(''),[forecast,setForecast]=useState(''),[reason,setReason]=useState('');
  const discrepancy=line.matchedVariation&&Number(line.contractorValue)!==Number(line.matchedVariation.confirmedContractorValue);
  return <tr><td>{line.contractorReference||'—'}</td><td>{line.description}</td><td>{pounds(line.contractorValue)}</td><td>{pounds(line.previousClaim)}</td><td>{pounds(line.currentClaim)}</td><td>{pounds(line.cumulativeClaim)}</td><td>
    {line.matchedVariation?<><strong>{line.matchedVariation.reference}</strong><small> QS Forecast {pounds(line.matchedVariation.qsForecast)}</small>{discrepancy?<small> Presented contractor value differs from confirmed {pounds(line.matchedVariation.confirmedContractorValue)}</small>:null}{editable&&canForecast&&discrepancy?<><input className="input" placeholder="Reconciliation reason" value={reason} onChange={e=>setReason(e.target.value)}/><button type="button" disabled={busy||!reason} onClick={()=>run(()=>confirmApplicationContractorPosition(packageId,applicationId,line.id,reason))}>Confirm contractor position</button></>:null}</>:
      editable&&canCreate?<><select className="input" value={selection} onChange={e=>setSelection(e.target.value)}><option value="">Unresolved</option>{items.map(item=><option key={item.id} value={item.id}>{item.reference} — {item.description}</option>)}</select><button type="button" disabled={busy||!selection} onClick={()=>run(()=>matchApplicationVariation(packageId,applicationId,line.id,selection))}>Match existing</button><input className="input" type="number" step="0.01" placeholder="Deliberate QS Forecast" value={forecast} onChange={e=>setForecast(e.target.value)}/><input className="input" placeholder="QS forecast reason" value={reason} onChange={e=>setReason(e.target.value)}/><button type="button" disabled={busy||forecast===''||!reason} onClick={()=>run(()=>createVariationFromApplication(packageId,applicationId,line.id,{qsForecast:forecast,reason}))}>New variation</button></>:<span>Unresolved</span>}
  </td></tr>;
}
