const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizePlotTenureCode,resolvePlotQuantityEvidence}=require('../services/plotTenureAuthority');

test('controlled tenure classification never infers from free text',()=>{
  assert.equal(normalizePlotTenureCode('OPEN_MARKET'),'OPEN_MARKET');
  assert.equal(normalizePlotTenureCode('Private'),'UNREVIEWED');
  assert.equal(normalizePlotTenureCode(''),'UNREVIEWED');
});

test('cancelled or removed plots disappear from the live quantity naturally',()=>{
  const development={id:'d',version:2,plotMaster:{updatedAt:'now',plots:[{tenureCode:'OPEN_MARKET'},{tenureCode:'AFFORDABLE_RENT'}]}};
  assert.equal(resolvePlotQuantityEvidence(development,'TOTAL_PLOTS').quantity,2);
  development.plotMaster.plots.pop();
  assert.equal(resolvePlotQuantityEvidence(development,'TOTAL_PLOTS').quantity,1);
});
