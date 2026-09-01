const { mapBrandToPdfContext } = require('./brandProfile');
const { dateOnly } = require('./paymentCertificateTimetable');

const money=value=>value==null?null:Number(value);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const addressOf=value=>{
  if(typeof value==='string')return value;
  const source=object(value);
  return [source.address1,source.address2,source.addressLine1,source.addressLine2,source.city,source.town,source.county,source.postcode]
    .filter(Boolean).join(', ');
};

async function buildPaymentCertificateRenderPayload(db, client, packageId, certificateId){
  const certificate=(await db.query(`SELECT * FROM package_payment_certificates
    WHERE client_id=$1 AND package_id=$2 AND id=$3`,[client.id,packageId,certificateId])).rows[0];
  if(!certificate)return {ok:false,status:404,message:'Certificate not found.'};
  if(certificate.status!=='locked')return {ok:false,status:409,message:'Only a Locked Payment Certificate can generate a formal document.'};
  const pkg=(await db.query(`SELECT * FROM packages WHERE client_id=$1 AND id=$2 AND development_id=$3`,[client.id,packageId,certificate.development_id])).rows[0];
  if(!pkg)return {ok:false,status:404,message:'Package not found.'};
  const development=(await db.query(`SELECT * FROM developments WHERE client_id=$1 AND id=$2`,[client.id,pkg.development_id])).rows[0];
  const supplier=(await db.query(`SELECT * FROM suppliers WHERE client_id=$1 AND id=$2`,[client.id,pkg.supplier_id])).rows[0]||null;
  const po=(await db.query(`SELECT po.po_number,po.payload FROM package_purchase_orders ppo JOIN purchase_orders po
    ON po.client_id=ppo.client_id AND po.po_number=ppo.po_number WHERE ppo.client_id=$1 AND ppo.package_id=$2 ORDER BY po.po_number LIMIT 1`,[client.id,packageId])).rows[0]||null;
  const brandRow=(await db.query(`SELECT * FROM client_brand_profiles WHERE client_id=$1`,[client.id])).rows[0]||null;
  const timetable=(await db.query(`SELECT * FROM package_payment_certificate_deadline_snapshots
    WHERE client_id=$1 AND certificate_id=$2 AND stage='locked' ORDER BY captured_at DESC LIMIT 1`,[client.id,certificateId])).rows[0]||null;
  const payload=object(certificate.payload),valuation=object(payload.valuationSnapshot),cells=Array.isArray(valuation.cells)?valuation.cells:[];
  const commercialLines=Array.isArray(payload.commercialLines)?payload.commercialLines:[];
  const previousCertified=money((await db.query(`SELECT COALESCE(SUM(gross_value),0) value FROM package_payment_certificates
    WHERE client_id=$1 AND package_id=$2 AND status='locked' AND certificate_number<$3`,[client.id,packageId,certificate.certificate_number])).rows[0].value)||0;
  const certifiedToDate=previousCertified+(money(certificate.gross_value)||0);
  const supplierData={...object(supplier?.payload),name:supplier?.name||pkg.supplier_label||pkg.supplier_id};
  const poData=object(po?.payload),developmentData=object(development?.payload),brand=mapBrandToPdfContext(brandRow,client);
  const application=object(payload.lockedApplicationSnapshot),terms=object(payload.lockedGoverningTermsSnapshot);
  const applicationAmount=money(application.comparison?.applicationCurrentGross??application.application?.currentPeriodGrossClaimed);
  const assessedGross=money(certificate.gross_value);
  const applicationComparable=application.comparison?.comparable===true&&applicationAmount!=null&&assessedGross!=null;
  const applicationDifference=applicationComparable?assessedGross-applicationAmount:null;
  const reference=`PC-${certificate.certificate_number}`;
  const presentation={
    payer:{name:brand.company,address:brand.address,companyNumber:brand.companyNo,vatNumber:brand.vatNo,phone:brand.phone,email:brand.email,website:brand.website,logo:brand.logo,accentColor:brand.color,footer:brand.strapline},
    payee:{id:pkg.supplier_id,name:supplierData.name,address:addressOf(supplierData),contactName:supplierData.contactName||'',email:supplierData.email||supplierData.contactEmail||'',phone:supplierData.phone||supplierData.contactPhone||''},
    development:{id:development?.id||pkg.development_id,number:development?.job_number||pkg.development_number||'',name:development?.development_name||pkg.development_name||pkg.development_id,address:addressOf(developmentData.siteAddress||developmentData.address||developmentData)},
    package:{id:pkg.id,description:pkg.payload?.description||poData.description||poData.title||'',costCode:pkg.cost_code,poReference:po?.po_number||'',orderKey:pkg.order_key},
  };
  return {ok:true,documentReference:reference,recipientSnapshot:presentation.payee,sourceSnapshotIds:{
    valuationCapturedAt:valuation.capturedAt||null,applicationId:application.application?.id||application.id||null,
    governingTermsVersionId:terms.termsVersionId||null,deadlineSnapshotId:timetable?.id||null,
  },renderPayload:{schemaVersion:1,templateVersion:'payment-certificate-v1',document:{type:'payment_certificate',reference,certificateNumber:Number(certificate.certificate_number),generatedAt:null},presentation,
    authority:{certificateId:certificate.id,packageId:pkg.id,developmentId:certificate.development_id,status:'locked',certificateVersion:Number(certificate.version),certificateDate:dateOnly(certificate.certificate_date),contractualValuationDate:dateOnly(certificate.contractual_valuation_date),submittedBy:certificate.submitted_by||null,submittedAt:certificate.submitted_at||null,approvedBy:certificate.approved_by||null,approvedAt:certificate.approved_at||null},
    application:{reference:application.application?.applicationReference||application.applicationReference||null,amountApplied:applicationAmount,assessedGross,comparisonBasis:application.comparison?.comparisonBasis||null,comparable:applicationComparable,difference:applicationDifference,differenceAmount:applicationComparable?Math.abs(applicationDifference):null,differenceDirection:applicationComparable?(applicationDifference<0?'lower':applicationDifference>0?'higher':'equal'):null},
    financials:{previousCertified, grossThisCertificate:money(certificate.gross_value),certifiedToDate,retention:money(certificate.retention),recoveries:money(certificate.recovery_signed),vat:money(certificate.vat),netPayment:money(certificate.net_value)},
    valuation:{cells:cells.map(cell=>({plot:cell.plotLabel||cell.plotKey||'',stage:cell.stageLabel||cell.stageKey||'',contractValue:money(cell.contractValue),previousCertified:money(cell.previousValue)||0,thisCertificate:money(cell.thisCertificateValue)||0,certifiedToDate:money(cell.certifiedToDateValue)||0}))},
    commercialLines:commercialLines.map(line=>({type:line.sourceType||line.lineType||'Commercial adjustment',reference:line.sourceReference||line.eventNumber||line.variationOrderReference||'',description:line.description||'',amount:money(line.amountThisCertificate??line.amount)||0})),
    terms:{familyName:terms.familyName||null,versionLabel:terms.versionLabel||null,revisionNumber:terms.revisionNumber||null,source:terms.source||null},
    timetable:{valuationDate:dateOnly(timetable?.contractual_valuation_date||certificate.contractual_valuation_date),dueDate:dateOnly(timetable?.due_date),paymentNoticeDeadline:dateOnly(timetable?.payment_notice_deadline),finalDateForPayment:dateOnly(timetable?.final_date_for_payment),payLessDeadline:dateOnly(timetable?.pay_less_notice_deadline),state:timetable?'locked_snapshot':'not_captured'},
  }};
}

module.exports={buildPaymentCertificateRenderPayload};
