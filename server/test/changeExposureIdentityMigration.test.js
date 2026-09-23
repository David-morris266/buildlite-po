const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '057_change_exposure_identity.sql'), 'utf8');
const repository = fs.readFileSync(path.join(__dirname, '..', 'services', 'variationAccountRepository.js'), 'utf8');

test('Migration 057 is nullable/no-backfill, stable, unique and append-only', () => {
  assert.match(sql, /source_commercial_event_id TEXT/i);
  assert.doesNotMatch(sql, /UPDATE\s+package_variation_account_items/i);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_va_source_commercial_event/i);
  assert.match(sql, /BEFORE UPDATE OR DELETE/i);
  assert.match(sql, /actor_membership_id UUID NOT NULL/i);
});

test('change identity mutation is tenant/package scoped and optimistic', () => {
  assert.match(repository, /lockedItem\(db,clientId,id,body\.version\)/);
  assert.match(repository, /client_id=\$1 AND package_id=\$2 AND id=\$3/);
  assert.match(repository, /package_variation_account_change_identity_audit/);
  assert.match(repository, /requireActor\(auth,PERMISSIONS\.VARIATION_ACCOUNT_FORECAST_EDIT\)/);
});
