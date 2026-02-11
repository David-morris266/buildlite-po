// server/routes/paymentRoutes.js
const express = require("express");
const router = express.Router();

const { pool } = require("../db");
const { getActiveClient } = require("../services/activeClient");

/* =========================================================
   Helpers
========================================================= */

async function getNextCertNo(clientId, jobId, supplierId) {
  const { rows } = await pool.query(
    `
    select coalesce(max(cert_no), 0) + 1 as next_no
    from payment_certificates
    where client_id = $1 and job_id = $2 and supplier_id = $3
    `,
    [clientId, jobId, supplierId]
  );
  return Number(rows[0]?.next_no || 1);
}

/* =========================================================
   GET PO lines for payment (against PO items)
   GET /api/payments/po-lines?jobId=...&supplierId=...
========================================================= */
router.get("/po-lines", async (req, res) => {
  try {
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const jobId = String(req.query.jobId || "");
    const supplierId = String(req.query.supplierId || "");
    if (!jobId || !supplierId) {
      return res.status(400).json({ error: "jobId and supplierId are required" });
    }

    const { rows } = await pool.query(
      `select po_number, payload
       from purchase_orders
       where client_id = $1`,
      [active.id]
    );

    const pos = rows
      .map((r) => ({ poNumber: r.po_number, ...r.payload }))
      .filter((po) => String(po?.costRef?.jobId || "") === jobId)
      .filter((po) => String(po?.supplierId || "") === supplierId)
      .filter((po) => ["issued", "approved"].includes(String(po?.status || "").toLowerCase()));

    const lines = [];
    for (const po of pos) {
      for (const it of po.items || []) {
        lines.push({
          poNumber: po.poNumber,
          poStatus: po.status,

          description: it.description || "",
          uom: it.uom || "nr",
          qty: Number(it.qty || 0),
          rate: Number(it.rate || 0),
          poLineValue:
            it.amount != null
              ? Number(it.amount) || 0
              : Number(it.qty || 0) * Number(it.rate || 0),

          costCode: it.costCode || po.costRef?.costCode || "",
          element: po.costRef?.element || "",

          previouslyCertified: 0,
          thisPeriod: 0,
          toDate: 0,
        });
      }
    }

    res.json({ jobId, supplierId, count: lines.length, lines });
  } catch (err) {
    console.error("GET /payments/po-lines failed:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
   List certificates
   GET /api/payments/certificates?jobId=&supplierId=&status=
========================================================= */
router.get("/certificates", async (req, res) => {
  try {
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const jobId = String(req.query.jobId || "");
    const supplierId = String(req.query.supplierId || "");
    const status = String(req.query.status || "");

    const params = [active.id];
    const where = ["client_id = $1"];
    if (jobId) {
      params.push(jobId);
      where.push(`job_id = $${params.length}`);
    }
    if (supplierId) {
      params.push(supplierId);
      where.push(`supplier_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }

    const { rows } = await pool.query(
      `
      select id, job_id, supplier_id, cert_no, period_end, status, payload, created_at, updated_at
      from payment_certificates
      where ${where.join(" and ")}
      order by job_id, supplier_id, cert_no desc
      `,
      params
    );

    res.json({ items: rows });
  } catch (err) {
    console.error("GET /payments/certificates failed:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
   Create a draft certificate
   POST /api/payments/certificates
========================================================= */
router.post("/certificates", async (req, res) => {
  try {
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const b = req.body || {};
    const jobId = String(b.jobId || "");
    const supplierId = String(b.supplierId || "");
    const periodEnd = b.periodEnd || null;

    if (!jobId || !supplierId) {
      return res.status(400).json({ error: "jobId and supplierId are required" });
    }

    const certNo = await getNextCertNo(active.id, jobId, supplierId);

    const payload = b.payload || {
      header: { jobId, supplierId, certNo, periodEnd, status: "Draft" },
      settings: {
        retentionRate: Number(b.retentionRate ?? 0.05),
        vatRate: Number(b.vatRate ?? 0.2),
      },
      deductions: { contra: Number(b.contra ?? 0) },
      lines: Array.isArray(b.lines) ? b.lines : [],
      totals: {},
    };

    const { rows } = await pool.query(
      `
      insert into payment_certificates (client_id, job_id, supplier_id, cert_no, period_end, status, payload)
      values ($1, $2, $3, $4, $5, 'Draft', $6)
      returning id, job_id, supplier_id, cert_no, period_end, status, payload, created_at, updated_at
      `,
      [active.id, jobId, supplierId, certNo, periodEnd, payload]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("POST /payments/certificates failed:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
   Update a draft certificate
   PUT /api/payments/certificates/:id
========================================================= */
router.put("/certificates/:id", async (req, res) => {
  try {
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const id = req.params.id;
    const payload = req.body?.payload;

    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ error: "payload object is required" });
    }

    const existing = await pool.query(
      "select status from payment_certificates where id = $1 and client_id = $2",
      [id, active.id]
    );
    if (!existing.rows[0]) return res.status(404).json({ error: "Not found" });
    if (String(existing.rows[0].status).toLowerCase() !== "draft") {
      return res.status(400).json({ error: "Only Draft certificates can be edited" });
    }

    const { rows } = await pool.query(
      `
      update payment_certificates
      set payload = $1,
          updated_at = now()
      where id = $2 and client_id = $3
      returning id, job_id, supplier_id, cert_no, period_end, status, payload, created_at, updated_at
      `,
      [payload, id, active.id]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error("PUT /payments/certificates/:id failed:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
   Issue certificate
   POST /api/payments/certificates/:id/issue
========================================================= */
router.post("/certificates/:id/issue", async (req, res) => {
  try {
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const id = req.params.id;

    const { rows } = await pool.query(
      `
      update payment_certificates
      set status = 'Issued',
          updated_at = now()
      where id = $1 and client_id = $2
      returning id, job_id, supplier_id, cert_no, period_end, status, payload, created_at, updated_at
      `,
      [id, active.id]
    );

    if (!rows[0]) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("POST /payments/certificates/:id/issue failed:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
