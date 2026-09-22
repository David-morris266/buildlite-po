/**
 * BL-033B — Tenant-level cost-code semantic classification.
 * GET never inserts. Unmapped resolves as UNCLASSIFIED + STANDARD_CVR.
 * Does not infer from Commercial Head. Does not write CVR overlays.
 */

const { pool, query } = require("../db");
const {
  classificationRowToDocument,
  unmappedDocument,
} = require("./costCodeClassificationMapper");
const { normalizeCostCodeKey, validatePutClassificationBody } = require(
  "./costCodeClassificationValidation"
);

function isUniqueViolation(err) {
  return err && err.code === "23505";
}

async function findClassificationRow(clientId, costCodeKey, dbClient = null) {
  const exec = dbClient ? dbClient.query.bind(dbClient) : query;
  const { rows } = await exec(
    `
      SELECT *
      FROM cost_code_classifications
      WHERE client_id = $1 AND lower(cost_code_key) = lower($2)
      LIMIT 1
    `,
    [clientId, costCodeKey]
  );
  return rows[0] || null;
}

async function listClassifications(clientId, dbClient = null) {
  const exec = dbClient ? dbClient.query.bind(dbClient) : query;
  const { rows } = await exec(
    `
      SELECT *
      FROM cost_code_classifications
      WHERE client_id = $1
      ORDER BY cost_code_key ASC
    `,
    [clientId]
  );
  return {
    ok: true,
    classifications: rows.map((row) => classificationRowToDocument(row)),
    unmappedDefault: unmappedDocument(""),
  };
}

async function getClassification(clientId, costCodeKeyParam) {
  const costCodeKey = normalizeCostCodeKey(costCodeKeyParam);
  if (!costCodeKey) {
    return { ok: false, status: 400, message: "costCodeKey is required." };
  }
  const row = await findClassificationRow(clientId, costCodeKey);
  return {
    ok: true,
    classification: classificationRowToDocument(row, costCodeKey),
  };
}

function provenanceValues(actor, envelope = {}) {
  return [actor || envelope.displayName || null, envelope.userId || null, envelope.membershipId || null,
    envelope.providerUserId || null, envelope.roleKey || null, envelope.permission || null];
}

async function putClassification(clientId, costCodeKeyParam, body = {}, { actor, actorEnvelope } = {}) {
  const validated = validatePutClassificationBody(body, costCodeKeyParam);
  if (!validated.ok) {
    return { ok: false, status: 400, errors: validated.errors, message: validated.errors.join(" ") };
  }

  const { costCodeKey, semanticGroup, forecastDriver, clear } = validated.value;
  const expectedVersion = validated.expectedVersion;
  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const existing = await findClassificationRow(clientId, costCodeKey, dbClient);
    const provenance = provenanceValues(actor, actorEnvelope);

    if (!existing) {
      if (clear) {
        await dbClient.query("COMMIT");
        return { ok: true, status: 200, classification: unmappedDocument(costCodeKey) };
      }
      if (expectedVersion !== 0) {
        await dbClient.query("ROLLBACK");
        return {
          ok: false,
          status: 409,
          message: "Cost-code classification version conflict.",
          classification: unmappedDocument(costCodeKey),
        };
      }

      const inserted = await dbClient.query(
        `
          INSERT INTO cost_code_classifications (
            client_id, cost_code_key, semantic_group, forecast_driver,
            version, created_by, updated_by,
            created_by_user_id, created_by_membership_id, created_by_provider_user_id,
            created_by_role_key, created_by_permission_key,
            updated_by_user_id, updated_by_membership_id, updated_by_provider_user_id,
            updated_by_role_key, updated_by_permission_key
          )
          VALUES ($1, $2, $3, $4, 1, $5, $5, $6,$7,$8,$9,$10,$6,$7,$8,$9,$10)
          RETURNING *
        `,
        [clientId, costCodeKey, semanticGroup, forecastDriver, ...provenance]
      );
      await dbClient.query("COMMIT");
      return {
        ok: true,
        status: 201,
        classification: classificationRowToDocument(inserted.rows[0], costCodeKey),
      };
    }

    if (expectedVersion !== existing.version) {
      await dbClient.query("ROLLBACK");
      return {
        ok: false,
        status: 409,
        message: "Cost-code classification version conflict.",
        classification: classificationRowToDocument(existing, costCodeKey),
      };
    }

    if (clear) {
      await dbClient.query(
        `DELETE FROM cost_code_classifications WHERE id = $1 AND client_id = $2`,
        [existing.id, clientId]
      );
      await dbClient.query("COMMIT");
      return { ok: true, status: 200, classification: unmappedDocument(existing.cost_code_key) };
    }

    const updated = await dbClient.query(
      `
        UPDATE cost_code_classifications
        SET
          semantic_group = $1,
          forecast_driver = $2,
          version = version + 1,
          updated_at = NOW(),
          updated_by = $3,
          updated_by_user_id=$4, updated_by_membership_id=$5, updated_by_provider_user_id=$6,
          updated_by_role_key=$7, updated_by_permission_key=$8
        WHERE id = $9 AND client_id = $10 AND version = $11
        RETURNING *
      `,
      [semanticGroup, forecastDriver, ...provenance, existing.id, clientId, expectedVersion]
    );
    if (!updated.rowCount) {
      await dbClient.query("ROLLBACK");
      return {
        ok: false,
        status: 409,
        message: "Cost-code classification version conflict.",
        classification: classificationRowToDocument(existing, costCodeKey),
      };
    }
    await dbClient.query("COMMIT");
    return {
      ok: true,
      status: 200,
      classification: classificationRowToDocument(updated.rows[0], costCodeKey),
    };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    if (isUniqueViolation(err)) {
      return {
        ok: false,
        status: 409,
        message: "A classification already exists for this cost code.",
      };
    }
    throw err;
  } finally {
    dbClient.release();
  }
}

function validateBulkBody(body = {}) {
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const target = validatePutClassificationBody({ version:0, semanticGroup:body.semanticGroup, forecastDriver:body.forecastDriver }, 'bulk');
  if (!rows.length) return { ok:false, status:400, message:'Select at least one Cost Code.' };
  if (!target.ok || target.value.clear) return { ok:false, status:400, message:target.errors?.join(' ') || 'A classification target is required.' };
  const seen = new Set();
  for (const row of rows) {
    if (!row?.costCodeId || !normalizeCostCodeKey(row.costCodeKey) || !Number.isInteger(Number(row.costCodeVersion)) || !Number.isInteger(Number(row.classificationVersion))) {
      return { ok:false, status:400, message:'Every reviewed row requires stable Cost Code identity and expected versions.' };
    }
    if (seen.has(row.costCodeId)) return { ok:false, status:400, message:'Duplicate Cost Code identity in reviewed batch.' };
    seen.add(row.costCodeId);
  }
  return { ok:true, rows, semanticGroup:target.value.semanticGroup, forecastDriver:target.value.forecastDriver };
}

async function inspectBulk(clientId, body, dbClient, { lock=false } = {}) {
  const valid = validateBulkBody(body); if (!valid.ok) return valid;
  const ids = valid.rows.map(row=>row.costCodeId);
  const codesResult = await dbClient.query(`SELECT id,code,version,is_active FROM cost_codes WHERE client_id=$1 AND id=ANY($2::uuid[]) ${lock?'FOR UPDATE':''}`, [clientId, ids]);
  const codes = new Map(codesResult.rows.map(row=>[String(row.id),row]));
  const classResult = await dbClient.query(`SELECT * FROM cost_code_classifications WHERE client_id=$1 AND lower(cost_code_key)=ANY($2::text[]) ${lock?'FOR UPDATE':''}`, [clientId, valid.rows.map(row=>normalizeCostCodeKey(row.costCodeKey).toLowerCase())]);
  const classes = new Map(classResult.rows.map(row=>[String(row.cost_code_key).trim().toLowerCase(),row]));
  const reviewed=[];
  for (const expected of valid.rows) {
    const code=codes.get(String(expected.costCodeId)); const key=normalizeCostCodeKey(expected.costCodeKey);
    if (!code || !code.is_active || String(code.code)!==key || Number(code.version)!==Number(expected.costCodeVersion)) return {ok:false,status:409,message:`Cost Code ${key} changed or is no longer an active tenant record.`};
    const current=classes.get(key.toLowerCase())||null;
    if (Number(current?.version||0)!==Number(expected.classificationVersion)) return {ok:false,status:409,message:`Classification ${key} changed after review.`};
    const unchanged=current?.semantic_group===valid.semanticGroup&&current?.forecast_driver===valid.forecastDriver;
    reviewed.push({costCodeId:code.id,costCodeKey:key,costCodeVersion:Number(code.version),classificationVersion:Number(current?.version||0),current:classificationRowToDocument(current,key),proposed:{semanticGroup:valid.semanticGroup,forecastDriver:valid.forecastDriver},change:unchanged?'unchanged':current?'changing':'new'});
  }
  return {ok:true,semanticGroup:valid.semanticGroup,forecastDriver:valid.forecastDriver,rows:reviewed,counts:{selected:reviewed.length,new:reviewed.filter(r=>r.change==='new').length,changing:reviewed.filter(r=>r.change==='changing').length,unchanged:reviewed.filter(r=>r.change==='unchanged').length}};
}

async function previewBulkClassifications(clientId, body={}) { const client=await pool.connect(); try{return await inspectBulk(clientId,body,client);} finally{client.release();} }

async function applyBulkClassifications(clientId, body={}, {actor,actorEnvelope}={}) {
  const client=await pool.connect(); try { await client.query('BEGIN'); const preview=await inspectBulk(clientId,body,client,{lock:true}); if(!preview.ok){await client.query('ROLLBACK');return preview;}
    for(const row of preview.rows.filter(item=>item.change!=='unchanged')) {
      const result=await putClassificationInTransaction(client,clientId,row.costCodeKey,{semanticGroup:preview.semanticGroup,forecastDriver:preview.forecastDriver},row.classificationVersion,{actor,actorEnvelope});
      if(!result.ok){await client.query('ROLLBACK');return result;}
    }
    await client.query('COMMIT'); return {ok:true,status:200,applied:preview.rows.filter(r=>r.change!=='unchanged').length,...preview};
  } catch(error){await client.query('ROLLBACK');throw error;} finally{client.release();}
}

async function putClassificationInTransaction(dbClient,clientId,key,target,expectedVersion,{actor,actorEnvelope}) {
  const existing=await findClassificationRow(clientId,key,dbClient);
  const p=provenanceValues(actor,actorEnvelope);
  if(!existing){const inserted=await dbClient.query(`INSERT INTO cost_code_classifications(client_id,cost_code_key,semantic_group,forecast_driver,version,created_by,updated_by,created_by_user_id,created_by_membership_id,created_by_provider_user_id,created_by_role_key,created_by_permission_key,updated_by_user_id,updated_by_membership_id,updated_by_provider_user_id,updated_by_role_key,updated_by_permission_key) VALUES($1,$2,$3,$4,1,$5,$5,$6,$7,$8,$9,$10,$6,$7,$8,$9,$10) RETURNING *`,[clientId,key,target.semanticGroup,target.forecastDriver,...p]);return {ok:true,classification:classificationRowToDocument(inserted.rows[0])};}
  const updated=await dbClient.query(`UPDATE cost_code_classifications SET semantic_group=$1,forecast_driver=$2,version=version+1,updated_at=NOW(),updated_by=$3,updated_by_user_id=$4,updated_by_membership_id=$5,updated_by_provider_user_id=$6,updated_by_role_key=$7,updated_by_permission_key=$8 WHERE id=$9 AND client_id=$10 AND version=$11 RETURNING *`,[target.semanticGroup,target.forecastDriver,...p,existing.id,clientId,expectedVersion]);
  return updated.rowCount?{ok:true,classification:classificationRowToDocument(updated.rows[0])}:{ok:false,status:409,message:`Classification ${key} changed after review.`};
}

module.exports = {
  listClassifications,
  getClassification,
  putClassification,
  findClassificationRow,
  previewBulkClassifications,
  applyBulkClassifications,
};
