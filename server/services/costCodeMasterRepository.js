/**
 * BL-033D.x.2A.1 — Tenant Cost Code Master Postgres access.
 * GET never writes. No DELETE. Code is immutable after insert.
 */

const { pool, query } = require("../db");
const { costCodeRowToDocument } = require("./costCodeMasterMapper");
const {
  validateActiveCostCodeBody,
  validateCreateCostCodeBody,
  validateUpdateCostCodeBody,
} = require("./costCodeMasterValidation");
const { validateHierarchyUpdates } = require("./costCodeCommercialHierarchy");
const { assertServicePermission } = require('../auth/authorization');
const { PERMISSIONS } = require('../auth/permissions');

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

function provisionalActor(body = {}) {
  return body.updatedBy || body.createdBy || body.actor || null;
}

function actorFromAuth(auth) { return auth?.displayName || null; }
const onboardingSelect = `,CASE WHEN c.commercial_head_id IS NOT NULL AND c.reporting_group_id IS NOT NULL AND h.id IS NOT NULL AND g.id IS NOT NULL AND (c.commercial_family_id IS NULL OR f.id IS NOT NULL) AND h.is_active AND g.is_active AND (f.id IS NULL OR f.is_active) THEN 'allocated' WHEN c.commercial_head_id IS NULL AND c.commercial_family_id IS NULL AND c.reporting_group_id IS NULL AND c.hierarchy_review_disposition='not_applicable' THEN 'not_applicable' WHEN c.commercial_head_id IS NULL AND c.commercial_family_id IS NULL AND c.reporting_group_id IS NULL THEN 'not_reviewed' ELSE 'needs_attention' END hierarchy_resolution_state,COALESCE((SELECT jsonb_agg(jsonb_build_object('batchId',e.batch_id,'sourceFilename',b.source_filename,'sourceRowNumber',e.source_row_number,'sourceCode',e.source_code,'sourceDescription',e.source_description,'hierarchyEvidence',e.selected_hierarchy_evidence,'targetMapping',e.selected_target_mapping,'importedAt',b.created_at) ORDER BY b.created_at DESC) FROM cost_code_import_row_evidence e JOIN cost_code_import_batches b ON b.id=e.batch_id WHERE e.client_id=c.client_id AND e.cost_code_id=c.id),'[]'::jsonb) import_evidence`;
async function resolveHierarchy(db,clientId,input,current=null,{requireActive=true,requireAllocated=false}={}){
  const supplied=['commercialHeadId','commercialFamilyId','reportingGroupId'].some(k=>Object.prototype.hasOwnProperty.call(input,k));
  if(!supplied&&current&&!current.commercial_head_id)return {ok:true,headId:null,familyId:null,groupId:null,head:current.commercial_head||null,family:current.commercial_family||null,group:current.reporting_group||null};
  const headId=(supplied?input.commercialHeadId:current?.commercial_head_id)||null,familyId=(supplied?input.commercialFamilyId:current?.commercial_family_id)||null,groupId=(supplied?input.reportingGroupId:current?.reporting_group_id)||null;
  if(!headId){if(familyId||groupId||requireAllocated)return {ok:false,message:requireAllocated?'Commercial Head and Reporting Group are required.':'Family or Reporting Group cannot be set without a Commercial Head.'};return {ok:true,headId:null,familyId:null,groupId:null,head:null,family:null,group:null};}
  if(!groupId)return {ok:false,message:'Reporting Group is required when Commercial Head is assigned.'};
  const h=(await db.query('SELECT * FROM commercial_structure_heads WHERE client_id=$1 AND id=$2',[clientId,headId])).rows[0];
  const f=familyId?(await db.query('SELECT * FROM commercial_structure_families WHERE client_id=$1 AND id=$2 AND head_id=$3',[clientId,familyId,headId])).rows[0]:null;
  const g=(await db.query('SELECT * FROM commercial_structure_reporting_groups WHERE client_id=$1 AND id=$2 AND head_id=$3 AND family_id IS NOT DISTINCT FROM $4',[clientId,groupId,headId,familyId])).rows[0];
  if(!h||(familyId&&!f)||!g)return {ok:false,message:'The selected Commercial Structure path is invalid.'};
  const unchanged=current&&String(current.commercial_head_id||'')===String(headId)&&String(current.commercial_family_id||'')===String(familyId||'')&&String(current.reporting_group_id||'')===String(groupId);
  if(requireActive&&!unchanged&&(!h.is_active||(f&&!f.is_active)||!g.is_active))return {ok:false,message:'Archived Commercial Structure items cannot be newly assigned.'};
  return {ok:true,headId,familyId,groupId,head:h.name,family:f?.name||null,group:g.name};
}

function isUniqueViolation(err) {
  if (!err || err.code !== "23505") return false;
  const constraint = String(err.constraint || "");
  return (
    constraint.includes("cost_codes_client_id_code_key") ||
    constraint.includes("uq_cost_codes_client_code_lower")
  );
}

function uniqueConflict() {
  return { ok: false, status: 409, message: "Cost code already exists." };
}

function notFound() {
  return { ok: false, status: 404, message: "Cost code not found." };
}

function stale(row) {
  return {
    ok: false,
    status: 409,
    message: "Cost code version conflict.",
    costCode: costCodeRowToDocument(row),
  };
}

async function findCostCodeRowByCode(clientId, code, dbClient = null) {
  const identity = String(code || "").trim();
  if (!identity) return null;
  const exec = dbClient ? dbClient.query.bind(dbClient) : query;
  const { rows } = await exec(
    `
      SELECT c.*,h.name resolved_commercial_head,f.name resolved_commercial_family,g.name resolved_reporting_group ${onboardingSelect}
      FROM cost_codes c LEFT JOIN commercial_structure_heads h ON h.client_id=c.client_id AND h.id=c.commercial_head_id LEFT JOIN commercial_structure_families f ON f.client_id=c.client_id AND f.id=c.commercial_family_id LEFT JOIN commercial_structure_reporting_groups g ON g.client_id=c.client_id AND g.id=c.reporting_group_id
      WHERE c.client_id = $1 AND lower(btrim(c.code)) = lower(btrim($2))
      LIMIT 1
    `,
    [clientId, identity]
  );
  return rows[0] || null;
}

async function findCostCodeRow(clientId, id, dbClient = null) {
  if (!isUuid(id)) return null;
  const exec = dbClient ? dbClient.query.bind(dbClient) : query;
  const { rows } = await exec(
    `
      SELECT c.*,h.name resolved_commercial_head,f.name resolved_commercial_family,g.name resolved_reporting_group ${onboardingSelect}
      FROM cost_codes c LEFT JOIN commercial_structure_heads h ON h.client_id=c.client_id AND h.id=c.commercial_head_id LEFT JOIN commercial_structure_families f ON f.client_id=c.client_id AND f.id=c.commercial_family_id LEFT JOIN commercial_structure_reporting_groups g ON g.client_id=c.client_id AND g.id=c.reporting_group_id
      WHERE c.client_id = $1 AND c.id = $2
      LIMIT 1
    `,
    [clientId, id]
  );
  return rows[0] || null;
}

async function listCostCodes(clientId, { activeOnly = false } = {}) {
  const { rows } = await query(
    `
      SELECT c.*,h.name resolved_commercial_head,f.name resolved_commercial_family,g.name resolved_reporting_group ${onboardingSelect}
      FROM cost_codes c LEFT JOIN commercial_structure_heads h ON h.client_id=c.client_id AND h.id=c.commercial_head_id LEFT JOIN commercial_structure_families f ON f.client_id=c.client_id AND f.id=c.commercial_family_id LEFT JOIN commercial_structure_reporting_groups g ON g.client_id=c.client_id AND g.id=c.reporting_group_id
      WHERE c.client_id = $1
        AND ($2::boolean = false OR c.is_active = true)
      ORDER BY c.reporting_order ASC, c.code ASC, c.id ASC
    `,
    [clientId, Boolean(activeOnly)]
  );
  return {
    ok: true,
    costCodes: rows.map(costCodeRowToDocument),
  };
}

async function getCostCode(clientId, id) {
  const row = await findCostCodeRow(clientId, id);
  if (!row) return notFound();
  return { ok: true, costCode: costCodeRowToDocument(row) };
}

async function createCostCode(clientId, body = {}, { actor, auth } = {}) {
  assertServicePermission(auth,PERMISSIONS.COMMERCIAL_STRUCTURE_MANAGE);
  const dbClient=await pool.connect();
  let authoritative;
  try { authoritative=await resolveHierarchy(dbClient,clientId,body,null,{requireActive:true,requireAllocated:true}); } finally { dbClient.release(); }
  if(!authoritative.ok)return {ok:false,status:400,message:authoritative.message,errors:[authoritative.message]};
  body={...body,commercialHead:authoritative.head,commercialFamily:authoritative.family||'',reportingGroup:authoritative.group,trade:authoritative.group}; actor=actorFromAuth(auth)||actor;
  const validated = validateCreateCostCodeBody(body);
  if (!validated.ok) {
    return { ok: false, status: 400, errors: validated.errors, message: validated.errors.join(" ") };
  }
  const value = validated.value;
  try {
    const inserted = await query(
      `
        INSERT INTO cost_codes (
          client_id, code, description, commercial_head, commercial_family,
          reporting_group, hierarchy_mode, reporting_order, default_vat_treatment,
          default_order_type, allow_budget, allow_purchase_orders, allow_ledger_import,
          allow_forecast_adjustment, notes, import_metadata, is_active, version,
          created_by, updated_by, trade, commercial_head_id, commercial_family_id, reporting_group_id
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9,
          $10, $11, $12, $13,
          $14, $15, $16::jsonb, $17, 1,
          $18, $18, $6, $19, $20, $21
        )
        RETURNING *
      `,
      [
        clientId,
        value.code,
        value.description,
        value.commercialHead,
        value.commercialFamily || null,
        value.reportingGroup,
        value.hierarchyMode,
        value.reportingOrder,
        value.defaultVatTreatment,
        value.defaultOrderType,
        value.allowBudget,
        value.allowPurchaseOrders,
        value.allowLedgerImport,
        value.allowForecastAdjustment,
        value.notes,
        value.importMetadata ? JSON.stringify(value.importMetadata) : null,
        value.active,
        actor || null, authoritative.headId, authoritative.familyId, authoritative.groupId,
      ]
    );
    return { ok: true, status: 201, costCode: costCodeRowToDocument(inserted.rows[0]) };
  } catch (err) {
    if (isUniqueViolation(err)) return uniqueConflict();
    throw err;
  }
}

async function updateCostCode(clientId, id, body = {}, { actor, auth } = {}) {
  assertServicePermission(auth,PERMISSIONS.COMMERCIAL_STRUCTURE_MANAGE);
  const existing = await findCostCodeRow(clientId, id);
  if (!existing) return notFound();

  const hierarchyDb=await pool.connect(); let authoritative;
  try { authoritative=await resolveHierarchy(hierarchyDb,clientId,body,existing,{requireActive:true}); } finally { hierarchyDb.release(); }
  if(!authoritative.ok)return {ok:false,status:400,message:authoritative.message,errors:[authoritative.message]};
  const hierarchySupplied=['commercialHeadId','commercialFamilyId','reportingGroupId'].some(k=>Object.prototype.hasOwnProperty.call(body,k));
  if(hierarchySupplied||authoritative.headId)body={...body,commercialHead:authoritative.head||'',commercialFamily:authoritative.family||'',reportingGroup:authoritative.group||'',trade:authoritative.group||''};
  actor=actorFromAuth(auth)||actor;
  const validated = validateUpdateCostCodeBody(body, existing);
  if (!validated.ok) {
    return { ok: false, status: 400, errors: validated.errors, message: validated.errors.join(" ") };
  }
  if (existing.version !== validated.expectedVersion) {
    return stale(existing);
  }

  const value = validated.value;
  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const updated = await dbClient.query(
      `
        UPDATE cost_codes
        SET
          description = $1,
          commercial_head = $2,
          commercial_family = $3,
          reporting_group = $4,
          hierarchy_mode = $5,
          reporting_order = $6,
          default_vat_treatment = $7,
          default_order_type = $8,
          allow_budget = $9,
          allow_purchase_orders = $10,
          allow_ledger_import = $11,
          allow_forecast_adjustment = $12,
          notes = $13,
          import_metadata = $14::jsonb,
          version = version + 1,
          updated_at = NOW(),
          updated_by = $15,
          commercial_head_id = $19, commercial_family_id = $20, reporting_group_id = $21
        WHERE client_id = $16 AND id = $17 AND version = $18
        RETURNING *
      `,
      [
        value.description,
        value.commercialHead,
        value.commercialFamily || null,
        value.reportingGroup,
        value.hierarchyMode,
        value.reportingOrder,
        value.defaultVatTreatment,
        value.defaultOrderType,
        value.allowBudget,
        value.allowPurchaseOrders,
        value.allowLedgerImport,
        value.allowForecastAdjustment,
        value.notes,
        value.importMetadata ? JSON.stringify(value.importMetadata) : null,
        actor || null,
        clientId,
        id,
        validated.expectedVersion,
        authoritative.headId, authoritative.familyId, authoritative.groupId,
      ]
    );
    if (!updated.rowCount) {
      await dbClient.query("ROLLBACK");
      const latest = await findCostCodeRow(clientId, id);
      return stale(latest || existing);
    }
    await dbClient.query("COMMIT");
    return { ok: true, costCode: costCodeRowToDocument(updated.rows[0]) };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    if (isUniqueViolation(err)) return uniqueConflict();
    throw err;
  } finally {
    dbClient.release();
  }
}

async function setCostCodeActive(clientId, id, body = {}, { actor, auth } = {}) {
  assertServicePermission(auth,PERMISSIONS.COMMERCIAL_STRUCTURE_MANAGE); actor=actorFromAuth(auth)||actor;
  const existing = await findCostCodeRow(clientId, id);
  if (!existing) return notFound();

  const validated = validateActiveCostCodeBody(body);
  if (!validated.ok) {
    return { ok: false, status: 400, errors: validated.errors, message: validated.errors.join(" ") };
  }
  if (existing.version !== validated.expectedVersion) {
    return stale(existing);
  }

  const updated = await query(
    `
      UPDATE cost_codes
      SET
        is_active = $1,
        version = version + 1,
        updated_at = NOW(),
        updated_by = $2
      WHERE client_id = $3 AND id = $4 AND version = $5
      RETURNING *
    `,
    [validated.value.active, actor || null, clientId, id, validated.expectedVersion]
  );
  if (!updated.rowCount) {
    const latest = await findCostCodeRow(clientId, id);
    return stale(latest || existing);
  }
  return { ok: true, costCode: costCodeRowToDocument(updated.rows[0]) };
}

async function bulkUpdateCostCodeHierarchy(clientId, body = {}, { actor, auth } = {}) {
  assertServicePermission(auth,PERMISSIONS.COMMERCIAL_STRUCTURE_MANAGE); actor=actorFromAuth(auth)||actor;
  const validated = validateHierarchyUpdates(body);
  if (!validated.ok) {
    return { ok: false, status: 400, errors: validated.errors, message: validated.errors.join(" ") };
  }
  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const actorUserId=auth?.userId&&(await dbClient.query('SELECT 1 FROM buildlite_users WHERE id=$1',[auth.userId])).rowCount?auth.userId:null;
    const actorMembershipId=auth?.membershipId&&(await dbClient.query('SELECT 1 FROM client_user_memberships WHERE id=$1 AND client_id=$2',[auth.membershipId,clientId])).rowCount?auth.membershipId:null;
    const updated = [];
    for (const entry of validated.updates) {
      const current = await findCostCodeRow(clientId, entry.id, dbClient);
      if (!current) {
        await dbClient.query("ROLLBACK");
        return notFound();
      }
      if (Number(current.version) !== entry.version) {
        await dbClient.query("ROLLBACK");
        return stale(current);
      }
      const hierarchy=await resolveHierarchy(dbClient,clientId,entry,current,{requireActive:true});
      if(!hierarchy.ok){await dbClient.query('ROLLBACK');return {ok:false,status:400,message:hierarchy.message,errors:[hierarchy.message]};}
      const result = await dbClient.query(
        `UPDATE cost_codes
         SET commercial_head = $1, commercial_family = $2, reporting_group = $3,
             commercial_head_id=$9,commercial_family_id=$10,reporting_group_id=$11,
             hierarchy_mode = $4, version = version + 1, updated_at = NOW(), updated_by = $5,
             hierarchy_review_disposition=$12,hierarchy_reviewed_at=NOW(),hierarchy_reviewed_by_user_id=$13,
             hierarchy_reviewed_by_membership_id=$14,hierarchy_reviewed_by_provider_user_id=$15,
             hierarchy_reviewed_by_display_name=$5,hierarchy_reviewed_by_role_key=$16
         WHERE client_id = $6 AND id = $7 AND version = $8 RETURNING *`,
        [hierarchy.head, hierarchy.family, hierarchy.group,
          hierarchy.headId ? (hierarchy.familyId ? "three-level" : "two-level") : null,
          actor || null, clientId, entry.id, entry.version,hierarchy.headId,hierarchy.familyId,hierarchy.groupId,entry.reviewDisposition,actorUserId,actorMembershipId,auth?.providerUserId||null,auth?.roleKey||null]
      );
      if (!result.rowCount) {
        await dbClient.query("ROLLBACK");
        return stale(current);
      }
      const row=result.rows[0];
      await dbClient.query(`INSERT INTO cost_code_hierarchy_review_audit(client_id,cost_code_id,operation,before_document,after_document,resulting_cost_code_version,actor_user_id,actor_membership_id,actor_provider_user_id,actor_display_name,actor_role_key,actor_permission_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[clientId,entry.id,hierarchy.headId?'allocate':entry.reviewDisposition?'mark_not_applicable':'clear',JSON.stringify({commercialHeadId:current.commercial_head_id,commercialFamilyId:current.commercial_family_id,reportingGroupId:current.reporting_group_id,reviewDisposition:current.hierarchy_review_disposition}),JSON.stringify({commercialHeadId:hierarchy.headId,commercialFamilyId:hierarchy.familyId,reportingGroupId:hierarchy.groupId,reviewDisposition:entry.reviewDisposition}),row.version,actorUserId,actorMembershipId,auth?.providerUserId||null,actor||null,auth?.roleKey||null,PERMISSIONS.COMMERCIAL_STRUCTURE_MANAGE]);
      updated.push(costCodeRowToDocument(row));
    }
    await dbClient.query("COMMIT");
    return { ok: true, costCodes: updated };
  } catch (error) {
    await dbClient.query("ROLLBACK");
    throw error;
  } finally {
    dbClient.release();
  }
}

async function getCostCodeOnboardingSummary(clientId) {
  const {rows}=await query(`SELECT COUNT(*)::int total,
    COUNT(*) FILTER(WHERE c.commercial_head_id IS NOT NULL AND c.reporting_group_id IS NOT NULL AND h.id IS NOT NULL AND g.id IS NOT NULL AND (c.commercial_family_id IS NULL OR f.id IS NOT NULL) AND h.is_active AND g.is_active AND (f.id IS NULL OR f.is_active))::int allocated,
    COUNT(*) FILTER(WHERE c.commercial_head_id IS NULL AND c.commercial_family_id IS NULL AND c.reporting_group_id IS NULL AND c.hierarchy_review_disposition IS NULL)::int not_reviewed,
    COUNT(*) FILTER(WHERE c.commercial_head_id IS NULL AND c.commercial_family_id IS NULL AND c.reporting_group_id IS NULL AND c.hierarchy_review_disposition='not_applicable')::int not_applicable,
    COUNT(*) FILTER(WHERE (c.commercial_head_id IS NOT NULL OR c.commercial_family_id IS NOT NULL OR c.reporting_group_id IS NOT NULL) AND NOT(c.commercial_head_id IS NOT NULL AND c.reporting_group_id IS NOT NULL AND h.id IS NOT NULL AND g.id IS NOT NULL AND (c.commercial_family_id IS NULL OR f.id IS NOT NULL) AND h.is_active AND g.is_active AND (f.id IS NULL OR f.is_active)))::int needs_attention
    FROM cost_codes c LEFT JOIN commercial_structure_heads h ON h.client_id=c.client_id AND h.id=c.commercial_head_id LEFT JOIN commercial_structure_families f ON f.client_id=c.client_id AND f.id=c.commercial_family_id LEFT JOIN commercial_structure_reporting_groups g ON g.client_id=c.client_id AND g.id=c.reporting_group_id WHERE c.client_id=$1 AND c.is_active=true`,[clientId]);
  const r=rows[0];return {ok:true,summary:{total:r.total,allocated:r.allocated,notReviewed:r.not_reviewed,notApplicable:r.not_applicable,needsAttention:r.needs_attention}};
}

module.exports = {
  bulkUpdateCostCodeHierarchy,
  createCostCode,
  findCostCodeRowByCode,
  getCostCode,
  getCostCodeOnboardingSummary,
  listCostCodes,
  provisionalActor,
  setCostCodeActive,
  updateCostCode,
};
