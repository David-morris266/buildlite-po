async function allocateNextVariationOrderNumber(db, clientId, packageId) {
  const { rows } = await db.query(
    `INSERT INTO variation_order_number_sequences (client_id, package_id, next_number)
     VALUES ($1, $2, 2)
     ON CONFLICT (client_id, package_id) DO UPDATE
       SET next_number = variation_order_number_sequences.next_number + 1
     RETURNING next_number - 1 AS allocated_number`,
    [clientId, packageId]
  );
  return `VO-${String(rows[0].allocated_number).padStart(4, "0")}`;
}

module.exports = { allocateNextVariationOrderNumber };
