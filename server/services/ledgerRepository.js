/**
 * BL-031A — Purchase ledger Postgres access layer.
 *
 * Import is transactional. Any duplicate fingerprint rejects the entire batch.
 * CVR actual = SUM(net_amount). VAT/gross are stored as evidence only.
 */

const { pool, query } = require("../db");
const { findDevelopmentById } = require("./developmentRepository");
const { isValidUuid } = require("./ledgerConstants");
const { buildReversalFingerprint } = require("./ledgerFingerprint");
const { batchRowToDocument, transactionRowToDocument } = require("./ledgerMapper");
const { roundMoney } = require("./cvrPeriodValidation");
const { validateLedgerImportBody } = require("./ledgerValidation");

function isUniqueViolation(err) {
  return err && err.code === "23505";
}

function provisionalActor(body = {}) {
  return body.updatedBy || body.createdBy || body.actor || body.importedBy || null;
}

async function runQuery(dbClient, text, params) {
  if (dbClient) return dbClient.query(text, params);
  return query(text, params);
}

async function developmentOr404(clientId, developmentId, dbClient = null) {
  const development = await findDevelopmentById(clientId, developmentId, dbClient);
  if (!development) {
    return { ok: false, status: 404, message: "Development not found." };
  }
  return { ok: true, development };
}

async function listLedgerBatches(clientId, developmentId) {
  const scoped = await developmentOr404(clientId, developmentId);
  if (!scoped.ok) return scoped;
  const { rows } = await query(
    `
      SELECT *
      FROM ledger_import_batches
      WHERE client_id = $1 AND development_id = $2
      ORDER BY imported_at DESC
    `,
    [clientId, developmentId]
  );
  return { ok: true, batches: rows.map(batchRowToDocument) };
}

async function listLedgerTransactions(clientId, developmentId, dbClient = null) {
  const scoped = await developmentOr404(clientId, developmentId, dbClient);
  if (!scoped.ok) return scoped;
  const { rows } = await runQuery(
    dbClient,
    `
      SELECT *
      FROM ledger_transactions
      WHERE client_id = $1 AND development_id = $2
      ORDER BY transaction_date DESC, created_at DESC
    `,
    [clientId, developmentId]
  );
  return { ok: true, transactions: rows.map(transactionRowToDocument) };
}

async function getLedgerTotals(clientId, developmentId) {
  const scoped = await developmentOr404(clientId, developmentId);
  if (!scoped.ok) return scoped;
  const { rows } = await query(
    `
      SELECT
        COALESCE(SUM(net_amount), 0) AS total_net,
        COALESCE(SUM(vat_amount), 0) AS total_vat,
        COUNT(*)::int AS transaction_count
      FROM ledger_transactions
      WHERE client_id = $1 AND development_id = $2
    `,
    [clientId, developmentId]
  );
  const { rows: byCode } = await query(
    `
      SELECT cost_code_key, COALESCE(SUM(net_amount), 0) AS total_net
      FROM ledger_transactions
      WHERE client_id = $1 AND development_id = $2
      GROUP BY cost_code_key
      ORDER BY cost_code_key
    `,
    [clientId, developmentId]
  );

  return {
    ok: true,
    totals: {
      totalNet: Number(rows[0].total_net) || 0,
      totalVat: Number(rows[0].total_vat) || 0,
      transactionCount: rows[0].transaction_count,
      actualCostByCostCode: Object.fromEntries(
        byCode.map((row) => [row.cost_code_key, Number(row.total_net) || 0])
      ),
    },
  };
}

async function importLedgerBatch(clientId, developmentId, body = {}, { actor } = {}) {
  const scoped = await developmentOr404(clientId, developmentId);
  if (!scoped.ok) return scoped;

  const validated = validateLedgerImportBody(body);
  if (!validated.ok) {
    return { ok: false, status: 400, message: validated.errors.join(" ") };
  }

  const fingerprints = validated.value.transactions.map((item) => item.fingerprint);
  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");

    const existing = await dbClient.query(
      `
        SELECT fingerprint
        FROM ledger_transactions
        WHERE client_id = $1
          AND development_id = $2
          AND fingerprint = ANY($3::text[])
      `,
      [clientId, developmentId, fingerprints]
    );
    if (existing.rows.length) {
      await dbClient.query("ROLLBACK");
      return {
        ok: false,
        status: 409,
        message: "Duplicate ledger transaction fingerprint. The batch was not imported.",
        duplicates: existing.rows.map((row) => row.fingerprint),
      };
    }

    const totalNet = roundMoney(
      validated.value.transactions.reduce((sum, item) => sum + item.netAmount, 0)
    );

    const batchInsert = await dbClient.query(
      `
        INSERT INTO ledger_import_batches (
          client_id, development_id, original_file_name, source_profile,
          rows_imported, rows_rejected, total_net, metadata, imported_by
        )
        VALUES ($1, $2, $3, $4, $5, 0, $6, $7::jsonb, $8)
        RETURNING *
      `,
      [
        clientId,
        developmentId,
        validated.value.originalFileName,
        validated.value.sourceProfile,
        validated.value.transactions.length,
        totalNet,
        JSON.stringify(validated.value.metadata),
        actor || null,
      ]
    );
    const batch = batchInsert.rows[0];

    const transactions = [];
    for (const item of validated.value.transactions) {
      const inserted = await dbClient.query(
        `
          INSERT INTO ledger_transactions (
            client_id, development_id, batch_id, supplier, supplier_code,
            cost_code_key, transaction_date, invoice_number, description,
            net_amount, vat_amount, gross_amount, source, document_type,
            reference, fingerprint, created_by
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
          )
          RETURNING *
        `,
        [
          clientId,
          developmentId,
          batch.id,
          item.supplier,
          item.supplierCode,
          item.costCodeKey,
          item.transactionDate,
          item.invoiceNumber,
          item.description,
          item.netAmount,
          item.vatAmount,
          item.grossAmount,
          item.source || validated.value.sourceProfile,
          item.documentType,
          item.reference,
          item.fingerprint,
          actor || null,
        ]
      );
      transactions.push(transactionRowToDocument(inserted.rows[0]));
    }

    await dbClient.query("COMMIT");
    return {
      ok: true,
      status: 201,
      batch: batchRowToDocument(batch),
      transactions,
    };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    if (isUniqueViolation(err)) {
      return {
        ok: false,
        status: 409,
        message: "Duplicate ledger transaction fingerprint. The batch was not imported.",
      };
    }
    throw err;
  } finally {
    dbClient.release();
  }
}

async function reverseLedgerTransaction(clientId, developmentId, transactionId, body = {}, { actor } = {}) {
  const scoped = await developmentOr404(clientId, developmentId);
  if (!scoped.ok) return scoped;
  if (!isValidUuid(transactionId)) {
    return { ok: false, status: 400, message: "transactionId must be a valid UUID." };
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const { rows } = await dbClient.query(
      `
        SELECT *
        FROM ledger_transactions
        WHERE client_id = $1 AND development_id = $2 AND id = $3
        FOR UPDATE
      `,
      [clientId, developmentId, transactionId]
    );
    const origin = rows[0];
    if (!origin) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 404, message: "Ledger transaction not found." };
    }
    if (origin.reverses_id) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 409, message: "Cannot reverse a reversal transaction." };
    }

    const { rows: existingReversal } = await dbClient.query(
      `
        SELECT id
        FROM ledger_transactions
        WHERE client_id = $1 AND development_id = $2 AND reverses_id = $3
        LIMIT 1
      `,
      [clientId, developmentId, transactionId]
    );
    if (existingReversal.length) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 409, message: "This transaction has already been reversed." };
    }

    const fingerprint = buildReversalFingerprint(origin.fingerprint, origin.id);
    const inserted = await dbClient.query(
      `
        INSERT INTO ledger_transactions (
          client_id, development_id, batch_id, supplier, supplier_code,
          cost_code_key, transaction_date, invoice_number, description,
          net_amount, vat_amount, gross_amount, source, document_type,
          reference, fingerprint, reverses_id, created_by
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
        )
        RETURNING *
      `,
      [
        clientId,
        developmentId,
        origin.batch_id,
        origin.supplier,
        origin.supplier_code,
        origin.cost_code_key,
        origin.transaction_date,
        origin.invoice_number,
        origin.description ? `Reversal of ${origin.description}` : "Reversal",
        roundMoney(-Number(origin.net_amount)),
        origin.vat_amount == null ? null : roundMoney(-Number(origin.vat_amount)),
        origin.gross_amount == null ? null : roundMoney(-Number(origin.gross_amount)),
        origin.source || "reversal",
        origin.document_type,
        origin.reference,
        fingerprint,
        origin.id,
        actor || null,
      ]
    );

    await dbClient.query("COMMIT");
    return { ok: true, status: 201, transaction: transactionRowToDocument(inserted.rows[0]) };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    if (isUniqueViolation(err)) {
      return { ok: false, status: 409, message: "This transaction has already been reversed." };
    }
    throw err;
  } finally {
    dbClient.release();
  }
}

module.exports = {
  provisionalActor,
  listLedgerBatches,
  listLedgerTransactions,
  getLedgerTotals,
  importLedgerBatch,
  reverseLedgerTransaction,
};
