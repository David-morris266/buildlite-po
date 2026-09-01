const express=require('express');
const {getActiveClient}=require('../services/activeClient');
const repo=require('../services/commercialDocumentRepository');
const {requirePermission}=require('../auth/authorization');
const {PERMISSIONS:P}=require('../auth/permissions');
const router=express.Router();
const send=(res,r,status=200)=>r.ok?res.status(status).json(r):res.status(r.status||400).json({message:r.message});
async function active(res){const client=await getActiveClient();if(!client)res.status(404).json({message:'No active client set'});return client;}
router.get('/packages/:packageId/certificates/:certificateId',async(req,res)=>{try{const c=await active(res);if(c)send(res,await repo.listForCertificate(c.id,req.params.packageId,req.params.certificateId));}catch(e){res.status(500).json({message:e.message});}});
function generate(type){return async(req,res)=>{try{const c=await active(res);if(!c)return;const body={...req.body,actor:req.buildliteAuth.displayName};const result=type==='payment_certificate'?await repo.generatePaymentCertificate(c,req.params.packageId,req.params.certificateId,body,{auth:req.buildliteAuth}):await repo.generateNoticeDocument(c,req.params.packageId,req.params.certificateId,type,body,{auth:req.buildliteAuth});send(res,result,201);}catch(e){res.status(e.status||500).json({message:e.message});}};}
router.post('/packages/:packageId/certificates/:certificateId/payment-certificate',requirePermission(P.DOCUMENT_GENERATE),generate('payment_certificate'));
router.post('/packages/:packageId/certificates/:certificateId/payment-notice',requirePermission(P.DOCUMENT_GENERATE),generate('payment_notice'));
router.post('/packages/:packageId/certificates/:certificateId/combined-certificate-payment-notice',requirePermission(P.DOCUMENT_GENERATE),generate('combined_certificate_payment_notice'));
router.post('/packages/:packageId/certificates/:certificateId/pay-less-notice',requirePermission(P.DOCUMENT_GENERATE),generate('pay_less_notice'));
router.get('/:documentId',requirePermission(P.DOCUMENT_VIEW),async(req,res)=>{try{const c=await active(res);if(c)send(res,await repo.getDocument(c.id,req.params.documentId));}catch(e){res.status(500).json({message:e.message});}});
router.get('/:documentId/pdf',requirePermission(P.DOCUMENT_VIEW),async(req,res)=>{try{const c=await active(res);if(!c)return;const result=await repo.getBinary(c.id,req.params.documentId,{auth:req.buildliteAuth});if(!result.ok)return res.status(result.status).json({message:result.message});res.set({'Content-Type':result.mimeType,'Content-Disposition':`${req.query.download==='1'?'attachment':'inline'}; filename="${result.reference}.pdf"`,'Cache-Control':'no-store','ETag':`"${result.sha256}"`});res.end(result.binary);}catch(e){res.status(e.status||500).json({message:e.message});}});
router.post('/:documentId/issue',requirePermission(P.DOCUMENT_ISSUE),async(req,res)=>{try{const c=await active(res);if(c)send(res,await repo.issueDocument(c.id,req.params.documentId,{...req.body,actor:req.buildliteAuth.displayName},{auth:req.buildliteAuth}));}catch(e){res.status(e.status||500).json({message:e.message});}});
module.exports=router;
