const { roundPlotMoney } = require('./cvrRevenueCloseFormulas');
const { resolvePlotQuantityEvidence } = require('./plotTenureAuthority');
const { createHash } = require('node:crypto');

const asNumber = (value) => value == null || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const stableHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function lineEvidence(line) {
  return {
    id: line.id,
    templateKey: line.templateKey || null,
    name: line.name,
    version: Number(line.version) || 0,
    driver: line.forecastDriver,
    percent: asNumber(line.percent),
    lumpSum: asNumber(line.lumpSum),
    quantity: asNumber(line.quantity),
    quantitySource: line.quantitySource,
    resolvedQuantity: asNumber(line.resolvedQuantity),
    quantityEvidence: line.quantityEvidence || null,
    rate: asNumber(line.rate),
    unitCode: line.unitCode,
    customUnitLabel: line.customUnitLabel || null,
    assumptionOverridden: Boolean(line.assumptionOverridden),
    destinationOverridden: Boolean(line.destinationOverridden),
    destinationCostCodeId: line.destination?.id || null,
    destinationCostCodeKey: line.destination?.code || null,
    forecast: asNumber(line.forecast),
  };
}
function lineForecast(line, revenue) {
  if (line.forecastDriver === 'PERCENT_REVENUE') return revenue == null || asNumber(line.percent)==null ? null : roundPlotMoney(revenue * asNumber(line.percent) / 100);
  if (line.forecastDriver === 'LUMP_SUM') return asNumber(line.lumpSum)==null ? null : roundPlotMoney(line.lumpSum);
  if (line.forecastDriver === 'QUANTITY_RATE') return asNumber(line.resolvedQuantity ?? line.quantity)==null || asNumber(line.rate)==null ? null : roundPlotMoney(asNumber(line.resolvedQuantity ?? line.quantity)*asNumber(line.rate));
  return null;
}
function buildDetailedProposal({template,revenue,assumptions=[],development=null}) {
  const saved=new Map(assumptions.map(line=>[line.templateLineId,line]));
  const lines=(template?.lines||[]).filter(line=>line.enabled).map(line=>{
    const override=saved.get(line.id)||{};
    const mapped=override.destinationOverridden ? override.destination : line.costCode;
    const effectiveDriver=override.assumptionOverridden?override.driver:line.forecastDriver;
    const quantitySource=override.assumptionOverridden?(override.quantitySource||'MANUAL'):(line.quantitySource||'MANUAL');
    const unitCode=quantitySource==='MANUAL'?(override.assumptionOverridden?(override.unitCode||line.unitCode||'EACH'):(line.unitCode||'EACH')):'PLOTS';
    const customUnitLabel=unitCode==='CUSTOM'?(override.assumptionOverridden?override.customUnitLabel:line.customUnitLabel):null;
    const quantityEvidence=effectiveDriver==='QUANTITY_RATE'&&quantitySource!=='MANUAL'?resolvePlotQuantityEvidence(development,quantitySource):null;
    const resolvedQuantity=quantitySource==='MANUAL'?(override.assumptionOverridden?override.quantity:line.defaultQuantity):(quantityEvidence?.ready?quantityEvidence.quantity:null);
    const companyAssumption={driver:line.forecastDriver,percent:line.defaultPercent,lumpSum:line.defaultLumpSum,quantity:line.defaultQuantity,rate:line.defaultRate,quantitySource:line.quantitySource||'MANUAL',unitCode:line.unitCode||'EACH',customUnitLabel:line.customUnitLabel||null};
    const composed={id:line.id,templateKey:line.templateKey,name:line.name,forecastDriver:effectiveDriver,percent:override.assumptionOverridden?override.percent:line.defaultPercent,lumpSum:override.assumptionOverridden?override.lumpSum:line.defaultLumpSum,quantity:override.assumptionOverridden?override.quantity:line.defaultQuantity,resolvedQuantity,rate:override.assumptionOverridden?override.rate:line.defaultRate,quantitySource,quantityEvidence,unitCode,customUnitLabel,unitLabel:unitCode==='CUSTOM'?customUnitLabel:unitCode,destinationCostCodeId:override.destinationOverridden?(override.destinationCostCodeId??override.destination?.id??null):null,destination:mapped||null,companyDestination:line.costCode||null,companyAssumption,assumptionOverridden:Boolean(override.assumptionOverridden),destinationOverridden:Boolean(override.destinationOverridden),version:override.version||0};
    const forecast=lineForecast(composed,revenue?.ready?revenue.forecastRevenue:null);const sourceReady=!quantityEvidence||quantityEvidence.ready;const assumptionsReady=forecast!=null&&sourceReady;const mappingReady=Boolean(mapped?.id&&mapped?.active!==false);return {...composed,forecast,ready:assumptionsReady&&mappingReady,issues:[...(!sourceReady?['quantity_source']:[]),...(sourceReady&&forecast==null?['assumption']:[]),...(!mappingReady?['mapping']:[])]};
  });
  const aggregateMap=new Map();for(const line of lines.filter(item=>item.ready)){const id=line.destination.id,current=aggregateMap.get(id)||{costCode:line.destination,forecast:0,lineIds:[],lines:[]};current.forecast=roundPlotMoney(current.forecast+line.forecast);current.lineIds.push(line.id);current.lines.push(lineEvidence(line));aggregateMap.set(id,current);}
  const costCodeAggregation=[...aggregateMap.values()].map(item=>({...item,lineIds:[...item.lineIds].sort(),lines:[...item.lines].sort((a,b)=>String(a.id).localeCompare(String(b.id)))})).sort((a,b)=>String(a.costCode.id).localeCompare(String(b.costCode.id))).map(item=>({...item,aggregateFingerprint:stableHash({destinationCostCodeId:item.costCode.id,destinationCostCodeKey:item.costCode.code,forecast:item.forecast,lines:item.lines})}));
  const quantityEvidenceFingerprint=createHash('sha256').update(JSON.stringify(lines.map(line=>({id:line.id,source:line.quantitySource,resolvedQuantity:line.resolvedQuantity,evidence:line.quantityEvidence||null})))).digest('hex');
  const proposalEvidence={template:template?{id:template.id,version:template.version}:null,forecastRevenue:revenue?.forecastRevenue??null,quantityEvidenceFingerprint,lines:lines.map(lineEvidence).sort((a,b)=>String(a.id).localeCompare(String(b.id))),aggregates:costCodeAggregation.map(item=>({destinationCostCodeId:item.costCode.id,destinationCostCodeKey:item.costCode.code,forecast:item.forecast,aggregateFingerprint:item.aggregateFingerprint}))};
  return {mode:'detailed',template:template?{id:template.id,name:template.name,version:template.version}:null,revenue,forecastRevenue:revenue?.forecastRevenue??null,lines,quantityEvidenceFingerprint,proposalEvidenceFingerprint:stableHash(proposalEvidence),readyLineCount:lines.filter(line=>line.ready).length,unreadyLineCount:lines.filter(line=>!line.ready).length,forecastSellingCosts:roundPlotMoney(lines.filter(line=>line.ready).reduce((sum,line)=>sum+line.forecast,0)),costCodeAggregation};
}
module.exports={asNumber,lineForecast,lineEvidence,buildDetailedProposal};
