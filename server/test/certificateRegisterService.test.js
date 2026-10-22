const test = require('node:test');
const assert = require('node:assert/strict');
const { getCertificateRegister, registerFilters } = require('../services/certificateRegisterService');
const { PERMISSIONS } = require('../auth/permissions');
const { pool, isDbConfigured } = require('../db');
const { prepareIntegrationTestDatabase } = require('./integrationTestSetup');

const result = rows => ({ rows });
const auth = (clientId = 'tenant-a', permissions = [PERMISSIONS.COMMERCIAL_READ]) => ({ clientId, userId: 'user-a', permissions });

test('certificate register is tenant scoped, filtered, stably ordered and paginated without N+1 queries', async () => {
  const calls = [];
  const run = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('COUNT(*)')) return result([{ total: 126 }]);
    if (sql.includes('jsonb_agg')) return result([{ developments: [{ id: 'd1', label: 'Oak' }], suppliers: [{ id: 's1', label: 'Groundworks Ltd' }] }]);
    return result([{ id: 'c1', package_id: 'p1', order_key: 'd1::s1::100', certificate_number: 3, certificate_date: '2026-08-31', status: 'locked', development_id: 'd1', job_number: 'OM-1', development_name: 'Oak', supplier_id: 's1', supplier_name: 'Groundworks Ltd', cost_code: '100', package_description: 'Groundworks', po_references: 'S001', gross_value: '0.00', retention: null, net_value: '125.50', approved_at: '2026-09-01', approved_by: 'CD' }]);
  };
  const output = await getCertificateRegister(auth(), { q: 'Oak', developmentId: 'd1', supplierId: 's1', status: 'locked', sort: 'certificate_desc', page: 2, pageSize: 50 }, run);
  assert.equal(calls.length, 3);
  calls.forEach(call => assert.equal(call.params[0], 'tenant-a'));
  assert.match(calls[1].sql, /ORDER BY c\.certificate_number DESC,c\.certificate_date DESC,c\.id DESC/);
  assert.match(calls[1].sql, /LIMIT \$\d+ OFFSET \$\d+/);
  assert.equal(output.total, 126); assert.equal(output.page, 2); assert.equal(output.pageSize, 50);
  assert.equal(output.items[0].grossValue, 0);
  assert.equal(output.items[0].retention, null);
  assert.equal(output.items[0].netPayment, 125.5);
});

test('register filters accept only governed lifecycle and ordering values', () => {
  assert.equal(registerFilters({ action: 'invented', status: 'approved', pageSize: 1000 }).status, '');
  assert.equal(registerFilters({ sort: 'oldest' }).sort, 'oldest');
  assert.equal(registerFilters({ sort: 'invented' }).sort, 'newest');
  assert.equal(registerFilters({ pageSize: 1000 }).pageSize, 100);
});

test('certificate register denies missing permission before querying', async () => {
  let calls = 0;
  await assert.rejects(() => getCertificateRegister(auth('tenant-a', []), {}, async () => { calls += 1; return result([]); }), error => error.status === 403);
  assert.equal(calls, 0);
});

test('guarded PostgreSQL register isolates tenants and combines search, lifecycle and ordering filters', { skip: !isDbConfigured() }, async () => {
  await prepareIntegrationTestDatabase(pool);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const tenantA = (await db.query("INSERT INTO clients(code,name,is_active) VALUES('CERT_REG_A_'||gen_random_uuid(),'Register A',false) RETURNING id")).rows[0].id;
    const tenantB = (await db.query("INSERT INTO clients(code,name,is_active) VALUES('CERT_REG_B_'||gen_random_uuid(),'Register B',false) RETURNING id")).rows[0].id;
    for (const [tenant, suffix] of [[tenantA, 'A'], [tenantB, 'B']]) {
      await db.query('INSERT INTO developments(id,client_id,job_number,development_name,status,payload) VALUES($1,$2,$3,$4,$5,$6)', [`cert-dev-${suffix}`, tenant, `REG-${suffix}`, `Register ${suffix}`, 'live', {}]);
      await db.query('INSERT INTO suppliers(id,name,payload,client_id) VALUES($1,$2,$3,$4)', [`cert-supplier-${suffix}`, `Supplier ${suffix}`, {}, tenant]);
      const packageId = (await db.query(`INSERT INTO packages(client_id,development_id,supplier_id,cost_code,order_key,supplier_label,development_number,development_name,payload)
        VALUES($1,$2,$3,'100',$4,$5,$6,$7,$8) RETURNING id`, [tenant, `cert-dev-${suffix}`, `cert-supplier-${suffix}`, `cert-dev-${suffix}::cert-supplier-${suffix}::100`, `Supplier ${suffix}`, `REG-${suffix}`, `Register ${suffix}`, { description: 'Groundworks' }])).rows[0].id;
      await db.query(`INSERT INTO package_payment_certificates(client_id,package_id,development_id,order_key,certificate_number,status,certificate_date,payload)
        VALUES($1,$2,$3,$4,1,'submitted','2026-10-01',$5)`, [tenant, packageId, `cert-dev-${suffix}`, `cert-dev-${suffix}::cert-supplier-${suffix}::100`, {}]);
    }
    const draftPackage = (await db.query(`INSERT INTO packages(client_id,development_id,supplier_id,cost_code,order_key,supplier_label,development_number,development_name,payload)
      VALUES($1,'cert-dev-A','cert-supplier-A','200','cert-dev-A::cert-supplier-A::200','Supplier A','REG-A','Register A','{}') RETURNING id`, [tenantA])).rows[0].id;
    await db.query(`INSERT INTO package_payment_certificates(client_id,package_id,development_id,order_key,certificate_number,status,certificate_date,payload)
      VALUES($1,$2,'cert-dev-A','cert-dev-A::cert-supplier-A::200',1,'draft','2026-10-02','{}')`, [tenantA, draftPackage]);
    const missingSupplierPackage = (await db.query(`INSERT INTO packages(client_id,development_id,supplier_id,cost_code,order_key,supplier_label,development_number,development_name,payload)
      VALUES($1,'cert-dev-A','','300','cert-dev-A::missing::300',NULL,'REG-A','Register A','{}') RETURNING id`, [tenantA])).rows[0].id;
    await db.query(`INSERT INTO package_payment_certificates(client_id,package_id,development_id,order_key,certificate_number,status,certificate_date,payload)
      VALUES($1,$2,'cert-dev-A','cert-dev-A::missing::300',1,'draft','2026-10-03','{}')`, [tenantA, missingSupplierPackage]);
    const output = await getCertificateRegister(auth(tenantA), { search: 'Supplier A', developmentId: 'cert-dev-A', supplierId: 'cert-supplier-A', status: 'submitted', pageSize: 1 }, db.query.bind(db));
    assert.equal(output.total, 1); assert.equal(output.items.length, 1);
    assert.equal(output.items[0].developmentId, 'cert-dev-A'); assert.equal(output.items[0].grossValue, null); assert.equal(output.items[0].retention, null); assert.equal(output.items[0].netPayment, null);
    assert.equal(output.options.developments.some(item => item.id === 'cert-dev-B'), false);
    assert.deepEqual(output.options.suppliers.map(item => item.id), ['cert-supplier-A']);
    const literalWildcard = await getCertificateRegister(auth(tenantA), { search: 'Supplier A%' }, db.query.bind(db));
    assert.equal(literalWildcard.total, 0);
    const packageRow = await db.query("SELECT id,order_key FROM packages WHERE client_id=$1 AND development_id='cert-dev-A'", [tenantA]);
    await db.query(`INSERT INTO package_payment_certificates(client_id,package_id,development_id,order_key,certificate_number,status,certificate_date,gross_value,net_value,matrix_gross,commercial_event_gross,recovery_signed,retention,vat,retention_rate,vat_rate,payload)
      SELECT $1,$2,'cert-dev-A',$3,n,'locked','2026-09-01',CASE WHEN n=2 THEN 0 ELSE n END,CASE WHEN n=2 THEN 0 ELSE n END,CASE WHEN n=2 THEN 0 ELSE n END,0,0,0,0,0,0,'{}'::jsonb FROM generate_series(2,106) n`, [tenantA, packageRow.rows[0].id, packageRow.rows[0].order_key]);
    const firstPage = await getCertificateRegister(auth(tenantA), { page: 1, pageSize: 100 }, db.query.bind(db));
    const secondPage = await getCertificateRegister(auth(tenantA), { page: 2, pageSize: 100 }, db.query.bind(db));
    assert.equal(firstPage.total, 108); assert.equal(firstPage.items.length, 100); assert.equal(secondPage.items.length, 8);
    assert.equal(new Set([...firstPage.items, ...secondPage.items].map(item => item.id)).size, 108);
    const draftRows = [...firstPage.items, ...secondPage.items].filter(item => item.status === 'draft');
    assert.equal(draftRows.length, 2); assert.ok(draftRows.every(item => item.grossValue === null && item.netPayment === null));
    const lockedZero = [...firstPage.items, ...secondPage.items].find(item => item.certificateNumber === 2);
    assert.equal(lockedZero.grossValue, 0); assert.equal(lockedZero.netPayment, 0);
  } finally {
    await db.query('ROLLBACK');
    db.release();
  }
});
