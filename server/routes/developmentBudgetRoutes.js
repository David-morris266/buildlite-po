const express=require('express');
const repo=require('../services/developmentBudgetRepository');
const {requirePermission}=require('../auth/authorization');
const {PERMISSIONS}=require('../auth/permissions');
const router=express.Router({mergeParams:true});
router.get('/budget-authority',requirePermission(PERMISSIONS.COMMERCIAL_READ),async(req,res)=>{try{const result=await repo.getAuthority(req.buildliteAuth.clientId,req.params.developmentId,req.buildliteAuth);res.status(result.status).json(result.ok?result.authority:{message:result.message});}catch(error){res.status(error.status||500).json({message:error.message||'Failed to load Development Budget Authority.'});}});
router.post('/budget-authority/events',requirePermission(PERMISSIONS.DEVELOPMENT_BUDGET_POST),async(req,res)=>{try{const result=await repo.postEvent(req.buildliteAuth.clientId,req.params.developmentId,req.body||{},req.buildliteAuth);res.status(result.status).json(result.ok?result:{message:result.message});}catch(error){res.status(error.status||500).json({message:error.message||'Failed to post Development Budget event.'});}});
module.exports=router;
