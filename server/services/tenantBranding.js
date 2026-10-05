const crypto = require('crypto');
const sharp = require('sharp');
const repository = require('./tenantBrandingRepository');

const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_INPUT_PIXELS = 4096 * 4096;

function detectedType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function safeFilename(value) {
  const decoded = (() => { try { return decodeURIComponent(String(value || 'company-logo')); } catch { return 'company-logo'; } })();
  return decoded.replace(/[\\/\0-\x1f\x7f]/g, '-').slice(0, 255) || 'company-logo';
}

async function normaliseLogo(input, filename) {
  if (!Buffer.isBuffer(input) && !(input instanceof Uint8Array)) throw Object.assign(new Error('Choose a PNG, JPEG or WebP company logo.'), { status: 400 });
  const source = Buffer.from(input);
  if (!source.length) throw Object.assign(new Error('Choose a PNG, JPEG or WebP company logo.'), { status: 400 });
  if (source.length > MAX_INPUT_BYTES) throw Object.assign(new Error('Company logo must be 2 MB or smaller.'), { status: 413 });
  if (!detectedType(source)) throw Object.assign(new Error('Company logo must be a valid PNG, JPEG or WebP image.'), { status: 415 });
  try {
    const image = sharp(source, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS, animated: false });
    const info = await image.metadata();
    if (!['png','jpeg','webp'].includes(info.format) || !info.width || !info.height || (info.pages || 1) !== 1) throw new Error('Unsupported image');
    if (info.width > 4096 || info.height > 4096 || info.width * info.height > MAX_INPUT_PIXELS) throw Object.assign(new Error('Company logo dimensions are too large.'), { status: 413 });
    let output;
    for (const quality of [84,74,64,54]) {
      output = await image.clone().rotate().resize({ width: 1200, height: 500, fit: 'inside', withoutEnlargement: true }).webp({ quality, effort: 5 }).toBuffer({ resolveWithObject: true });
      if (output.data.length <= 300 * 1024) break;
    }
    if (output.data.length > MAX_INPUT_BYTES) throw Object.assign(new Error('Company logo could not be reduced to a safe size.'), { status: 413 });
    return { originalFilename: safeFilename(filename), mimeType: 'image/webp', binary: output.data,
      width: output.info.width, height: output.info.height,
      sha256: crypto.createHash('sha256').update(output.data).digest('hex') };
  } catch (error) {
    if (error.status) throw error;
    throw Object.assign(new Error('Company logo is malformed or cannot be decoded safely.'), { status: 415 });
  }
}

function publicState(current) {
  return { version: current.version, logo: current.asset ? { ...current.asset, displayUrl: `/api/company-branding/assets/${current.asset.id}` } : null };
}

async function getState(clientId) { return publicState(await repository.getCurrent(clientId)); }
async function upload(clientId, input, filename, version, auth) {
  const asset = await normaliseLogo(input, filename);
  const result = await repository.activatePostgresAsset(clientId, asset, version, auth);
  return result.ok ? { ...result, ...publicState({ version: result.version, asset: result.asset }) } : result;
}
async function remove(clientId, version, auth) { return repository.removeCurrent(clientId, version, auth); }
async function getAsset(clientId, assetId) { return repository.getAsset(clientId, assetId, { includeBinary: true }); }

module.exports = { MAX_INPUT_BYTES, normaliseLogo, getState, upload, remove, getAsset };
