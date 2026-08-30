import {useEffect,useState} from 'react';
import AdminPageShell from './AdminPageShell';
import {cloneSubcontractTerms,createSubcontractTerms,listSubcontractTerms,publishSubcontractTerms,retireSubcontractTerms,setTenantSubcontractTermsDefault,updateSubcontractTermsDraft} from '../../api/subcontractTerms';

function DraftEditor({version,onSave}){
  const source=version.source_document||{};
  const [label,setLabel]=useState(version.version_label||'');
  const [documentName,setDocumentName]=useState(source.name||'');
  const [documentReference,setDocumentReference]=useState(source.reference||'');
  const [checksum,setChecksum]=useState(source.sha256||'');
  const [rules,setRules]=useState(JSON.stringify(version.payment_rules||{},null,2));
  return <form className="admin-terms-form" onSubmit={event=>{event.preventDefault();onSave({...version,versionLabel:label,paymentRules:JSON.parse(rules),sourceDocument:{...source,name:documentName,reference:documentReference,sha256:checksum,humanConfirmed:true},rulesSchemaVersion:version.rules_schema_version||1,recordVersion:version.record_version});}}>
    <div className="admin-terms-form__grid">
      <label className="dev-form__field"><span className="dev-form__label">Version label</span><input className="input" value={label} onChange={event=>setLabel(event.target.value)} /></label>
      <label className="dev-form__field"><span className="dev-form__label">Source document</span><input className="input" value={documentName} onChange={event=>setDocumentName(event.target.value)} placeholder="Document name" /></label>
      <label className="dev-form__field"><span className="dev-form__label">Document reference</span><input className="input" value={documentReference} onChange={event=>setDocumentReference(event.target.value)} placeholder="Internal or external reference" /></label>
    </div>
    <div className="admin-terms-rules-summary"><strong>Payment rules</strong><span className="admin-chip admin-chip--muted">Not yet configured</span><p>The detailed payment-rule editor will be introduced in a later controlled slice.</p></div>
    <details className="admin-terms-advanced"><summary>Advanced structured data</summary>
      <p>Developer-level representation. Normal administration does not require editing this data.</p>
      <label className="dev-form__field"><span className="dev-form__label">Structured payment rules</span><textarea className="input" rows="5" value={rules} onChange={event=>setRules(event.target.value)} /></label>
      <label className="dev-form__field"><span className="dev-form__label">SHA-256 checksum</span><input className="input" value={checksum} onChange={event=>setChecksum(event.target.value)} placeholder="Calculated automatically by future document upload" /></label>
    </details>
    <button className="po-btn-primary" type="submit">Save Draft</button>
  </form>;
}

export default function AdminSubcontractTermsPage({onBack}){
  const [families,setFamilies]=useState([]);
  const [defaultVersionId,setDefaultVersionId]=useState(null);
  const [name,setName]=useState('');
  const [message,setMessage]=useState('');
  async function load(){const result=await listSubcontractTerms();setFamilies(result.families||[]);setDefaultVersionId(result.defaultVersionId||null);return result;}
  useEffect(()=>{load().catch(error=>setMessage(error.message));},[]);
  async function act(fn,success='Saved successfully.'){try{setMessage('');await fn();await load();setMessage(success);}catch(error){setMessage(error.message);}}
  return <AdminPageShell title="Subcontract Terms" onBack={onBack}>
    <p>Versioned company subcontract terms. Controls are provisionally audited; authoritative role security is a future slice.</p>
    {message?<p className="admin-terms-message" role="status">{message}</p>:null}
    <form onSubmit={event=>{event.preventDefault();act(()=>createSubcontractTerms({name,paymentRules:{configurationState:'incomplete'},rulesSchemaVersion:1}),'Draft created.');setName('');}}>
      <label className="dev-form__field"><span className="dev-form__label">New terms family</span><input className="input" value={name} onChange={event=>setName(event.target.value)} required /></label>
      <button type="submit">Create Draft</button>
    </form>
    {families.length===0?<p>No subcontract terms configured.</p>:families.map(family=><section className="admin-terms-family" key={family.id}>
      <h2>{family.name}</h2>
      {(family.versions||[]).map(version=>{const isDefault=version.isCompanyDefault||version.id===defaultVersionId;return <article className="admin-terms-version" key={version.id}>
        <div className="admin-terms-version__header"><div><strong>Revision {version.revision_number}</strong>{version.version_label?` · ${version.version_label}`:''}<span className="admin-terms-version__status"> · {version.status}</span></div>{isDefault?<span className="admin-chip admin-chip--success">Company default</span>:null}</div>
        {version.status==='draft'?<><DraftEditor version={version} onSave={body=>act(()=>updateSubcontractTermsDraft(version.id,body),'Draft saved.')} /><button onClick={()=>act(()=>publishSubcontractTerms(version.id),'Revision published.')}>Publish</button></>:null}
        {version.status==='published'?<div className="admin-terms-actions">{!isDefault?<button onClick={()=>act(()=>setTenantSubcontractTermsDefault(version.id),'Company default updated.')}>Set company default</button>:null}<button onClick={()=>act(()=>cloneSubcontractTerms(version.id),'New Draft created.')}>Clone new Draft</button><button onClick={()=>act(()=>retireSubcontractTerms(version.id),'Revision retired.')}>Retire</button></div>:null}
      </article>})}
    </section>)}
  </AdminPageShell>;
}
