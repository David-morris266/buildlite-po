const express=require('express');
const {getActiveClient}=require('../services/activeClient');
const repo=require('../services/paymentNoticeRepository');
const {requirePermission,requireAnyPermission,requireResolvedPermission,actorFromAuth}=require('../auth/authorization');
const {PERMISSIONS}=require('../auth/permissions');
const router=express.Router();
const send=(res,result,success=200)=>result.ok?res.status(success).json(result):res.status(result.status||500).json({message:result.message});
async function active(res){const value=await getActiveClient();if(!value)res.status(404).json({message:'No active client set'});return value;}
const intendedPaymentPermission=requireResolvedPermission(req=>req.body?.confirm===true?PERMISSIONS.INTENDED_PAYMENT_CONFIRM:PERMISSIONS.INTENDED_PAYMENT_PROPOSE);
function noticePermission(action){return requireResolvedPermission(async req=>{
  const client=await getActiveClient();
  if(!client)throw Object.assign(new Error('No active client set'),{status:404});
  const type=await repo.findNoticeType(client.id,req.params.noticeId);
  if(!type)throw Object.assign(new Error('Notice not found.'),{status:404});
  if(action==='issue')return type==='pay_less_notice'?PERMISSIONS.PAY_LESS_ISSUE:PERMISSIONS.PAYMENT_NOTICE_ISSUE;
  return type==='pay_less_notice'?PERMISSIONS.PAY_LESS_PREPARE:PERMISSIONS.PAYMENT_NOTICE_PREPARE;
});}
router.get('/packages/:packageId/certificates/:certificateId/payment-authority',async(req,res)=>{try{const c=await active(res);if(c)send(res,await repo.getWorkspace(c.id,req.params.packageId,req.params.certificateId,null,req.query.asOfDate));}catch(e){res.status(500).json({message:e.message});}});
router.post('/packages/:packageId/certificates/:certificateId/payment-notices',requirePermission(PERMISSIONS.PAYMENT_NOTICE_PREPARE),async(req,res)=>{try{const c=await active(res);if(c)send(res,await repo.createPaymentNotice(c.id,req.params.packageId,req.params.certificateId,{...req.body,actor:actorFromAuth(req.buildliteAuth,PERMISSIONS.PAYMENT_NOTICE_PREPARE).actor},{auth:req.buildliteAuth}),201);}catch(e){res.status(e.status||500).json({message:e.message});}});
router.post('/packages/:packageId/certificates/:certificateId/intended-payments',intendedPaymentPermission,async(req,res)=>{try{const permission=req.requiredPermission;const c=await active(res);if(c)send(res,await repo.createDecision(c.id,req.params.packageId,req.params.certificateId,{...req.body,actor:actorFromAuth(req.buildliteAuth,permission).actor},{auth:req.buildliteAuth}),201);}catch(e){res.status(e.status||500).json({message:e.message});}});
router.post('/packages/:packageId/certificates/:certificateId/pay-less-notices',requirePermission(PERMISSIONS.PAY_LESS_PREPARE),async(req,res)=>{try{const c=await active(res);if(c)send(res,await repo.createPayLess(c.id,req.params.packageId,req.params.certificateId,{...req.body,actor:actorFromAuth(req.buildliteAuth,PERMISSIONS.PAY_LESS_PREPARE).actor},{auth:req.buildliteAuth}),201);}catch(e){res.status(e.status||500).json({message:e.message});}});
const anyPrepare=requireAnyPermission([PERMISSIONS.PAYMENT_NOTICE_PREPARE,PERMISSIONS.PAY_LESS_PREPARE],{record:false});
const anyIssue=requireAnyPermission([PERMISSIONS.PAYMENT_NOTICE_ISSUE,PERMISSIONS.PAY_LESS_ISSUE],{record:false});
router.patch('/payment-notices/:noticeId',anyPrepare,noticePermission('prepare'),async(req,res)=>{try{const c=await active(res);if(c)send(res,await repo.patchDraft(c.id,req.params.noticeId,{...req.body,actor:req.buildliteAuth.displayName},{auth:req.buildliteAuth}));}catch(e){res.status(e.status||500).json({message:e.message});}});
router.post('/payment-notices/:noticeId/prepare',anyPrepare,noticePermission('prepare'),async(req,res)=>{try{const c=await active(res);if(c)send(res,await repo.prepare(c.id,req.params.noticeId,{...req.body,actor:req.buildliteAuth.displayName},{auth:req.buildliteAuth}));}catch(e){res.status(e.status||500).json({message:e.message});}});
router.post('/payment-notices/:noticeId/issue',anyIssue,noticePermission('issue'),async(req,res)=>{try{const c=await active(res);if(c)send(res,await repo.issue(c.id,req.params.noticeId,{...req.body,actor:req.buildliteAuth.displayName},{auth:req.buildliteAuth}));}catch(e){res.status(e.status||500).json({message:e.message});}});
module.exports=router;
