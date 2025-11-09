// server/services/pdf.js
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// Registers Handlebars + your helpers (formatMoney, formatDate, etc.)
const Handlebars = require('../hbs-helpers');

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'po.hbs');

// Try a few common paths/casings for the logo and embed as data URI
const LOGO_CANDIDATES = [
  path.join(__dirname, '..', 'brand', 'cotswold-oak-logo.png'),
  path.join(__dirname, '..', 'Brand', 'cotswold-oak-logo.png'),
  path.join(__dirname, '..', 'Brand', 'Cotswold-oak-logo.png'),
  path.join(__dirname, '..', 'Brand', 'Cotswold-Oak-Logo.png'),
];

function getLogoDataURL() {
  for (const p of LOGO_CANDIDATES) {
    try {
      if (fs.existsSync(p)) {
        const b64 = fs.readFileSync(p).toString('base64');
        return `data:image/png;base64,${b64}`;
      }
    } catch (_) { /* ignore and try next */ }
  }
  return null;
}

/** Map your stored PO shape -> template context the .hbs expects */
function mapPOToContext(po) {
  const vatRate = Number(po.vatRateDefault ?? po.totals?.vatRate ?? 0.2) || 0;

  const subtotal = Number(
    po.subtotal ??
    po.totals?.net ??
    (Array.isArray(po.items) ? po.items.reduce((s, i) => s + (Number(i.amount) || 0), 0) : 0)
  ) || 0;

  const vat = +(subtotal * vatRate).toFixed(2);
  const total = +(subtotal + vat).toFixed(2);

  const supplier = po.supplierSnapshot ?? {};
  const address = {
    line1: [supplier.address1, supplier.address2].filter(Boolean).join(', ') || '',
    town: supplier.city || '',
    postcode: supplier.postcode || ''
  };

  const lines = (po.items || []).map(it => ({
    description: it.description || '',
    qty: Number(it.qty) || 0,
    unit: it.uom || it.unit || 'nr',
    rate: Number(it.rate) || 0,
    total: Number(
      it.amount != null ? it.amount :
      (Number(it.qty) || 0) * (Number(it.rate) || 0)
    ) || 0,
    costCode: it.costCode || ''
  }));

  const hasCostCode = lines.some(l => l.costCode && l.costCode.trim() !== '');

  // Status flags (for watermark/stamps)
  const status = String(po.status || 'Issued');
  const isApproved = status.toLowerCase() === 'approved';
  const isRejected = status.toLowerCase() === 'rejected';
  const isPending  = status.toLowerCase() === 'pending' || status.toLowerCase() === 'issued';

  const brand = {
   company: 'Cotswold Oak Ltd',
  address: 'Unit 4, Weston Industrial Estate, Honeybourne, Evesham, Worcestershire, WR11 7QB',
  companyNo: '05041616',
  vatNo: 'TBC',
  phone: '01633 898086',
  email: 'applications@cotswoldoakltd.co.uk',
  website: 'www.cotswoldoak.co.uk',
  color: '#1e233a',
  logo: getLogoDataURL(),
  showWordmark: false,               // <-- NEW: hide text next to logo
  shortName: 'Cotswold Oak',         // used only if showWordmark=true
  strapline: 'SUPERIOR HOMES BUILT WITH STYLE'
  };
  
  return {
    brand,
    po: {
      number: po.poNumber,
      date: po.createdAt || new Date().toISOString(),
      status,
      currency: 'GBP',
      subtotal,
      vat,
      total
    },
    project: {
      jobCode: po.costRef?.jobCode || '',
      jobId: po.costRef?.jobId || ''
    },
    supplier: {
      name: supplier.name || String(po.supplierId || ''),
      address,
      contactName: supplier.contactName || ''
    },
    lines,
    hasCostCode,
    approval: {
      approver: po.approval?.approver || '',
      note: po.approval?.note || '',
      decidedAt: po.approval?.decidedAt || ''
    },
    flags: { isApproved, isRejected, isPending },
  };
}

/** Render PDF from the mapped context using Puppeteer */
async function renderPOToPDF(ctx, { draft = false } = {}) {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`PO template not found at ${TEMPLATE_PATH}`);
  }
  const templateSrc = fs.readFileSync(TEMPLATE_PATH, 'utf8') || '';
  const compile = Handlebars.compile(templateSrc);

  const html = compile({ ...ctx, draft });
  if (!html || !html.trim()) {
    throw new Error('Template rendered empty HTML (likely missing context fields)');
  }

  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    // Make sure images/data-uris render as screen media
    await page.emulateMediaType('screen');
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', right: '10mm', bottom: '0mm', left: '10mm' }
    });

    if (!pdf || !pdf.length) throw new Error('Puppeteer returned empty PDF buffer');
    return pdf;
  } finally {
    await browser.close();
  }
}

module.exports = { mapPOToContext, renderPOToPDF };
