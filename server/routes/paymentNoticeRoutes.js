const express=require('express');
const {getActiveClient}=require('../services/activeClient');
const repo=require('../services/paymentNoticeRepository');
const router=express.Router();
const send=(res,result,success=200)=>result.ok?res.status(success).json(result):res.status(result.status||500).json({message:result.message});
async function active(res){const value=await getActiveClient();if(!value)res.status(404).json({message:'No active client set'});return value;}
router.get('/packages/:packageId/certificates/:certificateId/payment-authority',async(req,res)=>{try{const c=await active(res);if(c)send(res,await repo.getWorkspace(c.id,req.params.packageId,req.params.certificateId,null,req.query.asOfDate));}catch(e){res.status(500).json({message:e.message});}});
router.post('/packages/:packageId/certificates/:certificateId/payment-notices',async(req,res)=>{try{const c=await active(res);if(c)send(res,await repo.createPaymentNotice(c.id,req.params.packageId,req.params.certificateId,req.body),201);}catch(e){res.status(500).json({message:e.message});}});
router.post('/packages/:packageId/certificates/:certificateId/intended-payments',async(req,res)=>{try{const c=await active(res);if(c)send(res,await repo.createDecision(c.id,req.params.packageId,req.params.certificateId,req.body),201);}catch(e){res.status(500).json({message:e.message});}});
router.post('/packages/:packageId/certificates/:certificateId/pay-less-notices',async(req,res)=>{try{const c=await active(res);if(c)send(res,await repo.createPayLess(c.id,req.params.packageId,req.params.certificateId,req.body),201);}catch(e){res.status(500).json({message:e.message});}});
router.patch('/payment-notices/:noticeId',async(req,res)=>{try{const c=await active(res);if(c)send(res,await repo.patchDraft(c.id,req.params.noticeId,req.body));}catch(e){res.status(500).json({message:e.message});}});
router.post('/payment-notices/:noticeId/prepare',async(req,res)=>{try{const c=await active(res);if(c)send(res,await repo.prepare(c.id,req.params.noticeId,req.body));}catch(e){res.status(500).json({message:e.message});}});
router.post('/payment-notices/:noticeId/issue',async(req,res)=>{try{const c=await active(res);if(c)send(res,await repo.issue(c.id,req.params.noticeId,req.body));}catch(e){res.status(500).json({message:e.message});}});
module.exports=router;
