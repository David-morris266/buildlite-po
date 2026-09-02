const express=require('express');
const repository=require('../services/variationAccountRepository');
const {requirePermission}=require('../auth/authorization');
const {PERMISSIONS}=require('../auth/permissions');
const router=express.Router();

const clientId=req=>req.buildliteAuth.clientId;
const respond=(res,result)=>res.status(result.status).json(result.ok?{item:result.item}:{message:result.message});

router.get('/',requirePermission(PERMISSIONS.VARIATION_ACCOUNT_VIEW),async(req,res)=>{
  try { res.json({items:await repository.listItems(clientId(req),{packageId:req.query.packageId,status:req.query.status||null},req.buildliteAuth)}); }
  catch(error){res.status(error.status||500).json({message:error.message||'Failed to load Variation Account.'});}
});
router.post('/',requirePermission(PERMISSIONS.VARIATION_ACCOUNT_CREATE),async(req,res)=>{
  try { respond(res,await repository.createItem(clientId(req),req.body.packageId,req.body,req.buildliteAuth)); }
  catch(error){res.status(error.status||500).json({message:error.message||'Failed to create Variation Account item.'});}
});
router.get('/:id',requirePermission(PERMISSIONS.VARIATION_ACCOUNT_VIEW),async(req,res)=>{
  try { const item=await repository.getItem(clientId(req),req.params.id,req.buildliteAuth);if(!item)return res.status(404).json({message:'Variation Account item not found.'});res.json({item}); }
  catch(error){res.status(error.status||500).json({message:error.message||'Failed to load Variation Account item.'});}
});
router.patch('/:id/forecast',requirePermission(PERMISSIONS.VARIATION_ACCOUNT_FORECAST_EDIT),async(req,res)=>{
  try { respond(res,await repository.updateForecast(clientId(req),req.params.id,req.body,req.buildliteAuth)); }
  catch(error){res.status(error.status||500).json({message:error.message||'Failed to update QS Forecast.'});}
});
router.post('/:id/contractor-positions',requirePermission(PERMISSIONS.VARIATION_ACCOUNT_FORECAST_EDIT),async(req,res)=>{
  try { respond(res,await repository.recordContractorPosition(clientId(req),req.params.id,req.body,req.buildliteAuth)); }
  catch(error){res.status(error.status||500).json({message:error.message||'Failed to reconcile contractor position.'});}
});
for(const action of ['resolve','reopen','withdraw'])router.post(`/:id/${action}`,requirePermission(PERMISSIONS.VARIATION_ACCOUNT_RESOLVE),async(req,res)=>{
  try { respond(res,await repository.transitionItem(clientId(req),req.params.id,action,req.body,req.buildliteAuth)); }
  catch(error){res.status(error.status||500).json({message:error.message||`Failed to ${action} Variation Account item.`});}
});

module.exports=router;
