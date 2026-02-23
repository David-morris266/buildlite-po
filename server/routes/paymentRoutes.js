// server/routes/paymentRoutes.js
const express = require("express");
const router = express.Router();

const { pool, query } = require("../db");
const { getActiveClient } = require("../services/activeClient");

/**
 * Utility: safe number
 */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * DEBUG: /api/payments/_debug
 * Helps confirm whether payments tables exist + what columns exist.
 */
router.get("/_debug", async (_req, res) => {
  try {
    const certs = await query(
      `SELECT to_regclass('public.payment_certificates') AS name`,
      []
    );
    const lines = await query(
      `SELECT to_regclass('public.payment_certificate_lines') AS name`,
      []
    );

    let cols = [];
    if (certs.rows[0]?.name) {
      const c = await query(
        `SELECT column_name, data_type
         FROM information_schema.columns
         WHERE table_name = 'payment_certificates'
         ORDER BY ordinal_position`,
        []
      );
      cols = c.rows;
    }

    res.json({
      ok: true,
      tables: {
        payment_certificates: certs.rows[0]?.name || null,
        payment_certificate_lines: lines.rows[0]?.name || null,
      },
      payment_certificates_columns: cols,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/migrate", async (_req, res) => {
  try {
    await query(`
      ALTER TABLE payment_certificates
      ADD COLUMN IF NOT EXISTS certificate_number INTEGER,
      ADD COLUMN IF NOT EXISTS period_from DATE,
      ADD COLUMN IF NOT EXISTS period_to DATE,
      ADD COLUMN IF NOT EXISTS notes TEXT;
    `);

    await query(`
      ALTER TABLE payment_certificates
      RENAME COLUMN cert_no TO legacy_cert_no;
    `);

    await query(`
      ALTER TABLE payment_certificates
      RENAME COLUMN period_end TO legacy_period_end;
    `);

    res.json({ ok: true, message: "Migration complete" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
/**
 * GET /api/payments/certificates
 * Optional filters: ?jobId=3&supplierId=sup-123
 */
router.get("/certificates", async (req, res) => {
  try {
    const { jobId, supplierId } = req.query;

    const where = [];
    const params = [];

    if (jobId) {
      params.push(String(jobId));
      where.push(`job_id = $${params.length}`);
    }
    if (supplierId) {
      params.push(String(supplierId));
      where.push(`supplier_id = $${params.length}`);
    }

    const sql = `
      SELECT
        id,
        job_id,
        supplier_id,
        certificate_number,
        period_from,
        period_to,
        status,
        notes,
        created_at
      FROM payment_certificates
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY created_at DESC
      LIMIT 200
    `;

    const { rows } = await query(sql, params);
    res.json({ items: rows });
  } catch (err) {
    console.error("[payments] list certs error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * GET /api/payments/certificates/:id
 * Returns header + snapshot lines.
 */
router.get("/certificates/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const head = await query(
      `
      SELECT
        id,
        job_id,
        supplier_id,
        certificate_number,
        period_from,
        period_to,
        status,
        notes,
        created_at
      FROM payment_certificates
      WHERE id = $1
      `,
      [id]
    );

    if (!head.rows.length) {
      return res.status(404).json({ message: "Certificate not found" });
    }

    const lines = await query(
      `
      SELECT
        id,
        certificate_id,
        po_number,
        line_index,
        cost_code,
        description,
        qty,
        rate,
        line_value,
        previous_certified,
        this_certified,
        created_at
      FROM payment_certificate_lines
      WHERE certificate_id = $1
      ORDER BY po_number, line_index
      `,
      [id]
    );

    res.json({ certificate: head.rows[0], lines: lines.rows });
  } catch (err) {
    console.error("[payments] cert preview error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * GET /api/payments/po-lines?jobId=3&supplierId=sup-xxx
 * Pulls "certifiable" PO lines (flattened) and includes certified-to-date + remaining.
 *
 * IMPORTANT:
 * - POs are client-scoped (active client)
 * - Cert sums are currently not client-scoped unless you add client_id to payments tables later
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

    // 1) Certified-to-date totals for this job+supplier across ALL existing certs
    const certSums = await query(
      `
      SELECT
        l.po_number,
        l.line_index,
        COALESCE(SUM(l.this_certified), 0) AS certified_to_date
      FROM payment_certificate_lines l
      JOIN payment_certificates c ON c.id = l.certificate_id
      WHERE c.job_id = $1 AND c.supplier_id = $2
      GROUP BY l.po_number, l.line_index
      `,
      [String(jobId), String(supplierId)]
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

      if (String(poJobId) !== String(jobId)) continue;
      if (String(poSupplierId) !== String(supplierId)) continue;

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

        // Hide fully certified lines
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
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * POST /api/payments/certificates
 * Creates a DRAFT certificate + snapshots selected lines.
 *
 * Body:
 * {
 *   "jobId": 3,
 *   "supplierId": "sup-...",
 *   "periodFrom": "2026-02-01",
 *   "periodTo": "2026-02-29",
 *   "notes": "",
 *   "lines": [
 *     { "poNumber": "S0001", "lineIndex": 0, "thisCertified": 500 }
 *   ]
 * }
 */
router.post("/certificates", async (req, res) => {
  const dbClient = await pool.connect();

  try {
    const { jobId, supplierId, periodFrom, periodTo, notes, lines } =
      req.body || {};

    if (!jobId || !supplierId) {
      return res
        .status(400)
        .json({ message: "jobId and supplierId are required" });
    }
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ message: "lines[] is required" });
    }

    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    await dbClient.query("BEGIN");

    // Next certificate number (per job+supplier)
    const nextNoRes = await dbClient.query(
      `
      SELECT COALESCE(MAX(certificate_number), 0) + 1 AS next_no
      FROM payment_certificates
      WHERE job_id = $1 AND supplier_id = $2
      `,
      [String(jobId), String(supplierId)]
    );
    const certificateNumber = Number(nextNoRes.rows[0]?.next_no || 1);

    // Create header
    const headRes = await dbClient.query(
      `
      INSERT INTO payment_certificates
        (job_id, supplier_id, certificate_number, period_from, period_to, status, notes)
      VALUES
        ($1, $2, $3, $4, $5, 'DRAFT', $6)
      RETURNING
        id, job_id, supplier_id, certificate_number, period_from, period_to, status, notes, created_at
      `,
      [
        String(jobId),
        String(supplierId),
        certificateNumber,
        periodFrom || null,
        periodTo || null,
        notes || null,
      ]
    );

    const certificate = headRes.rows[0];

    // Previous certified map
    const sumsRes = await dbClient.query(
      `
      SELECT
        l.po_number,
        l.line_index,
        COALESCE(SUM(l.this_certified), 0) AS certified_to_date
      FROM payment_certificate_lines l
      JOIN payment_certificates c ON c.id = l.certificate_id
      WHERE c.job_id = $1 AND c.supplier_id = $2
        AND c.id <> $3
      GROUP BY l.po_number, l.line_index
      `,
      [String(jobId), String(supplierId), certificate.id]
    );

    const prevMap = new Map();
    for (const r of sumsRes.rows) {
      prevMap.set(`${r.po_number}::${r.line_index}`, num(r.certified_to_date));
    }

    // Fetch POs needed for snapshotting (ACTIVE CLIENT ONLY)
    const poNumbers = [...new Set(lines.map((l) => String(l.poNumber)))];
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
      const key = p && p.poNumber ? String(p.poNumber) : String(r.po_number);
      poByNumber.set(key, p);
    }

    for (const l of lines) {
      const poNumber = String(l.poNumber);
      const lineIndex = Number(l.lineIndex);
      const thisCertified = num(l.thisCertified);

      const payload = poByNumber.get(poNumber);
      if (!payload) {
        throw new Error(`PO not found for poNumber=${poNumber} (active client scope)`);
      }

      const item = Array.isArray(payload.items) ? payload.items[lineIndex] : null;
      if (!item) {
        throw new Error(`Line not found for poNumber=${poNumber}, lineIndex=${lineIndex}`);
      }

      const qty = num(item.qty);
      const rate = num(item.rate);
      const lineValue = num(item.amount) || qty * rate;
      const prevCertified = num(prevMap.get(`${poNumber}::${lineIndex}`) || 0);

      await dbClient.query(
        `
        INSERT INTO payment_certificate_lines
          (certificate_id, po_number, line_index, cost_code, description, qty, rate, line_value, previous_certified, this_certified)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          certificate.id,
          poNumber,
          lineIndex,
          item.costCode || null,
          item.description || null,
          qty,
          rate,
          lineValue,
          prevCertified,
          thisCertified,
        ]
      );
    }

    await dbClient.query("COMMIT");
    res.status(201).json({ certificate });
  } catch (err) {
    console.error("[payments] create certificate error:", err);
    try {
      await dbClient.query("ROLLBACK");
    } catch (e) {
      // ignore rollback errors
    }
    res.status(500).json({ message: err.message || "Server error" });
  } finally {
    dbClient.release();
  }
});

module.exports = router;