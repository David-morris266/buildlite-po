const express=require('express');
const {accept}=require('../services/tenantMembershipService');
const router=express.Router();
router.post('/accept',async(req,res)=>{try{res.json({ok:true,...await accept({token:req.body?.token,identity:req.invitationIdentity})});}catch(error){res.status(error.status||500).json({message:error.message||'Invitation could not be accepted.',code:error.code});}});
module.exports=router;
