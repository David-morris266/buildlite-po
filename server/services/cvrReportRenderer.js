const Handlebars=require('../hbs-helpers');
const fs=require('fs');const path=require('path');
const {renderHtmlPdf}=require('./commercialDocumentRenderer');
Handlebars.registerHelper('money',value=>value==null?'Unavailable':new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(value));
Handlebars.registerHelper('signedMoney',value=>{
  if(value==null||!Number.isFinite(Number(value)))return 'Unavailable';
  const numeric=Number(value);if(numeric===0)return '£0';
  const absolute=new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(Math.abs(numeric));
  return `${numeric>0?'+':'−'}${absolute}`;
});
Handlebars.registerHelper('percent',value=>value==null||!Number.isFinite(Number(value))?'Unavailable':`${Number(value).toFixed(1)}%`);
Handlebars.registerHelper('perFt2',value=>value==null||!Number.isFinite(Number(value))?'Unavailable':`£${Number(value).toFixed(2)}/ft²`);
Handlebars.registerHelper('integer',value=>value==null||!Number.isFinite(Number(value))?'Unavailable':new Intl.NumberFormat('en-GB',{maximumFractionDigits:4}).format(value));
Handlebars.registerHelper('month',value=>{const match=String(value||'').match(/^(\d{4})-(\d{2})/);if(!match)return 'Reporting month unavailable';return new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(Number(match[1]),Number(match[2])-1,1)));});
Handlebars.registerHelper('date',value=>{if(!value)return 'Unavailable';const parsed=new Date(value);return Number.isNaN(parsed.getTime())?'Unavailable':new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(parsed);});
Handlebars.registerHelper('dateTime',value=>{const parsed=new Date(value);return Number.isNaN(parsed.getTime())?'Unavailable':new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Europe/London',timeZoneName:'short'}).format(parsed);});
Handlebars.registerHelper('actor',value=>String(value||'').trim()||'Pending / unavailable');
const template=Handlebars.compile(fs.readFileSync(path.join(__dirname,'..','templates','cvr-summary-report-v1.hbs'),'utf8'));

function trendPresentation(points,provisional){
  const available=points.filter(p=>p.margin!=null&&Number.isFinite(p.margin));
  const min=available.length?Math.min(...available.map(p=>p.margin)):0,max=available.length?Math.max(...available.map(p=>p.margin)):0;
  const pad=Math.max(1,(max-min)*.15),low=min-pad,high=max+pad,span=high-low||1;
  const yFor=value=>Math.max(10,Math.min(52,52-34*((value-low)/span)));
  const lockedEnd=provisional?248:288;
  const mapped=points.map((p,index)=>({...p,available:p.margin!=null&&Number.isFinite(p.margin),x:18+index*(points.length>1?(lockedEnd-18)/(points.length-1):0),y:p.margin==null?52:yFor(p.margin),label:p.margin==null?'—':`${p.margin.toFixed(1)}%`}));
  const segments=[];let current=[];
  for(const point of mapped){if(point.available)current.push(point);else if(current.length){segments.push(current);current=[];}}
  if(current.length)segments.push(current);
  const provisionalPoint=provisional?.margin!=null&&Number.isFinite(provisional.margin)?{...provisional,x:294,y:yFor(provisional.margin),label:`${provisional.margin.toFixed(1)}%`}:null;
  return {points:mapped,provisionalPoint,paths:segments.filter(x=>x.length>1).map(segment=>segment.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')),range:points.length?`${points[0].periodKey}–${points.at(-1).periodKey}`:'No eligible Locked history'};
}
function view(payload){
  const tone=v=>v>0?'adverse':v<0?'favourable':'neutral',trend=trendPresentation(payload.trend.locked,payload.trend.provisional);
  return {...payload,
    heads:payload.heads.map(h=>({...h,displayMovement:payload.kpis.movementLabel==='Movement from Site Start'?h.movementFromSiteStart:h.periodMovement,periodTone:tone(payload.kpis.movementLabel==='Movement from Site Start'?h.movementFromSiteStart:h.periodMovement),varianceTone:tone(h.budgetVariance)})),
    totals:{...payload.totals,displayMovement:payload.kpis.periodMovement,periodTone:tone(payload.kpis.periodMovement),varianceTone:tone(payload.totals.budgetVariance)},
    statusLabel:payload.period.provisional?`${payload.period.status.toUpperCase()} · PROVISIONAL`:'LOCKED',
    evidenceCaptions:{revenue:payload.kpis.forecastRevenue==null?'Revenue evidence unavailable':payload.authority.financial==='immutable_snapshot'?'Frozen Locked Revenue':'Governed provisional Revenue',efc:payload.authority.financial==='immutable_snapshot'?'Frozen Locked forecast':'Governed provisional forecast',siteStart:payload.totals.siteStartBudget==null?'Site Start evidence unavailable':'Fixed agreed Site Start baseline'},
    movementEvidenceLabel:payload.kpis.movementLabel==='Movement from Site Start'?'Initial Site Start comparator':payload.totals.previousEfc==null?'Previous Locked monthly CVR unavailable':'Previous Locked monthly CVR',
    programmeStart:payload.performance.programme?.siteStart||null,programmeFinish:payload.performance.programme?.finalCompletion||null,
    exceptions:payload.exceptions.map(item=>({...item,label:item.movement>0?'ADVERSE':item.movement<0?'FAVOURABLE':'EXPOSURE',tone:item.movement>0?'adverse':item.movement<0?'favourable':'neutral'})),
    commentaryItems:[['Issues',payload.commentary.keyCommercialIssues],['Opportunities',payload.commentary.commercialOpportunities],['Risks',payload.commentary.financialRisks],['Actions',payload.commentary.actionsBeforeNextCvr]].filter(x=>String(x[1]||'').trim()),
    trendPoints:trend.points,trendPaths:trend.paths,trendRange:trend.range,provisionalPoint:trend.provisionalPoint};
}
function renderCvrReportHtml(payload){return template(view(payload));}
async function renderCvrReportPdf(payload){const html=renderCvrReportHtml(payload);const pdf=await renderHtmlPdf(html,{capacityCheck:()=>{const page=document.querySelector('.page');const expected=Number(page.dataset.headCount);const actual=document.querySelectorAll('[data-head-row]').length;const fits=actual===expected&&page.scrollHeight<=page.clientHeight+1&&page.scrollWidth<=page.clientWidth+1;return {fits,message:fits?'':'CVR report exceeds one-page capacity; no Commercial Heads or commentary were omitted.'};}});return {html,pdf};}
module.exports={renderCvrReportHtml,renderCvrReportPdf,trendPresentation};
