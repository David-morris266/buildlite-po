const { query } = require('../db');
const { assertServicePermission } = require('../auth/authorization');
const { PERMISSIONS } = require('../auth/permissions');
const { findDevelopmentById } = require('./developmentRepository');
const { getCvrPeriod, listCvrPeriods } = require('./cvrPeriodRepository');
const { buildWholeCvrCloseCandidate } = require('./cvrCommercialClose');
const { getDevelopmentProgramme } = require('./developmentProgrammeRepository');
const { getBrandContextForClient } = require('./brandProfile');

const money = value => value == null || !Number.isFinite(Number(value)) ? null : Math.round(Number(value)*100)/100;
const sum = (rows,key) => money(rows.reduce((total,row)=>total+(Number(row[key])||0),0));
const monthly = period => period?.periodType === 'monthly_cvr';
const periodNumber = key => Number(String(key||'').match(/^P(\d+)$/)?.[1]||-1);

function byHead(rows=[],fields=[]){const result=new Map();for(const row of rows||[]){const name=String(row.commercialHead||'Unallocated').trim()||'Unallocated';const item=result.get(name)||Object.fromEntries(fields.map(field=>[field,0]));for(const field of fields)item[field]+=Number(row[field])||0;result.set(name,item);}return result;}
function aggregateHeads(rows=[],previousRows=null,siteStartRows=null,gia=null){
  const current=byHead(rows,['finalForecast','costToComplete','changeExposure']);
  const previous=Array.isArray(previousRows)?byHead(previousRows,['finalForecast']):null;
  const baseline=Array.isArray(siteStartRows)?byHead(siteStartRows,['finalForecast']):null;
  const names=new Set([...current.keys(),...(previous?.keys()||[]),...(baseline?.keys()||[])]);
  return [...names].map(name=>{const currentEfc=current.get(name)?.finalForecast||0;const previousEfc=previous?(previous.get(name)?.finalForecast||0):null;const siteStartBudget=baseline?(baseline.get(name)?.finalForecast||0):null;return {name,siteStartBudget,previousEfc,currentEfc,costToComplete:current.get(name)?.costToComplete||0,changeExposure:current.get(name)?.changeExposure||0,periodMovement:previous?currentEfc-previousEfc:null,movementFromSiteStart:baseline?currentEfc-siteStartBudget:null,budgetVariance:baseline?currentEfc-siteStartBudget:null,efcPerFt2:gia?currentEfc/gia:null};}).sort((a,b)=>a.name.localeCompare(b.name));
}

function worksheetRows(currentRows=[],previousRows=null,siteStartRows=null,periodKey=''){
  const keyOf=row=>String(row?.costCodeKey||'').trim().toLowerCase();
  const current=new Map((currentRows||[]).map(row=>[keyOf(row),row]));
  const previous=Array.isArray(previousRows)?new Map(previousRows.map(row=>[keyOf(row),row])):null;
  const baseline=Array.isArray(siteStartRows)?new Map(siteStartRows.map(row=>[keyOf(row),row])):null;
  const keys=new Set([...current.keys(),...(previous?.keys()||[]),...(baseline?.keys()||[])]);
  const p01=periodNumber(periodKey)===1;
  return [...keys].filter(Boolean).map(key=>{
    const row=current.get(key)||{};
    const previousRow=previous?.get(key)||null;
    const baselineRow=baseline?.get(key)||null;
    const finalEfc=Number(row.finalForecast)||0;
    const siteStartBudget=baseline?Number(baselineRow?.finalForecast)||0:null;
    const previousEfc=previous?Number(previousRow?.finalForecast)||0:null;
    const comparator=previous?previousEfc:(p01&&baseline?siteStartBudget:null);
    return {
      commercialHead:String(row.commercialHead||previousRow?.commercialHead||baselineRow?.commercialHead||'Unallocated').trim()||'Unallocated',
      costCode:String(row.costCodeKey||previousRow?.costCodeKey||baselineRow?.costCodeKey||key),
      description:String(row.description||previousRow?.description||baselineRow?.description||''),
      siteStartBudget,
      actualCost:Number(row.actualCost)||0,
      committed:Number(row.committed)||0,
      certified:Number(row.certified)||0,
      costToComplete:Number(row.costToComplete)||0,
      uncommitted:Number(row.uncommittedForecast)||0,
      changeExposure:Number(row.changeExposure)||0,
      projectedAdjustment:Number(row.commercialAdjustment)||0,
      finalEfc,
      previousEfc,
      movement:comparator==null?null:money(finalEfc-comparator),
      benchmarkVariance:siteStartBudget==null?null:money(finalEfc-siteStartBudget),
    };
  }).sort((a,b)=>a.commercialHead.localeCompare(b.commercialHead)||a.costCode.localeCompare(b.costCode,undefined,{numeric:true,sensitivity:'base'}));
}

function worksheetTotals(rows=[]){
  const fields=['siteStartBudget','actualCost','committed','certified','costToComplete','uncommitted','changeExposure','projectedAdjustment','finalEfc','previousEfc','movement','benchmarkVariance'];
  return Object.fromEntries(fields.map(field=>[field,rows.some(row=>row[field]!=null)?sum(rows,field):null]));
}

function snapshotTotal(snapshot){return snapshot?.finalForecast==null?null:Number(snapshot.finalForecast);}
function rowsReconcile(snapshot){return snapshot&&money(sum(snapshot.rows||[],'finalForecast'))===money(snapshotTotal(snapshot));}

function auditActor(period,action){return period?.auditHistory?.find(entry=>entry.action===action)?.actor||null;}

async function buildCvrReportPayload({clientId,developmentId,periodId,auth,now=new Date(),validateWorksheet=false,deps={}}){
  assertServicePermission(auth,PERMISSIONS.COMMERCIAL_READ);
  if(String(auth.clientId)!==String(clientId)) return {ok:false,status:403,message:'Tenant boundary violation.'};
  const loadDevelopment=deps.findDevelopmentById||findDevelopmentById;
  const loadPeriod=deps.getCvrPeriod||getCvrPeriod;
  const loadPeriods=deps.listCvrPeriods||listCvrPeriods;
  const development=await loadDevelopment(clientId,developmentId);
  if(!development)return {ok:false,status:404,message:'Development not found.'};
  const found=await loadPeriod(clientId,developmentId,periodId);
  if(!found.ok)return found;
  const period=found.period;
  if(!monthly(period))return {ok:false,status:409,message:'CVR Summary reports are available for monthly CVR periods only.'};
  const periodsResult=await loadPeriods(clientId,developmentId);
  if(!periodsResult.ok)return periodsResult;
  const allPeriods=periodsResult.periods||[];
  const periods=allPeriods.filter(monthly).sort((a,b)=>periodNumber(a.periodKey)-periodNumber(b.periodKey));
  const prior=[...periods].filter(p=>p.status==='locked'&&periodNumber(p.periodKey)<periodNumber(period.periodKey)).pop()||null;
  const siteStart=[...allPeriods].filter(p=>p.status==='locked'&&(p.periodType==='site_start'||String(p.periodKey).toUpperCase()==='SITE_START')).pop()||null;
  let evidence;
  if(period.status==='locked') evidence=period.snapshot;
  else {
    const candidate=await (deps.buildWholeCvrCloseCandidate||buildWholeCvrCloseCandidate)({clientId,developmentId,periodId,
      variationExposureDocument:period.variationExposure?.document||null,
      developmentBudgetDocument:period.budgetSource?.document||null,
      commercialHierarchyDocument:period.commercialHierarchy?.document||null});
    if(!candidate?.ready||!candidate?.snapshot)return {ok:false,status:409,message:'Current governed CVR evidence is unavailable.',blockers:candidate?.blockers||[]};
    evidence=candidate.snapshot;
  }
  if(!evidence)return {ok:false,status:409,message:'Authoritative CVR snapshot is unavailable.'};
  const gia=evidence.giaEvidence?.availabilityState==='complete'&&Number(evidence.giaEvidence.totalActiveGia)>0?Number(evidence.giaEvidence.totalActiveGia):null;
  const previous=prior?.snapshot||null;
  const siteStartSnapshot=siteStart?.snapshot||null;
  if(previous&&!rowsReconcile(previous))return {ok:false,status:409,message:'Previous Locked CVR Head totals do not reconcile to its authoritative snapshot.'};
  if(siteStartSnapshot&&!rowsReconcile(siteStartSnapshot))return {ok:false,status:409,message:'Site Start Head totals do not reconcile to its authoritative snapshot.'};
  const heads=aggregateHeads(evidence.rows||[],previous?.rows||null,siteStartSnapshot?.rows||null,gia);
  const totals={siteStartBudget:snapshotTotal(siteStartSnapshot),previousEfc:snapshotTotal(previous),currentEfc:Number(evidence.finalForecast),costToComplete:Number(evidence.costToComplete),changeExposure:sum(heads,'changeExposure')};
  totals.periodMovement=previous?totals.currentEfc-totals.previousEfc:null;totals.movementFromSiteStart=siteStartSnapshot?totals.currentEfc-totals.siteStartBudget:null;totals.budgetVariance=totals.movementFromSiteStart;totals.efcPerFt2=gia?totals.currentEfc/gia:null;
  const reconciliation=[['EFC',evidence.finalForecast,sum(heads,'currentEfc')],['Cost to Complete',evidence.costToComplete,sum(heads,'costToComplete')],['Actual Cost',evidence.actualCost,sum(evidence.rows||[],'actualCost')]];
  const mismatch=reconciliation.find(([,header,rowTotal])=>header!=null&&money(header)!==money(rowTotal));
  if(mismatch)return {ok:false,status:409,message:`CVR report reconciliation failed for ${mismatch[0]}.`};
  const reportedPeriodNumber=periodNumber(period.periodKey);
  const lockedTrend=periods.filter(p=>p.status==='locked'&&periodNumber(p.periodKey)<=reportedPeriodNumber).slice(-7).map(p=>({periodKey:p.periodKey,reportingMonth:p.reportingMonth,margin:p.snapshot?.grossMarginPercent==null?null:Number(p.snapshot.grossMarginPercent)}));
  const programme=await (deps.getDevelopmentProgramme||getDevelopmentProgramme)(clientId,developmentId);
  const clientRow=deps.client||((await (deps.query||query)('SELECT id,name,code FROM clients WHERE id=$1',[clientId])).rows[0]);
  const brand=await (deps.getBrandContextForClient||getBrandContextForClient)(clientId,clientRow);
  const actualCost=evidence.actualCost==null?null:Number(evidence.actualCost),forecastRevenue=evidence.forecastRevenue==null?null:Number(evidence.forecastRevenue),efc=Number(evidence.finalForecast);
  const commentary=period.status==='locked'?(evidence.commentary||{}):(period.commentary||evidence.commentary||{});
  const movementFor=head=>prior?head.periodMovement:(periodNumber(period.periodKey)===1?head.movementFromSiteStart:null);
  const exceptions=heads.filter(h=>movementFor(h)!=null&&movementFor(h)!==0||h.changeExposure!==0).sort((a,b)=>Math.abs(movementFor(b)||0)-Math.abs(movementFor(a)||0)).slice(0,3).map(h=>({name:h.name,movement:movementFor(h),exposure:h.changeExposure,evidence:prior?'Monthly movement':periodNumber(period.periodKey)===1?'Movement from Site Start':'Change exposure'}));
  const giaPlotCount=evidence.giaEvidence?.totalPlotCount;
  const plotCount=period.status==='locked'
    ? (evidence.giaEvidence?.captured&&Number.isFinite(Number(giaPlotCount))?Number(giaPlotCount):null)
    : (evidence.giaEvidence&&evidence.giaEvidence.availabilityState!=='plot_master_missing'&&Number.isFinite(Number(giaPlotCount))?Number(giaPlotCount):null);
  const movementLabel=prior?'Period Movement':periodNumber(period.periodKey)===1?'Movement from Site Start':'Period Movement';
  const movementValue=prior?totals.periodMovement:periodNumber(period.periodKey)===1?totals.movementFromSiteStart:null;
  const costCodeRows=worksheetRows(evidence.rows||[],previous?.rows||null,siteStartSnapshot?.rows||null,period.periodKey);
  const costCodeTotals=worksheetTotals(costCodeRows);
  const worksheetReconciliation=[['EFC',evidence.finalForecast,costCodeTotals.finalEfc],['Actual Cost',evidence.actualCost,costCodeTotals.actualCost],['Cost to Complete',evidence.costToComplete,costCodeTotals.costToComplete],['Site Start Budget',totals.siteStartBudget,costCodeTotals.siteStartBudget],['Period Movement',movementValue,costCodeTotals.movement],['Benchmark Variance',totals.budgetVariance,costCodeTotals.benchmarkVariance]];
  const worksheetMismatch=worksheetReconciliation.find(([,header,rowTotal])=>header!=null&&money(header)!==money(rowTotal));
  if(validateWorksheet&&worksheetMismatch)return {ok:false,status:409,message:`CVR worksheet reconciliation failed for ${worksheetMismatch[0]}.`};
  return {ok:true,payload:{brand,development:{id:development.id,name:development.developmentName,number:development.jobNumber,plotCount:Number.isFinite(plotCount)?plotCount:null},period:{id:period.id,key:period.periodKey,label:period.periodLabel,reportingMonth:period.reportingMonth,status:period.status,provisional:period.status!=='locked'},
    kpis:{forecastRevenue,efc,grossProfit:evidence.grossProfit==null?null:Number(evidence.grossProfit),grossMarginPercent:evidence.grossMarginPercent==null?null:Number(evidence.grossMarginPercent),costToComplete:Number(evidence.costToComplete),budgetVariance:totals.budgetVariance,periodMovement:movementValue,movementLabel},
    performance:{gia,totalDevelopmentCostPerFt2:totals.efcPerFt2,actualCost,efcIncurredPercent:efc&&actualCost!=null?(actualCost/efc)*100:null,programme:programme.ok?programme.programme:null,giaState:evidence.giaEvidence?.availabilityState||'legacy_unavailable'},heads,totals,trend:{locked:lockedTrend,provisional:period.status==='locked'||evidence.grossMarginPercent==null?null:{periodKey:period.periodKey,margin:Number(evidence.grossMarginPercent)}},exceptions,commentary,
    worksheet:{rows:costCodeRows,totals:costCodeTotals,movementLabel,benchmarkLabel:'Variance from Approved Site Start Budget'},
    attribution:{created:period.createdBy||auditActor(period,'created')||null,submitted:period.submittedBy||auditActor(period,'submitted'),approved:period.approvedBy||auditActor(period,'locked')||evidence.createdBy||null},generatedAt:now.toISOString(),authority:{financial:period.status==='locked'?'immutable_snapshot':'governed_provisional',gia:period.status==='locked'?'frozen_snapshot':'current_plot_master'}}};}

module.exports={buildCvrReportPayload,aggregateHeads,worksheetRows,worksheetTotals};
