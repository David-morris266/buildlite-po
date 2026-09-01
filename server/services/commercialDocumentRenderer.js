const fs=require('fs');
const path=require('path');
const puppeteer=require('puppeteer');
const Handlebars=require('../hbs-helpers');

const TEMPLATE_DIR=path.join(__dirname,'..','templates','commercial-documents');
const templates={payment_certificate:'payment-certificate-v1.hbs',payment_notice:'payment-notice-v1.hbs',combined_certificate_payment_notice:'combined-certificate-payment-notice-v1.hbs'};

function renderCommercialDocumentHtml(documentType,payload){
  const file=templates[documentType];if(!file)throw new Error(`Unsupported commercial document type: ${documentType}`);
  const source=fs.readFileSync(path.join(TEMPLATE_DIR,file),'utf8');
  return Handlebars.compile(source)(payload);
}

async function renderCommercialDocumentPdf(documentType,payload){
  const html=renderCommercialDocumentHtml(documentType,payload);
  const browser=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-setuid-sandbox']});
  try{const page=await browser.newPage();await page.setContent(html,{waitUntil:'domcontentloaded',timeout:15000});
    return Buffer.from(await page.pdf({format:'A4',printBackground:true,preferCSSPageSize:true,margin:{top:'10mm',right:'10mm',bottom:'10mm',left:'10mm'}}));
  }finally{await browser.close();}
}

module.exports={renderCommercialDocumentHtml,renderCommercialDocumentPdf};
