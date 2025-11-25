// server/services/pdf.js
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// Registers Handlebars + helpers (formatMoney, formatDate, etc.)
const Handlebars = require('../hbs-helpers');

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'po.hbs');

// Data paths for enriching old POs (no job snapshot saved)
const DATA_DIR  = path.join(__dirname, '..', 'data');
const JOBS_PATH = path.join(DATA_DIR, 'jobs.json');

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
    } catch {
      // ignore, try next candidate
    }
  }
  return null;
}

function readJSONSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8') || '';
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * Map stored PO shape -> template context the po.hbs expects
 */
function mapPOToContext(po) {
  /* ----- Money totals ----- */
  const vatRate =
    Number(po.vatRateDefault ?? po.totals?.vatRate ?? 0.2) || 0;

  const subtotal =
    Number(
      po.subtotal ??
        po.totals?.net ??
        (Array.isArray(po.items)
          ? po.items.reduce(
              (s, i) => s + (Number(i.amount) || 0),
              0
            )
          : 0)
    ) || 0;

  const vat   = +(subtotal * vatRate).toFixed(2);
  const total = +(subtotal + vat).toFixed(2);

  /* ----- Supplier ----- */
  const supplierSnap = po.supplierSnapshot ?? {};
  const address = {
    line1:
      [supplierSnap.address1, supplierSnap.address2]
        .filter(Boolean)
        .join(', ') || '',
    town: supplierSnap.city || '',
    postcode: supplierSnap.postcode || '',
  };

  const supplier = {
    name: supplierSnap.name || String(po.supplierId || ''),
    address,
    contactName: supplierSnap.contactName || '',
    phone: supplierSnap.phone || supplierSnap.contactPhone || '',
    email: supplierSnap.email || supplierSnap.contactEmail || '',
  };

  /* ----- Lines ----- */
  const lines = (po.items || []).map((it) => ({
    description: it.description || '',
    qty: Number(it.qty ?? it.quantity) || 0,
    unit: it.uom || it.unit || 'nr',
    rate: Number(it.rate ?? it.unitRate) || 0,
    total:
      Number(
        it.amount != null
          ? it.amount
          : (Number(it.qty ?? it.quantity) || 0) *
              (Number(it.rate ?? it.unitRate) || 0)
      ) || 0,
    costCode: it.costCode || '',
  }));

  const hasCostCode = lines.some(
    (l) => l.costCode && l.costCode.trim() !== ''
  );

  /* ----- Status / flags ----- */
  const rawStatus = String(
    po.approval?.status || po.status || 'Issued'
  );
  const statusLower = rawStatus.toLowerCase();

  const isApproved = statusLower === 'approved';
  const isRejected = statusLower === 'rejected';
  const isPending =
    statusLower === 'pending' || statusLower === 'issued';

  /* ----- Brand (static for now) ----- */
  const brand = {
    company: 'Cotswold Oak Ltd',
    address:
      'Unit 4, Weston Industrial Estate, Honeybourne, Evesham, Worcestershire, WR11 7QB',
    companyNo: '05041616',
    vatNo: '851257724',
    phone: '01633 898086',
    email: 'applications@cotswoldoakltd.co.uk',
    website: 'www.cotswoldoak.co.uk',
    color: '#1e233a',
    logo: getLogoDataURL(),
    showWordmark: false,
    shortName: 'Cotswold Oak',
    strapline: 'SUPERIOR HOMES BUILT WITH STYLE',
  };

  /* ----- Job / project (prefer snapshot; else enrich from jobs.json) ----- */
  let job = po.job || null;

  if (!job) {
    const jobs  = readJSONSafe(JOBS_PATH, []);
    const byId  = jobs.find(
      (j) => String(j.id) === String(po.costRef?.jobId)
    );
    const byCode = jobs.find(
      (j) =>
        String(j.jobCode)  === String(po.costRef?.jobCode) ||
        String(j.jobNumber) === String(po.costRef?.jobCode)
    );
    job = byId || byCode || null;
  }

  const projectLabel = job
    ? [job.jobNumber || job.jobCode, job.name]
        .filter(Boolean)
        .join(' - ')
    : [po.costRef?.jobCode, po.costRef?.jobId]
        .filter(Boolean)
        .join(' — ');

  const addressLines =
    job && job.siteAddress
      ? String(job.siteAddress)
          .split(/\r?\n|,/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  const project = {
    jobCode: po.costRef?.jobCode || '',
    jobId:   po.costRef?.jobId   || '',
    label:   projectLabel,
    addressLines,
    ...(job || {}),
  };

  /* ----- Type label (for heading: Purchase / Sub-contract / Plant) ----- */
  const type = String(po.type || 'M').toUpperCase();
  let typeLabel = 'Purchase Order';
  if (type === 'S') typeLabel = 'Sub-contract Order';
  else if (type === 'P') typeLabel = 'Plant Order';

  /* ----- Title & notes (for “Order summary” block) ----- */
  const title =
    po.title ||
    po.description ||
    (projectLabel ? `Order for ${projectLabel}` : '');
  const notes = po.notes || '';

  /* ----- Approval meta ----- */
  const approval = {
    approver:  po.approval?.approver  || '',
    note:      po.approval?.note      || '',
    decidedAt: po.approval?.decidedAt || '',
  };

  /* ----- Contract clauses / references ----- */
  const rawClauses = po.clauses || {};
  const clauseLines = [];

  // Tender enquiry reference
  const tenderEnabled =
    !!rawClauses.tenderRefEnabled ||
    !!rawClauses.tenderEnabled ||
    !!rawClauses.tenderRef?.enabled;

  const tenderDate =
    rawClauses.tenderRefDate ||
    rawClauses.tenderDate ||
    rawClauses.tenderRef?.date ||
    '';

  if (tenderEnabled) {
    let line = 'Refer to Cotswold Oak tender enquiry';
    if (tenderDate) line += ` dated ${tenderDate}`;
    line += '.';
    clauseLines.push(line);
  }

  // Sub-contract terms & conditions
  const termsEnabled =
    !!rawClauses.termsEnabled ||
    !!rawClauses.termsRef?.enabled;

  const termsVersion =
    rawClauses.termsVersion ||
    rawClauses.termsRef?.version ||
    '';

  if (termsEnabled) {
    let line =
      'Refer to Cotswold Oak sub-contract terms and conditions';
    if (termsVersion) line += ` version ${termsVersion}`;
    line += '.';
    clauseLines.push(line);
  }

  // RAMS requirement
  const ramsRequired =
    !!rawClauses.ramsRequired ||
    !!rawClauses.ramsEnabled ||
    !!rawClauses.rams?.enabled;

  if (ramsRequired) {
    clauseLines.push(
      'RAMS must be supplied and vetted prior to start on site.'
    );
  }

  // Optional free-text extras
  if (Array.isArray(rawClauses.extra)) {
    rawClauses.extra
      .filter(Boolean)
      .forEach((line) => clauseLines.push(String(line)));
  } else if (
    typeof rawClauses.extra === 'string' &&
    rawClauses.extra.trim()
  ) {
    clauseLines.push(rawClauses.extra.trim());
  }

  const hasClauses = clauseLines.length > 0;

  /* ----- Final context for template ----- */
  return {
    brand,
    po: {
      number:   po.poNumber,
      date:     po.createdAt || po.date || new Date().toISOString(),
      status:   rawStatus,
      currency: 'GBP',
      subtotal,
      vat,
      total,
      typeLabel,
      title,
      notes,
    },
    project,
    supplier,
    lines,
    hasCostCode,
    approval,
    flags: { isApproved, isRejected, isPending },
    clauses: clauseLines,
    hasClauses,
  };
}

/**
 * Render PDF from the mapped context using Puppeteer
 */
async function renderPOToPDF(ctx, { draft = false } = {}) {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`PO template not found at ${TEMPLATE_PATH}`);
  }

  const templateSrc = fs.readFileSync(TEMPLATE_PATH, 'utf8') || '';
  const compile = Handlebars.compile(templateSrc);

  const html = compile({ ...ctx, draft });
  if (!html || !html.trim()) {
    throw new Error(
      'Template rendered empty HTML (likely missing context fields)'
    );
  }

  const browser = await puppeteer.launch({
    headless: 'new', // or true – fine on Render
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.emulateMediaType('screen');

    // Less strict wait + finite timeout to avoid 30s "navigation timeout"
    await page.setContent(html, {
      waitUntil: 'domcontentloaded', // DOM ready is enough for static HTML
      timeout: 15000,                // 15s cap – adjust if needed
    });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '12mm',
        right: '10mm',
        bottom: '0mm',
        left: '10mm',
      },
    });

    if (!pdf || !pdf.length) {
      throw new Error('Puppeteer returned empty PDF buffer');
    }

    return pdf;
  } finally {
    await browser.close();
  }
}

module.exports = { mapPOToContext, renderPOToPDF };
