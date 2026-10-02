const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const createApp = require('../app');
const { validateProductionConfig } = require('../utils/productionConfig');
const { checkMigrationReadiness, migrationFrontier } = require('../services/migrationReadiness');

const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://pilot.invalid/buildlite',
  DATABASE_SSL: 'true',
  CLERK_SECRET_KEY: 'test-only-secret',
  CORS_ALLOWED_ORIGINS: 'https://pilot.example.com',
  BUILDLITE_APP_URL: 'https://pilot.example.com',
};

test('production configuration accepts the hosted contract with optional platform provisioning', () => {
  assert.deepEqual(validateProductionConfig(production), { ok: true, errors: [] });
});

for (const [name, change, expected] of [
  ['DATABASE_URL', { DATABASE_URL: '' }, /DATABASE_URL/],
  ['Clerk secret', { CLERK_SECRET_KEY: '' }, /CLERK_SECRET_KEY/],
  ['CORS origins', { CORS_ALLOWED_ORIGINS: '' }, /CORS_ALLOWED_ORIGINS/],
  ['wildcard CORS origin', { CORS_ALLOWED_ORIGINS: '*' }, /explicit origins/],
  ['canonical app URL', { BUILDLITE_APP_URL: 'http://pilot.example.com' }, /HTTPS origin/],
  ['database SSL setting', { DATABASE_SSL: 'sometimes' }, /true or false/],
  ['test auth mode', { BUILDLITE_SERVER_TEST: '1' }, /must not be enabled/],
  ['test database authority', { TEST_DATABASE_URL: 'postgresql://localhost/buildlite_test' }, /must not be configured/],
]) test(`production configuration rejects invalid ${name}`, () => {
  const result = validateProductionConfig({ ...production, ...change });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), expected);
});

test('development and test configuration remain outside the production gate', () => {
  assert.deepEqual(validateProductionConfig({ NODE_ENV: 'development' }), { ok: true, errors: [] });
  assert.deepEqual(validateProductionConfig({ NODE_ENV: 'test', BUILDLITE_SERVER_TEST: '1' }), { ok: true, errors: [] });
});

test('production server fails before listening when required configuration is absent', () => {
  const result = spawnSync(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: '', CLERK_SECRET_KEY: '', CORS_ALLOWED_ORIGINS: '', BUILDLITE_APP_URL: '', TEST_DATABASE_URL: '', BUILDLITE_SERVER_TEST: '' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Production configuration is invalid/);
  assert.doesNotMatch(result.stdout, /Server running/);
});

test('migration readiness requires every application migration', async () => {
  const files = ['001_one.sql', '002_two.sql'];
  const current = await checkMigrationReadiness({ query: async (sql) => sql === 'SELECT 1' ? { rows: [] } : { rows: files.map(filename => ({ filename })) } }, files);
  assert.deepEqual(current, { ready: true, category: 'ready', requiredFrontier: '002' });
  const behind = await checkMigrationReadiness({ query: async (sql) => sql === 'SELECT 1' ? { rows: [] } : { rows: [{ filename: files[0] }] } }, files);
  assert.equal(behind.ready, false);
  assert.equal(behind.category, 'migration_behind');
  assert.equal(migrationFrontier(files), '002');
});

test('migration readiness safely classifies unavailable database and absent ledger', async () => {
  const unavailable = await checkMigrationReadiness({ query: async () => { const error = new Error('internal connection failure'); error.code = 'ECONNREFUSED'; throw error; } }, ['064_last.sql']);
  assert.equal(unavailable.category, 'database_unavailable');
  const absent = await checkMigrationReadiness({ query: async (sql) => { if (sql === 'SELECT 1') return { rows: [] }; const error = new Error('relation schema_migrations does not exist'); error.code = '42P01'; throw error; } }, ['064_last.sql']);
  assert.equal(absent.category, 'migration_ledger_unavailable');
});

const testAuth = { middleware(_req, _res, next) { next(); }, identity() { return null; } };

test('public health reports ready without Clerk authentication', async () => {
  let authCalls = 0;
  const app = createApp({ authAdapter: { ...testAuth, middleware(_req, _res, next) { authCalls += 1; next(); } }, readinessCheck: async () => ({ ready: true, requiredFrontier: '064' }) });
  const response = await request(app).get('/health');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: 'ready', database: 'ready', migrations: 'ready', requiredFrontier: '064' });
  assert.equal(authCalls, 0);
  assert.doesNotMatch(JSON.stringify(response.body), /tenant|postgres|password|sql/i);
});

test('health failure is non-sensitive and non-2xx', async () => {
  const app = createApp({ authAdapter: testAuth, readinessCheck: async () => ({ ready: false, category: 'database_unavailable', error: new Error('internal database failure') }) });
  const response = await request(app).get('/health');
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { status: 'not_ready', database: 'not_ready', reason: 'database_unavailable' });
  assert.doesNotMatch(JSON.stringify(response.body), /secret|clients|relation|sql/i);
});

for (const category of ['migration_ledger_unavailable', 'migration_behind']) test(`health rejects ${category} without exposing schema details`, async () => {
  const app = createApp({ authAdapter: testAuth, readinessCheck: async () => ({ ready: false, category, error: new Error('internal schema detail') }) });
  const response = await request(app).get('/health');
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { status: 'not_ready', database: 'not_ready', reason: category });
  assert.doesNotMatch(JSON.stringify(response.body), /schema detail/i);
});

test('unexpected production error is generic and shares a reference with the diagnostic log', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const logs = [];
  try {
    const app = createApp({ authAdapter: testAuth, readinessCheck: async () => ({ ready: true }), errorLogger: (...items) => logs.push(items), configureRoutes(instance) {
      instance.get('/test/unexpected', () => { throw new Error('internal relation private_table failed'); });
      instance.get('/test/caught-but-unsafe', (_req, response) => response.status(500).json({ message: 'internal column private_name failed' }));
      instance.get('/test/domain', () => { const error = new Error('The supplied value is invalid.'); error.status = 400; error.code = 'INVALID_VALUE'; throw error; });
    } });
    const unexpected = await request(app).get('/test/unexpected');
    assert.equal(unexpected.status, 500);
    assert.equal(unexpected.body.message, 'An unexpected server error occurred.');
    assert.match(unexpected.body.referenceId, /^[0-9a-f-]{36}$/);
    assert.equal(logs[0][1].referenceId, unexpected.body.referenceId);
    assert.doesNotMatch(JSON.stringify(unexpected.body), /secret|private_table|relation/i);
    const caught = await request(app).get('/test/caught-but-unsafe');
    assert.equal(caught.status, 500);
    assert.equal(caught.body.message, 'An unexpected server error occurred.');
    assert.match(caught.body.referenceId, /^[0-9a-f-]{36}$/);
    assert.equal(logs[1][1].referenceId, caught.body.referenceId);
    assert.doesNotMatch(JSON.stringify(caught.body), /secret|private_name|column/i);
    const domain = await request(app).get('/test/domain');
    assert.deepEqual(domain.body, { message: 'The supplied value is invalid.', code: 'INVALID_VALUE' });
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
  }
});
