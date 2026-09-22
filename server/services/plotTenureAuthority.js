const PLOT_TENURE_CODES=new Set(['OPEN_MARKET','AFFORDABLE_RENT','SHARED_OWNERSHIP','FIRST_HOMES','ADDITIONALITY','DISCOUNT_MARKET_SALE','OTHER','UNREVIEWED']);
function normalizePlotTenureCode(value){const code=String(value||'').trim().toUpperCase();return PLOT_TENURE_CODES.has(code)?code:'UNREVIEWED';}
function resolvePlotQuantityEvidence(development,source){
  const plots=development?.plotMaster?.plots;
  const base={source,developmentId:development?.id||null,developmentVersion:Number(development?.version)||null,plotMasterUpdatedAt:development?.plotMaster?.updatedAt||null,plotMasterRecordCount:Array.isArray(plots)?plots.length:null};
  if(!Array.isArray(plots)||plots.length===0)return {...base,ready:false,quantity:null,classificationComplete:false,reason:'plot-master-missing-or-empty',message:'Plot Master is missing or empty; quantity is unavailable.'};
  if(source==='TOTAL_PLOTS')return {...base,ready:true,quantity:plots.length,classificationComplete:null};
  if(source==='PRIVATE_SALE_PLOTS'){const unresolved=plots.filter(plot=>normalizePlotTenureCode(plot.tenureCode)==='UNREVIEWED');if(unresolved.length)return {...base,ready:false,quantity:null,classificationComplete:false,unreviewedCount:unresolved.length,reason:'plot-tenure-unreviewed',message:`Review ${unresolved.length} Plot Master tenure classification${unresolved.length===1?'':'s'} before using private-sale quantity.`};return {...base,ready:true,quantity:plots.filter(plot=>normalizePlotTenureCode(plot.tenureCode)==='OPEN_MARKET').length,classificationComplete:true,unreviewedCount:0};}
  return {...base,ready:false,quantity:null,classificationComplete:null,reason:'manual-source'};
}
module.exports={PLOT_TENURE_CODES,normalizePlotTenureCode,resolvePlotQuantityEvidence};
