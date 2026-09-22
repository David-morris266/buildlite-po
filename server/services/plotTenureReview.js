const { createHash, randomUUID } = require('node:crypto');
const { pool } = require('../db');
const { PLOT_TENURE_CODES, normalizePlotTenureCode } = require('./plotTenureAuthority');
const { rowToDocument, extractPayloadFromDocument } = require('./developmentMapper');

const REVIEWED_CODES = new Set([...PLOT_TENURE_CODES].filter(code => code !== 'UNREVIEWED'));
const ALIASES = new Map([
  ['open market','OPEN_MARKET'],['private','OPEN_MARKET'],['market','OPEN_MARKET'],
  ['affordable rent','AFFORDABLE_RENT'],['social rent','AFFORDABLE_RENT'],['affordable housing','AFFORDABLE_RENT'],
  ['shared ownership','SHARED_OWNERSHIP'],['social shared','SHARED_OWNERSHIP'],['first homes','FIRST_HOMES'],
  ['additionality','ADDITIONALITY'],['discount market sale','DISCOUNT_MARKET_SALE'],['dms','DISCOUNT_MARKET_SALE'],['other','OTHER'],
]);
const sourceKey = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const fingerprint = plot => createHash('sha256').update(JSON.stringify({ id:String(plot.id||''), sourceTenure:String(plot.tenure??''), tenureCode:normalizePlotTenureCode(plot.tenureCode) })).digest('hex');

function buildReviewDocument(development) {
  const plots = development?.plotMaster?.plots;
  if (!Array.isArray(plots) || !plots.length) return { state:'missing', developmentId:development?.id||null, developmentVersion:Number(development?.version)||null, total:0, reviewed:0, needsAttention:0, cohorts:[] };
  const cohorts = new Map();
  for (const plot of plots) {
    const key = sourceKey(plot.tenure) || '__blank__';
    if (!cohorts.has(key)) cohorts.set(key, { key, sourceTenure:String(plot.tenure??''), sourceValues:new Set(), suggestedTenureCode:ALIASES.get(key)||null, plots:[] });
    const cohort = cohorts.get(key); cohort.sourceValues.add(String(plot.tenure??''));
    cohort.plots.push({ id:String(plot.id||''), plotNumber:String(plot.plotNumber||''), sourceTenure:String(plot.tenure??''), tenureCode:normalizePlotTenureCode(plot.tenureCode), sourceFingerprint:fingerprint(plot) });
  }
  const reviewed = plots.filter(plot => REVIEWED_CODES.has(normalizePlotTenureCode(plot.tenureCode))).length;
  return { state:reviewed===plots.length?'ready':'needs_attention', developmentId:development.id, developmentVersion:Number(development.version), total:plots.length, reviewed, needsAttention:plots.length-reviewed, cohorts:[...cohorts.values()].map(row=>({...row,sourceValues:[...row.sourceValues],plotCount:row.plots.length})) };
}

async function loadReview(clientId, developmentId) {
  const result=await pool.query('SELECT * FROM developments WHERE client_id=$1 AND id=$2',[clientId,developmentId]);
  if(!result.rowCount)return {ok:false,status:404,message:'Development not found.'};
  return {ok:true,status:200,review:buildReviewDocument(rowToDocument(result.rows[0]))};
}

async function applyReview(clientId, developmentId, body, auth) {
  const decisions=Array.isArray(body?.decisions)?body.decisions:[];
  const expectedVersion=Number(body?.developmentVersion);
  if(!Number.isInteger(expectedVersion)||expectedVersion<1)return {ok:false,status:400,message:'Development version is required.'};
  if(!decisions.length)return {ok:false,status:400,message:'At least one reviewed plot decision is required.'};
  const ids=new Set();
  for(const decision of decisions){const id=String(decision?.plotId||'');if(!id||ids.has(id))return {ok:false,status:400,message:'Every decision requires one unique stable plot identity.'};ids.add(id);if(!REVIEWED_CODES.has(String(decision.resultingTenureCode||'')))return {ok:false,status:400,message:'A valid reviewed tenure classification is required.'};}
  const db=await pool.connect();
  try{
    await db.query('BEGIN');
    const result=await db.query('SELECT * FROM developments WHERE client_id=$1 AND id=$2 FOR UPDATE',[clientId,developmentId]);
    if(!result.rowCount){await db.query('ROLLBACK');return {ok:false,status:404,message:'Development not found.'};}
    const current=rowToDocument(result.rows[0]);
    if(Number(current.version)!==expectedVersion){await db.query('ROLLBACK');return {ok:false,status:409,message:'Development version conflict.',review:buildReviewDocument(current)};}
    const plots=current.plotMaster?.plots;
    if(!Array.isArray(plots)){await db.query('ROLLBACK');return {ok:false,status:409,message:'Plot Master is missing.',review:buildReviewDocument(current)};}
    const byId=new Map(plots.map(plot=>[String(plot.id||''),plot]));
    const batchId=randomUUID(), now=new Date().toISOString(), nextVersion=expectedVersion+1, audited=[];
    for(const decision of decisions){
      const plot=byId.get(String(decision.plotId));
      if(!plot){await db.query('ROLLBACK');return {ok:false,status:409,message:'A reviewed plot no longer exists.',review:buildReviewDocument(current)};}
      const before=normalizePlotTenureCode(plot.tenureCode), currentFingerprint=fingerprint(plot);
      if(String(decision.sourceTenure??'')!==String(plot.tenure??'')||decision.sourceFingerprint!==currentFingerprint||normalizePlotTenureCode(decision.previousTenureCode)!==before){await db.query('ROLLBACK');return {ok:false,status:409,message:'Plot tenure evidence changed. Reload and review the current Plot Master.',review:buildReviewDocument(current)};}
      const after=String(decision.resultingTenureCode); if(after===before)continue;
      plot.tenureCode=after; plot.tenureReview={reviewBatchId:batchId,reviewedAt:now,userId:auth.userId,membershipId:auth.membershipId,providerUserId:auth.providerUserId,displayName:auth.displayName,roleKey:auth.roleKey};
      audited.push({plot,before,after,fingerprint:currentFingerprint});
    }
    if(!audited.length){await db.query('ROLLBACK');return {ok:false,status:400,message:'The reviewed decisions contain no changes.'};}
    current.plotMaster={...current.plotMaster,plots,updatedAt:now};
    const payload=extractPayloadFromDocument(current);
    const updated=await db.query('UPDATE developments SET payload=$1::jsonb,version=version+1,updated_at=NOW(),updated_by=$2 WHERE client_id=$3 AND id=$4 AND version=$5 RETURNING *',[JSON.stringify(payload),auth.displayName,clientId,developmentId,expectedVersion]);
    if(!updated.rowCount){await db.query('ROLLBACK');return {ok:false,status:409,message:'Development version conflict.'};}
    for(const item of audited)await db.query(`INSERT INTO plot_tenure_review_audit(review_batch_id,client_id,development_id,plot_id,source_tenure,source_fingerprint,previous_tenure_code,resulting_tenure_code,development_version_before,development_version_after,actor_user_id,actor_membership_id,actor_provider_user_id,actor_display_name,actor_role_key,actor_permission_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'plot_master.manage')`,[batchId,clientId,developmentId,String(item.plot.id),String(item.plot.tenure??''),item.fingerprint,item.before,item.after,expectedVersion,nextVersion,auth.userId,auth.membershipId,auth.providerUserId,auth.displayName,auth.roleKey]);
    await db.query('COMMIT'); const development=rowToDocument(updated.rows[0]);
    return {ok:true,status:200,reviewBatchId:batchId,applied:audited.length,development,review:buildReviewDocument(development)};
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}

module.exports={buildReviewDocument,loadReview,applyReview,sourceKey,fingerprint};
