const { pool, query } = require("../db");
const { rowToVariationOrder } = require("./variationOrderMapper");
const { allocateNextVariationOrderNumber } = require("./variationOrderNumbering");
const {
  VARIATION_ORDER_STATUSES,
  VARIATION_ORDER_TRANSITIONS,
  VAT_TREATMENTS,
  RETENTION_TREATMENTS,
} = require("./variationOrderConstants");
const { CERTIFIABLE_EVENT_TYPES } = require("./paymentCertificateConstants");

function actorFrom(body = {}) {
  return body.actor || body.updatedBy || body.createdBy || null;
}

function fail(status, message) {
  return { ok: false, status, message };
}

function validateCreate(body = {}) {
  const errors = [];
  if (!String(body.developmentId || "").trim()) errors.push("developmentId is required.");
  if (!String(body.packageId || "").trim()) errors.push("packageId is required.");
  if (!String(body.sourcePoNumber || "").trim()) errors.push("sourcePoNumber is required.");
  if (!String(body.description || "").trim()) errors.push("description is required.");
  if (!Array.isArray(body.lines) || body.lines.length === 0) errors.push("At least one line is required.");
  if (!(body.sourceCommercialEvents || []).length && !body.supersedesId && !body.reversesId) {
    errors.push("At least one approved source Commercial Event is required.");
  }
  if (body.supersedesId && body.reversesId) errors.push("A Variation Order cannot both supersede and reverse another Variation Order.");
  if (!VAT_TREATMENTS.has(body.vatTreatment || "inherit")) errors.push("vatTreatment is invalid.");
  if (!RETENTION_TREATMENTS.has(body.retentionTreatment || "inherit")) errors.push("retentionTreatment is invalid.");
  for (const [index, line] of (body.lines || []).entries()) {
    if (!String(line.costCode || "").trim()) errors.push(`lines[${index}].costCode is required.`);
    if (!String(line.description || "").trim()) errors.push(`lines[${index}].description is required.`);
    if (!Number.isFinite(Number(line.netValue))) errors.push(`lines[${index}].netValue must be finite.`);
    if (!VAT_TREATMENTS.has(line.vatTreatment || "inherit")) errors.push(`lines[${index}].vatTreatment is invalid.`);
    if (!RETENTION_TREATMENTS.has(line.retentionTreatment || "inherit")) errors.push(`lines[${index}].retentionTreatment is invalid.`);
  }
  for (const [index, source] of (body.sourceCommercialEvents || []).entries()) {
    if (!String(source.commercialEventId || source.id || "").trim()) {
      errors.push(`sourceCommercialEvents[${index}].commercialEventId is required.`);
    }
    if (source.allocatedValue != null && !Number.isFinite(Number(source.allocatedValue))) {
      errors.push(`sourceCommercialEvents[${index}].allocatedValue must be finite.`);
    }
  }
  return errors;
}

async function loadVariationOrder(clientId, id, db = null) {
  const run = db || { query };
  const header = await run.query(
    `SELECT vo.*, p.supplier_label, p.development_name, p.cost_code AS package_cost_code
     FROM variation_orders vo JOIN packages p ON p.id=vo.package_id AND p.client_id=vo.client_id
     WHERE vo.client_id=$1 AND vo.id=$2`, [clientId, id]
  );
  if (!header.rows[0]) return null;
  const [lines, sources, audit] = await Promise.all([
    run.query("SELECT * FROM variation_order_lines WHERE client_id = $1 AND variation_order_id = $2 ORDER BY line_number", [clientId, id]),
    run.query(`SELECT l.*, ce.event_number, ce.description, ce.value, ce.status, ce.cost_code
               FROM variation_order_commercial_events l
               JOIN commercial_events ce ON ce.id = l.commercial_event_id
               WHERE l.client_id = $1 AND l.variation_order_id = $2
               ORDER BY ce.event_number`, [clientId, id]),
    run.query("SELECT * FROM variation_order_audit WHERE client_id = $1 AND variation_order_id = $2 ORDER BY created_at, id", [clientId, id]),
  ]);
  return rowToVariationOrder(header.rows[0], lines.rows, sources.rows, audit.rows);
}

async function getVariationOrder(clientId, id) {
  return loadVariationOrder(clientId, id);
}

async function listVariationOrders(clientId, { packageId } = {}) {
  const params = [clientId];
  let packageClause = "";
  if (packageId) {
    params.push(packageId);
    packageClause = "AND package_id = $2";
  }
  const { rows } = await query(`SELECT id FROM variation_orders WHERE client_id = $1 ${packageClause} ORDER BY created_at, id`, params);
  return Promise.all(rows.map((row) => loadVariationOrder(clientId, row.id)));
}

async function validateCorrectiveRelationship(db, clientId, packageId, id, label) {
  if (!id) return null;
  const { rows } = await db.query(
    "SELECT id, package_id, status FROM variation_orders WHERE client_id = $1 AND id = $2",
    [clientId, id]
  );
  if (!rows[0] || rows[0].package_id !== packageId) {
    throw Object.assign(new Error(`${label} Variation Order must belong to the same tenant and package.`), { httpStatus: 400 });
  }
  if (rows[0].status !== VARIATION_ORDER_STATUSES.issued) {
    throw Object.assign(new Error(`${label} Variation Order must already be issued.`), { httpStatus: 409 });
  }
  return rows[0];
}

async function createDraftVariationOrder(clientId, body = {}, { actor = actorFrom(body) } = {}) {
  const errors = validateCreate(body);
  if (errors.length) return fail(400, errors.join(" "));
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const packageResult = await db.query(
      `SELECT p.* FROM packages p JOIN developments d ON d.id = p.development_id AND d.client_id = p.client_id
       WHERE p.client_id = $1 AND p.id = $2 AND p.development_id = $3 FOR UPDATE`,
      [clientId, body.packageId, body.developmentId]
    );
    const pkg = packageResult.rows[0];
    if (!pkg) throw Object.assign(new Error("Package/development not found for active tenant."), { httpStatus: 400 });
    if (body.supplierId && body.supplierId !== pkg.supplier_id) {
      throw Object.assign(new Error("supplierId does not match the source package."), { httpStatus: 400 });
    }
    const po = await db.query(
      "SELECT 1 FROM package_purchase_orders WHERE client_id = $1 AND package_id = $2 AND po_number = $3",
      [clientId, pkg.id, body.sourcePoNumber]
    );
    if (!po.rows[0]) throw Object.assign(new Error("sourcePoNumber is not linked to the source package."), { httpStatus: 400 });

    await validateCorrectiveRelationship(db, clientId, pkg.id, body.supersedesId, "Superseded");
    await validateCorrectiveRelationship(db, clientId, pkg.id, body.reversesId, "Reversed");

    const sourceIds = [...new Set((body.sourceCommercialEvents || []).map((item) => String(item.commercialEventId || item.id || "").trim()).filter(Boolean))];
    let sourceRows = [];
    if (sourceIds.length) {
      const result = await db.query(
        `SELECT id, package_id, development_id, status, event_type, financial_treatment, relationship_type FROM commercial_events
         WHERE client_id = $1 AND id = ANY($2::text[]) FOR SHARE`,
        [clientId, sourceIds]
      );
      sourceRows = result.rows;
      if (sourceRows.length !== sourceIds.length || sourceRows.some((row) => row.package_id !== pkg.id || row.development_id !== pkg.development_id)) {
        throw Object.assign(new Error("Every source Commercial Event must belong to the same tenant, development and package."), { httpStatus: 400 });
      }
      if (sourceRows.some((row) => !["approved", "includedInCertificate", "closed"].includes(row.status))) {
        throw Object.assign(new Error("Source Commercial Events must be approved commercial facts."), { httpStatus: 409 });
      }
      if (sourceRows.some((row) => row.event_type === "budgetTransfer" || row.relationship_type === "recovery" || row.financial_treatment === "recoverableDeduction")) {
        throw Object.assign(new Error("Recovery and budget-transfer Commercial Events cannot source a Variation Order."), { httpStatus: 409 });
      }
    }

    const number = await allocateNextVariationOrderNumber(db, clientId, pkg.id);
    const inserted = await db.query(
      `INSERT INTO variation_orders
       (client_id, development_id, package_id, order_key, source_po_number, supplier_id, normal_source_commercial_event_id,
        variation_order_number, reference, description, vat_treatment, retention_treatment,
        terms_override, supersedes_id, reverses_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16) RETURNING *`,
      [clientId, pkg.development_id, pkg.id, pkg.order_key, body.sourcePoNumber, pkg.supplier_id,
        body.normalSourceCommercialEventId || null, number, String(body.reference || ""), String(body.description).trim(), body.vatTreatment || "inherit",
        body.retentionTreatment || "inherit", body.termsOverride || {}, body.supersedesId || null,
        body.reversesId || null, actor]
    );
    const vo = inserted.rows[0];
    for (const [index, line] of body.lines.entries()) {
      await db.query(
        `INSERT INTO variation_order_lines
         (client_id, variation_order_id, line_number, cost_code, description, net_value, vat_treatment, retention_treatment)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [clientId, vo.id, index + 1, String(line.costCode).trim(), String(line.description).trim(), Number(line.netValue),
          line.vatTreatment || "inherit", line.retentionTreatment || "inherit"]
      );
    }
    for (const source of body.sourceCommercialEvents || []) {
      const sourceId = String(source.commercialEventId || source.id || "").trim();
      await db.query(
        `INSERT INTO variation_order_commercial_events (client_id, variation_order_id, commercial_event_id, allocated_value)
         VALUES ($1,$2,$3,$4) ON CONFLICT (variation_order_id, commercial_event_id) DO NOTHING`,
        [clientId, vo.id, sourceId, source.allocatedValue == null ? null : Number(source.allocatedValue)]
      );
    }
    await db.query(
      `INSERT INTO variation_order_audit
       (client_id, variation_order_id, action, actor, new_status, new_version)
       VALUES ($1,$2,'created',$3,'draft',1)`, [clientId, vo.id, actor]
    );
    await db.query("COMMIT");
    return { ok: true, status: 201, variationOrder: await loadVariationOrder(clientId, vo.id) };
  } catch (error) {
    await db.query("ROLLBACK");
    return fail(error.code === "23505" ? 409 : (error.httpStatus || 500), error.code === "23505" ? "A live Variation Order already exists for this Commercial Event." : (error.httpStatus ? error.message : "Failed to create Variation Order."));
  } finally {
    db.release();
  }
}

async function createDraftVariationOrderFromCommercialEvent(clientId, commercialEventId, body = {}, { actor = actorFrom(body) } = {}) {
  const { rows } = await query(
    `SELECT ce.*, p.supplier_id AS package_supplier_id, p.order_key AS package_order_key
     FROM commercial_events ce
     JOIN packages p ON p.id=ce.package_id AND p.client_id=ce.client_id AND p.development_id=ce.development_id
     WHERE ce.client_id=$1 AND ce.id=$2`,
    [clientId, commercialEventId]
  );
  const ce = rows[0];
  if (!ce) return fail(404, "Commercial Event not found.");
  if (ce.status !== "approved" || !CERTIFIABLE_EVENT_TYPES.has(ce.event_type) || ce.event_type === "budgetTransfer" || ce.relationship_type === "recovery" || ce.financial_treatment === "recoverableDeduction") {
    return fail(409, "Only an eligible approved contract-value Commercial Event can create a Variation Order.");
  }
  const duplicate = await query(
    `SELECT vo.id FROM variation_order_commercial_events link
     JOIN variation_orders vo ON vo.id=link.variation_order_id AND vo.client_id=link.client_id
     WHERE link.client_id=$1 AND link.commercial_event_id=$2 AND vo.status <> 'rejected'
     ORDER BY vo.created_at LIMIT 1`,
    [clientId, commercialEventId]
  );
  if (duplicate.rows[0]) {
    return { ok: false, status: 409, message: "A live Variation Order already exists for this Commercial Event.", existingVariationOrder: await loadVariationOrder(clientId, duplicate.rows[0].id) };
  }
  const po = await query(
    `SELECT po_number FROM package_purchase_orders
     WHERE client_id=$1 AND package_id=$2 ORDER BY po_number LIMIT 1`,
    [clientId, ce.package_id]
  );
  if (!po.rows[0]) return fail(409, "The Commercial Event package has no source Purchase Order.");
  const created = await createDraftVariationOrder(clientId, {
    developmentId: ce.development_id,
    packageId: ce.package_id,
    sourcePoNumber: po.rows[0].po_number,
    supplierId: ce.package_supplier_id,
    reference: String(body.reference || ce.event_number || ""),
    description: String(body.description || ce.description || ""),
    lines: [{
      costCode: ce.cost_code,
      description: String(body.description || ce.description || ""),
      netValue: body.netValue == null ? Number(ce.value) : Number(body.netValue),
    }],
    sourceCommercialEvents: [{ commercialEventId: ce.id, allocatedValue: Number(ce.value) }],
    normalSourceCommercialEventId: ce.id,
    actor,
  }, { actor });
  if (!created.ok && created.status === 409) {
    const existing = await query(
      "SELECT id FROM variation_orders WHERE client_id=$1 AND normal_source_commercial_event_id=$2 AND status <> 'rejected' LIMIT 1",
      [clientId, ce.id]
    );
    if (existing.rows[0]) return { ...created, existingVariationOrder: await loadVariationOrder(clientId, existing.rows[0].id) };
  }
  return created;
}

async function updateDraftVariationOrder(clientId, id, body = {}, { actor = actorFrom(body) } = {}) {
  const version = Number(body.version);
  if (!Number.isInteger(version) || version < 1) return fail(400, "version is required.");
  const errors = validateCreate({
    developmentId: body.developmentId || "preserved",
    packageId: body.packageId || "preserved",
    sourcePoNumber: body.sourcePoNumber || "preserved",
    description: body.description,
    lines: body.lines,
    sourceCommercialEvents: [{ commercialEventId: "preserved" }],
    vatTreatment: body.vatTreatment,
    retentionTreatment: body.retentionTreatment,
  });
  if (errors.length) return fail(400, errors.join(" "));
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const current = await db.query("SELECT * FROM variation_orders WHERE client_id=$1 AND id=$2 FOR UPDATE", [clientId, id]);
    const row = current.rows[0];
    if (!row) throw Object.assign(new Error("Variation Order not found."), { httpStatus: 404 });
    if (row.version !== version) throw Object.assign(new Error("Variation Order has changed. Reload and try again."), { httpStatus: 409 });
    if (row.status !== VARIATION_ORDER_STATUSES.draft) throw Object.assign(new Error("Only Draft Variation Orders can be edited."), { httpStatus: 409 });
    const updated = await db.query(
      `UPDATE variation_orders SET reference=$3, description=$4, vat_treatment=$5,
       retention_treatment=$6, terms_override=$7, version=version+1, updated_at=NOW(), updated_by=$8
       WHERE client_id=$1 AND id=$2 RETURNING *`,
      [clientId, id, String(body.reference || ""), String(body.description).trim(), body.vatTreatment || "inherit", body.retentionTreatment || "inherit", body.termsOverride || {}, actor]
    );
    await db.query("DELETE FROM variation_order_lines WHERE client_id=$1 AND variation_order_id=$2", [clientId, id]);
    for (const [index, line] of body.lines.entries()) {
      await db.query(
        `INSERT INTO variation_order_lines(client_id,variation_order_id,line_number,cost_code,description,net_value,vat_treatment,retention_treatment)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [clientId, id, index + 1, String(line.costCode).trim(), String(line.description).trim(), Number(line.netValue), line.vatTreatment || "inherit", line.retentionTreatment || "inherit"]
      );
    }
    await db.query(
      `INSERT INTO variation_order_audit(client_id,variation_order_id,action,actor,comment,prior_status,new_status,prior_version,new_version)
       VALUES($1,$2,'edited',$3,$4,'draft','draft',$5,$6)`,
      [clientId, id, actor, String(body.comment || ""), row.version, updated.rows[0].version]
    );
    await db.query("COMMIT");
    return { ok: true, status: 200, variationOrder: await loadVariationOrder(clientId, id) };
  } catch (error) {
    await db.query("ROLLBACK");
    return fail(error.httpStatus || 500, error.httpStatus ? error.message : "Failed to update Variation Order.");
  } finally { db.release(); }
}

async function validateVariationOrderForSubmit(db, clientId, row) {
  const lines = await db.query("SELECT * FROM variation_order_lines WHERE client_id=$1 AND variation_order_id=$2", [clientId, row.id]);
  if (!String(row.description || "").trim() || !lines.rows.length || lines.rows.some((line) => !String(line.cost_code || "").trim() || !String(line.description || "").trim() || !Number.isFinite(Number(line.net_value)))) {
    throw Object.assign(new Error("Variation Order requires a description and at least one valid signed cost-code line."), { httpStatus: 400 });
  }
  const costCodes = [...new Set(lines.rows.map((line) => String(line.cost_code).trim().toLowerCase()))];
  const validCodes = await db.query(
    `SELECT lower(btrim(code)) AS code FROM cost_codes
     WHERE client_id=$1 AND is_active=true AND lower(btrim(code))=ANY($2::text[])`,
    [clientId, costCodes]
  );
  if (validCodes.rows.length !== costCodes.length) {
    throw Object.assign(new Error("Every Variation Order line must use an active tenant Cost Code Master code."), { httpStatus: 400 });
  }
  const relation = await db.query(
    `SELECT ce.id FROM variation_order_commercial_events link
     JOIN commercial_events ce ON ce.id=link.commercial_event_id AND ce.client_id=link.client_id
     JOIN package_purchase_orders po ON po.client_id=link.client_id AND po.package_id=$3 AND po.po_number=$4
     WHERE link.client_id=$1 AND link.variation_order_id=$2 AND ce.package_id=$3 AND ce.development_id=$5 AND ce.status='approved'`,
    [clientId, row.id, row.package_id, row.source_po_number, row.development_id]
  );
  if (!relation.rows.length) throw Object.assign(new Error("Variation Order source CE/PO/package relationship is no longer valid."), { httpStatus: 409 });
}

async function transitionVariationOrder(clientId, id, action, body = {}, { actor = actorFrom(body) } = {}) {
  const transition = VARIATION_ORDER_TRANSITIONS[action];
  if (!transition) return fail(400, "Unknown Variation Order action.");
  const version = Number(body.version);
  if (!Number.isInteger(version) || version < 1) return fail(400, "version is required.");
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const current = await db.query("SELECT * FROM variation_orders WHERE client_id = $1 AND id = $2 FOR UPDATE", [clientId, id]);
    const row = current.rows[0];
    if (!row) throw Object.assign(new Error("Variation Order not found."), { httpStatus: 404 });
    if (row.version !== version) throw Object.assign(new Error("Variation Order has changed. Reload and try again."), { httpStatus: 409 });
    if (row.status === VARIATION_ORDER_STATUSES.issued) throw Object.assign(new Error("Issued Variation Orders are immutable."), { httpStatus: 409 });
    if (row.status !== transition.from) throw Object.assign(new Error(`Only ${transition.from} Variation Orders can be ${action}d.`), { httpStatus: 409 });
    if (action === "submit") await validateVariationOrderForSubmit(db, clientId, row);
    if ((action === "reject" || action === "issue") && !String(body.comment || "").trim()) {
      throw Object.assign(new Error(`${action === "reject" ? "Rejection" : "Issue"} comment is required.`), { httpStatus: 400 });
    }
    const approved = action === "approve";
    const issued = action === "issue";
    const updated = await db.query(
      `UPDATE variation_orders SET status=$3, version=version+1, updated_at=NOW(), updated_by=$4,
       approved_at=CASE WHEN $5 THEN NOW() ELSE approved_at END,
       approved_by=CASE WHEN $5 THEN $4 ELSE approved_by END,
       issued_at=CASE WHEN $6 THEN NOW() ELSE issued_at END,
       issued_by=CASE WHEN $6 THEN $4 ELSE issued_by END
       WHERE client_id=$1 AND id=$2 RETURNING *`,
      [clientId, id, transition.to, actor, approved, issued]
    );
    await db.query(
      `INSERT INTO variation_order_audit
       (client_id, variation_order_id, action, actor, comment, prior_status, new_status, prior_version, new_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [clientId, id, action, actor, String(body.comment || ""), row.status, transition.to, row.version, updated.rows[0].version]
    );
    await db.query("COMMIT");
    return { ok: true, status: 200, variationOrder: await loadVariationOrder(clientId, id) };
  } catch (error) {
    await db.query("ROLLBACK");
    return fail(error.httpStatus || 500, error.httpStatus ? error.message : "Failed to transition Variation Order.");
  } finally {
    db.release();
  }
}

async function approveAndIssueVariationOrder(clientId, id, body = {}, { actor = actorFrom(body) } = {}) {
  const version = Number(body.version);
  if (!Number.isInteger(version) || version < 1) return fail(400, "version is required.");
  const comment = String(body.comment || "").trim();
  if (!comment) return fail(400, "Issue comment is required.");
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const current = await db.query("SELECT * FROM variation_orders WHERE client_id=$1 AND id=$2 FOR UPDATE", [clientId, id]);
    const row = current.rows[0];
    if (!row) throw Object.assign(new Error("Variation Order not found."), { httpStatus: 404 });
    if (row.version !== version) throw Object.assign(new Error("Variation Order has changed. Reload and try again."), { httpStatus: 409 });
    if (row.status !== VARIATION_ORDER_STATUSES.submitted) throw Object.assign(new Error("Only Submitted Variation Orders can be approved and issued."), { httpStatus: 409 });
    await validateVariationOrderForSubmit(db, clientId, row);
    const approved = await db.query(
      `UPDATE variation_orders SET status='approved',approved_at=NOW(),approved_by=$3,
       version=version+1,updated_at=NOW(),updated_by=$3 WHERE client_id=$1 AND id=$2 RETURNING *`,
      [clientId, id, actor]
    );
    await db.query(
      `INSERT INTO variation_order_audit(client_id,variation_order_id,action,actor,comment,prior_status,new_status,prior_version,new_version,created_at)
       VALUES($1,$2,'approve',$3,$4,'submitted','approved',$5,$6,clock_timestamp())`,
      [clientId, id, actor, comment, row.version, approved.rows[0].version]
    );
    const issued = await db.query(
      `UPDATE variation_orders SET status='issued',issued_at=NOW(),issued_by=$3,
       version=version+1,updated_at=NOW(),updated_by=$3 WHERE client_id=$1 AND id=$2 RETURNING *`,
      [clientId, id, actor]
    );
    await db.query(
      `INSERT INTO variation_order_audit(client_id,variation_order_id,action,actor,comment,prior_status,new_status,prior_version,new_version,created_at)
       VALUES($1,$2,'issue',$3,$4,'approved','issued',$5,$6,clock_timestamp())`,
      [clientId, id, actor, comment, approved.rows[0].version, issued.rows[0].version]
    );
    await db.query("COMMIT");
    return { ok: true, status: 200, variationOrder: await loadVariationOrder(clientId, id) };
  } catch (error) {
    await db.query("ROLLBACK");
    return fail(error.httpStatus || 500, error.httpStatus ? error.message : "Failed to approve and issue Variation Order.");
  } finally { db.release(); }
}

module.exports = {
  actorFrom,
  getVariationOrder,
  listVariationOrders,
  createDraftVariationOrder,
  createDraftVariationOrderFromCommercialEvent,
  updateDraftVariationOrder,
  transitionVariationOrder,
  approveAndIssueVariationOrder,
};
