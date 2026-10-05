const { pool, query } = require('../db');

const metadata = row => row && ({
  id: row.id,
  assetType: row.asset_type,
  mimeType: row.mime_type,
  byteSize: Number(row.byte_size),
  width: Number(row.width),
  height: Number(row.height),
  sha256: row.sha256,
  createdAt: row.created_at,
});

async function getCurrent(clientId, db = { query }) {
  let row;
  try {
    row = (await db.query(`SELECT b.version,a.* FROM tenant_branding b
      LEFT JOIN tenant_brand_assets a ON a.client_id=b.client_id AND a.id=b.active_logo_asset_id
      WHERE b.client_id=$1`, [clientId])).rows[0];
  } catch (error) {
    // Migration readiness prevents a hosted server starting without 066. This keeps
    // lower-level historic tests, which deliberately install only their own schema slice, neutral.
    if (error.code === '42P01') return { version: 0, asset: null };
    throw error;
  }
  return row ? { version: Number(row.version), asset: row.id ? metadata(row) : null } : { version: 0, asset: null };
}

async function getAsset(clientId, assetId, { includeBinary = false, db = { query } } = {}) {
  const fields = includeBinary ? '*' : 'id,asset_type,mime_type,byte_size,width,height,sha256,created_at';
  const row = (await db.query(`SELECT ${fields} FROM tenant_brand_assets WHERE client_id=$1 AND id=$2`, [clientId, assetId])).rows[0];
  return row ? { ...metadata(row), binary: includeBinary ? row.binary_data : undefined } : null;
}

async function activatePostgresAsset(clientId, asset, expectedVersion, auth) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const current = (await db.query('SELECT * FROM tenant_branding WHERE client_id=$1 FOR UPDATE', [clientId])).rows[0];
    const version = current ? Number(current.version) : 0;
    if (version !== expectedVersion) {
      await db.query('ROLLBACK');
      return { ok: false, status: 409, message: 'Company branding changed. Reload and try again.' };
    }
    const inserted = (await db.query(`INSERT INTO tenant_brand_assets(
      client_id,asset_type,original_filename,mime_type,byte_size,width,height,sha256,
      storage_provider,binary_data,created_by_user_id,created_by_membership_id,
      created_by_provider_user_id,created_by_display_name)
      VALUES($1,'company_logo',$2,$3,$4,$5,$6,$7,'postgres',$8,$9,$10,$11,$12) RETURNING *`,
    [clientId, asset.originalFilename, asset.mimeType, asset.binary.length, asset.width, asset.height,
      asset.sha256, asset.binary, auth.userId, auth.membershipId, auth.providerUserId, auth.displayName])).rows[0];
    const nextVersion = version + 1;
    if (current) await db.query(`UPDATE tenant_branding SET active_logo_asset_id=$2,version=$3,updated_at=NOW(),
      updated_by_user_id=$4,updated_by_membership_id=$5,updated_by_provider_user_id=$6,updated_by_display_name=$7
      WHERE client_id=$1`, [clientId, inserted.id, nextVersion, auth.userId, auth.membershipId, auth.providerUserId, auth.displayName]);
    else await db.query(`INSERT INTO tenant_branding(client_id,active_logo_asset_id,version,updated_by_user_id,
      updated_by_membership_id,updated_by_provider_user_id,updated_by_display_name) VALUES($1,$2,1,$3,$4,$5,$6)`,
    [clientId, inserted.id, auth.userId, auth.membershipId, auth.providerUserId, auth.displayName]);
    await db.query(`INSERT INTO tenant_branding_audit(client_id,operation,previous_logo_asset_id,next_logo_asset_id,
      actor_user_id,actor_membership_id,actor_provider_user_id,actor_display_name,actor_role_key,actor_permission_key)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'company_settings.manage')`,
    [clientId, current?.active_logo_asset_id ? 'logo_replaced' : 'logo_uploaded', current?.active_logo_asset_id || null,
      inserted.id, auth.userId, auth.membershipId, auth.providerUserId, auth.displayName, auth.roleKey]);
    await db.query('COMMIT');
    return { ok: true, version: nextVersion, asset: metadata(inserted) };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally { db.release(); }
}

async function removeCurrent(clientId, expectedVersion, auth) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const current = (await db.query('SELECT * FROM tenant_branding WHERE client_id=$1 FOR UPDATE', [clientId])).rows[0];
    const version = current ? Number(current.version) : 0;
    if (version !== expectedVersion) {
      await db.query('ROLLBACK');
      return { ok: false, status: 409, message: 'Company branding changed. Reload and try again.' };
    }
    if (!current?.active_logo_asset_id) {
      await db.query('COMMIT');
      return { ok: true, version, asset: null };
    }
    const nextVersion = version + 1;
    await db.query(`UPDATE tenant_branding SET active_logo_asset_id=NULL,version=$2,updated_at=NOW(),
      updated_by_user_id=$3,updated_by_membership_id=$4,updated_by_provider_user_id=$5,updated_by_display_name=$6
      WHERE client_id=$1`, [clientId, nextVersion, auth.userId, auth.membershipId, auth.providerUserId, auth.displayName]);
    await db.query(`INSERT INTO tenant_branding_audit(client_id,operation,previous_logo_asset_id,next_logo_asset_id,
      actor_user_id,actor_membership_id,actor_provider_user_id,actor_display_name,actor_role_key,actor_permission_key)
      VALUES($1,'logo_removed',$2,NULL,$3,$4,$5,$6,$7,'company_settings.manage')`,
    [clientId, current.active_logo_asset_id, auth.userId, auth.membershipId, auth.providerUserId, auth.displayName, auth.roleKey]);
    await db.query('COMMIT');
    return { ok: true, version: nextVersion, asset: null };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally { db.release(); }
}

module.exports = { getCurrent, getAsset, activatePostgresAsset, removeCurrent };
