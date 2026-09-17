const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const { pool } = require('../db');
const { prepareIntegrationTestDatabase } = require('./integrationTestSetup');
const worksheet = require('../services/costCodeHierarchyWorksheetRepository');
const { PERMISSIONS } = require('../auth/permissions');

let fixture;
test.before(async () => {
  await prepareIntegrationTestDatabase(pool);
  const client = (await pool.query("INSERT INTO clients(code,name,is_active) VALUES($1,'Worksheet authority test',false) RETURNING *", [`WS_${randomUUID().slice(0, 8)}`])).rows[0];
  const otherClient = (await pool.query("INSERT INTO clients(code,name,is_active) VALUES($1,'Other worksheet tenant',false) RETURNING *", [`WO_${randomUUID().slice(0, 8)}`])).rows[0];
  const user = (await pool.query("INSERT INTO buildlite_users(auth_provider,provider_user_id,email_snapshot,display_name,status) VALUES('clerk',$1,'worksheet@test','Worksheet Admin','active') RETURNING *", [`provider-${randomUUID()}`])).rows[0];
  const role = (await pool.query("SELECT id FROM roles WHERE key='admin'")).rows[0];
  const membership = (await pool.query('INSERT INTO client_user_memberships(client_id,user_id,role_id,is_active) VALUES($1,$2,$3,true) RETURNING *', [client.id, user.id, role.id])).rows[0];
  const auth = { clientId: client.id, userId: user.id, membershipId: membership.id, providerUserId: user.provider_user_id, displayName: user.display_name, roleKey: 'admin', permissions: [PERMISSIONS.COMMERCIAL_STRUCTURE_MANAGE] };
  const head = (await pool.query("INSERT INTO commercial_structure_heads(client_id,name,display_order) VALUES($1,'Land',0) RETURNING *", [client.id])).rows[0];
  const group = (await pool.query("INSERT INTO commercial_structure_reporting_groups(client_id,head_id,name,display_order) VALUES($1,$2,'Land Cost',0) RETURNING *", [client.id, head.id])).rows[0];
  const allocated = (await pool.query(`INSERT INTO cost_codes(client_id,code,description,commercial_head,reporting_group,trade,hierarchy_mode,commercial_head_id,reporting_group_id,notes,is_active,version) VALUES($1,'0010','Leading zero','Land','Land Cost','Land Cost','two-level',$2,$3,'preserve me',true,1) RETURNING *`, [client.id, head.id, group.id])).rows[0];
  const unreviewed = (await pool.query(`INSERT INTO cost_codes(client_id,code,description,notes,is_active,version) VALUES($1,'ALPHA-1','Alpha code','unchanged note',true,1) RETURNING *`, [client.id])).rows[0];
  const otherCode = (await pool.query(`INSERT INTO cost_codes(client_id,code,description,is_active,version) VALUES($1,'FOREIGN','Foreign code',true,1) RETURNING *`, [otherClient.id])).rows[0];
  fixture = { client, otherClient, user, membership, auth, head, group, allocated, unreviewed, otherCode };
});

test.after(async () => {
  if (!fixture) return;
  for (const table of ['cost_code_import_row_evidence', 'cost_code_import_batches', 'cost_code_hierarchy_review_audit', 'commercial_structure_audit']) {
    await pool.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
    await pool.query(`DELETE FROM ${table} WHERE client_id IN($1,$2)`, [fixture.client.id, fixture.otherClient.id]);
    await pool.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
  }
  await pool.query('DELETE FROM cost_codes WHERE client_id IN($1,$2)', [fixture.client.id, fixture.otherClient.id]);
  await pool.query('DELETE FROM commercial_structure_reporting_groups WHERE client_id IN($1,$2)', [fixture.client.id, fixture.otherClient.id]);
  await pool.query('DELETE FROM commercial_structure_families WHERE client_id IN($1,$2)', [fixture.client.id, fixture.otherClient.id]);
  await pool.query('DELETE FROM commercial_structure_heads WHERE client_id IN($1,$2)', [fixture.client.id, fixture.otherClient.id]);
  await pool.query('DELETE FROM client_user_memberships WHERE client_id=$1', [fixture.client.id]);
  await pool.query('DELETE FROM clients WHERE id IN($1,$2)', [fixture.client.id, fixture.otherClient.id]);
  await pool.query('DELETE FROM buildlite_users WHERE id=$1', [fixture.user.id]);
  await pool.end();
});

test('active export preserves identity, leading-zero codes and evidence contract', async () => {
  const exported = await worksheet.exportWorksheet(fixture.client.id, fixture.auth);
  assert.equal(exported.ok, true);
  assert.deepEqual(exported.document.rows.map((row) => row.code).sort(), ['0010', 'ALPHA-1']);
  assert.equal(exported.document.rows.find((row) => row.code === '0010').id, fixture.allocated.id);
  assert.equal(exported.document.rows.find((row) => row.code === '0010').currentReviewState, 'allocated');
});

test('preview is zero-write, deterministic and blocks unresolved, duplicate, unknown and foreign rows', async () => {
  const before = Number((await pool.query('SELECT count(*) FROM commercial_structure_heads WHERE client_id=$1', [fixture.client.id])).rows[0].count);
  const rows = [
    { id: fixture.allocated.id, code: '0010', description: 'Leading zero', version: 1, commercialHead: 'Land', reportingGroup: 'Land Cost', reviewDecision: 'Keep Existing' },
    { id: fixture.unreviewed.id, code: 'ALPHA-1', description: 'Alpha code', version: 1, commercialHead: 'House Build', reportingGroup: 'Brickwork', sourceEvidence: { tampered: true } },
  ];
  const result = await worksheet.preview(fixture.client.id, { rows, sourceFilename: 'mapping.xlsx' }, fixture.auth);
  assert.equal(result.preview.summary.unchanged, 1); assert.equal(result.preview.summary.allocations, 1); assert.equal(result.preview.summary.newHeads, 1); assert.equal(result.preview.summary.newReportingGroups, 1); assert.equal(result.preview.summary.blockers, 0);
  assert.deepEqual(result.preview.rows[1].sourceEvidence, {});
  assert.equal(Number((await pool.query('SELECT count(*) FROM commercial_structure_heads WHERE client_id=$1', [fixture.client.id])).rows[0].count), before);
  const unresolved = worksheet.previewDocument({ heads: [], families: [], reportingGroups: [], costCodes: [fixture.unreviewed] }, [{ id: fixture.unreviewed.id, code: 'ALPHA-1', description: 'Alpha code', version: 1 }]);
  assert.equal(unresolved.summary.blockers, 1);
  const invalid = worksheet.previewDocument({ heads: [], families: [], reportingGroups: [], costCodes: [fixture.unreviewed] }, [
    { id: fixture.unreviewed.id, code: 'ALPHA-1', description: 'Alpha code', version: 1, commercialHead: 'A', reportingGroup: 'B' },
    { id: fixture.unreviewed.id, code: 'ALPHA-1', description: 'Alpha code', version: 1, commercialHead: 'A', reportingGroup: 'B' },
    { id: fixture.otherCode.id, code: 'FOREIGN', description: 'Foreign code', version: 1, commercialHead: 'A', reportingGroup: 'B' },
  ]);
  assert.equal(invalid.summary.blockers, 2);
});

test('protected worksheet identity is exact while hierarchy labels normalize independently', async () => {
  const exactDescription = 'Compound  - Groundworks';
  const code = (await pool.query(`INSERT INTO cost_codes(client_id,code,description,is_active,version) VALUES($1,'002220',$2,true,1) RETURNING *`, [fixture.client.id, exactDescription])).rows[0];
  const exported = await worksheet.exportWorksheet(fixture.client.id, fixture.auth);
  const exportedRow = exported.document.rows.find((row) => row.id === code.id);
  assert.equal(exportedRow.code, '002220');
  assert.equal(exportedRow.description, exactDescription);
  assert.equal(exportedRow.version, 1);

  const before = Number((await pool.query('SELECT count(*) FROM commercial_structure_heads WHERE client_id=$1', [fixture.client.id])).rows[0].count);
  const unchangedIdentity = await worksheet.preview(fixture.client.id, { rows: [{
    id: code.id,
    code: exportedRow.code,
    description: exportedRow.description,
    version: exportedRow.version,
    commercialHead: '  House   Build ',
    reportingGroup: ' Brickwork  ',
  }] }, fixture.auth);
  assert.equal(unchangedIdentity.preview.summary.blockers, 0);
  assert.equal(unchangedIdentity.preview.summary.allocations, 1);
  assert.deepEqual(unchangedIdentity.preview.rows[0].after.labels, { commercialHead: 'House Build', commercialFamily: '', reportingGroup: 'Brickwork' });
  assert.equal(Number((await pool.query('SELECT count(*) FROM commercial_structure_heads WHERE client_id=$1', [fixture.client.id])).rows[0].count), before);

  const editedIdentity = await worksheet.preview(fixture.client.id, { rows: [{
    id: code.id,
    code: exportedRow.code,
    description: 'Compound - Groundworks',
    version: exportedRow.version,
    commercialHead: 'House Build',
    reportingGroup: 'Brickwork',
  }] }, fixture.auth);
  assert.equal(editedIdentity.preview.summary.blockers, 1);
  assert.match(editedIdentity.preview.rows[0].blocker, /identity or description/i);
});

test('atomic apply creates reviewed paths, maps and marks Not Applicable without rewriting unrelated facts', async () => {
  const second = (await pool.query(`INSERT INTO cost_codes(client_id,code,description,notes,is_active,version) VALUES($1,'NA-1','Revenue control','retain this too',true,1) RETURNING *`, [fixture.client.id])).rows[0];
  const rows = [
    { id: fixture.allocated.id, code: '0010', description: 'Leading zero', version: 1, commercialHead: 'Land', reportingGroup: 'Land Cost', reviewDecision: 'Keep Existing' },
    { id: fixture.unreviewed.id, code: 'ALPHA-1', description: 'Alpha code', version: 1, commercialHead: 'House Build', commercialFamily: 'Superstructure', reportingGroup: 'Brickwork', sourceEvidence: { legacy: { trade: 'Sub-Con' } } },
    { id: second.id, code: 'NA-1', description: 'Revenue control', version: 1, reviewDecision: 'Not Applicable' },
  ];
  const reviewed = (await worksheet.preview(fixture.client.id, { rows, sourceFilename: 'mapping.xlsx' }, fixture.auth)).preview;
  const applied = await worksheet.apply(fixture.client.id, { rows, sourceFilename: 'mapping.xlsx', catalogueRevision: reviewed.catalogueRevision, reviewToken: reviewed.reviewToken }, fixture.auth);
  assert.equal(applied.ok, true); assert.equal(applied.summary.updated, 2);
  const codes = (await pool.query("SELECT * FROM cost_codes WHERE id=ANY($1::uuid[]) ORDER BY code", [[fixture.allocated.id, fixture.unreviewed.id, second.id]])).rows;
  assert.equal(codes.find((row) => row.code === '0010').version, 1);
  assert.equal(codes.find((row) => row.code === '0010').notes, 'preserve me');
  assert.equal(codes.find((row) => row.code === 'ALPHA-1').notes, 'unchanged note');
  assert.ok(codes.find((row) => row.code === 'ALPHA-1').commercial_head_id);
  assert.equal(codes.find((row) => row.code === 'NA-1').hierarchy_review_disposition, 'not_applicable');
  assert.equal((await pool.query('SELECT count(*)::int n FROM cost_code_hierarchy_review_audit WHERE client_id=$1', [fixture.client.id])).rows[0].n, 2);
  assert.equal((await pool.query('SELECT count(*)::int n FROM cost_code_import_batches WHERE client_id=$1', [fixture.client.id])).rows[0].n, 1);
  assert.equal((await pool.query('SELECT count(*)::int n FROM cost_code_import_row_evidence WHERE client_id=$1', [fixture.client.id])).rows[0].n, 3);
  await assert.rejects(pool.query('UPDATE cost_code_hierarchy_review_audit SET operation=operation WHERE client_id=$1', [fixture.client.id]), /append-only/);
});

test('inactive rows and missing permission fail closed', async () => {
  const inactive = (await pool.query(`INSERT INTO cost_codes(client_id,code,description,is_active,version) VALUES($1,'INACTIVE','Inactive row',false,1) RETURNING *`, [fixture.client.id])).rows[0];
  const result = await worksheet.preview(fixture.client.id, { rows: [{ id: inactive.id, code: 'INACTIVE', description: 'Inactive row', version: 1, commercialHead: 'Land', reportingGroup: 'Land Cost' }] }, fixture.auth);
  assert.equal(result.preview.summary.blockers, 1);
  await assert.rejects(worksheet.preview(fixture.client.id, { rows: [] }, { ...fixture.auth, permissions: [] }), /permission/i);
});

test('tampered or stale reviewed evidence rolls back completely', async () => {
  const code = (await pool.query(`INSERT INTO cost_codes(client_id,code,description,is_active,version) VALUES($1,'ROLL','Rollback row',true,1) RETURNING *`, [fixture.client.id])).rows[0];
  const rows = [{ id: code.id, code: 'ROLL', description: 'Rollback row', version: 1, commercialHead: 'Rollback Head', reportingGroup: 'Rollback Group' }];
  const reviewed = (await worksheet.preview(fixture.client.id, { rows }, fixture.auth)).preview;
  const tampered = await worksheet.apply(fixture.client.id, { rows: [{ ...rows[0], reportingGroup: 'Changed' }], catalogueRevision: reviewed.catalogueRevision, reviewToken: reviewed.reviewToken }, fixture.auth);
  assert.equal(tampered.status, 409);
  assert.equal((await pool.query("SELECT count(*)::int n FROM commercial_structure_heads WHERE client_id=$1 AND name='Rollback Head'", [fixture.client.id])).rows[0].n, 0);
  await pool.query('UPDATE cost_codes SET version=2 WHERE id=$1', [code.id]);
  const stale = await worksheet.apply(fixture.client.id, { rows, catalogueRevision: reviewed.catalogueRevision, reviewToken: reviewed.reviewToken }, fixture.auth);
  assert.equal(stale.status, 400);
});

test('realistic 300-row preview consolidates paths and applies once without duplicate nodes', async () => {
  const values = []; const params = [fixture.client.id];
  for (let index = 0; index < 300; index += 1) { const base = index * 2 + 2; values.push(`($1,$${base},$${base + 1},true,1)`); params.push(`W${String(index).padStart(3, '0')}`, `Worksheet ${index}`); }
  const inserted = (await pool.query(`INSERT INTO cost_codes(client_id,code,description,is_active,version) VALUES ${values.join(',')} RETURNING *`, params)).rows;
  const rows = inserted.map((row, index) => ({ id: row.id, code: row.code, description: row.description, version: 1, ...(index === 299 ? { reviewDecision: 'Not Applicable' } : { commercialHead: index < 150 ? 'House Build' : 'External Works', reportingGroup: index < 150 ? 'Brickwork' : 'Roads & Sewers' }) }));
  const reviewed = (await worksheet.preview(fixture.client.id, { rows, sourceFilename: '300 rows.xlsx' }, fixture.auth)).preview;
  assert.deepEqual({ allocations: reviewed.summary.allocations, notApplicable: reviewed.summary.notApplicable, newHeads: reviewed.summary.newHeads, newReportingGroups: reviewed.summary.newReportingGroups, blockers: reviewed.summary.blockers }, { allocations: 299, notApplicable: 1, newHeads: 2, newReportingGroups: 2, blockers: 0 });
  const applied = await worksheet.apply(fixture.client.id, { rows, sourceFilename: '300 rows.xlsx', catalogueRevision: reviewed.catalogueRevision, reviewToken: reviewed.reviewToken }, fixture.auth);
  assert.equal(applied.ok, true); assert.equal(applied.summary.updated, 300);
  assert.equal((await pool.query("SELECT count(*)::int n FROM commercial_structure_heads WHERE client_id=$1 AND name IN('House Build','External Works')", [fixture.client.id])).rows[0].n, 2);
  assert.equal((await pool.query("SELECT count(*)::int n FROM commercial_structure_reporting_groups g JOIN commercial_structure_heads h ON h.id=g.head_id WHERE g.client_id=$1 AND g.family_id IS NULL AND ((h.name='House Build' AND g.name='Brickwork') OR (h.name='External Works' AND g.name='Roads & Sewers'))", [fixture.client.id])).rows[0].n, 2);
});
