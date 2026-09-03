const express=require('express');
const repository=require('../services/variationAccountRepository');
const {requirePermission}=require('../auth/authorization');
const {PERMISSIONS}=require('../auth/permissions');
const router=express.Router();
const authority=require('../services/variationAccountAuthorityRepository');

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
router.get('/:id/authority',requirePermission(PERMISSIONS.VARIATION_ACCOUNT_VIEW),async(req,res)=>{try{const projection=await authority.getProjection(clientId(req),req.params.id,req.buildliteAuth);if(!projection)return res.status(404).json({message:'Variation Account item not found.'});res.json({projection});}catch(error){res.status(error.status||500).json({message:error.message||'Failed to load VA authority.'});}});
router.get('/:id/eligible-authorities',requirePermission(PERMISSIONS.VARIATION_ACCOUNT_VIEW),async(req,res)=>{try{const sources=await authority.listEligibleSources(clientId(req),req.params.id,req.buildliteAuth);if(!sources)return res.status(404).json({message:'Variation Account item not found.'});res.json({sources});}catch(error){res.status(error.status||500).json({message:error.message||'Failed to load eligible VA authority.'});}});
router.post('/:id/authority-allocations',requirePermission(PERMISSIONS.VARIATION_ACCOUNT_AUTHORITY_ALLOCATE),async(req,res)=>{try{const result=await authority.allocateAuthority(clientId(req),req.params.id,req.body||{},req.buildliteAuth);res.status(result.status).json(result.ok?{projection:result.projection}:{message:result.message});}catch(error){res.status(error.status||500).json({message:error.message||'Failed to allocate VA authority.'});}});
router.post('/:id/authority-substitutions',requirePermission(PERMISSIONS.VARIATION_ACCOUNT_AUTHORITY_ALLOCATE),async(req,res)=>{try{const result=await authority.appendSubstitution(clientId(req),req.params.id,req.body||{},req.buildliteAuth);res.status(result.status).json(result.ok?{projection:result.projection,substitution:result.substitution}:{message:result.message});}catch(error){res.status(error.status||500).json({message:error.message||'Failed to append VA authority substitution.'});}});
router.post('/:id/authority-allocations/:allocationId/reverse',requirePermission(PERMISSIONS.VARIATION_ACCOUNT_AUTHORITY_ALLOCATE),async(req,res)=>{try{const result=await authority.reverseAllocation(clientId(req),req.params.id,req.params.allocationId,req.body||{},req.buildliteAuth);res.status(result.status).json(result.ok?{projection:result.projection}:{message:result.message});}catch(error){res.status(error.status||500).json({message:error.message||'Failed to reverse VA authority allocation.'});}});

module.exports=router;
