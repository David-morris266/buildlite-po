const crypto = require('crypto');

const CANONICAL_JSON_SHA256_V1 = 'canonical_json_sha256_v1';

function canonicalJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON only supports finite numbers.');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new TypeError(`Unsupported canonical JSON value: ${typeof value}`);
}

function hashCanonicalJson(value) {
  return crypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function verifyJsonIntegrity(value, storedHash, scheme) {
  if (!scheme) return { verifiable: false, valid: null, reason: 'legacy_unversioned' };
  if (scheme !== CANONICAL_JSON_SHA256_V1) return { verifiable: false, valid: null, reason: 'unsupported_scheme' };
  const calculatedHash = hashCanonicalJson(value);
  return { verifiable: true, valid: calculatedHash === storedHash, calculatedHash, scheme };
}

module.exports = { CANONICAL_JSON_SHA256_V1, canonicalJson, hashCanonicalJson, verifyJsonIntegrity };
