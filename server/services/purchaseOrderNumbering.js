const VALID_TYPES = new Set(["S", "M", "P"]);
const MAX_ALLOCATION_ATTEMPTS = 3;

function normaliseOrderType(value) {
  const type = String(value || "").trim().toUpperCase();
  if (!VALID_TYPES.has(type)) {
    throw Object.assign(new Error("Purchase Order type must be Materials, Subcontract or Plant."), { status: 400 });
  }
  return type;
}

async function allocatePurchaseOrderNumber(db, clientId, orderType) {
  const type = normaliseOrderType(orderType);
  const result = await db.query(
    `WITH existing AS (
       SELECT COALESCE(MAX(substring(po_number FROM 2)::BIGINT), 0) AS maximum
       FROM purchase_orders
       WHERE client_id=$1 AND po_number ~ ('^' || $2 || '[0-9]{4,}$')
     )
     INSERT INTO purchase_order_number_sequences(client_id, order_type, next_number)
     SELECT $1, $2, existing.maximum + 2 FROM existing
     ON CONFLICT(client_id, order_type) DO UPDATE
       SET next_number=GREATEST(
         purchase_order_number_sequences.next_number,
         (SELECT maximum + 1 FROM existing)
       ) + 1
     RETURNING next_number - 1 AS allocated_number`,
    [clientId, type]
  );
  const allocated = Number(result.rows[0].allocated_number);
  return `${type}${String(allocated).padStart(4, "0")}`;
}

async function insertPurchaseOrderWithNumber(db, clientId, orderType, buildPayload) {
  for (let attempt = 1; attempt <= MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
    const savepoint = `po_number_attempt_${attempt}`;
    let poNumber = null;
    await db.query(`SAVEPOINT ${savepoint}`);
    try {
      poNumber = await allocatePurchaseOrderNumber(db, clientId, orderType);
      const payload = buildPayload(poNumber);
      await db.query(
        `INSERT INTO purchase_orders(client_id, po_number, payload) VALUES($1,$2,$3)`,
        [clientId, poNumber, payload]
      );
      await db.query(`RELEASE SAVEPOINT ${savepoint}`);
      return payload;
    } catch (error) {
      await db.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await db.query(`RELEASE SAVEPOINT ${savepoint}`);
      if (
        error.code !== "23505" ||
        error.constraint !== "purchase_orders_pkey" ||
        !poNumber ||
        attempt === MAX_ALLOCATION_ATTEMPTS
      ) throw error;
      await db.query(
        `INSERT INTO purchase_order_number_sequences(client_id, order_type, next_number)
         VALUES($1,$2,$3)
         ON CONFLICT(client_id, order_type) DO UPDATE
           SET next_number=GREATEST(purchase_order_number_sequences.next_number, EXCLUDED.next_number)`,
        [clientId, normaliseOrderType(orderType), Number(poNumber.slice(1)) + 2]
      );
    }
  }
  throw Object.assign(new Error("Purchase Order number could not be allocated safely."), { status: 409 });
}

module.exports = {
  MAX_ALLOCATION_ATTEMPTS,
  normaliseOrderType,
  allocatePurchaseOrderNumber,
  insertPurchaseOrderWithNumber,
};
