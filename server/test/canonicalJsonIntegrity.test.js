const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalJson, hashCanonicalJson, verifyJsonIntegrity, CANONICAL_JSON_SHA256_V1 } = require('../services/canonicalJsonIntegrity');

test('canonical JSON ignores recursive object insertion order but preserves array order', () => {
  const first = { money: 8000.01, nested: { z: null, a: true }, values: ['a', false, 2] };
  const reordered = { values: ['a', false, 2], nested: { a: true, z: null }, money: 8000.01 };
  assert.equal(canonicalJson(first), canonicalJson(reordered));
  assert.equal(hashCanonicalJson(first), hashCanonicalJson(reordered));
  assert.notEqual(hashCanonicalJson(first), hashCanonicalJson({ ...reordered, values: [false, 'a', 2] }));
});

test('commercial value and provenance changes alter canonical integrity', () => {
  const snapshot = { certificateId: 'cert-1', certificateVersion: 3, amount: 8000.01, source: null };
  assert.notEqual(hashCanonicalJson(snapshot), hashCanonicalJson({ ...snapshot, amount: 8000.02 }));
  assert.notEqual(hashCanonicalJson(snapshot), hashCanonicalJson({ ...snapshot, certificateVersion: 4 }));
  const hash = hashCanonicalJson(snapshot);
  assert.deepEqual(verifyJsonIntegrity(snapshot, hash, CANONICAL_JSON_SHA256_V1), { verifiable: true, valid: true, calculatedHash: hash, scheme: CANONICAL_JSON_SHA256_V1 });
});

test('legacy unversioned decisions remain readable without false canonical verification', () => {
  assert.deepEqual(verifyJsonIntegrity({ amount: 1 }, 'legacy-hash', null), { verifiable: false, valid: null, reason: 'legacy_unversioned' });
});

test('Migration 039 versions new hashes without relabelling historic decisions', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '039_payment_authority_snapshot_hash_scheme.sql'), 'utf8');
  assert.match(sql, /ADD COLUMN source_snapshot_hash_scheme TEXT/);
  assert.match(sql, /canonical_json_sha256_v1/);
  assert.match(sql, /BEFORE INSERT ON payment_authority_decisions/);
  assert.doesNotMatch(sql, /UPDATE\s+payment_authority_decisions|DEFAULT\s+'canonical_json_sha256_v1'/i);
});
