/**
 * BL-027B.1 — Package Postgres access layer.
 */

const { pool, query } = require("../db");
const { rowToDocument } = require("./packageMapper");

async function loadPoNumbersForPackages(clientId, packageIds = []) {
  if (!packageIds.length) return new Map();

  const { rows } = await query(
    `
      SELECT package_id, po_number
      FROM package_purchase_orders
      WHERE client_id = $1
        AND package_id = ANY($2::uuid[])
      ORDER BY po_number ASC
    `,
    [clientId, packageIds]
  );

  const map = new Map();
  for (const row of rows) {
    const list = map.get(row.package_id) || [];
    list.push(row.po_number);
    map.set(row.package_id, list);
  }
  return map;
}

async function listPackagesForDevelopment(clientId, developmentId) {
  const { rows } = await query(
    `
      SELECT *
      FROM packages
      WHERE client_id = $1
        AND development_id = $2
      ORDER BY supplier_label ASC NULLS LAST, order_key ASC
    `,
    [clientId, developmentId]
  );

  const poMap = await loadPoNumbersForPackages(
    clientId,
    rows.map((row) => row.id)
  );

  return rows.map((row) => rowToDocument(row, poMap.get(row.id) || []));
}

async function findPackageRowById(clientId, packageId) {
  const { rows } = await query(
    `
      SELECT *
      FROM packages
      WHERE id = $1 AND client_id = $2
      LIMIT 1
    `,
    [packageId, clientId]
  );
  return rows[0] || null;
}

async function findPackageById(clientId, packageId) {
  const row = await findPackageRowById(clientId, packageId);
  if (!row) return null;

  const poMap = await loadPoNumbersForPackages(clientId, [row.id]);
  return rowToDocument(row, poMap.get(row.id) || []);
}

async function findPackageByOrderKey(clientId, orderKey) {
  const { rows } = await query(
    `
      SELECT *
      FROM packages
      WHERE client_id = $1
        AND order_key = $2
      LIMIT 1
    `,
    [clientId, orderKey]
  );
  if (!rows[0]) return null;

  const poMap = await loadPoNumbersForPackages(clientId, [rows[0].id]);
  return rowToDocument(rows[0], poMap.get(rows[0].id) || []);
}

async function developmentExistsForClient(clientId, developmentId) {
  const { rows } = await query(
    `
      SELECT id
      FROM developments
      WHERE client_id = $1 AND id = $2
      LIMIT 1
    `,
    [clientId, developmentId]
  );
  return rows.length > 0;
}

async function findDevelopmentRowForPo(clientId, developmentId) {
  const { rows } = await query(
    `
      SELECT id, job_number, development_name
      FROM developments
      WHERE client_id = $1 AND id = $2
      LIMIT 1
    `,
    [clientId, developmentId]
  );
  return rows[0] || null;
}

async function findDevelopmentByJobNumber(clientId, jobNumber) {
  if (!jobNumber) return null;
  const { rows } = await query(
    `
      SELECT id, job_number, development_name
      FROM developments
      WHERE client_id = $1 AND lower(job_number) = lower($2)
      LIMIT 1
    `,
    [clientId, jobNumber]
  );
  return rows[0] || null;
}

async function upsertPackageWithMembership(client, group, { actor = null } = {}) {
  const clientId = client.id;
  const dbClient = await pool.connect();

  try {
    await dbClient.query("BEGIN");

    const existingLookup = await dbClient.query(
      `
        SELECT id
        FROM packages
        WHERE client_id = $1 AND order_key = $2
        LIMIT 1
      `,
      [clientId, group.orderKey]
    );
    const existed = existingLookup.rows.length > 0;

    const upsert = await dbClient.query(
      `
        INSERT INTO packages (
          client_id,
          development_id,
          supplier_id,
          cost_code,
          order_key,
          supplier_label,
          development_number,
          development_name,
          payload,
          version,
          materialised_at,
          created_by,
          updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 1, NOW(), $10, $11)
        ON CONFLICT (client_id, order_key)
        DO UPDATE SET
          supplier_label = EXCLUDED.supplier_label,
          development_number = EXCLUDED.development_number,
          development_name = EXCLUDED.development_name,
          materialised_at = NOW(),
          updated_at = NOW(),
          updated_by = EXCLUDED.updated_by
        RETURNING *
      `,
      [
        clientId,
        group.developmentId,
        group.supplierId,
        group.costCode,
        group.orderKey,
        group.supplierLabel || null,
        group.developmentNumber || null,
        group.developmentName || null,
        JSON.stringify(group.payload || {}),
        actor,
        actor,
      ]
    );

    const packageRow = upsert.rows[0];
    const created = !existed;

    await dbClient.query(
      `
        DELETE FROM package_purchase_orders
        WHERE package_id = $1 AND client_id = $2
      `,
      [packageRow.id, clientId]
    );

    for (const poNumber of group.poNumbers) {
      await dbClient.query(
        `
          INSERT INTO package_purchase_orders (package_id, client_id, po_number)
          VALUES ($1, $2, $3)
          ON CONFLICT (package_id, po_number) DO NOTHING
        `,
        [packageRow.id, clientId, poNumber]
      );
    }

    await dbClient.query("COMMIT");

    return {
      ok: true,
      created,
      package: rowToDocument(packageRow, group.poNumbers),
    };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    throw err;
  } finally {
    dbClient.release();
  }
}

module.exports = {
  listPackagesForDevelopment,
  findPackageById,
  findPackageByOrderKey,
  developmentExistsForClient,
  findDevelopmentRowForPo,
  findDevelopmentByJobNumber,
  upsertPackageWithMembership,
};
