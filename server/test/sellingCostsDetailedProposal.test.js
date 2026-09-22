const test = require('node:test');
const assert = require('node:assert/strict');
const { lineForecast, buildDetailedProposal } = require('../services/sellingCostsDetailedProposal');

test('Detailed drivers use decimal-safe CVR money rounding', () => {
  assert.equal(lineForecast({forecastDriver:'PERCENT_REVENUE',percent:1.5},6575000),98625);
  assert.equal(lineForecast({forecastDriver:'LUMP_SUM',lumpSum:25000},6575000),25000);
  assert.equal(lineForecast({forecastDriver:'QUANTITY_RATE',quantity:6,rate:145.83},6575000),874.98);
});

test('Detailed proposal retains lines and aggregates duplicate stable Cost Code identities', () => {
  const destination={id:'cost-code-id',code:'6210',description:'Selling Costs',label:'6210 — Selling Costs',active:true};
  const template={id:'template',name:'Company',version:3,lines:[
    {id:'a',templateKey:'a',name:'A',forecastDriver:'LUMP_SUM',defaultLumpSum:10000,costCode:destination,enabled:true},
    {id:'b',templateKey:'b',name:'B',forecastDriver:'LUMP_SUM',defaultLumpSum:15000,costCode:destination,enabled:true},
    {id:'c',templateKey:'c',name:'Unmapped',forecastDriver:'LUMP_SUM',defaultLumpSum:5000,costCode:null,enabled:true},
  ]};
  const proposal=buildDetailedProposal({template,revenue:{ready:true,forecastRevenue:100000},assumptions:[]});
  assert.equal(proposal.forecastSellingCosts,25000);
  assert.equal(proposal.readyLineCount,2);assert.equal(proposal.unreadyLineCount,1);
  assert.deepEqual(proposal.costCodeAggregation.map(item=>[item.costCode.id,item.forecast,item.lineIds]),[['cost-code-id',25000,['a','b']]]);
  assert.equal(proposal.lines[2].forecast,5000);assert.deepEqual(proposal.lines[2].issues,['mapping']);
  assert.equal(proposal.costCodeAggregation[0].lines.length,2);
  assert.equal(proposal.costCodeAggregation[0].forecast,25000);
  assert.match(proposal.costCodeAggregation[0].aggregateFingerprint,/^[a-f0-9]{64}$/);
  assert.match(proposal.proposalEvidenceFingerprint,/^[a-f0-9]{64}$/);
});

test('development overrides do not mutate inherited template values', () => {
  const template={id:'t',name:'Company',version:1,lines:[{id:'a',name:'Legal',forecastDriver:'QUANTITY_RATE',defaultQuantity:2,defaultRate:100,unitLabel:'plots',enabled:true,costCode:{id:'x',active:true}}]};
  const proposal=buildDetailedProposal({template,revenue:{ready:true,forecastRevenue:1},assumptions:[{templateLineId:'a',driver:'QUANTITY_RATE',quantity:3,rate:125,unitLabel:'plots',assumptionOverridden:true,destinationOverridden:false}]});
  assert.equal(proposal.lines[0].forecast,375);assert.equal(template.lines[0].defaultQuantity,2);
});

test('system Plot Master quantities resolve dynamically with truthful evidence', () => {
  const destination={id:'x',active:true};
  const development={id:'dev',version:4,plotMaster:{updatedAt:'2026-09-21T10:00:00Z',plots:[{tenureCode:'OPEN_MARKET'},{tenureCode:'AFFORDABLE_RENT'},{tenureCode:'OPEN_MARKET'}]}};
  const template={id:'t',name:'Company',version:1,lines:[
    {id:'total',name:'Legal',forecastDriver:'QUANTITY_RATE',quantitySource:'TOTAL_PLOTS',unitCode:'PLOTS',defaultRate:100,enabled:true,costCode:destination},
    {id:'private',name:'Commission',forecastDriver:'QUANTITY_RATE',quantitySource:'PRIVATE_SALE_PLOTS',unitCode:'PLOTS',defaultRate:250,enabled:true,costCode:destination},
  ]};
  const proposal=buildDetailedProposal({template,revenue:{ready:true,forecastRevenue:999},development});
  assert.equal(proposal.lines[0].resolvedQuantity,3);assert.equal(proposal.lines[0].forecast,300);
  assert.equal(proposal.lines[1].resolvedQuantity,2);assert.equal(proposal.lines[1].forecast,500);
  assert.equal(proposal.lines[1].quantityEvidence.developmentVersion,4);
  assert.equal(proposal.forecastSellingCosts,800);
});

test('private-sale quantity fails closed for unreviewed tenure while total plots remains ready', () => {
  const destination={id:'x',active:true};
  const development={id:'dev',plotMaster:{plots:[{tenure:'Private',tenureCode:'UNREVIEWED'},{tenureCode:'OPEN_MARKET'}]}};
  const template={id:'t',name:'Company',version:1,lines:[
    {id:'total',name:'Total',forecastDriver:'QUANTITY_RATE',quantitySource:'TOTAL_PLOTS',defaultRate:1,enabled:true,costCode:destination},
    {id:'private',name:'Private',forecastDriver:'QUANTITY_RATE',quantitySource:'PRIVATE_SALE_PLOTS',defaultRate:1,enabled:true,costCode:destination},
  ]};
  const proposal=buildDetailedProposal({template,revenue:{ready:true},development});
  assert.equal(proposal.lines[0].ready,true);assert.equal(proposal.lines[0].forecast,2);
  assert.equal(proposal.lines[1].ready,false);assert.deepEqual(proposal.lines[1].issues,['quantity_source']);
  assert.equal(proposal.lines[1].quantityEvidence.unreviewedCount,1);
});

test('missing and empty Plot Masters are unavailable rather than zero', () => {
  const template={id:'t',name:'Company',version:1,lines:[{id:'a',name:'Plots',forecastDriver:'QUANTITY_RATE',quantitySource:'TOTAL_PLOTS',defaultRate:10,enabled:true,costCode:{id:'x',active:true}}]};
  for(const development of [{id:'dev'},{id:'dev',plotMaster:{plots:[]}}]){
    const proposal=buildDetailedProposal({template,revenue:{ready:true},development});
    assert.equal(proposal.lines[0].forecast,null);assert.equal(proposal.lines[0].ready,false);
  }
});

test('Development Lump Sum override to private-sale Quantity Rate uses the effective driver', () => {
  const destination={id:'x',code:'6110',description:'Sales Legal',active:true};
  const template={id:'t',name:'Company',version:1,lines:[{id:'legal',name:'Sales Legal',forecastDriver:'LUMP_SUM',defaultLumpSum:25000,quantitySource:'MANUAL',enabled:true,costCode:destination}]};
  const assumptions=[{templateLineId:'legal',driver:'QUANTITY_RATE',quantitySource:'PRIVATE_SALE_PLOTS',unitCode:'PLOTS',rate:500,assumptionOverridden:true,destinationOverridden:false}];
  const plots=Array.from({length:24},(_,index)=>({id:`p${index+1}`,tenureCode:index<20?'OPEN_MARKET':'AFFORDABLE_RENT'}));
  const first=buildDetailedProposal({template,revenue:{ready:true,forecastRevenue:8341500},assumptions,development:{id:'dev',version:2,plotMaster:{plots}}});
  assert.equal(first.lines[0].forecastDriver,'QUANTITY_RATE');
  assert.equal(first.lines[0].resolvedQuantity,20);
  assert.equal(first.lines[0].forecast,10000);
  assert.equal(first.lines[0].ready,true);
  assert.equal(first.lines[0].companyAssumption.driver,'LUMP_SUM');
  const changed=buildDetailedProposal({template,revenue:{ready:true,forecastRevenue:8341500},assumptions,development:{id:'dev',version:3,plotMaster:{plots:plots.map((plot,index)=>index===19?{...plot,tenureCode:'AFFORDABLE_RENT'}:plot)}}});
  assert.equal(changed.lines[0].resolvedQuantity,19);
  assert.notEqual(changed.quantityEvidenceFingerprint,first.quantityEvidenceFingerprint);
});

test('Detailed proposal preserves independent assumption and destination authority in all four states', () => {
  const companyDestination={id:'company-code',code:'6210',description:'Company Selling Costs',active:true};
  const developmentDestination={id:'development-code',code:'6170',description:'Sales Office Set-up',active:true};
  const template={id:'t',name:'Company',version:1,lines:[{id:'furnishing',name:'Show Home Furnishing',forecastDriver:'LUMP_SUM',defaultLumpSum:null,quantitySource:'MANUAL',unitCode:'EACH',enabled:true,costCode:companyDestination}]};
  const development={id:'dev',plotMaster:{plots:Array.from({length:20},()=>({tenureCode:'OPEN_MARKET'}))}};
  const developmentAssumption={templateLineId:'furnishing',driver:'QUANTITY_RATE',quantitySource:'PRIVATE_SALE_PLOTS',unitCode:'PLOTS',rate:500,assumptionOverridden:true};
  const states=[
    {assumptionOverridden:false,destinationOverridden:false,driver:'LUMP_SUM',destinationId:'company-code',destinationCostCodeId:null},
    {assumptionOverridden:true,destinationOverridden:false,driver:'QUANTITY_RATE',destinationId:'company-code',destinationCostCodeId:null},
    {assumptionOverridden:false,destinationOverridden:true,driver:'LUMP_SUM',destinationId:'development-code',destinationCostCodeId:'development-code'},
    {assumptionOverridden:true,destinationOverridden:true,driver:'QUANTITY_RATE',destinationId:'development-code',destinationCostCodeId:'development-code'},
  ];
  for (const state of states) {
    const assumption={
      templateLineId:'furnishing',
      ...(state.assumptionOverridden?developmentAssumption:{}),
      assumptionOverridden:state.assumptionOverridden,
      destinationOverridden:state.destinationOverridden,
      destinationCostCodeId:state.destinationOverridden?'development-code':null,
      destination:state.destinationOverridden?developmentDestination:null,
    };
    const line=buildDetailedProposal({template,revenue:{ready:true},assumptions:[assumption],development}).lines[0];
    assert.equal(line.assumptionOverridden,state.assumptionOverridden);
    assert.equal(line.destinationOverridden,state.destinationOverridden);
    assert.equal(line.forecastDriver,state.driver);
    assert.equal(line.destination.id,state.destinationId);
    assert.equal(line.destinationCostCodeId,state.destinationCostCodeId);
    assert.equal(line.companyDestination.id,'company-code');
  }
});

test('Hawthorn-shaped independent reversions retain the untouched authority domain', () => {
  const destination={id:'6170-id',code:'6170',description:'Sales Office Set-up',active:true};
  const template={id:'t',name:'Company',version:1,lines:[{id:'furnishing',name:'Show Home Furnishing',forecastDriver:'LUMP_SUM',defaultLumpSum:null,quantitySource:'MANUAL',unitCode:'EACH',enabled:true,costCode:null}]};
  const development={id:'dev',plotMaster:{plots:Array.from({length:20},()=>({tenureCode:'OPEN_MARKET'}))}};
  const assumptionReverted=buildDetailedProposal({template,revenue:{ready:true},development,assumptions:[{templateLineId:'furnishing',assumptionOverridden:false,destinationOverridden:true,destinationCostCodeId:'6170-id',destination}] }).lines[0];
  assert.equal(assumptionReverted.forecastDriver,'LUMP_SUM');
  assert.equal(assumptionReverted.destinationCostCodeId,'6170-id');
  assert.equal(assumptionReverted.destination.id,'6170-id');
  assert.deepEqual(assumptionReverted.issues,['assumption']);

  const mappingReverted=buildDetailedProposal({template,revenue:{ready:true},development,assumptions:[{templateLineId:'furnishing',driver:'QUANTITY_RATE',quantitySource:'PRIVATE_SALE_PLOTS',unitCode:'PLOTS',rate:500,assumptionOverridden:true,destinationOverridden:false,destinationCostCodeId:null,destination:null}] }).lines[0];
  assert.equal(mappingReverted.forecast,10000);
  assert.equal(mappingReverted.assumptionOverridden,true);
  assert.equal(mappingReverted.destinationOverridden,false);
  assert.deepEqual(mappingReverted.issues,['mapping']);
});
