const express=require('express');
const {PERMISSIONS}=require('../auth/permissions');
const {requirePermission}=require('../auth/authorization');
const repo=require('../services/sellingCostsTemplateRepository');
const {getBuildLiteStandardSellingCostsTemplate}=require('../services/buildliteStandardSellingCostsTemplate');
const router=express.Router();
function send(res,result,key,status=200){if(!result.ok)return res.status(result.status||400).json({message:result.message,template:result.template});return res.status(result.status||status).json(key?result[key]:result);}
function guarded(handler, message) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      console.error('[Selling Costs Templates] route error:', error);
      if (!res.headersSent) res.status(500).json({ message });
    }
  };
}
router.get('/standard',requirePermission(PERMISSIONS.COMMERCIAL_READ),(req,res)=>res.json(getBuildLiteStandardSellingCostsTemplate()));
router.get('/',requirePermission(PERMISSIONS.COMMERCIAL_READ),guarded(async(req,res)=>send(res,await repo.listTemplates(req.buildliteAuth.clientId),'templates'),'Failed to load Selling Costs templates.'));
router.post('/',requirePermission(PERMISSIONS.COMMERCIAL_TEMPLATES_MANAGE),guarded(async(req,res)=>send(res,await repo.createTemplate(req.buildliteAuth.clientId,req.body||{},req.buildliteAuth),'template',201),'Failed to create Selling Costs template.'));
router.get('/:id',requirePermission(PERMISSIONS.COMMERCIAL_READ),guarded(async(req,res)=>send(res,await repo.getTemplate(req.buildliteAuth.clientId,req.params.id),'template'),'Failed to load Selling Costs template.'));
router.put('/:id',requirePermission(PERMISSIONS.COMMERCIAL_TEMPLATES_MANAGE),guarded(async(req,res)=>send(res,await repo.updateTemplate(req.buildliteAuth.clientId,req.params.id,req.body||{},req.buildliteAuth),'template'),'Failed to save Selling Costs template.'));
module.exports=router;
