// server/routes/paymentRoutes.js
const express = require("express");
const router = express.Router();

const { pool, query } = require("../db");
const { getActiveClient } = require("../services/activeClient");
const { isProduction } = require("../utils/env");

/**
 * Utility: safe number
 */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function asText(v) {
  return v == null ? "" : String(v);
}

function isoNow() {
  return new Date().toISOString();
}

/** Map DB row to API shape (canonical + legacy aliases). */
function mapCertificateRow(r) {
  const payload = r.payload || {};
  const certNo = r.certificate_number ?? r.cert_no ?? null;
  const periodFrom =
    r.period_from ?? payload?.header?.periodFrom ?? null;
  const periodTo =
    r.period_to ?? r.period_end ?? payload?.header?.periodTo ?? null;

  return {
    id: r.id,
    client_id: r.client_id,
    job_id: r.job_id,
    supplier_id: r.supplier_id,
    certificate_number: certNo,
    cert_no: certNo,
    period_from: periodFrom,
    period_to: periodTo,
    period_end: periodTo,
    status: r.status,
    notes: r.notes ?? payload?.header?.notes ?? null,
    payload,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/**
 * DEBUG: /api/payments/_debug (disabled in production)
 */
router.get("/_debug", async (_req, res) => {
  if (isProduction()) {
    return res.status(404).json({ message: "Not found" });
  }

  try {
    const certs = await query(
      `SELECT to_regclass('public.payment_certificates') AS name`,
      []
    );
    const lines = await query(
      `SELECT to_regclass('public.payment_certificate_lines') AS name`,
      []
    );

    let certCols = [];
    if (certs.rows[0]?.name) {
      const c = await query(
        `SELECT column_name, data_type
         FROM information_schema.columns
         WHERE table_name = 'payment_certificates'
         ORDER BY ordinal_position`,
        []
      );
      certCols = c.rows;
    }

    let lineCols = [];
    if (lines.rows[0]?.name) {
      const l = await query(
        `SELECT column_name, data_type
         FROM information_schema.columns
         WHERE table_name = 'payment_certificate_lines'
         ORDER BY ordinal_position`,
        []
      );
      lineCols = l.rows;
    }

    res.json({
      ok: true,
      tables: {
        payment_certificates: certs.rows[0]?.name || null,
        payment_certificate_lines: lines.rows[0]?.name || null,
      },
      payment_certificates_columns: certCols,
      payment_certificate_lines_columns: lineCols,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * Production schema (Doc 20 Appendix A):
 * certificate_number, period_from, period_to, payload (JSONB lines)
 */

/**
 * GET /api/payments/certificates
 * Optional filters: ?jobId=3&supplierId=sup-123
 * Always scoped to active client_id.
 */
router.get("/certificates", async (req, res) => {
  try {
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const { jobId, supplierId } = req.query;

    const where = ["client_id = $1"];
    const params = [active.id];

    if (jobId) {
      params.push(asText(jobId));
      where.push(`job_id = $${params.length}`);
    }
    if (supplierId) {
      params.push(asText(supplierId));
      where.push(`supplier_id = $${params.length}`);
    }

    const sql = `
      SELECT
        id,
        client_id,
        job_id,
        supplier_id,
        certificate_number,
        period_from,
        period_to,
        status,
        notes,
        payload,
        created_at,
        updated_at
      FROM payment_certificates
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT 200
    `;

    const { rows } = await query(sql, params);
    const items = rows.map(mapCertificateRow);

    res.json({ items });
  } catch (err) {
    console.error("[payments] list certs error:", err);
    res.status(500).json({ message: err.message || "Server error" });
  }
});

/**
 * GET /api/payments/certificates/:id
 * Returns certificate row + payload.lines (and keeps legacy keys)
 */
router.get("/certificates/:id", async (req, res) => {
  try {
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const { id } = req.params;

    const head = await query(
      `
      SELECT
        id,
        client_id,
        job_id,
        supplier_id,
        certificate_number,
        period_from,
        period_to,
        status,
        notes,
        payload,
        created_at,
        updated_at
      FROM payment_certificates
      WHERE id = $1 AND client_id = $2
      `,
      [id, active.id]
    );

    if (!head.rows.length) {
      return res.status(404).json({ message: "Certificate not found" });
    }

    const cert = head.rows[0];
    const payload = cert.payload || {};
    const lines = Array.isArray(payload.lines) ? payload.lines : [];

    res.json({
      certificate: mapCertificateRow(cert),
      lines,
    });
  } catch (err) {
    console.error("[payments] cert preview error:", err);
    res.status(500).json({ message: err.message || "Server error" });
  }
});

/**
 * GET /api/payments/po-lines?jobId=3&supplierId=sup-xxx
 * Pulls certifiable PO lines (flattened) and includes certifiedToDate + remaining.
 *
 * - POs are client-scoped (active client_id)
 * - Certified-to-date is computed from payment_certificates.payload->lines JSONB
 *   so we do NOT depend on payment_certificate_lines existing/being correct.
 */
router.get("/po-lines", async (req, res) => {
  try {
    const { jobId, supplierId } = req.query;
    if (!jobId || !supplierId) {
      return res
        .status(400)
        .json({ message: "jobId and supplierId are required" });
    }

    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    // 1) Certified-to-date totals for this client+job+supplier across ALL existing certs
    //    Extract payload.lines[] items: { poNumber, lineIndex, thisCertified }
    const certSums = await query(
      `
      SELECT
        (li->>'poNumber') AS po_number,
        (li->>'lineIndex')::int AS line_index,
        COALESCE(SUM( (li->>'thisCertified')::numeric ), 0) AS certified_to_date
      FROM payment_certificates c
      JOIN LATERAL jsonb_array_elements(COALESCE(c.payload->'lines', '[]'::jsonb)) AS li ON TRUE
      WHERE c.client_id = $1
        AND c.job_id = $2
        AND c.supplier_id = $3
      GROUP BY (li->>'poNumber'), (li->>'lineIndex')::int
      `,
      [active.id, asText(jobId), asText(supplierId)]
    );

    const certifiedMap = new Map();
    for (const r of certSums.rows) {
      certifiedMap.set(
        `${r.po_number}::${r.line_index}`,
        num(r.certified_to_date)
      );
    }

    // 2) Load POs for ACTIVE CLIENT ONLY
    const pos = await query(
      `SELECT po_number, payload FROM purchase_orders WHERE client_id = $1`,
      [active.id]
    );

    const out = [];

    for (const row of pos.rows) {
      const payload = row.payload;
      if (!payload) continue;

      const poJobId = payload?.job?.id;
      const poSupplierId = payload?.supplierId;

      if (asText(poJobId) !== asText(jobId)) continue;
      if (asText(poSupplierId) !== asText(supplierId)) continue;

      if (String(payload.status || "").toLowerCase() !== "approved") continue;
      if (payload.archived === true) continue;

      const poNumber = payload.poNumber || row.po_number;
      const items = Array.isArray(payload.items) ? payload.items : [];

      items.forEach((it, idx) => {
        const qty = num(it.qty);
        const rate = num(it.rate);
        const lineValue = num(it.amount) || qty * rate;

        const key = `${poNumber}::${idx}`;
        const certifiedToDate = num(certifiedMap.get(key) || 0);
        const remaining = Math.max(0, lineValue - certifiedToDate);

        if (remaining <= 0) return;

        out.push({
          poNumber,
          poType: payload.type,
          jobId: payload?.job?.id,
          jobCode: payload?.job?.jobCode,
          jobName: payload?.job?.name,
          supplierId: payload.supplierId,
          supplierName: payload?.supplierSnapshot?.name,
          lineIndex: idx,
          costCode: it.costCode || "",
          description: it.description || "",
          uom: it.uom || "",
          qty,
          rate,
          lineValue,
          certifiedToDate,
          remaining,
        });
      });
    }

    res.json({ count: out.length, lines: out });
  } catch (err) {
    console.error("[payments] po-lines error:", err);
    res.status(500).json({ message: err.message || "Server error" });
  }
});

/**
 * POST /api/payments/certificates
 * Creates a DRAFT certificate in payment_certificates (client-scoped) with payload JSONB.
 *
 * Body (supports your existing shape):
 * {
 *   "jobId": 3,
 *   "supplierId": "sup-...",
 *   "periodFrom": "2026-02-01",
 *   "periodTo": "2026-02-28",   // must be a real date
 *   "periodEnd": "2026-02-28",  // optional alternative to periodTo
 *   "notes": "Test certificate",
 *   "lines": [
 *     { "poNumber": "S0001", "lineIndex": 0, "thisCertified": 500 }
 *   ],
 *   "settings": { "vatRate": 0.2, "retentionRate": 0.05 },
 *   "deductions": { "contra": 0 }
 * }
 *
 * DB inserts:
 * - client_id
 * - job_id, supplier_id
 * - certificate_number, period_from, period_to
 * - status, payload (jsonb)
 */
router.post("/certificates", async (req, res) => {
  const dbClient = await pool.connect();

  try {
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const body = req.body || {};
    const jobId = body.jobId;
    const supplierId = body.supplierId;

    if (!jobId || !supplierId) {
      return res
        .status(400)
        .json({ message: "jobId and supplierId are required" });
    }
    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      return res.status(400).json({ message: "lines[] is required" });
    }

    // Resolve period end
    const periodFrom = body.periodFrom || null;
    const periodTo = body.periodTo || body.periodEnd || null;

    await dbClient.query("BEGIN");

    const nextNoRes = await dbClient.query(
      `
      SELECT COALESCE(MAX(certificate_number), 0) + 1 AS next_no
      FROM payment_certificates
      WHERE client_id = $1 AND job_id = $2 AND supplier_id = $3
      `,
      [active.id, asText(jobId), asText(supplierId)]
    );
    const certNo = Number(nextNoRes.rows[0]?.next_no || 1);

    // Build a certified-to-date map BEFORE this new cert (for previousCertified)
    const sumsRes = await dbClient.query(
      `
      SELECT
        (li->>'poNumber') AS po_number,
        (li->>'lineIndex')::int AS line_index,
        COALESCE(SUM( (li->>'thisCertified')::numeric ), 0) AS certified_to_date
      FROM payment_certificates c
      JOIN LATERAL jsonb_array_elements(COALESCE(c.payload->'lines', '[]'::jsonb)) AS li ON TRUE
      WHERE c.client_id = $1
        AND c.job_id = $2
        AND c.supplier_id = $3
      GROUP BY (li->>'poNumber'), (li->>'lineIndex')::int
      `,
      [active.id, asText(jobId), asText(supplierId)]
    );

    const prevMap = new Map();
    for (const r of sumsRes.rows) {
      prevMap.set(`${r.po_number}::${r.line_index}`, num(r.certified_to_date));
    }

    // Snapshot the required PO lines from purchase_orders (client scoped)
    const requested = body.lines.map((l) => ({
      poNumber: asText(l.poNumber),
      lineIndex: Number(l.lineIndex),
      thisCertified: num(l.thisCertified),
    }));

    const poNumbers = [...new Set(requested.map((l) => l.poNumber))];

    const poRes = await dbClient.query(
      `
      SELECT po_number, payload
      FROM purchase_orders
      WHERE client_id = $1 AND po_number = ANY($2)
      `,
      [active.id, poNumbers]
    );

    const poByNumber = new Map();
    for (const r of poRes.rows) {
      const p = r.payload;
      const key = p && p.poNumber ? asText(p.poNumber) : asText(r.po_number);
      poByNumber.set(key, p);
    }

    const snapLines = [];
    for (const l of requested) {
      const payload = poByNumber.get(l.poNumber);
      if (!payload) {
        throw new Error(
          `PO not found for poNumber=${l.poNumber} (active client scope)`
        );
      }

      const item = Array.isArray(payload.items)
        ? payload.items[l.lineIndex]
        : null;
      if (!item) {
        throw new Error(
          `Line not found for poNumber=${l.poNumber}, lineIndex=${l.lineIndex}`
        );
      }

      const qty = num(item.qty);
      const rate = num(item.rate);
      const lineValue = num(item.amount) || qty * rate;

      const previousCertified = num(
        prevMap.get(`${l.poNumber}::${l.lineIndex}`) || 0
      );

      snapLines.push({
        poNumber: l.poNumber,
        lineIndex: l.lineIndex,
        costCode: item.costCode || "",
        description: item.description || "",
        uom: item.uom || "",
        qty,
        rate,
        lineValue,
        previousCertified,
        thisCertified: l.thisCertified,
        toDate: previousCertified + l.thisCertified,
        remaining: Math.max(0, lineValue - (previousCertified + l.thisCertified)),
      });
    }

    const payload = {
      header: {
        clientCode: active.code,
        clientId: active.id,
        jobId: asText(jobId),
        supplierId: asText(supplierId),
        certNo,
        status: "Draft",
        periodFrom,
        periodTo,
        notes: body.notes || "",
      },
      settings: {
        vatRate: num(body.settings?.vatRate ?? 0.2),
        retentionRate: num(body.settings?.retentionRate ?? 0.05),
      },
      deductions: {
        contra: num(body.deductions?.contra ?? 0),
      },
      lines: snapLines,
    };

    const now = isoNow();

    const insertRes = await dbClient.query(
      `
      INSERT INTO payment_certificates
        (client_id, job_id, supplier_id, certificate_number, period_from, period_to, status, notes, payload, created_at, updated_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING
        id, client_id, job_id, supplier_id, certificate_number, period_from, period_to, status, notes, payload, created_at, updated_at
      `,
      [
        active.id,
        asText(jobId),
        asText(supplierId),
        certNo,
        periodFrom || null,
        periodTo || null,
        "Draft",
        body.notes || "",
        payload,
        now,
        now,
      ]
    );

    await dbClient.query("COMMIT");

    const cert = insertRes.rows[0];

    res.status(201).json({
      certificate: mapCertificateRow(cert),
    });
  } catch (err) {
    console.error("[payments] create certificate error:", err);
    try {
      await dbClient.query("ROLLBACK");
    } catch (_) {}
    res.status(500).json({ message: err.message || "Server error" });
  } finally {
    dbClient.release();
  }
});

module.exports = router;