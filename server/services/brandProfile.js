const { pool } = require('../db');
const brandingRepository = require('./tenantBrandingRepository');

async function getBrandProfileForClient(clientId, db = { query: pool.query.bind(pool) }) {
  return (await db.query('SELECT * FROM client_brand_profiles WHERE client_id=$1', [clientId])).rows[0] || null;
}

function mapBrandToPdfContext(brandRow, client, logo = null) {
  const company = brandRow?.trading_name || brandRow?.legal_name || client?.name || client?.code || 'BuildLite';
  const address = [brandRow?.address_line1, brandRow?.address_line2, brandRow?.town, brandRow?.county, brandRow?.postcode].filter(Boolean).join(', ');
  return {
    company,
    address,
    companyNo: brandRow?.company_number || '',
    vatNo: brandRow?.vat_number || '',
    phone: brandRow?.phone || '',
    email: brandRow?.email || '',
    website: brandRow?.website || '',
    color: brandRow?.accent_color || '#1e233a',
    logo,
    showWordmark: !logo,
    shortName: brandRow?.trading_name || brandRow?.legal_name || company,
    strapline: brandRow?.pdf_footer_text || '',
  };
}

async function getBrandContextForClient(clientId, client, db = { query: pool.query.bind(pool) }) {
  const [brandRow, current] = await Promise.all([
    getBrandProfileForClient(clientId, db),
    brandingRepository.getCurrent(clientId, db),
  ]);
  let logo = null;
  if (current.asset) {
    const asset = await brandingRepository.getAsset(clientId, current.asset.id, { includeBinary: true, db });
    if (asset?.binary) logo = `data:${asset.mimeType};base64,${asset.binary.toString('base64')}`;
  }
  return mapBrandToPdfContext(brandRow, client, logo);
}

module.exports = { getBrandProfileForClient, mapBrandToPdfContext, getBrandContextForClient };
