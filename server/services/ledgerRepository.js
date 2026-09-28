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
      SELECT lt.*, code.code AS resolved_cost_code_key,
             code.description AS resolved_cost_code_description
      FROM ledger_transactions lt
      LEFT JOIN cost_codes code ON code.id = lt.resolved_cost_code_id
      WHERE lt.client_id = $1 AND lt.development_id = $2
      ORDER BY lt.transaction_date DESC, lt.created_at DESC
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
        COALESCE(SUM(net_amount), 0) AS source_total_net,
        COALESCE(SUM(net_amount) FILTER (WHERE resolution_status = 'resolved'), 0) AS allocated_total_net,
        COALESCE(SUM(net_amount) FILTER (WHERE resolution_status = 'unresolved'), 0) AS unresolved_total_net,
        COALESCE(SUM(vat_amount), 0) AS total_vat,
        COUNT(*)::int AS transaction_count,
        COUNT(*) FILTER (WHERE resolution_status = 'unresolved')::int AS unresolved_count
      FROM ledger_transactions
      WHERE client_id = $1 AND development_id = $2
    `,
    [clientId, developmentId]
  );
  const { rows: byCode } = await query(
    `
      SELECT code.code AS cost_code_key, COALESCE(SUM(lt.net_amount), 0) AS total_net
      FROM ledger_transactions lt
      JOIN cost_codes code ON code.id = lt.resolved_cost_code_id
      WHERE lt.client_id = $1 AND lt.development_id = $2
        AND lt.resolution_status = 'resolved'
      GROUP BY code.code
      ORDER BY code.code
    `,
    [clientId, developmentId]
  );

  return {
    ok: true,
    totals: {
      totalNet: Number(rows[0].source_total_net) || 0,
      sourceTotalNet: Number(rows[0].source_total_net) || 0,
      allocatedTotalNet: Number(rows[0].allocated_total_net) || 0,
      unresolvedTotalNet: Number(rows[0].unresolved_total_net) || 0,
      totalVat: Number(rows[0].total_vat) || 0,
      transactionCount: rows[0].transaction_count,
      unresolvedCount: rows[0].unresolved_count,
      actualCostByCostCode: Object.fromEntries(
        byCode.map((row) => [row.cost_code_key, Number(row.total_net) || 0])
      ),
    },
  };
}

async function importLedgerBatch(clientId, developmentId, body = {}, auth = {}) {
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

    const sourceKeys = [...new Set(validated.value.transactions.map((item) => item.costCodeKey.toLowerCase()))];
    const eligibleResult = await dbClient.query(
      `SELECT id, code FROM cost_codes
       WHERE client_id=$1 AND is_active=TRUE AND allow_ledger_import=TRUE
         AND lower(btrim(code)) = ANY($2::text[])`,
      [clientId, sourceKeys]
    );
    const eligible = new Map(eligibleResult.rows.map((row) => [String(row.code).trim().toLowerCase(), row]));

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
        auth.displayName || null,
      ]
    );
    const batch = batchInsert.rows[0];

    const transactions = [];
    for (const item of validated.value.transactions) {
      const inserted = await dbClient.query(
        `
          INSERT INTO ledger_transactions (
            client_id, development_id, batch_id, supplier, supplier_code,
            cost_code_key, source_cost_code_key, resolved_cost_code_id, resolution_status,
            resolved_at, resolved_by_user_id, resolved_by_membership_id,
            resolved_by_provider_user_id, resolved_by_display_name,
            transaction_date, invoice_number, description,
            net_amount, vat_amount, gross_amount, source, document_type,
            reference, fingerprint, created_by
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
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
          eligible.get(item.costCodeKey.toLowerCase())?.id || null,
          eligible.has(item.costCodeKey.toLowerCase()) ? "resolved" : "unresolved",
          eligible.has(item.costCodeKey.toLowerCase()) ? new Date() : null,
          eligible.has(item.costCodeKey.toLowerCase()) ? auth.userId : null,
          eligible.has(item.costCodeKey.toLowerCase()) ? auth.membershipId : null,
          eligible.has(item.costCodeKey.toLowerCase()) ? auth.providerUserId : null,
          eligible.has(item.costCodeKey.toLowerCase()) ? auth.displayName : null,
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
          auth.displayName || null,
        ]
      );
      transactions.push(transactionRowToDocument({
        ...inserted.rows[0],
        resolved_cost_code_key: eligible.get(item.costCodeKey.toLowerCase())?.code || null,
      }));
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

async function reverseLedgerTransaction(clientId, developmentId, transactionId, body = {}, auth = {}) {
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
          cost_code_key, source_cost_code_key, resolved_cost_code_id, resolution_status,
          resolved_at, resolved_by_user_id, resolved_by_membership_id, resolved_by_provider_user_id,
          resolved_by_display_name, transaction_date, invoice_number, description,
          net_amount, vat_amount, gross_amount, source, document_type,
          reference, fingerprint, reverses_id, created_by
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26
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
        origin.source_cost_code_key,
        origin.resolved_cost_code_id,
        origin.resolution_status,
        origin.resolved_at,
        origin.resolved_by_user_id,
        origin.resolved_by_membership_id,
        origin.resolved_by_provider_user_id,
        origin.resolved_by_display_name,
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
        auth.displayName || null,
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

async function resolveLedgerTransaction(clientId, developmentId, transactionId, body = {}, auth = {}) {
  if (!isValidUuid(transactionId) || !isValidUuid(body.resolvedCostCodeId)) {
    return { ok:false, status:400, message:"Valid transaction and Company Cost Code identities are required." };
  }
  const version = Number(body.version);
  const reason = String(body.reason || "").trim();
  if (!Number.isInteger(version) || version < 1 || !reason) return { ok:false,status:400,message:"Resolution version and reason are required." };
  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const transactionResult = await dbClient.query(
      `SELECT * FROM ledger_transactions WHERE client_id=$1 AND development_id=$2 AND id=$3 FOR UPDATE`,
      [clientId, developmentId, transactionId]
    );
    const transaction = transactionResult.rows[0];
    if (!transaction) { await dbClient.query("ROLLBACK"); return {ok:false,status:404,message:"Ledger transaction not found."}; }
    if (Number(transaction.resolution_version) !== version) { await dbClient.query("ROLLBACK"); return {ok:false,status:409,message:"Ledger resolution changed. Refresh and try again."}; }
    const codeResult = await dbClient.query(
      `SELECT id,code FROM cost_codes WHERE client_id=$1 AND id=$2 AND is_active=TRUE AND allow_ledger_import=TRUE`,
      [clientId, body.resolvedCostCodeId]
    );
    if (!codeResult.rows[0]) { await dbClient.query("ROLLBACK"); return {ok:false,status:400,message:"Select an active ledger-eligible Company Cost Code."}; }
    const priorVersion = Number(transaction.resolution_version);
    const updated = await dbClient.query(
      `UPDATE ledger_transactions SET resolved_cost_code_id=$1,resolution_status='resolved',resolution_version=resolution_version+1,
       resolved_at=NOW(),resolved_by_user_id=$2,resolved_by_membership_id=$3,resolved_by_provider_user_id=$4,resolved_by_display_name=$5
       WHERE client_id=$6 AND development_id=$7 AND id=$8 AND resolution_version=$9 RETURNING *`,
      [body.resolvedCostCodeId,auth.userId,auth.membershipId,auth.providerUserId,auth.displayName,clientId,developmentId,transactionId,version]
    );
    if (!updated.rowCount) { await dbClient.query("ROLLBACK"); return {ok:false,status:409,message:"Ledger resolution changed. Refresh and try again."}; }
    await dbClient.query(
      `INSERT INTO ledger_cost_code_resolution_audit(client_id,development_id,transaction_id,prior_resolved_cost_code_id,resolved_cost_code_id,
       source_cost_code_key,prior_resolution_version,resolution_version,reason,actor_user_id,actor_membership_id,actor_provider_user_id,
       actor_display_name,actor_role_key,permission_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'ledger.manage')`,
      [clientId,developmentId,transactionId,transaction.resolved_cost_code_id,body.resolvedCostCodeId,transaction.source_cost_code_key,
       priorVersion,priorVersion+1,reason,auth.userId,auth.membershipId,auth.providerUserId,auth.displayName,auth.roleKey]
    );
    await dbClient.query("COMMIT");
    return {ok:true,status:200,transaction:transactionRowToDocument({...updated.rows[0],resolved_cost_code_key:codeResult.rows[0].code})};
  } catch(error) { await dbClient.query("ROLLBACK"); throw error; } finally { dbClient.release(); }
}

module.exports = {
  listLedgerBatches,
  listLedgerTransactions,
  getLedgerTotals,
  importLedgerBatch,
  reverseLedgerTransaction,
  resolveLedgerTransaction,
};
