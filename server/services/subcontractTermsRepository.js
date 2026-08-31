const { pool, query } = require('../db');
const { validatePaymentRulesV1 } = require('./paymentRulesV1');

const run = (db, sql, params = []) => db ? db.query(sql, params) : query(sql, params);
const who = (body = {}) => body.actor || body.updatedBy || body.createdBy || null;
const fail = (status, message) => ({ ok: false, status, message });

async function audit(db, clientId, action, data = {}) {
  await run(db, `INSERT INTO subcontract_terms_audit
    (client_id,family_id,terms_version_id,po_number,development_id,action,actor,reason,detail)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [clientId, data.familyId||null,
    data.versionId||null, data.poNumber||null, data.developmentId||null, action,
    data.actor||null, data.reason||'', JSON.stringify(data.detail||{})]);
}

async function mapVersion(clientId, id, db = null) {
  const { rows } = await run(db, `SELECT v.*,f.name family_name,f.description family_description
    FROM subcontract_terms_versions v JOIN subcontract_terms_families f
      ON f.id=v.family_id AND f.client_id=v.client_id
    WHERE v.client_id=$1 AND v.id=$2`, [clientId, id]);
  const r = rows[0];
  return r ? { id:r.id, familyId:r.family_id, familyName:r.family_name,
    familyDescription:r.family_description, revisionNumber:r.revision_number,
    versionLabel:r.version_label, status:r.status, effectiveFrom:r.effective_from,
    rulesSchemaVersion:r.rules_schema_version, paymentRules:r.payment_rules,
    sourceDocument:r.source_document, recordVersion:r.record_version,
    publishedAt:r.published_at, retiredAt:r.retired_at } : null;
}

async function list(clientId) {
  const [{ rows }, defaults] = await Promise.all([
    query(`SELECT f.*,
    COALESCE(json_agg(v ORDER BY v.revision_number) FILTER(WHERE v.id IS NOT NULL),'[]') versions
    FROM subcontract_terms_families f LEFT JOIN subcontract_terms_versions v
      ON v.family_id=f.id AND v.client_id=f.client_id
    WHERE f.client_id=$1 GROUP BY f.id ORDER BY f.name`, [clientId]),
    query(`SELECT terms_version_id FROM client_subcontract_terms_defaults WHERE client_id=$1`, [clientId]),
  ]);
  const defaultVersionId = defaults.rows[0]?.terms_version_id || null;
  return {
    defaultVersionId,
    families: rows.map((family) => ({
      ...family,
      versions: (family.versions || []).map((version) => ({
        ...version,
        isCompanyDefault: version.id === defaultVersionId,
      })),
    })),
  };
}

async function createFamily(clientId, body = {}) {
  const name = String(body.name || '').trim();
  if (!name) return fail(400, 'Name is required.');
  const paymentRules=body.paymentRules||{configurationState:'incomplete'};
  const rulesValidation=validatePaymentRulesV1(paymentRules,body.rulesSchemaVersion||1);
  if(!rulesValidation.valid)return fail(400,rulesValidation.errors.join(' '));
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const family = (await db.query(`INSERT INTO subcontract_terms_families
      (client_id,name,description,created_by) VALUES($1,$2,$3,$4) RETURNING *`,
      [clientId,name,String(body.description||''),who(body)])).rows[0];
    const version = (await db.query(`INSERT INTO subcontract_terms_versions
      (client_id,family_id,revision_number,version_label,rules_schema_version,payment_rules,
       source_document,created_by,updated_by) VALUES($1,$2,1,$3,$4,$5,$6,$7,$7) RETURNING id`,
      [clientId,family.id,body.versionLabel||null,Number(body.rulesSchemaVersion||1),
       JSON.stringify(paymentRules),JSON.stringify(body.sourceDocument||{}),who(body)])).rows[0];
    await audit(db,clientId,'family_created',{familyId:family.id,versionId:version.id,actor:who(body)});
    await db.query('COMMIT');
    return { ok:true, version:await mapVersion(clientId,version.id) };
  } catch (error) {
    await db.query('ROLLBACK');
    if (error.code === '23505') return fail(409,'Family name or active Draft already exists.');
    throw error;
  } finally { db.release(); }
}

async function updateDraft(clientId,id,body={}) {
  const current=await mapVersion(clientId,id);
  if(!current||current.status!=='draft')return fail(409,'Draft not found or version conflict. Published terms are immutable.');
  if (!body.paymentRules || typeof body.paymentRules !== 'object' || Array.isArray(body.paymentRules)) return fail(400,'paymentRules must be an object.');
  const rulesValidation=validatePaymentRulesV1(body.paymentRules,body.rulesSchemaVersion||1);
  if(!rulesValidation.valid)return fail(400,rulesValidation.errors.join(' '));
  const {rows}=await query(`UPDATE subcontract_terms_versions SET version_label=$3,effective_from=$4,
    rules_schema_version=$5,payment_rules=$6,source_document=$7,record_version=record_version+1,
    updated_by=$8,updated_at=NOW() WHERE client_id=$1 AND id=$2 AND status='draft'
    AND record_version=$9 RETURNING id`,[clientId,id,body.versionLabel||null,body.effectiveFrom||null,
    Number(body.rulesSchemaVersion||1),JSON.stringify(body.paymentRules),JSON.stringify(body.sourceDocument||{}),who(body),Number(body.recordVersion)]);
  if(!rows[0])return fail(409,'Draft not found or version conflict. Published terms are immutable.');
  await audit(null,clientId,'draft_updated',{versionId:id,actor:who(body)});
  return {ok:true,version:await mapVersion(clientId,id)};
}

async function publish(clientId,id,body={}) {
  const current=await mapVersion(clientId,id);
  if(!current||current.status!=='draft')return fail(409,'Only a Draft version can be published.');
  const rulesValidation=validatePaymentRulesV1(current.paymentRules,current.rulesSchemaVersion);
  if(!rulesValidation.complete)return fail(400,'Payment rules must be Complete and valid.');
  if(!rulesValidation.valid)return fail(400,rulesValidation.errors.join(' '));
  const {rows}=await query(`UPDATE subcontract_terms_versions SET status='published',published_by=$3,
    published_at=NOW(),updated_by=$3,updated_at=NOW() WHERE client_id=$1 AND id=$2 AND status='draft' RETURNING id`,[clientId,id,who(body)]);
  if(!rows[0])return fail(409,'Only a Draft version can be published.');
  await audit(null,clientId,'published',{versionId:id,actor:who(body)});
  return {ok:true,version:await mapVersion(clientId,id)};
}

async function cloneVersion(clientId,id,body={}) {
  const db=await pool.connect(); try { await db.query('BEGIN');
    const src=(await db.query(`SELECT * FROM subcontract_terms_versions WHERE client_id=$1 AND id=$2
      AND status IN('published','retired') FOR UPDATE`,[clientId,id])).rows[0];
    if(!src){await db.query('ROLLBACK');return fail(404,'Published version not found.');}
    const next=(await db.query(`SELECT COALESCE(MAX(revision_number),0)+1 n FROM subcontract_terms_versions WHERE family_id=$1`,[src.family_id])).rows[0].n;
    const row=(await db.query(`INSERT INTO subcontract_terms_versions(client_id,family_id,revision_number,
      version_label,rules_schema_version,payment_rules,source_document,created_by,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING id`,[clientId,src.family_id,next,body.versionLabel||null,
      src.rules_schema_version,src.payment_rules,src.source_document,who(body)])).rows[0];
    await audit(db,clientId,'cloned',{familyId:src.family_id,versionId:row.id,actor:who(body),detail:{fromVersionId:id}});
    await db.query('COMMIT'); return {ok:true,version:await mapVersion(clientId,row.id)};
  } catch(error){await db.query('ROLLBACK');if(error.code==='23505')return fail(409,'This family already has an active Draft.');throw error;} finally{db.release();}
}

async function retire(clientId,id,body={}) {
  const {rows}=await query(`UPDATE subcontract_terms_versions SET status='retired',retired_by=$3,
    retired_at=NOW(),updated_by=$3,updated_at=NOW() WHERE client_id=$1 AND id=$2 AND status='published'
    AND NOT EXISTS(SELECT 1 FROM client_subcontract_terms_defaults d WHERE d.client_id=$1 AND d.terms_version_id=$2)
    AND NOT EXISTS(SELECT 1 FROM development_subcontract_terms_defaults d WHERE d.client_id=$1 AND d.terms_version_id=$2) RETURNING id`,[clientId,id,who(body)]);
  if(!rows[0])return fail(409,'Only a non-default Published version can be retired.');
  await audit(null,clientId,'retired',{versionId:id,actor:who(body)});
  return {ok:true,version:await mapVersion(clientId,id)};
}
async function ensurePublished(clientId,id,db=null) {
  return !!(await run(db,`SELECT 1 FROM subcontract_terms_versions WHERE client_id=$1 AND id=$2 AND status='published'`,[clientId,id])).rows[0];
}
async function setTenantDefault(clientId,id,body={}) {
  if(!await ensurePublished(clientId,id))return fail(400,'Default must be a current Published version.');
  await query(`INSERT INTO client_subcontract_terms_defaults(client_id,terms_version_id,assigned_by)
    VALUES($1,$2,$3) ON CONFLICT(client_id) DO UPDATE SET terms_version_id=$2,assigned_by=$3,assigned_at=NOW()`,[clientId,id,who(body)]);
  await audit(null,clientId,'tenant_default_set',{versionId:id,actor:who(body)}); return {ok:true};
}
async function setDevelopmentDefault(clientId,developmentId,id,body={}) {
  if(!await ensurePublished(clientId,id))return fail(400,'Default must be a current Published version.');
  if(!(await query(`SELECT 1 FROM developments WHERE client_id=$1 AND id=$2`,[clientId,developmentId])).rows[0])return fail(404,'Development not found.');
  await query(`INSERT INTO development_subcontract_terms_defaults(client_id,development_id,terms_version_id,assigned_by)
    VALUES($1,$2,$3,$4) ON CONFLICT(client_id,development_id) DO UPDATE SET terms_version_id=$3,assigned_by=$4,assigned_at=NOW()`,[clientId,developmentId,id,who(body)]);
  await audit(null,clientId,'development_default_set',{versionId:id,developmentId,actor:who(body)}); return {ok:true};
}
async function setPoOverride(clientId,poNumber,id,reason,body={}) {
  reason=String(reason||'').trim(); if(!reason)return fail(400,'An override reason is required.');
  if(!await ensurePublished(clientId,id))return fail(400,'Override must use a current Published version.');
  const po=(await query(`SELECT payload FROM purchase_orders WHERE client_id=$1 AND po_number=$2`,[clientId,poNumber])).rows[0];
  if(!po)return fail(404,'PO not found.');
  if(String(po.payload?.status||'').toLowerCase()==='approved')return fail(409,'Approved PO terms are immutable.');
  await query(`INSERT INTO purchase_order_terms_overrides(client_id,po_number,terms_version_id,reason,assigned_by)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(client_id,po_number) DO UPDATE SET terms_version_id=$3,reason=$4,assigned_by=$5,assigned_at=NOW()`,[clientId,poNumber,id,reason,who(body)]);
  await audit(null,clientId,'order_override_set',{versionId:id,poNumber,reason,actor:who(body)}); return {ok:true};
}

async function resolveForPo(clientId,poNumber,db=null) {
  const bound=(await run(db,`SELECT * FROM purchase_order_terms_bindings WHERE client_id=$1 AND po_number=$2`,[clientId,poNumber])).rows[0];
  if(bound)return {state:bound.terms_version_id?'bound':'unconfigured',source:bound.resolved_source,bindingId:bound.id,
    version:bound.terms_version_id?await mapVersion(clientId,bound.terms_version_id,db):null,legacyProspective:bound.legacy_prospective};
  const po=(await run(db,`SELECT payload FROM purchase_orders WHERE client_id=$1 AND po_number=$2`,[clientId,poNumber])).rows[0];
  if(!po)return null;
  if(String(po.payload?.status||'').toLowerCase()==='approved') {
    return {state:'legacy',source:'unconfigured',version:null,message:'Legacy / not formally configured'};
  }
  const developmentId=po.payload?.developmentId||po.payload?.costRef?.developmentId||null;
  const picked=(await run(db,`SELECT terms_version_id,source FROM (
    SELECT o.terms_version_id,'order_override' source,1 priority FROM purchase_order_terms_overrides o WHERE o.client_id=$1 AND o.po_number=$2
    UNION ALL SELECT d.terms_version_id,'development_default',2 FROM development_subcontract_terms_defaults d WHERE d.client_id=$1 AND d.development_id=$3
    UNION ALL SELECT t.terms_version_id,'tenant_default',3 FROM client_subcontract_terms_defaults t WHERE t.client_id=$1
    ) choices JOIN subcontract_terms_versions v ON v.id=choices.terms_version_id AND v.client_id=$1 AND v.status='published'
    ORDER BY priority LIMIT 1`,[clientId,poNumber,developmentId])).rows[0];
  return {state:picked?'proposed':'unconfigured',source:picked?.source||'unconfigured',version:picked?await mapVersion(clientId,picked.terms_version_id,db):null};
}

async function bindOnApproval(clientId,poNumber,{dbClient,actor,resolvedTerms}={}) {
  const resolved=resolvedTerms||await resolveForPo(clientId,poNumber,dbClient);
  const inserted=(await run(dbClient,`INSERT INTO purchase_order_terms_bindings(client_id,po_number,terms_version_id,resolved_source,bound_by)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(client_id,po_number) DO NOTHING RETURNING id`,
    [clientId,poNumber,resolved?.version?.id||null,resolved?.source||'unconfigured',actor||null])).rows[0];
  if(inserted)await audit(dbClient,clientId,'order_bound',{versionId:resolved?.version?.id,poNumber,actor,detail:{source:resolved?.source||'unconfigured'}});
  return resolveForPo(clientId,poNumber,dbClient);
}

async function confirmLegacy(clientId,poNumber,id,reason,body={}) {
  reason=String(reason||'').trim(); if(!reason)return fail(400,'A prospective confirmation reason is required.');
  if(!await ensurePublished(clientId,id))return fail(400,'Confirmation must use a current Published version.');
  const {rows}=await query(`INSERT INTO purchase_order_terms_bindings
    (client_id,po_number,terms_version_id,resolved_source,legacy_prospective,override_reason,bound_by)
    SELECT $1,$2,$3,'legacy_confirmed',TRUE,$4,$5 FROM purchase_orders po
    WHERE po.client_id=$1 AND po.po_number=$2 AND lower(po.payload->>'status')='approved'
    ON CONFLICT(client_id,po_number) DO UPDATE SET terms_version_id=$3,resolved_source='legacy_confirmed',
      legacy_prospective=TRUE,override_reason=$4,bound_by=$5,bound_at=NOW()
      WHERE purchase_order_terms_bindings.terms_version_id IS NULL RETURNING id`,[clientId,poNumber,id,reason,who(body)]);
  if(!rows[0])return fail(409,'Only an unconfigured Approved order can be prospectively confirmed.');
  await audit(null,clientId,'legacy_confirmed',{versionId:id,poNumber,reason,actor:who(body)});
  return {ok:true,terms:await resolveForPo(clientId,poNumber)};
}

async function resolveForPackage(clientId,packageId,db=null) {
  const {rows}=await run(db,`SELECT po_number FROM package_purchase_orders WHERE client_id=$1 AND package_id=$2 ORDER BY po_number`,[clientId,packageId]);
  const orders=[]; for(const row of rows)orders.push({poNumber:row.po_number,terms:await resolveForPo(clientId,row.po_number,db)});
  const ids=[...new Set(orders.map(item=>item.terms?.version?.id||'unconfigured'))];
  const state=ids.length>1?'mixed':ids[0]==='unconfigured'||!ids.length?'unconfigured':'common';
  return {state,message:state==='mixed'?'Mixed contract terms — payment-rule readiness unavailable':state==='unconfigured'?'Contract terms: Not configured':null,
    version:state==='common'?orders[0].terms.version:null,source:state==='common'?orders[0].terms.source:null,orders};
}

async function snapshotForPackage(clientId,packageId,db=null) {
  const value=await resolveForPackage(clientId,packageId,db),v=value.version;
  return {state:value.state,readiness:value.state==='common'?'configured':'unavailable',message:value.message||null,source:value.source||null,
    familyId:v?.familyId||null,familyName:v?.familyName||null,termsVersionId:v?.id||null,revisionNumber:v?.revisionNumber||null,
    versionLabel:v?.versionLabel||null,rulesSchemaVersion:v?.rulesSchemaVersion||null,paymentRules:v?.paymentRules||null,
    sourceDocument:v?.sourceDocument||null,capturedAt:new Date().toISOString()};
}

module.exports={list,createFamily,updateDraft,publish,cloneVersion,retire,setTenantDefault,setDevelopmentDefault,
  setPoOverride,resolveForPo,bindOnApproval,confirmLegacy,resolveForPackage,snapshotForPackage,mapVersion};
