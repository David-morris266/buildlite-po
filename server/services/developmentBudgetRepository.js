const { pool } = require('../db');
const { assertServicePermission } = require('../auth/authorization');
const { PERMISSIONS } = require('../auth/permissions');
const { CANONICAL_JSON_SHA256_V1, hashCanonicalJson } = require('./canonicalJsonIntegrity');

const TYPES = new Set(['opening_budget','opening_adjustment','addition','omission','transfer','correction','reversal']);
const CALCULATION_VERSION = 'development_budget_authority_v1';
const text = value => String(value ?? '').trim();
function fail(status,message){return {ok:false,status,message};}
function moneyToPence(value){const s=String(value??'').trim();const m=s.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);if(!m)return null;const p=Number(m[2])*100+Number((m[3]||'').padEnd(2,'0'));if(!Number.isSafeInteger(p))return null;return (m[1]? -1:1)*p;}
function pounds(pence){return pence/100;}
function actor(auth){return [auth.userId,auth.membershipId,auth.providerUserId,auth.displayName,auth.roleKey,PERMISSIONS.DEVELOPMENT_BUDGET_POST];}
function canonicalDatabaseDate(value){
  if(value==null)return null;
  if(value instanceof Date){
    if(Number.isNaN(value.getTime()))return null;
    const year=value.getFullYear(),month=String(value.getMonth()+1).padStart(2,'0'),day=String(value.getDate()).padStart(2,'0');
    return `${year}-${month}-${day}`;
  }
  const match=String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if(!match)return null;
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
  const candidate=new Date(Date.UTC(year,month-1,day));
  if(candidate.getUTCFullYear()!==year||candidate.getUTCMonth()!==month-1||candidate.getUTCDate()!==day)return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}
function mapEvent(row,lines=[]){return {id:row.id,sequenceNumber:row.sequence_number,eventType:row.event_type,effectiveDate:canonicalDatabaseDate(row.effective_date),reference:row.reference,reason:row.reason,reversesEventId:row.reverses_event_id||null,idempotencyKey:row.idempotency_key,sourceSnapshot:row.source_snapshot,sourceSnapshotSha256:row.source_snapshot_sha256,sourceSnapshotHashScheme:row.source_snapshot_hash_scheme,createdBy:{userId:row.created_by_user_id,membershipId:row.created_by_membership_id,providerUserId:row.created_by_provider_user_id,displayName:row.created_by_display_name,roleKey:row.created_role_key,permission:row.created_permission_key},createdAt:new Date(row.created_at).toISOString(),lines};}

async function getAuthority(clientId,developmentId,auth,dbClient=null){
  assertServicePermission(auth,PERMISSIONS.COMMERCIAL_READ);
  const db=dbClient||pool;
  const dev=(await db.query('SELECT id,development_name,version FROM developments WHERE id=$1 AND client_id=$2',[developmentId,clientId])).rows[0];
  if(!dev)return fail(404,'Development not found.');
  const rows=(await db.query(`SELECT e.*,l.id line_id,l.line_number,l.cost_code_id,l.signed_amount,l.explanation,c.code,c.description
    FROM development_budget_events e LEFT JOIN development_budget_event_lines l ON l.event_id=e.id LEFT JOIN cost_codes c ON c.id=l.cost_code_id
    WHERE e.client_id=$1 AND e.development_id=$2 ORDER BY e.sequence_number,l.line_number`,[clientId,developmentId])).rows;
  const by=new Map();for(const row of rows){if(!by.has(row.id))by.set(row.id,mapEvent(row,[]));if(row.line_id)by.get(row.id).lines.push({id:row.line_id,lineNumber:row.line_number,costCodeId:row.cost_code_id,costCode:row.code,description:row.description||'',signedAmount:Number(row.signed_amount),explanation:row.explanation||''});}
  const events=[...by.values()];const reversed=new Set(events.filter(e=>e.eventType==='reversal').map(e=>e.reversesEventId));const positions=new Map();
  for(const event of events){for(const line of event.lines){const p=positions.get(line.costCodeId)||{costCodeId:line.costCodeId,costCode:line.costCode,description:line.description,originalPence:0,currentPence:0};const cents=moneyToPence(line.signedAmount.toFixed(2));if(event.eventType==='opening_budget'&&!reversed.has(event.id))p.originalPence+=cents;p.currentPence+=cents;positions.set(line.costCodeId,p);}}
  const perCostCode=[...positions.values()].sort((a,b)=>a.costCode.localeCompare(b.costCode)).map(p=>({costCodeId:p.costCodeId,costCode:p.costCode,description:p.description,originalBudget:pounds(p.originalPence),currentBudget:pounds(p.currentPence)}));
  const totalOriginalPence=perCostCode.reduce((s,p)=>s+moneyToPence(p.originalBudget.toFixed(2)),0),totalCurrentPence=perCostCode.reduce((s,p)=>s+moneyToPence(p.currentBudget.toFixed(2)),0);
  const sourceDocument={calculationVersion:CALCULATION_VERSION,clientId,developmentId,events:events.map(e=>({id:e.id,sequenceNumber:e.sequenceNumber,eventType:e.eventType,sourceSnapshotSha256:e.sourceSnapshotSha256})),positions:perCostCode.map(p=>({costCodeId:p.costCodeId,costCode:p.costCode,originalPence:moneyToPence(p.originalBudget.toFixed(2)),currentPence:moneyToPence(p.currentBudget.toFixed(2))}))};
  return {ok:true,status:200,authority:{exists:events.length>0,calculationVersion:CALCULATION_VERSION,dataVersion:events.at(-1)?.sequenceNumber||0,development:{id:dev.id,name:dev.development_name,version:dev.version},totalOriginalBudget:pounds(totalOriginalPence),totalCurrentBudget:pounds(totalCurrentPence),perCostCode,events,sourceDocument,canonicalDigest:hashCanonicalJson(sourceDocument),canonicalHashScheme:CANONICAL_JSON_SHA256_V1}};
}

async function postEvent(clientId,developmentId,body={},auth={}){
  assertServicePermission(auth,PERMISSIONS.DEVELOPMENT_BUDGET_POST);
  const type=text(body.eventType),reference=text(body.reference),reason=text(body.reason),idempotencyKey=text(body.idempotencyKey),effectiveDate=text(body.effectiveDate);
  if(!TYPES.has(type))return fail(400,'eventType is invalid.');if(!reference)return fail(400,'reference is required.');if(!reason)return fail(400,'reason is required.');if(!idempotencyKey)return fail(400,'idempotencyKey is required.');if(!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate))return fail(400,'effectiveDate is required in YYYY-MM-DD format.');
  const db=await pool.connect();try{await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[clientId,developmentId]);
    const dev=(await db.query('SELECT id FROM developments WHERE id=$1 AND client_id=$2 FOR UPDATE',[developmentId,clientId])).rows[0];if(!dev){await db.query('ROLLBACK');return fail(404,'Development not found.');}
    let requestedLines=Array.isArray(body.lines)?body.lines:[];let reversed=null;
    if(type==='reversal'){reversed=(await db.query('SELECT * FROM development_budget_events WHERE id=$1 AND client_id=$2 AND development_id=$3',[body.reversesEventId,clientId,developmentId])).rows[0];if(!reversed||reversed.event_type==='reversal'||reversed.event_type==='opening_budget'){await db.query('ROLLBACK');return fail(400,'reversesEventId must identify an eligible non-opening event in this Development.');}if((await db.query('SELECT 1 FROM development_budget_events WHERE client_id=$1 AND reverses_event_id=$2',[clientId,reversed.id])).rowCount){await db.query('ROLLBACK');return fail(409,'Budget event has already been reversed.');}requestedLines=(await db.query('SELECT cost_code_id,(-signed_amount)::text amount,explanation FROM development_budget_event_lines WHERE event_id=$1 ORDER BY line_number',[reversed.id])).rows.map(r=>({costCodeId:r.cost_code_id,amount:r.amount,explanation:r.explanation||`Reversal of ${reversed.reference}`}));}
    if(!requestedLines.length){await db.query('ROLLBACK');return fail(400,'At least one non-zero budget line is required.');}
    const lines=[];for(const [i,line] of requestedLines.entries()){const p=moneyToPence(line.amount);if(p==null||p===0){await db.query('ROLLBACK');return fail(400,`lines[${i}].amount must be an exact non-zero monetary value.`);}const cc=(await db.query('SELECT id,code,description FROM cost_codes WHERE id=$1 AND client_id=$2 AND is_active=true',[line.costCodeId,clientId])).rows[0];if(!cc){await db.query('ROLLBACK');return fail(400,`lines[${i}] requires an active tenant Cost Code Master record.`);}lines.push({lineNumber:i+1,costCodeId:cc.id,costCode:cc.code,description:cc.description||'',amountPence:p,explanation:text(line.explanation)});}
    const sum=lines.reduce((s,l)=>s+l.amountPence,0);if(type==='transfer'&&(lines.length<2||sum!==0)){await db.query('ROLLBACK');return fail(400,'Transfer lines must contain at least two lines and net exactly to zero.');}if(type==='addition'&&lines.some(l=>l.amountPence<=0)){await db.query('ROLLBACK');return fail(400,'Addition lines must be positive.');}if(type==='omission'&&lines.some(l=>l.amountPence>=0)){await db.query('ROLLBACK');return fail(400,'Omission lines must be negative.');}if(type==='opening_budget'&&lines.some(l=>l.amountPence<=0)){await db.query('ROLLBACK');return fail(400,'Opening Budget lines must be positive.');}
    const snapshot={schemaVersion:'development_budget_event_v1',clientId,developmentId,eventType:type,effectiveDate,reference,reason,reversesEventId:reversed?.id||null,lines:lines.map(l=>({lineNumber:l.lineNumber,costCodeId:l.costCodeId,costCode:l.costCode,amountPence:l.amountPence,explanation:l.explanation}))};const digest=hashCanonicalJson(snapshot);
    const existing=(await db.query('SELECT * FROM development_budget_events WHERE client_id=$1 AND development_id=$2 AND idempotency_key=$3',[clientId,developmentId,idempotencyKey])).rows[0];if(existing){await db.query('ROLLBACK');if(existing.source_snapshot_sha256!==digest)return fail(409,'Idempotency key was already used for a different budget event.');const loaded=await getAuthority(clientId,developmentId,{...auth,permissions:[...(auth.permissions||[]),PERMISSIONS.COMMERCIAL_READ]});return {ok:true,status:200,replayed:true,event:loaded.authority.events.find(e=>e.id===existing.id),authority:loaded.authority};}
    if(type==='opening_budget'){const active=(await db.query(`SELECT 1 FROM development_budget_events o WHERE o.client_id=$1 AND o.development_id=$2 AND o.event_type='opening_budget' AND NOT EXISTS(SELECT 1 FROM development_budget_events r WHERE r.reverses_event_id=o.id)`,[clientId,developmentId])).rowCount;if(active){await db.query('ROLLBACK');return fail(409,'An active Opening Budget already exists for this Development.');}}
    const sequence=Number((await db.query('SELECT COALESCE(MAX(sequence_number),0)+1 n FROM development_budget_events WHERE client_id=$1 AND development_id=$2',[clientId,developmentId])).rows[0].n);
    const inserted=(await db.query(`INSERT INTO development_budget_events(client_id,development_id,sequence_number,event_type,effective_date,reference,reason,reverses_event_id,idempotency_key,source_snapshot,source_snapshot_sha256,source_snapshot_hash_scheme,created_by_user_id,created_by_membership_id,created_by_provider_user_id,created_by_display_name,created_role_key,created_permission_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,[clientId,developmentId,sequence,type,effectiveDate,reference,reason,reversed?.id||null,idempotencyKey,JSON.stringify(snapshot),digest,CANONICAL_JSON_SHA256_V1,...actor(auth)])).rows[0];
    for(const line of lines)await db.query('INSERT INTO development_budget_event_lines(client_id,development_id,event_id,line_number,cost_code_id,signed_amount,explanation) VALUES($1,$2,$3,$4,$5,$6,$7)',[clientId,developmentId,inserted.id,line.lineNumber,line.costCodeId,(line.amountPence/100).toFixed(2),line.explanation||null]);
    await db.query('COMMIT');const loaded=await getAuthority(clientId,developmentId,{...auth,permissions:[...(auth.permissions||[]),PERMISSIONS.COMMERCIAL_READ]});return {ok:true,status:201,replayed:false,event:loaded.authority.events.find(e=>e.id===inserted.id),authority:loaded.authority};
  }catch(error){await db.query('ROLLBACK');if(error.code==='23505')return fail(409,'Conflicting Development Budget event.');throw error;}finally{db.release();}
}
module.exports={CALCULATION_VERSION,moneyToPence,canonicalDatabaseDate,getAuthority,postEvent};
