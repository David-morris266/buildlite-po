#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });

const { Client } = require('pg');
const { spawnSync } = require('child_process');
const request = require('supertest');
const path = require('path');
const { requiredMigrationFiles, migrationFrontier, checkMigrationReadiness } = require('../services/migrationReadiness');

const targetName = String(process.env.PILOT_REHEARSAL_DATABASE_NAME || '').trim();
const verifyExisting = process.env.PILOT_REHEARSAL_VERIFY_EXISTING === 'true';
const protectedNames = new Set(['buildlite_clone', 'buildlite_test', 'buildlite_po_db', 'postgres', 'template0', 'template1']);
const localHosts = new Set(['localhost', '127.0.0.1', '::1']);

function fail(message) {
  console.error(`[pilot-rehearsal] Refused: ${message}`);
  process.exit(1);
}

if (!/^buildlite_pilot_rehearsal_[a-z0-9_]+$/.test(targetName)) fail('PILOT_REHEARSAL_DATABASE_NAME must use the buildlite_pilot_rehearsal_* convention.');
if (protectedNames.has(targetName)) fail('The requested database name is protected.');
if (!process.env.DATABASE_URL) fail('DATABASE_URL is required only as the source of local connection credentials.');

const sourceUrl = new URL(process.env.DATABASE_URL);
if (!localHosts.has(sourceUrl.hostname)) fail('The configured PostgreSQL host is not local.');
const targetUrl = new URL(sourceUrl);
targetUrl.pathname = `/${targetName}`;
const maintenanceUrl = new URL(sourceUrl);
maintenanceUrl.pathname = '/postgres';

async function inventory(client) {
  const tables = ['clients', 'buildlite_users', 'client_user_memberships', 'developments', 'purchase_orders', 'package_payment_certificates', 'cvr_periods', 'commercial_events', 'variation_orders', 'package_variation_account_items'];
  const counts = {};
  for (const table of tables) counts[table] = Number((await client.query(`SELECT COUNT(*)::int AS count FROM ${table}`)).rows[0].count);
  return counts;
}

async function main() {
  const admin = new Client({ connectionString: maintenanceUrl.toString(), ssl: false });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [targetName]);
  if (exists.rowCount && !verifyExisting) fail('The disposable target already exists; refusing to reuse or alter it.');
  if (!exists.rowCount && verifyExisting) fail('The requested verification target does not exist.');
  if (!exists.rowCount) await admin.query(`CREATE DATABASE ${targetName}`);
  await admin.end();

  const target = new Client({ connectionString: targetUrl.toString(), ssl: false });
  await target.connect();
  const identity = (await target.query('SELECT current_database() AS database, inet_server_addr()::text AS address, inet_server_port() AS port')).rows[0];
  if (identity.database !== targetName || protectedNames.has(identity.database)) fail('Positive database identity check failed.');
  const initialTables = Number((await target.query("SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema='public'")).rows[0].count);
  if (!verifyExisting && initialTables !== 0) fail('Disposable target is not initially empty.');
  console.log('[pilot-rehearsal] Identity verified:', JSON.stringify({ database: identity.database, host: sourceUrl.hostname, address: identity.address, port: identity.port, initialPublicTables: initialTables, mode: verifyExisting ? 'verify_existing' : 'create_and_migrate' }));
  await target.end();

  if (!verifyExisting) {
    const command = process.platform === 'win32' ? process.env.ComSpec : 'npm';
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd run migrate'] : ['run', 'migrate'];
    const migration = spawnSync(command, args, {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: targetUrl.toString(), DATABASE_SSL: 'false', BUILDLITE_SERVER_TEST: '', TEST_DATABASE_URL: '' },
      encoding: 'utf8',
    });
    process.stdout.write(migration.stdout || '');
    process.stderr.write(migration.stderr || '');
    if (migration.status !== 0) fail(`Normal migration command failed with exit code ${migration.status}.`);
  }

  const verify = new Client({ connectionString: targetUrl.toString(), ssl: false });
  await verify.connect();
  const files = requiredMigrationFiles();
  const ledger = (await verify.query('SELECT filename, COUNT(*)::int AS count FROM schema_migrations GROUP BY filename ORDER BY filename')).rows;
  if (ledger.length !== files.length || ledger.some((row, index) => row.filename !== files[index] || row.count !== 1)) fail('Migration ledger does not exactly match the repository inventory.');
  const counts = await inventory(verify);
  const readiness = await checkMigrationReadiness(verify, files);
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.NODE_ENV = 'production';
  process.env.DATABASE_URL = targetUrl.toString();
  const createApp = require('../app');
  const app = createApp({ authAdapter: { middleware(_req, _res, next) { next(); }, identity() { return null; } }, readinessCheck: () => checkMigrationReadiness(verify, files) });
  const health = await request(app).get('/health');
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
  process.env.DATABASE_URL = previousDatabaseUrl;
  if (health.status !== 200 || health.body?.status !== 'ready') fail('The real health endpoint did not report ready against the migrated database.');
  console.log('[pilot-rehearsal] Result:', JSON.stringify({ migrationCount: ledger.length, firstMigration: ledger[0]?.filename, lastMigration: ledger.at(-1)?.filename, frontier: migrationFrontier(files), healthReadiness: { ready: readiness.ready, category: readiness.category, requiredFrontier: readiness.requiredFrontier, endpointStatus: health.status, endpointBody: health.body }, businessRows: counts }));
  await verify.end();
}

main().catch((error) => fail(error.message));
