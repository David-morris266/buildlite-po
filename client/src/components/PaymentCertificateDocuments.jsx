import {useEffect,useState} from 'react';
import {commercialDocumentPdfUrl,generatePaymentCertificateDocument,issueCommercialDocument,listCertificateDocuments} from '../api/commercialDocuments';

const dateTime=value=>value?new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'—';
export default function PaymentCertificateDocuments({certificate,packageId}){
  const [documents,setDocuments]=useState([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  async function load(){if(certificate?.status!=='locked'||!packageId||!certificate?.id)return;const result=await listCertificateDocuments(packageId,certificate.id);setDocuments(result.documents||[]);}
  useEffect(()=>{load().catch(error=>setMessage(error.message));},[packageId,certificate?.id,certificate?.status]);
  async function act(fn){setBusy(true);setMessage('');try{await fn();await load();setMessage('Document authority updated.');}catch(error){setMessage(error.message);}finally{setBusy(false);}}
  if(certificate?.status!=='locked')return null;
  const issued=documents.some(document=>document.status==='issued');
  const generationById=new Map([...documents].sort((a,b)=>new Date(a.generatedAt)-new Date(b.generatedAt)||a.id.localeCompare(b.id)).map((document,index)=>[document.id,index+1]));
  return <section className="po-module-card po-cert-documents" aria-labelledby="certificate-documents-heading"><div className="po-cert-notices__heading"><div><h3 id="certificate-documents-heading">Payment Certificate document</h3><p>Generated PDFs are frozen review copies. Issue is a separate explicit action.</p></div>{issued?<p>Issued authority is frozen. A correction requires an explicit revised-document workflow.</p>:<button className="po-btn-primary" disabled={busy} onClick={()=>act(()=>generatePaymentCertificateDocument(packageId,certificate.id))}>{busy?'Working…':'Generate Payment Certificate'}</button>}</div>
    {documents.length?<div className="po-table-wrap"><table className="po-data-table"><thead><tr><th>Reference</th><th>Generation</th><th>Generated</th><th>Status</th><th>Checksum</th><th>Actions</th></tr></thead><tbody>{documents.map(document=><tr key={document.id}><td>{document.reference}</td><td>Generation {generationById.get(document.id)}</td><td>{dateTime(document.generatedAt)}</td><td>{document.status}</td><td title={document.sha256}>{document.sha256?.slice(0,12)}…</td><td><a className="po-list-btn-secondary" href={commercialDocumentPdfUrl(document.id)} target="_blank" rel="noreferrer">View</a> <a className="po-list-btn-secondary" href={commercialDocumentPdfUrl(document.id,{download:true})}>Download</a>{!issued&&document.status==='generated'?<button disabled={busy} onClick={()=>act(()=>issueCommercialDocument(document.id))}>Issue</button>:null}</td></tr>)}</tbody></table></div>:<p>No Payment Certificate documents generated.</p>}
    {message?<p role={message==='Document authority updated.'?'status':'alert'}>{message}</p>:null}
  </section>;
}
