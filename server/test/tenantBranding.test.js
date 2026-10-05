const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const request = require('supertest');
const sharp = require('sharp');
const createApp = require('../app');
const { pool } = require('../db');
const { createTestAuthAdapter } = require('../auth/authAdapters');
const { prepareIntegrationTestDatabase } = require('./integrationTestSetup');
const { normaliseLogo } = require('../services/tenantBranding');
const { getBrandContextForClient } = require('../services/brandProfile');
const { mapPOToContext } = require('../services/pdf');

let first, second, user, membership;
const ids = [];

function principal(clientId, permissions = ['company_settings.manage']) {
  return { userId: user.id, providerUserId: user.provider_user_id, displayName: user.display_name,
    email: user.email_snapshot, clientId, membershipId: membership, roleKey: 'commercial_director',
    roleName: 'Commercial Director', permissions, platformPermissions: [], memberships: [] };
}

async function image(format, width = 80, height = 40) {
  let pipeline = sharp({ create: { width, height, channels: 4, background: { r: 22, g: 120, b: 80, alpha: 1 } } });
  if (format === 'png') pipeline = pipeline.png();
  if (format === 'jpeg') pipeline = pipeline.jpeg();
  if (format === 'webp') pipeline = pipeline.webp();
  return pipeline.toBuffer();
}

test.before(async () => {
  await prepareIntegrationTestDatabase(pool);
  user = (await pool.query(`INSERT INTO buildlite_users(auth_provider,provider_user_id,email_snapshot,display_name,status)
    VALUES('clerk',$1,$2,'Branding Director','active') RETURNING *`, [`brand-${randomUUID()}`, `brand-${randomUUID()}@test.invalid`])).rows[0];
  const role = (await pool.query("SELECT id FROM roles WHERE key='commercial_director'")).rows[0];
  for (const name of ['Brand One', 'Brand Two']) {
    const client = (await pool.query('INSERT INTO clients(code,name,is_active) VALUES($1,$2,false) RETURNING *', [`brand_${randomUUID().slice(0,8)}`, name])).rows[0];
    ids.push(client.id);
    const member = (await pool.query('INSERT INTO client_user_memberships(client_id,user_id,role_id,is_active) VALUES($1,$2,$3,true) RETURNING id', [client.id,user.id,role.id])).rows[0];
    if (!membership) membership = member.id;
    await pool.query('INSERT INTO client_brand_profiles(client_id,legal_name,logo_url) VALUES($1,$2,$3)', [client.id,name,'brand/cotswold-oak-logo.png']);
    await pool.query('INSERT INTO tenant_company_settings(client_id,settings) VALUES($1,$2)', [client.id,{companyName:name,logoUrl:'https://invalid.example/legacy.png'}]);
    if (!first) first=client; else second=client;
  }
});

test.after(async () => {
  await pool.query('ALTER TABLE authorization_action_audit DISABLE TRIGGER USER');
  await pool.query('ALTER TABLE tenant_branding_audit DISABLE TRIGGER USER');
  await pool.query('ALTER TABLE tenant_brand_assets DISABLE TRIGGER USER');
  for (const id of ids) {
    await pool.query('DELETE FROM authorization_action_audit WHERE client_id=$1',[id]);
    await pool.query('DELETE FROM tenant_branding_audit WHERE client_id=$1',[id]);
    await pool.query('DELETE FROM tenant_branding WHERE client_id=$1',[id]);
    await pool.query('DELETE FROM tenant_brand_assets WHERE client_id=$1',[id]);
    await pool.query('DELETE FROM tenant_company_settings WHERE client_id=$1',[id]);
    await pool.query('DELETE FROM client_user_memberships WHERE client_id=$1',[id]);
    await pool.query('DELETE FROM clients WHERE id=$1',[id]);
  }
  await pool.query('ALTER TABLE tenant_brand_assets ENABLE TRIGGER USER');
  await pool.query('ALTER TABLE tenant_branding_audit ENABLE TRIGGER USER');
  await pool.query('ALTER TABLE authorization_action_audit ENABLE TRIGGER USER');
  await pool.query('DELETE FROM buildlite_users WHERE id=$1',[user.id]);
});

test('PNG, JPEG and WebP decode safely and normalise to a bounded metadata-free WebP', async () => {
  for (const format of ['png','jpeg','webp']) {
    const result = await normaliseLogo(await image(format), `logo.${format}`);
    assert.equal(result.mimeType,'image/webp');
    assert.ok(result.binary.length <= 300*1024);
    assert.equal(result.width,80); assert.equal(result.height,40);
    assert.match(result.sha256,/^[0-9a-f]{64}$/);
  }
});

test('SVG, fake magic, corrupt image, oversize input and excessive decoded dimensions fail closed', async () => {
  await assert.rejects(normaliseLogo(Buffer.from('<svg/>'),'logo.svg'), error => error.status===415);
  await assert.rejects(normaliseLogo(Buffer.from('not an image'),'logo.png'), error => error.status===415);
  await assert.rejects(normaliseLogo(Buffer.from([137,80,78,71,13,10,26,10,0]),'broken.png'), error => error.status===415);
  await assert.rejects(normaliseLogo(Buffer.alloc(2*1024*1024+1,0xff),'huge.jpg'), error => error.status===413);
  await assert.rejects(normaliseLogo(await image('png',4097,1),'wide.png'), error => error.status===413);
});

test('tenant-scoped upload, caching, replacement and removal use one audited authority', async () => {
  const app = createApp({authAdapter:createTestAuthAdapter(principal(first.id))});
  const initial = await request(app).get('/api/company-settings');
  assert.equal(initial.status,200);
  assert.deepEqual(initial.body.branding,{version:0,logo:null});
  assert.equal('logoUrl' in initial.body.settings,false);
  const png=await image('png');
  const uploaded=await request(app).post('/api/company-branding/logo').set('Content-Type','image/png')
    .set('X-BuildLite-Branding-Version','0').set('X-BuildLite-File-Name','logo.png').send(png);
  assert.equal(uploaded.status,201,uploaded.text); assert.equal(uploaded.body.version,1); assert.equal(uploaded.body.logo.mimeType,'image/webp');
  const firstAsset=uploaded.body.logo.id;
  const served=await request(app).get(`/api/company-branding/assets/${firstAsset}`);
  assert.equal(served.status,200); assert.equal(served.headers['content-type'],'image/webp'); assert.match(served.headers.etag,/^["].+[\"]$/);
  assert.equal((await request(app).get(`/api/company-branding/assets/${firstAsset}`).set('If-None-Match',served.headers.etag)).status,304);
  const otherApp=createApp({authAdapter:createTestAuthAdapter({...principal(second.id),membershipId:(await pool.query('SELECT id FROM client_user_memberships WHERE client_id=$1',[second.id])).rows[0].id})});
  assert.equal((await request(otherApp).get(`/api/company-branding/assets/${firstAsset}`)).status,404);
  assert.equal((await request(createApp({authAdapter:createTestAuthAdapter(principal(first.id,[]))})).post('/api/company-branding/logo').set('Content-Type','image/png').set('X-BuildLite-Branding-Version','1').send(png)).status,403);
  const failed=await request(app).post('/api/company-branding/logo').set('Content-Type','image/png').set('X-BuildLite-Branding-Version','1').send(Buffer.from('bad'));
  assert.equal(failed.status,415); assert.equal((await request(app).get('/api/company-branding')).body.logo.id,firstAsset);
  const replacement=await request(app).post('/api/company-branding/logo').set('Content-Type','image/jpeg').set('X-BuildLite-Branding-Version','1').set('X-BuildLite-File-Name','new.jpg').send(await image('jpeg',100,50));
  assert.equal(replacement.status,201); assert.notEqual(replacement.body.logo.id,firstAsset);
  const frozenContext=await getBrandContextForClient(first.id,first);
  assert.match(frozenContext.logo,/^data:image\/webp;base64,/);
  assert.equal(mapPOToContext({poNumber:'PO-BRAND',items:[]},frozenContext).brand.logo,frozenContext.logo);
  const removed=await request(app).delete('/api/company-branding/logo').send({version:2});
  assert.equal(removed.status,200); assert.deepEqual(removed.body,{version:3,logo:null});
  const neutral=await getBrandContextForClient(first.id,first);
  assert.equal(neutral.logo,null); assert.equal(neutral.showWordmark,true); assert.equal(neutral.company,'Brand One');
  assert.match(frozenContext.logo,/^data:image\/webp;base64,/);
  const audit=(await pool.query('SELECT operation FROM tenant_branding_audit WHERE client_id=$1 ORDER BY occurred_at,id',[first.id])).rows.map(x=>x.operation);
  assert.deepEqual(audit,['logo_uploaded','logo_replaced','logo_removed']);
  await assert.rejects(pool.query('UPDATE tenant_branding_audit SET operation=operation WHERE client_id=$1',[first.id]),/append-only/i);
});

test('legacy filesystem and URL values are never logo authority', async () => {
  const context=await getBrandContextForClient(second.id,second);
  assert.equal(context.logo,null);
  assert.equal(context.showWordmark,true);
  assert.equal(context.company,'Brand Two');
});
