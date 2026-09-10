const test=require('node:test');
const assert=require('node:assert/strict');
const {buildCvrCloseCandidate}=require('../services/cvrCloseEngine');
const {sourceOk}=require('../services/cvrCloseSources');

test('adopted Development Budget is complete authority and preserves non-budget inputs',async()=>{
 const clientId='00000000-0000-4000-8000-000000000001',developmentId='dev-budget-overlay',periodId='00000000-0000-4000-8000-000000000002';
 const candidate=await buildCvrCloseCandidate({clientId,developmentId,periodId,
  developmentBudgetDocument:{positions:[{costCode:'4120',originalPence:10000000,currentPence:10800000},{costCode:'4130',originalPence:5000000,currentPence:4700000},{costCode:'4230',originalPence:2500000,currentPence:2500000},{costCode:'4240',originalPence:1000000,currentPence:1000000},{costCode:'4250',originalPence:500000,currentPence:500000}]},
  loadSources:async()=>({ok:true,sources:{development:sourceOk({id:developmentId}),period:sourceOk({id:periodId,clientId,developmentId,periodKey:'P01',commentary:{}}),inputs:sourceOk([
   {costCodeKey:'4120',costCodeLabel:'4120 — Brickwork',originalBudget:245000,currentBudget:245000,commercialAdjustment:15000,manualAccrual:0},
   {costCodeKey:'1100',costCodeLabel:'1100 — Land Cost',originalBudget:1650000,currentBudget:1650000,commercialAdjustment:2500,manualAccrual:7000},
  ]),purchaseOrders:sourceOk([]),commercialEvents:sourceOk([]),variationOrders:sourceOk([]),certificates:sourceOk([]),ledger:sourceOk([])}})});
 assert.equal(candidate.ready,true); const rows=candidate.snapshot.rows; const brick=rows.find(r=>r.costCodeKey==='4120'),land=rows.find(r=>r.costCodeKey==='1100');
 assert.equal(brick.originalBudget,100000); assert.equal(brick.currentBudget,108000); assert.equal(brick.commercialAdjustment,15000);
 assert.equal(land.originalBudget,0); assert.equal(land.currentBudget,0); assert.equal(land.commercialAdjustment,2500); assert.equal(land.manualAccrual,7000);
 assert.equal(rows.reduce((s,r)=>s+r.originalBudget,0),190000); assert.equal(candidate.snapshot.currentBudget,195000);
});
