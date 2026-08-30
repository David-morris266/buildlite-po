const express=require('express');
const {getActiveClient}=require('../services/activeClient');
const repo=require('../services/subcontractTermsRepository');
const router=express.Router();
async function tenant(res){const active=await getActiveClient();if(!active)res.status(404).json({message:'No active client set'});return active;}
function send(res,result,key,status=200){if(!result.ok)return res.status(result.status||400).json({message:result.message});return res.status(status).json(key?result[key]:result);}
router.get('/',async(req,res)=>{try{const c=await tenant(res);if(c)res.json(await repo.list(c.id));}catch(e){console.error(e);res.status(500).json({message:'Failed to load subcontract terms.'});}});
router.post('/',async(req,res)=>{try{const c=await tenant(res);if(c)send(res,await repo.createFamily(c.id,req.body),'version',201);}catch(e){console.error(e);res.status(500).json({message:'Failed to create subcontract terms.'});}});
router.put('/versions/:id',async(req,res)=>{const c=await tenant(res);if(c)send(res,await repo.updateDraft(c.id,req.params.id,req.body),'version');});
router.post('/versions/:id/publish',async(req,res)=>{const c=await tenant(res);if(c)send(res,await repo.publish(c.id,req.params.id,req.body),'version');});
router.post('/versions/:id/clone',async(req,res)=>{const c=await tenant(res);if(c)send(res,await repo.cloneVersion(c.id,req.params.id,req.body),'version',201);});
router.post('/versions/:id/retire',async(req,res)=>{const c=await tenant(res);if(c)send(res,await repo.retire(c.id,req.params.id,req.body),'version');});
router.put('/default',async(req,res)=>{const c=await tenant(res);if(c)send(res,await repo.setTenantDefault(c.id,req.body.termsVersionId,req.body));});
router.put('/developments/:developmentId/default',async(req,res)=>{const c=await tenant(res);if(c)send(res,await repo.setDevelopmentDefault(c.id,req.params.developmentId,req.body.termsVersionId,req.body));});
router.get('/purchase-orders/:poNumber',async(req,res)=>{const c=await tenant(res);if(c){const terms=await repo.resolveForPo(c.id,req.params.poNumber);if(!terms)return res.status(404).json({message:'PO not found.'});res.json(terms);}});
router.put('/purchase-orders/:poNumber/override',async(req,res)=>{const c=await tenant(res);if(c)send(res,await repo.setPoOverride(c.id,req.params.poNumber,req.body.termsVersionId,req.body.reason,req.body));});
router.post('/purchase-orders/:poNumber/confirm-legacy',async(req,res)=>{const c=await tenant(res);if(c)send(res,await repo.confirmLegacy(c.id,req.params.poNumber,req.body.termsVersionId,req.body.reason,req.body),'terms');});
router.get('/packages/:packageId',async(req,res)=>{const c=await tenant(res);if(c)res.json(await repo.resolveForPackage(c.id,req.params.packageId));});
module.exports=router;
