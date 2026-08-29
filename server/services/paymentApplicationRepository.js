const { pool, query } = require("../db");
const { isValidPackageUuid, isValidCertificateUuid } = require("./paymentCertificateConstants");
const { APPLICATION_BASES, moneyOrNull } = require("./paymentApplicationNormalization");
const { rowToApplication } = require("./paymentApplicationMapper");

const VALID_BASES = new Set(Object.values(APPLICATION_BASES));
const MONEY_COLUMNS = [
  ["cumulativeGrossClaimed", "cumulative_gross_claimed"],
  ["currentPeriodGrossClaimed", "current_period_gross_claimed"],
  ["previousApplicationStated", "previous_application_stated"],
  ["previousCertifiedStated", "previous_certified_stated"],
  ["retentionStated", "retention_stated"],
  ["contraDeductionsStated", "contra_deductions_stated"],
  ["vatStated", "vat_stated"],
  ["netRequestedStated", "net_requested_stated"],
];

function fail(status, message) { return { ok: false, status, message }; }
function actorOf(body) { return body?.actor || body?.recordedBy || body?.updatedBy || null; }
function text(value) { return value == null ? null : String(value).trim() || null; }

async function loadPackage(clientId, packageId, db = null) {
  const runner = db || { query };
  const { rows } = await runner.query("SELECT * FROM packages WHERE client_id=$1 AND id=$2", [clientId, packageId]);
  return rows[0] || null;
}

async function loadCertificate(clientId, packageId, certificateId, db = null, lock = false) {
  const runner = db || { query };
  const { rows } = await runner.query(
    `SELECT * FROM package_payment_certificates WHERE client_id=$1 AND package_id=$2 AND id=$3 ${lock ? "FOR UPDATE" : ""}`,
    [clientId, packageId, certificateId]
  );
  return rows[0] || null;
}

async function audit(clientId, applicationId, db = null) {
  const runner = db || { query };
  const { rows } = await runner.query(
    "SELECT * FROM subcontract_payment_application_audit WHERE client_id=$1 AND application_id=$2 ORDER BY created_at,id",
    [clientId, applicationId]
  );
  return rows;
}

function assessmentFromCertificate(row) {
  if (!row) return null;
  if (row.status === "locked") return { grossWorksThisCertificate: row.gross_value == null ? null : Number(row.gross_value) };
  const totals = row.payload?.submissionApplicationSnapshot?.comparison?.assessmentCurrentGross;
  return { grossWorksThisCertificate: totals ?? null };
}

async function mapRow(clientId, row, certificate = null, db = null) {
  return rowToApplication(row, await audit(clientId, row.id, db), assessmentFromCertificate(certificate));
}

function validate(body) {
  const reference = text(body.applicationReference);
  const receivedAt = text(body.receivedAt);
  const basis = text(body.applicationBasis);
  if (!reference) return fail(400, "Application reference is required.");
  if (!receivedAt || Number.isNaN(Date.parse(receivedAt))) return fail(400, "A valid received date is required.");
  if (!VALID_BASES.has(basis)) return fail(400, "A supported application basis is required.");
  const money = {};
  for (const [api, column] of MONEY_COLUMNS) {
    const supplied = body[api] !== undefined && body[api] !== null && body[api] !== "";
    const parsed = moneyOrNull(body[api]);
    if (supplied && parsed === null) return fail(400, `${api} must be a valid monetary amount.`);
    money[column] = parsed;
  }
  return { ok: true, reference, receivedAt, basis, money };
}

async function listApplications(clientId, packageId, certificateId = null) {
  if (!isValidPackageUuid(packageId)) return fail(400, "packageId must be a valid UUID.");
  const pkg = await loadPackage(clientId, packageId);
  if (!pkg) return fail(404, "Package not found.");
  if (certificateId && !isValidCertificateUuid(certificateId)) return fail(400, "certificateId must be a valid UUID.");
  const cert = certificateId ? await loadCertificate(clientId, packageId, certificateId) : null;
  if (certificateId && !cert) return fail(404, "Certificate not found.");
  const params = [clientId, packageId];
  let filter = "";
  if (certificateId) { params.push(certificateId); filter = " AND certificate_id=$3"; }
  const { rows } = await query(
    `SELECT * FROM subcontract_payment_applications WHERE client_id=$1 AND package_id=$2${filter} ORDER BY received_at DESC,revision_number DESC`, params
  );
  return { ok: true, applications: await Promise.all(rows.map((row) => mapRow(clientId, row, cert))) };
}

async function createApplication(clientId, packageId, body = {}) {
  if (!isValidPackageUuid(packageId)) return fail(400, "packageId must be a valid UUID.");
  const valid = validate(body); if (!valid.ok) return valid;
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const pkg = await loadPackage(clientId, packageId, db);
    if (!pkg) { await db.query("ROLLBACK"); return fail(404, "Package not found."); }
    const certificateId = text(body.certificateId);
    let certificate = null;
    if (certificateId) {
      if (!isValidCertificateUuid(certificateId)) { await db.query("ROLLBACK"); return fail(400, "certificateId must be a valid UUID."); }
      certificate = await loadCertificate(clientId, packageId, certificateId, db, true);
      if (!certificate) { await db.query("ROLLBACK"); return fail(404, "Certificate not found."); }
      if (certificate.status !== "draft") { await db.query("ROLLBACK"); return fail(409, "Applications can only be linked to a Draft certificate."); }
    }
    const m = valid.money;
    const { rows } = await db.query(`INSERT INTO subcontract_payment_applications (
      client_id,development_id,package_id,certificate_id,application_reference,received_at,valuation_date,application_basis,
      cumulative_gross_claimed,current_period_gross_claimed,previous_application_stated,previous_certified_stated,
      retention_stated,contra_deductions_stated,vat_stated,net_requested_stated,notes,attachment_metadata,recorded_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`, [
      clientId,pkg.development_id,packageId,certificateId,valid.reference,valid.receivedAt,text(body.valuationDate),valid.basis,
      m.cumulative_gross_claimed,m.current_period_gross_claimed,m.previous_application_stated,m.previous_certified_stated,
      m.retention_stated,m.contra_deductions_stated,m.vat_stated,m.net_requested_stated,text(body.notes),body.attachmentMetadata || null,actorOf(body)
    ]);
    await db.query("INSERT INTO subcontract_payment_application_audit(client_id,application_id,action,actor) VALUES($1,$2,'recorded',$3)",[clientId,rows[0].id,actorOf(body)]);
    await db.query("COMMIT");
    return { ok: true, status: 201, application: await mapRow(clientId, rows[0], certificate) };
  } catch (error) {
    await db.query("ROLLBACK");
    if (error.code === "23505") return fail(409, "An active application already exists for this certificate or revision.");
    throw error;
  } finally { db.release(); }
}

async function reviseApplication(clientId, packageId, applicationId, body = {}) {
  if (!isValidPackageUuid(packageId)) return fail(400, "packageId must be a valid UUID.");
  const valid = validate(body); if (!valid.ok) return valid;
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const { rows } = await db.query("SELECT * FROM subcontract_payment_applications WHERE client_id=$1 AND package_id=$2 AND id=$3 FOR UPDATE",[clientId,packageId,applicationId]);
    const prior = rows[0];
    if (!prior) { await db.query("ROLLBACK"); return fail(404,"Application not found."); }
    if (prior.status !== "recorded") { await db.query("ROLLBACK"); return fail(409,"Only the active recorded application can be revised."); }
    const cert = prior.certificate_id ? await loadCertificate(clientId,packageId,prior.certificate_id,db,true) : null;
    if (cert && cert.status !== "draft") { await db.query("ROLLBACK"); return fail(409,"A submitted or locked certificate application is immutable."); }
    await db.query("UPDATE subcontract_payment_applications SET status='superseded',version=version+1 WHERE id=$1",[prior.id]);
    const m=valid.money;
    const inserted=await db.query(`INSERT INTO subcontract_payment_applications(client_id,development_id,package_id,certificate_id,application_reference,received_at,valuation_date,application_basis,cumulative_gross_claimed,current_period_gross_claimed,previous_application_stated,previous_certified_stated,retention_stated,contra_deductions_stated,vat_stated,net_requested_stated,notes,attachment_metadata,revision_number,supersedes_id,recorded_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,[
      clientId,prior.development_id,packageId,prior.certificate_id,valid.reference,valid.receivedAt,text(body.valuationDate),valid.basis,m.cumulative_gross_claimed,m.current_period_gross_claimed,m.previous_application_stated,m.previous_certified_stated,m.retention_stated,m.contra_deductions_stated,m.vat_stated,m.net_requested_stated,text(body.notes),body.attachmentMetadata||null,Number(prior.revision_number)+1,prior.id,actorOf(body)
    ]);
    await db.query("INSERT INTO subcontract_payment_application_audit(client_id,application_id,action,actor,comment) VALUES($1,$2,'superseded',$3,$4),($1,$5,'recorded_revision',$3,$4)",[clientId,prior.id,actorOf(body),text(body.comment)||"",inserted.rows[0].id]);
    await db.query("COMMIT");
    return { ok:true,status:201,application:await mapRow(clientId,inserted.rows[0],cert) };
  } catch(error){ await db.query("ROLLBACK"); throw error; } finally { db.release(); }
}

async function loadActiveApplicationForCertificate(clientId, packageId, certificateId, db = null) {
  const runner=db||{query};
  const {rows}=await runner.query("SELECT * FROM subcontract_payment_applications WHERE client_id=$1 AND package_id=$2 AND certificate_id=$3 AND status='recorded' LIMIT 1",[clientId,packageId,certificateId]);
  return rows[0]||null;
}

async function linkApplication(clientId, packageId, applicationId, body = {}) {
  if (!isValidPackageUuid(packageId)) return fail(400, "packageId must be a valid UUID.");
  const certificateId = text(body.certificateId);
  if (!isValidCertificateUuid(certificateId)) return fail(400, "certificateId must be a valid UUID.");
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const { rows } = await db.query("SELECT * FROM subcontract_payment_applications WHERE client_id=$1 AND package_id=$2 AND id=$3 FOR UPDATE", [clientId, packageId, applicationId]);
    const application = rows[0];
    if (!application) { await db.query("ROLLBACK"); return fail(404, "Application not found."); }
    if (application.status !== "recorded") { await db.query("ROLLBACK"); return fail(409, "Only an active recorded application can be linked."); }
    if (application.certificate_id && application.certificate_id !== certificateId) { await db.query("ROLLBACK"); return fail(409, "Application is already linked to another certificate."); }
    const certificate = await loadCertificate(clientId, packageId, certificateId, db, true);
    if (!certificate) { await db.query("ROLLBACK"); return fail(404, "Certificate not found."); }
    if (certificate.status !== "draft") { await db.query("ROLLBACK"); return fail(409, "Applications can only be linked to a Draft certificate."); }
    const updated = await db.query("UPDATE subcontract_payment_applications SET certificate_id=$1,version=version+1 WHERE id=$2 RETURNING *", [certificateId, applicationId]);
    await db.query("INSERT INTO subcontract_payment_application_audit(client_id,application_id,action,actor) VALUES($1,$2,'linked_to_certificate',$3)", [clientId, applicationId, actorOf(body)]);
    await db.query("COMMIT");
    return { ok: true, application: await mapRow(clientId, updated.rows[0], certificate) };
  } catch (error) {
    await db.query("ROLLBACK");
    if (error.code === "23505") return fail(409, "This certificate already has an active application.");
    throw error;
  } finally { db.release(); }
}

module.exports={ listApplications,createApplication,reviseApplication,linkApplication,loadActiveApplicationForCertificate,mapRow };
