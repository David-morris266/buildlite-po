const express=require('express');
const {getActiveClient}=require('../services/activeClient');
const repo=require('../services/commercialDocumentRepository');
const router=express.Router();
const send=(res,result,success=200)=>result.ok?res.status(result.status||success).json(result):res.status(result.status||500).json({message:result.message});
async function active(res){const client=await getActiveClient();if(!client)res.status(404).json({message:'No active client set'});return client;}
router.get('/packages/:packageId/certificates/:certificateId',async(req,res)=>{try{const client=await active(res);if(client)send(res,await repo.listForCertificate(client.id,req.params.packageId,req.params.certificateId));}catch(e){res.status(500).json({message:e.message});}});
router.post('/packages/:packageId/certificates/:certificateId/payment-certificate',async(req,res)=>{try{const client=await active(res);if(client)send(res,await repo.generatePaymentCertificate(client,req.params.packageId,req.params.certificateId,req.body),201);}catch(e){res.status(500).json({message:e.message});}});
router.get('/:documentId',async(req,res)=>{try{const client=await active(res);if(client)send(res,await repo.getDocument(client.id,req.params.documentId));}catch(e){res.status(500).json({message:e.message});}});
router.get('/:documentId/pdf',async(req,res)=>{try{const client=await active(res);if(!client)return;const result=await repo.getBinary(client.id,req.params.documentId);if(!result.ok)return res.status(result.status).json({message:result.message});res.set({'Content-Type':result.mimeType,'Content-Disposition':`${req.query.download==='1'?'attachment':'inline'}; filename="${result.reference}.pdf"`,'Cache-Control':'no-store','ETag':`"${result.sha256}"`});res.end(result.binary);}catch(e){res.status(500).json({message:e.message});}});
router.post('/:documentId/issue',async(req,res)=>{try{const client=await active(res);if(client)send(res,await repo.issueDocument(client.id,req.params.documentId,req.body));}catch(e){res.status(500).json({message:e.message});}});
module.exports=router;
