import {useEffect,useState} from 'react';
import AdminPageShell from './AdminPageShell';
import {cloneSubcontractTerms,createSubcontractTerms,listSubcontractTerms,publishSubcontractTerms,retireSubcontractTerms,setTenantSubcontractTermsDefault,updateSubcontractTermsDraft} from '../../api/subcontractTerms';
import {anchorOptions,normalisePaymentRules,paymentRulesPreview} from '../../subcontractTerms/paymentRulesV1';

function DraftEditor({version,onSave}){
  const source=version.source_document||{};
  const [label,setLabel]=useState(version.version_label||'');
  const [documentName,setDocumentName]=useState(source.name||'');
  const [documentReference,setDocumentReference]=useState(source.reference||'');
  const [checksum,setChecksum]=useState(source.sha256||'');
  const [rules,setRules]=useState(()=>normalisePaymentRules(version.payment_rules));
  const [saveState,setSaveState]=useState({busy:false,message:''});
  useEffect(()=>{setRules(normalisePaymentRules(version.payment_rules));},[version.record_version,version.payment_rules]);
  const setSection=(section,field,value)=>setRules(current=>({...current,[section]:{...current[section],[field]:value}}));
  async function submit(event){event.preventDefault();setSaveState({busy:true,message:''});const result=await onSave({...version,versionLabel:label,paymentRules:rules,sourceDocument:{...source,name:documentName,reference:documentReference,sha256:checksum,humanConfirmed:true},rulesSchemaVersion:1,recordVersion:version.record_version});setSaveState({busy:false,message:result.ok?'Draft saved.':result.message});}
  return <form className="admin-terms-form" onSubmit={submit}>
    <div className="admin-terms-form__grid">
      <label className="dev-form__field"><span className="dev-form__label">Version label</span><input className="input" value={label} onChange={event=>setLabel(event.target.value)} /></label>
      <label className="dev-form__field"><span className="dev-form__label">Source document</span><input className="input" value={documentName} onChange={event=>setDocumentName(event.target.value)} placeholder="Document name" /></label>
      <label className="dev-form__field"><span className="dev-form__label">Document reference</span><input className="input" value={documentReference} onChange={event=>setDocumentReference(event.target.value)} placeholder="Internal or external reference" /></label>
    </div>
    <fieldset className="admin-terms-payment-rules"><legend>Payment rules</legend>
      <div className="admin-terms-form__grid">
        <label className="dev-form__field"><span className="dev-form__label">Configuration state</span><select className="input" value={rules.configurationState} onChange={event=>setRules({...rules,configurationState:event.target.value})}><option value="incomplete">Incomplete</option><option value="complete">Complete</option></select></label>
        <label className="dev-form__field"><span className="dev-form__label">Jurisdiction</span><select className="input" value={rules.jurisdiction} onChange={event=>setRules({...rules,jurisdiction:event.target.value})}><option value="england_wales">England &amp; Wales</option></select></label>
        <label className="dev-form__field"><span className="dev-form__label">Timezone</span><select className="input" value={rules.timezone} onChange={event=>setRules({...rules,timezone:event.target.value})}><option value="Europe/London">Europe/London</option></select></label>
        <label className="dev-form__field"><span className="dev-form__label">Payment-cycle anchor</span><select className="input" value={rules.anchor.type} onChange={event=>setSection('anchor','type',event.target.value)}>{anchorOptions.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
      </div>
      <div className="admin-terms-offsets">
        <RuleOffset label="Due date" section="dueDate" rule={rules.dueDate} relativeOptions={[['anchor','anchor']]} setSection={setSection}/>
        <RuleOffset label="Payment Notice deadline" section="paymentNoticeDeadline" rule={rules.paymentNoticeDeadline} relativeOptions={[['anchor','anchor'],['due_date','due date']]} setSection={setSection}/>
        <RuleOffset label="Final date for payment" section="finalDateForPayment" rule={rules.finalDateForPayment} relativeOptions={[['due_date','due date']]} setSection={setSection}/>
        <RuleOffset label="Pay Less Notice deadline" section="payLessNoticeDeadline" rule={rules.payLessNoticeDeadline} relativeOptions={[['final_date_for_payment','final date for payment']]} setSection={setSection}/>
      </div>
      <div className="admin-terms-preview"><strong>Plain-English preview</strong>{paymentRulesPreview(rules).map(line=><p key={line}>{line}</p>)}</div>
    </fieldset>
    <details className="admin-terms-advanced"><summary>Advanced structured data</summary>
      <p>Read-only developer representation. Normal administration does not require JSON.</p>
      <label className="dev-form__field"><span className="dev-form__label">Structured payment rules</span><textarea className="input" rows="8" value={JSON.stringify(rules,null,2)} readOnly /></label>
      <label className="dev-form__field"><span className="dev-form__label">SHA-256 checksum</span><input className="input" value={checksum} onChange={event=>setChecksum(event.target.value)} placeholder="Calculated automatically by future document upload" /></label>
    </details>
    <div className="admin-terms-save-row"><button className="po-btn-primary" type="submit" disabled={saveState.busy}>{saveState.busy?'Saving…':'Save Draft'}</button>{saveState.message?<span className={saveState.message==='Draft saved.'?'admin-terms-inline-success':'admin-terms-inline-error'} role={saveState.message==='Draft saved.'?'status':'alert'}>{saveState.message}</span>:null}</div>
  </form>;
}

function RuleOffset({label,section,rule,relativeOptions,setSection}){
  return <div className="admin-terms-offset"><strong>{label}</strong><label><span>Days</span><input className="input" type="number" min="0" step="1" value={rule.days??''} onChange={event=>setSection(section,'days',event.target.value===''?null:Number(event.target.value))}/></label><span>calendar days {rule.direction}</span><label><span className="sr-only">Relative to</span><select className="input" value={rule.relativeTo} onChange={event=>setSection(section,'relativeTo',event.target.value)}>{relativeOptions.map(([value,text])=><option key={value} value={value}>{text}</option>)}</select></label></div>;
}

export default function AdminSubcontractTermsPage({onBack}){
  const [families,setFamilies]=useState([]);
  const [defaultVersionId,setDefaultVersionId]=useState(null);
  const [name,setName]=useState('');
  const [message,setMessage]=useState('');
  const [versionFeedback,setVersionFeedback]=useState({});
  async function load(){const result=await listSubcontractTerms();setFamilies(result.families||[]);setDefaultVersionId(result.defaultVersionId||null);return result;}
  useEffect(()=>{load().catch(error=>setMessage(error.message));},[]);
  async function act(fn,success='Saved successfully.',feedback=null){if(feedback)setVersionFeedback(current=>({...current,[feedback.versionId]:{busy:true,message:''}}));try{setMessage('');await fn();await load();setMessage(success);if(feedback)setVersionFeedback(current=>({...current,[feedback.versionId]:{busy:false,message:success,success:true}}));return {ok:true};}catch(error){const base=error.message||'Unable to save.';const text=feedback?.errorPrefix?`${feedback.errorPrefix}${base}`:base;setMessage(text);if(feedback)setVersionFeedback(current=>({...current,[feedback.versionId]:{busy:false,message:text,success:false}}));return {ok:false,message:text};}}
  return <AdminPageShell title="Subcontract Terms" onBack={onBack}>
    <p>Versioned company subcontract terms. Controls are provisionally audited; authoritative role security is a future slice.</p>
    {message?<p className="admin-terms-message" role="status">{message}</p>:null}
    <form onSubmit={event=>{event.preventDefault();act(()=>createSubcontractTerms({name,paymentRules:{configurationState:'incomplete'},rulesSchemaVersion:1}),'Draft created.');setName('');}}>
      <label className="dev-form__field"><span className="dev-form__label">New terms family</span><input className="input" value={name} onChange={event=>setName(event.target.value)} required /></label>
      <button type="submit">Create Draft</button>
    </form>
    {families.length===0?<p>No subcontract terms configured.</p>:families.map(family=><section className="admin-terms-family" key={family.id}>
      <h2>{family.name}</h2>
      {(family.versions||[]).map(version=>{const isDefault=version.isCompanyDefault||version.id===defaultVersionId;const feedback=versionFeedback[version.id]||{};return <article className="admin-terms-version" key={version.id}>
        <div className="admin-terms-version__header"><div><strong>Revision {version.revision_number}</strong>{version.version_label?` · ${version.version_label}`:''}<span className="admin-terms-version__status"> · {version.status}</span></div>{isDefault?<span className="admin-chip admin-chip--success">Company default</span>:null}</div>
        {version.status==='draft'?<><DraftEditor version={version} onSave={body=>act(()=>updateSubcontractTermsDraft(version.id,body),'Draft saved.')} /><button type="button" disabled={feedback.busy} onClick={()=>act(()=>publishSubcontractTerms(version.id),'Revision published.',{versionId:version.id,errorPrefix:'Cannot publish — '})}>{feedback.busy?'Publishing…':'Publish'}</button></>:null}
        {version.status==='published'?<div className="admin-terms-actions">{!isDefault?<button onClick={()=>act(()=>setTenantSubcontractTermsDefault(version.id),'Company default updated.')}>Set company default</button>:null}<button onClick={()=>act(()=>cloneSubcontractTerms(version.id),'New Draft created.')}>Clone new Draft</button><button onClick={()=>act(()=>retireSubcontractTerms(version.id),'Revision retired.')}>Retire</button></div>:null}
        {feedback.message?<p className={feedback.success?'admin-terms-inline-success':'admin-terms-inline-error'} role={feedback.success?'status':'alert'}>{feedback.message}</p>:null}
      </article>})}
    </section>)}
  </AdminPageShell>;
}
