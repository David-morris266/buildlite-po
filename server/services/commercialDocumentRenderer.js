const fs=require('fs');
const path=require('path');
const puppeteer=require('puppeteer');
const Handlebars=require('../hbs-helpers');

const TEMPLATE_DIR=path.join(__dirname,'..','templates','commercial-documents');
Handlebars.registerPartial('certificate-valuation-schedule',fs.readFileSync(path.join(TEMPLATE_DIR,'certificate-valuation-schedule.hbs'),'utf8'));
const templates={payment_certificate:'payment-certificate-v1.hbs',payment_notice:'payment-notice-v1.hbs',combined_certificate_payment_notice:'combined-certificate-payment-notice-v1.hbs',pay_less_notice:'pay-less-notice-v1.hbs'};

function renderCommercialDocumentHtml(documentType,payload){
  const file=templates[documentType];if(!file)throw new Error(`Unsupported commercial document type: ${documentType}`);
  const source=fs.readFileSync(path.join(TEMPLATE_DIR,file),'utf8');
  return Handlebars.compile(source)(payload);
}

async function renderCommercialDocumentPdf(documentType,payload,options={}){
  const html=renderCommercialDocumentHtml(documentType,payload);
  return renderHtmlPdf(html,options);
}

async function renderHtmlPdf(html,{capacityCheck=null,signal=null,timeoutMs=null,executablePath=null}={}){
  if(signal?.aborted)throw new Error('PDF preparation cancelled.');
  let expired=false;
  const browser=await puppeteer.launch({headless:true,...(executablePath?{executablePath}:{}),...(timeoutMs?{timeout:10000}:{}),args:['--no-sandbox','--disable-setuid-sandbox']});
  const cancel=()=>{expired=true;browser.close().catch(()=>{});};
  const timer=timeoutMs?setTimeout(cancel,timeoutMs):null;
  signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted)cancel();
  try{const page=await browser.newPage();await page.setContent(html,{waitUntil:'domcontentloaded',timeout:15000});
    if(signal?.aborted || expired)throw new Error('PDF preparation cancelled or timed out.');
    if(capacityCheck){
      const capacity=await page.evaluate(capacityCheck);
      if(!capacity?.fits){const error=new Error(capacity?.message||'Report content exceeds one-page capacity.');error.code='REPORT_CAPACITY_EXCEEDED';error.status=422;throw error;}
    }
    return Buffer.from(await page.pdf({format:'A4',printBackground:true,preferCSSPageSize:true,margin:{top:'10mm',right:'10mm',bottom:'10mm',left:'10mm'}}));
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);await browser.close();}
}

module.exports={renderCommercialDocumentHtml,renderCommercialDocumentPdf,renderHtmlPdf};
