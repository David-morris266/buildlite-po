const {buildPaymentCertificateRenderPayload}=require('./paymentCertificateDocumentPayload');
const {dateOnly}=require('./paymentCertificateTimetable');

const money=value=>value==null?null:Number(value);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const frozenDate=value=>{if(!value)return null;if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value))return value;const date=new Date(value);if(Number.isNaN(date.valueOf()))return null;const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);const part=type=>parts.find(item=>item.type===type)?.value;return `${part('year')}-${part('month')}-${part('day')}`;};

async function issuedPaymentNotice(db,clientId,packageId,certificateId){
  return (await db.query(`SELECT n.id notice_id,n.notice_reference,n.status notice_status,n.version notice_version,
    s.* FROM package_payment_notices n JOIN package_payment_notice_snapshots s
      ON s.notice_id=n.id AND s.client_id=n.client_id AND s.stage='issued'
    WHERE n.client_id=$1 AND n.package_id=$2 AND n.certificate_id=$3
      AND n.notice_type='payment_notice' AND n.status='issued'
    ORDER BY s.captured_at DESC,s.id DESC LIMIT 1`,[clientId,packageId,certificateId])).rows[0]||null;
}

function noticePayload(row){
  const timetable=object(row.timetable_snapshot),application=object(row.application_snapshot),terms=object(row.terms_snapshot);
  return {
    id:row.notice_id,snapshotId:row.id,reference:row.notice_reference,status:'issued',version:Number(row.notice_version),
    notifiedSum:money(row.notified_sum),basisOfCalculation:row.basis_of_calculation||'',noticeMode:row.notice_mode,
    assessed:{gross:money(row.assessed_gross),retention:money(row.retention),recoveries:money(row.recoveries),vat:money(row.vat),net:money(row.assessed_net)},
    timetable:{contractualValuationDate:frozenDate(timetable.contractual_valuation_date||timetable.contractualValuationDate||timetable.anchor_value||timetable.anchorValue),dueDate:frozenDate(timetable.due_date||timetable.dueDate),paymentNoticeDeadline:dateOnly(row.payment_notice_deadline)||frozenDate(timetable.payment_notice_deadline||timetable.paymentNoticeDeadline),finalDateForPayment:frozenDate(timetable.final_date_for_payment||timetable.finalDateForPayment)},
    terms:{familyName:terms.familyName||null,versionLabel:terms.versionLabel||null,revisionNumber:terms.revisionNumber||null,termsVersionId:row.terms_version_id||terms.termsVersionId||null,rulesSchemaVersion:row.rules_schema_version==null?null:Number(row.rules_schema_version)},
    application:{reference:application.application?.applicationReference||application.applicationReference||null,amountApplied:application.comparison?.applicationCurrentGross??application.application?.currentPeriodGrossClaimed??null},
    issuedBy:row.actor||null,issuedAt:row.captured_at,
  };
}

async function buildNoticeDocumentRenderPayload(db,client,packageId,certificateId,documentType){
  const certificateBuilt=await buildPaymentCertificateRenderPayload(db,client,packageId,certificateId);if(!certificateBuilt.ok)return certificateBuilt;
  const row=await issuedPaymentNotice(db,client.id,packageId,certificateId);
  if(!row)return {ok:false,status:409,message:'An Issued Payment Notice snapshot is required before document generation.'};
  const notice=noticePayload(row);
  if(documentType==='combined_certificate_payment_notice'&&notice.noticeMode!=='certificate_as_payment_notice')return {ok:false,status:409,message:'Combined document generation requires frozen certificate-as-payment-notice terms authority.'};
  const combined=documentType==='combined_certificate_payment_notice';
  const reference=combined?`${certificateBuilt.documentReference}-${notice.reference}`:notice.reference;
  const common={schemaVersion:1,templateVersion:combined?'combined-certificate-payment-notice-v1':'payment-notice-v1',document:{type:documentType,reference,generatedAt:null},presentation:certificateBuilt.renderPayload.presentation,
    sourceCertificate:{...certificateBuilt.renderPayload.authority,reference:certificateBuilt.documentReference,financials:certificateBuilt.renderPayload.financials},notice,
  };
  const renderPayload=combined?{...certificateBuilt.renderPayload,...common,certificate:certificateBuilt.renderPayload,notice}:{...common};
  return {ok:true,documentReference:reference,sourceAuthorityType:combined?'locked_certificate_and_issued_payment_notice':'issued_payment_notice_snapshot',sourceAuthorityId:combined?certificateId:row.id,
    sourceSnapshotIds:{...certificateBuilt.sourceSnapshotIds,lockedCertificateId:certificateId,paymentNoticeId:row.notice_id,paymentNoticeIssuedSnapshotId:row.id},recipientSnapshot:certificateBuilt.recipientSnapshot,renderPayload,noticeRow:row};
}

async function getDocumentEligibility(db,clientId,packageId,certificateId){
  const certificate=(await db.query(`SELECT status FROM package_payment_certificates WHERE client_id=$1 AND package_id=$2 AND id=$3`,[clientId,packageId,certificateId])).rows[0];
  if(!certificate)return {ok:false,status:404,message:'Certificate not found.'};
  const notice=await issuedPaymentNotice(db,clientId,packageId,certificateId);
  return {ok:true,locked:certificate.status==='locked',issuedPaymentNotice:!!notice,noticeMode:notice?.notice_mode||null};
}

module.exports={buildNoticeDocumentRenderPayload,getDocumentEligibility};
