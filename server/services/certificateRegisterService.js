const { query } = require('../db');
const { assertServicePermission } = require('../auth/authorization');
const { PERMISSIONS } = require('../auth/permissions');

const VALID_STATUSES = new Set(['draft', 'submitted', 'locked']);
const VALID_SORTS = new Set(['newest', 'oldest', 'certificate_desc']);

function positiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function registerFilters(input = {}) {
  return {
    search: String(input.search || input.q || '').trim().slice(0, 200),
    developmentId: String(input.developmentId || '').trim(),
    supplierId: String(input.supplierId || '').trim(),
    status: VALID_STATUSES.has(input.status) ? input.status : '',
    sort: VALID_SORTS.has(input.sort) ? input.sort : 'newest',
    page: positiveInteger(input.page, 1, 1000000),
    pageSize: positiveInteger(input.pageSize, 25, 100),
  };
}

function whereClause(filters) {
  const values = [];
  const clauses = [];
  const add = (clause, value) => { values.push(value); clauses.push(clause.replace('?', `$${values.length + 1}`)); };
  if (filters.search) {
    values.push(`%${filters.search.replace(/[\\%_]/g, '\\$&')}%`);
    const token = `$${values.length + 1}`;
    clauses.push(`(
      c.certificate_number::text ILIKE ${token} ESCAPE '\\' OR COALESCE(s.name,p.supplier_label,'') ILIKE ${token} ESCAPE '\\' OR
      COALESCE(d.development_name,'') ILIKE ${token} ESCAPE '\\' OR COALESCE(d.job_number,'') ILIKE ${token} ESCAPE '\\' OR
      COALESCE(p.cost_code,'') ILIKE ${token} ESCAPE '\\' OR COALESCE(p.payload->>'description',p.payload->>'packageDescription','') ILIKE ${token} ESCAPE '\\' OR
      COALESCE(po_refs.po_references,'') ILIKE ${token} ESCAPE '\\'
    )`);
  }
  if (filters.developmentId) add('c.development_id = ?', filters.developmentId);
  if (filters.supplierId) add('p.supplier_id = ?', filters.supplierId);
  if (filters.status) add('c.status = ?', filters.status);
  return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', values };
}

function orderClause(sort) {
  if (sort === 'oldest') return 'c.certificate_date ASC,c.certificate_number ASC,c.id ASC';
  if (sort === 'certificate_desc') return 'c.certificate_number DESC,c.certificate_date DESC,c.id DESC';
  return 'c.certificate_date DESC,c.certificate_number DESC,c.id DESC';
}

function baseFrom({ includePoReferences = true } = {}) {
  return `FROM package_payment_certificates c
    JOIN packages p ON p.id=c.package_id AND p.client_id=c.client_id
    JOIN developments d ON d.id=c.development_id AND d.client_id=c.client_id
    LEFT JOIN suppliers s ON s.id=p.supplier_id AND s.client_id=p.client_id
    ${includePoReferences ? `LEFT JOIN LATERAL (
      SELECT string_agg(ppo.po_number, ', ' ORDER BY ppo.po_number) po_references
      FROM package_purchase_orders ppo WHERE ppo.client_id=c.client_id AND ppo.package_id=c.package_id
    ) po_refs ON true` : ''}`;
}

function numberOrNull(value) { return value == null ? null : Number(value); }
function mapRow(row) {
  return {
    id: row.id, packageId: row.package_id, orderKey: row.order_key,
    certificateNumber: row.certificate_number, certificateDate: row.certificate_date,
    status: row.status, developmentId: row.development_id,
    developmentNumber: row.job_number, developmentName: row.development_name,
    supplierId: row.supplier_id, supplierName: row.supplier_name,
    costCode: row.cost_code, packageDescription: row.package_description || null,
    poReferences: row.po_references || null,
    grossValue: numberOrNull(row.gross_value), retention: numberOrNull(row.retention),
    netPayment: numberOrNull(row.net_value), submittedAt: row.submitted_at,
    submittedBy: row.submitted_by, approvedAt: row.approved_at, approvedBy: row.approved_by,
  };
}

async function getCertificateRegister(auth, input = {}, run = query) {
  assertServicePermission(auth, PERMISSIONS.COMMERCIAL_READ);
  if (!auth?.clientId) { const error = new Error('An active company is required.'); error.status = 403; throw error; }
  const filters = registerFilters(input);
  const where = whereClause(filters);
  const commonValues = [auth.clientId, ...where.values];
  const from = baseFrom();
  const countFrom = baseFrom({ includePoReferences: Boolean(filters.search) });
  const offset = (filters.page - 1) * filters.pageSize;
  const [countResult, rowsResult, optionsResult] = await Promise.all([
    run(`SELECT COUNT(*)::int total ${countFrom} WHERE c.client_id=$1${where.sql}`, commonValues),
    run(`SELECT c.id,c.package_id,c.order_key,c.certificate_number,c.certificate_date,c.status,c.development_id,
      CASE WHEN c.status='locked' THEN c.gross_value END gross_value,
      CASE WHEN c.status='locked' THEN c.retention END retention,
      CASE WHEN c.status='locked' THEN c.net_value END net_value,
      c.submitted_at,c.submitted_by,c.approved_at,c.approved_by,
      d.job_number,d.development_name,p.supplier_id,COALESCE(s.name,p.supplier_label) supplier_name,p.cost_code,
      COALESCE(p.payload->>'description',p.payload->>'packageDescription') package_description,po_refs.po_references
      ${from} WHERE c.client_id=$1${where.sql}
      ORDER BY ${orderClause(filters.sort)}
      LIMIT $${commonValues.length + 1} OFFSET $${commonValues.length + 2}`,
    [...commonValues, filters.pageSize, offset]),
    run(`SELECT
      COALESCE((SELECT jsonb_agg(x ORDER BY x->>'label') FROM (SELECT jsonb_build_object('id',d.id,'label',d.development_name || CASE WHEN NULLIF(btrim(d.job_number),'') IS NULL THEN '' ELSE ' · ' || d.job_number END) x FROM package_payment_certificates c JOIN developments d ON d.id=c.development_id AND d.client_id=c.client_id WHERE c.client_id=$1 GROUP BY d.id,d.development_name,d.job_number) q),'[]') developments,
      COALESCE((SELECT jsonb_agg(x ORDER BY x->>'label') FROM (SELECT jsonb_build_object('id',p.supplier_id,'label',MIN(COALESCE(NULLIF(btrim(s.name),''),NULLIF(btrim(p.supplier_label),''),p.supplier_id))) x FROM package_payment_certificates c JOIN packages p ON p.id=c.package_id AND p.client_id=c.client_id LEFT JOIN suppliers s ON s.id=p.supplier_id AND s.client_id=p.client_id WHERE c.client_id=$1 AND NULLIF(btrim(p.supplier_id),'') IS NOT NULL GROUP BY p.supplier_id) q),'[]') suppliers`, [auth.clientId]),
  ]);
  return { items: rowsResult.rows.map(mapRow), total: countResult.rows[0]?.total || 0, page: filters.page, pageSize: filters.pageSize, options: optionsResult.rows[0] };
}

module.exports = { getCertificateRegister, registerFilters, mapRow };
