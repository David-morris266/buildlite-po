const STANDARD_VERSION = 1;

const lines = [
  ['sales-commission','Sales Commission / Estate Agents','PERCENT_REVENUE'],
  ['sales-legal','Sales Legal / Conveyancing','QUANTITY_RATE'],
  ['marketing-advertising','Marketing & Advertising','LUMP_SUM'],
  ['sales-signage','Sales Signage','LUMP_SUM'],
  ['show-home-furnishing','Show Home Furnishing','LUMP_SUM'],
  ['sales-office-setup','Sales Office / Marketing Suite Setup','LUMP_SUM'],
  ['sales-office-running','Sales Office / Show Home Running Costs','LUMP_SUM'],
  ['sales-landscaping','Sales Landscaping / External Presentation','LUMP_SUM'],
  ['sales-handover','Sales Handover / Welcome Packs','LUMP_SUM'],
  ['other-selling-costs','Other Selling Costs','LUMP_SUM'],
].map(([key,name,forecastDriver],index)=>({templateKey:`bl.selling.${key}`,name,forecastDriver,quantitySource:forecastDriver==='QUANTITY_RATE'?'MANUAL':null,unitCode:forecastDriver==='QUANTITY_RATE'?'PLOTS':null,displayOrder:index+1,enabled:true}));

function getBuildLiteStandardSellingCostsTemplate(){return {id:'standard',name:'BuildLite Standard Selling Costs',origin:'buildlite_standard',sourceStandardVersion:STANDARD_VERSION,version:STANDARD_VERSION,isDefault:false,simpleAssumptionPercent:2,simpleDestination:null,lines:lines.map(line=>({...line}))};}
module.exports={STANDARD_VERSION,getBuildLiteStandardSellingCostsTemplate};
