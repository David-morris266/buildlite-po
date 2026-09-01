const crypto=require('crypto');
const {pool,query}=require('../db');
const storage=require('./commercialDocumentStorage');
const {buildPaymentCertificateRenderPayload}=require('./paymentCertificateDocumentPayload');
const {buildNoticeDocumentRenderPayload,getDocumentEligibility}=require('./paymentNoticeDocumentPayload');
const {renderCommercialDocumentPdf}=require('./commercialDocumentRenderer');

const fail=(status,message)=>({ok:false,status,message});
const actor=body=>body?.actor||body?.generatedBy||body?.issuedBy||null;
const map=row=>row&&({id:row.id,developmentId:row.development_id,packageId:row.package_id,certificateId:row.certificate_id,type:row.document_type,reference:row.document_reference,status:row.status,documentSchemaVersion:Number(row.document_schema_version),templateVersion:row.template_version,mimeType:row.mime_type,pageCount:row.page_count==null?null:Number(row.page_count),sha256:row.sha256,generatedBy:row.generated_by,generatedAt:row.generated_at,issuedBy:row.issued_by,issuedAt:row.issued_at,supersedesDocumentId:row.supersedes_document_id,version:Number(row.version),sourceAuthorityType:row.source_authority_type,sourceAuthorityId:row.source_authority_id,sourceSnapshotIds:row.source_snapshot_ids});
const audit=(db,clientId,documentId,action,body,detail={})=>db.query(`INSERT INTO commercial_document_audit(client_id,document_id,action,actor,detail) VALUES($1,$2,$3,$4,$5)`,[clientId,documentId,action,actor(body),JSON.stringify(detail)]);

async function listForCertificate(clientId,packageId,certificateId){const eligibility=await getDocumentEligibility({query},clientId,packageId,certificateId);if(!eligibility.ok)return eligibility;const rows=(await query(`SELECT * FROM commercial_documents WHERE client_id=$1 AND package_id=$2 AND certificate_id=$3 ORDER BY generated_at DESC,id DESC`,[clientId,packageId,certificateId])).rows;const documents=rows.map(map);const available={payment_certificate:eligibility.locked&&!documents.some(x=>x.type==='payment_certificate'&&x.status==='issued'),payment_notice:eligibility.locked&&eligibility.issuedPaymentNotice&&!documents.some(x=>x.type==='payment_notice'&&x.status==='issued'),combined_certificate_payment_notice:eligibility.locked&&eligibility.issuedPaymentNotice&&eligibility.noticeMode==='certificate_as_payment_notice'&&!documents.some(x=>x.type==='combined_certificate_payment_notice'&&x.status==='issued')};return {ok:true,documents,eligibility:{...eligibility,available}};}

async function generatePaymentCertificate(client,packageId,certificateId,body={},options={}){
  const built=await buildPaymentCertificateRenderPayload({query},client,packageId,certificateId);if(!built.ok)return built;
  const generatedAt=new Date().toISOString();const renderPayload={...built.renderPayload,document:{...built.renderPayload.document,generatedAt}};
  const render=options.render||renderCommercialDocumentPdf;const binary=Buffer.from(await render('payment_certificate',renderPayload));
  if(!binary.length)return fail(500,'PDF renderer returned an empty document.');
  const sha256=crypto.createHash('sha256').update(binary).digest('hex');
  const pageCount=(binary.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length||null;
  const db=await pool.connect();try{await db.query('BEGIN');
    const current=(await db.query(`SELECT status,version,development_id FROM package_payment_certificates WHERE client_id=$1 AND package_id=$2 AND id=$3 FOR UPDATE`,[client.id,packageId,certificateId])).rows[0];
    if(!current||current.status!=='locked'||Number(current.version)!==renderPayload.authority.certificateVersion){await db.query('ROLLBACK');return fail(409,'Locked certificate authority changed before document generation completed.');}
    const issued=(await db.query(`SELECT id FROM commercial_documents WHERE client_id=$1 AND certificate_id=$2 AND document_type='payment_certificate' AND status='issued' LIMIT 1`,[client.id,certificateId])).rows[0];if(issued){await db.query('ROLLBACK');return fail(409,'An Issued Payment Certificate document already exists; correction/supersession is required.');}
    const row=await storage.insert(db,{clientId:client.id,developmentId:current.development_id,packageId,certificateId,documentType:'payment_certificate',documentReference:built.documentReference,sourceAuthorityType:'locked_payment_certificate',sourceAuthorityId:certificateId,sourceSnapshotIds:built.sourceSnapshotIds,documentSchemaVersion:1,templateVersion:'payment-certificate-v1',renderPayload,recipientSnapshot:built.recipientSnapshot,pageCount,binary,sha256,actor:actor(body),generatedAt});
    await audit(db,client.id,row.id,'generated',body,{sha256,pageCount});await db.query('COMMIT');return {ok:true,status:201,document:map(row)};
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}

async function generateNoticeDocument(client,packageId,certificateId,documentType,body={},options={}){
  if(!['payment_notice','combined_certificate_payment_notice'].includes(documentType))return fail(400,'Unsupported document type.');
  const built=await buildNoticeDocumentRenderPayload({query},client,packageId,certificateId,documentType);if(!built.ok)return built;
  const generatedAt=new Date().toISOString();const renderPayload={...built.renderPayload,document:{...built.renderPayload.document,generatedAt}};
  const render=options.render||renderCommercialDocumentPdf;const binary=Buffer.from(await render(documentType,renderPayload));if(!binary.length)return fail(500,'PDF renderer returned an empty document.');
  const sha256=crypto.createHash('sha256').update(binary).digest('hex');const pageCount=(binary.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length||null;
  const db=await pool.connect();try{await db.query('BEGIN');
    const certificate=(await db.query(`SELECT status,version,development_id FROM package_payment_certificates WHERE client_id=$1 AND package_id=$2 AND id=$3 FOR UPDATE`,[client.id,packageId,certificateId])).rows[0];
    if(!certificate||certificate.status!=='locked'||Number(certificate.version)!==Number(renderPayload.sourceCertificate.certificateVersion)){await db.query('ROLLBACK');return fail(409,'Locked certificate authority changed before document generation completed.');}
    const notice=(await db.query(`SELECT n.status,s.id snapshot_id FROM package_payment_notices n JOIN package_payment_notice_snapshots s ON s.notice_id=n.id AND s.client_id=n.client_id AND s.stage='issued' WHERE n.client_id=$1 AND n.id=$2 AND s.id=$3 FOR UPDATE OF n`,[client.id,built.sourceSnapshotIds.paymentNoticeId,built.sourceSnapshotIds.paymentNoticeIssuedSnapshotId])).rows[0];
    if(!notice||notice.status!=='issued'){await db.query('ROLLBACK');return fail(409,'Issued Payment Notice authority changed before document generation completed.');}
    const issued=(await db.query(`SELECT id FROM commercial_documents WHERE client_id=$1 AND certificate_id=$2 AND document_type=$3 AND status='issued' LIMIT 1`,[client.id,certificateId,documentType])).rows[0];if(issued){await db.query('ROLLBACK');return fail(409,'An Issued document of this type already exists; correction/supersession is required.');}
    const row=await storage.insert(db,{clientId:client.id,developmentId:certificate.development_id,packageId,certificateId,documentType,documentReference:built.documentReference,sourceAuthorityType:built.sourceAuthorityType,sourceAuthorityId:built.sourceAuthorityId,sourceSnapshotIds:built.sourceSnapshotIds,documentSchemaVersion:1,templateVersion:renderPayload.templateVersion,renderPayload,recipientSnapshot:built.recipientSnapshot,pageCount,binary,sha256,actor:actor(body),generatedAt});
    await audit(db,client.id,row.id,'generated',body,{sha256,pageCount});await db.query('COMMIT');return {ok:true,status:201,document:map(row)};
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}

async function getDocument(clientId,documentId){const row=await storage.findMetadata({query},clientId,documentId);return row?{ok:true,document:{...map(row),renderPayload:row.render_payload,recipientSnapshot:row.recipient_snapshot}}:fail(404,'Document not found.');}
async function getBinary(clientId,documentId){const row=await storage.findBinary({query},clientId,documentId);return row?{ok:true,binary:row.binary_data,mimeType:row.mime_type,reference:row.document_reference,sha256:row.sha256,status:row.status}:fail(404,'Document not found.');}

async function issueDocument(clientId,documentId,body={}){const db=await pool.connect();try{await db.query('BEGIN');const row=(await db.query(`SELECT * FROM commercial_documents WHERE client_id=$1 AND id=$2 FOR UPDATE`,[clientId,documentId])).rows[0];if(!row){await db.query('ROLLBACK');return fail(404,'Document not found.');}if(row.status!=='generated'){await db.query('ROLLBACK');return fail(409,'Only a Generated document can be Issued.');}
  const certificate=(await db.query(`SELECT status FROM package_payment_certificates WHERE client_id=$1 AND id=$2 AND package_id=$3`,[clientId,row.certificate_id,row.package_id])).rows[0];if(!certificate||certificate.status!=='locked'){await db.query('ROLLBACK');return fail(409,'Source Payment Certificate is no longer valid Locked authority.');}
  if(row.document_type!=='payment_certificate'){const snapshotId=row.source_snapshot_ids?.paymentNoticeIssuedSnapshotId;const noticeId=row.source_snapshot_ids?.paymentNoticeId;const notice=(await db.query(`SELECT 1 FROM package_payment_notices n JOIN package_payment_notice_snapshots s ON s.notice_id=n.id AND s.client_id=n.client_id AND s.stage='issued' WHERE n.client_id=$1 AND n.id=$2 AND n.status='issued' AND s.id=$3`,[clientId,noticeId,snapshotId])).rows[0];if(!notice){await db.query('ROLLBACK');return fail(409,'Source Issued Payment Notice authority is no longer valid.');}}
  const other=(await db.query(`SELECT id FROM commercial_documents WHERE client_id=$1 AND certificate_id=$2 AND document_type=$3 AND status='issued' AND id<>$4 LIMIT 1`,[clientId,row.certificate_id,row.document_type,row.id])).rows[0];if(other){await db.query('ROLLBACK');return fail(409,'An Issued document already exists; correction/supersession is required.');}
  const updated=(await db.query(`UPDATE commercial_documents SET status='issued',issued_by=$3,issued_at=NOW(),version=version+1 WHERE client_id=$1 AND id=$2 AND status='generated' RETURNING *`,[clientId,documentId,actor(body)])).rows[0];await audit(db,clientId,documentId,'issued',body,{sha256:row.sha256});await db.query('COMMIT');return {ok:true,document:map(updated)};
}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}}

module.exports={listForCertificate,generatePaymentCertificate,generateNoticeDocument,getDocument,getBinary,issueDocument};
