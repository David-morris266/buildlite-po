const { pool, query } = require('../db');
const { assertServicePermission } = require('../auth/authorization');
const { PERMISSIONS } = require('../auth/permissions');

const fail=(status,message)=>({ok:false,status,message});
const text=value=>String(value??'').trim();
const amount=value=>Math.round(Number(value)*100)/100;
const actor=(auth)=>[auth.userId,auth.membershipId,auth.providerUserId,auth.displayName];

function requirePermission(auth,key){
  assertServicePermission(auth,key);
  if(!auth?.userId||!auth?.membershipId||!auth?.providerUserId)throw Object.assign(new Error('Authenticated BuildLite identity is required.'),{status:401});
}
function mapLine(row){return row&&{
  id:row.id,applicationId:row.application_id,packageId:row.package_id,variationAccountItemId:row.variation_account_item_id,
  contractorReference:row.contractor_reference,description:row.contractor_description,
  contractorValue:Number(row.contractor_variation_value),previousClaim:Number(row.previous_claim),currentClaim:Number(row.current_claim),
  cumulativeClaim:Number(row.cumulative_claim),reconciliationState:row.reconciliation_state,
  createdAt:row.created_at,createdBy:{userId:row.created_by_user_id,membershipId:row.created_by_membership_id,providerUserId:row.created_by_provider_user_id,displayName:row.created_by_display_name},
};}
async function loadEditableApplication(db,clientId,packageId,applicationId){
  const row=(await db.query(`SELECT a.*,c.status certificate_status FROM subcontract_payment_applications a
    LEFT JOIN package_payment_certificates c ON c.id=a.certificate_id AND c.client_id=a.client_id
    WHERE a.client_id=$1 AND a.package_id=$2 AND a.id=$3 FOR UPDATE OF a`,[clientId,packageId,applicationId])).rows[0];
  if(!row)return {error:fail(404,'Application not found.')};
  if(row.status!=='recorded'||(row.certificate_id&&row.certificate_status!=='draft'))return {error:fail(409,'Frozen or superseded application variation evidence is immutable.')};
  return {row};
}
async function listLines(clientId,packageId,applicationId,auth,db=null){
  requirePermission(auth,PERMISSIONS.VARIATION_ACCOUNT_VIEW);const run=db?.query?db.query.bind(db):query;
  const app=(await run('SELECT id FROM subcontract_payment_applications WHERE client_id=$1 AND package_id=$2 AND id=$3',[clientId,packageId,applicationId])).rows[0];
  if(!app)return fail(404,'Application not found.');
  const rows=(await run(`SELECT l.*,v.variation_reference,v.current_qs_forecast,v.current_contractor_value
    FROM subcontract_payment_application_variation_lines l LEFT JOIN package_variation_account_items v ON v.id=l.variation_account_item_id
    WHERE l.client_id=$1 AND l.package_id=$2 AND l.application_id=$3 ORDER BY l.created_at,l.id`,[clientId,packageId,applicationId])).rows;
  return {ok:true,status:200,lines:rows.map(row=>({...mapLine(row),matchedVariation:row.variation_account_item_id?{reference:row.variation_reference,qsForecast:Number(row.current_qs_forecast),confirmedContractorValue:row.current_contractor_value==null?null:Number(row.current_contractor_value)}:null}))};
}
function validateLine(body){
  const description=text(body.description),values=['contractorValue','previousClaim','currentClaim','cumulativeClaim'].map(key=>Number(body[key]));
  if(!description)return fail(400,'Contractor description is required.');if(values.some(v=>!Number.isFinite(v)))return fail(400,'All variation and claim values must be valid signed amounts.');
  const [contractorValue,previousClaim,currentClaim,cumulativeClaim]=values.map(amount);
  if(amount(previousClaim+currentClaim)!==cumulativeClaim)return fail(400,'Previous claim plus this claim must equal cumulative claim.');
  return {ok:true,description,contractorValue,previousClaim,currentClaim,cumulativeClaim};
}
async function addLine(clientId,packageId,applicationId,body,auth){
  requirePermission(auth,PERMISSIONS.VARIATION_ACCOUNT_CREATE);const valid=validateLine(body);if(!valid.ok)return valid;const db=await pool.connect();
  try{await db.query('BEGIN');const app=await loadEditableApplication(db,clientId,packageId,applicationId);if(app.error){await db.query('ROLLBACK');return app.error;}
    const row=(await db.query(`INSERT INTO subcontract_payment_application_variation_lines
      (client_id,application_id,package_id,contractor_reference,contractor_description,contractor_variation_value,previous_claim,current_claim,cumulative_claim,created_by_user_id,created_by_membership_id,created_by_provider_user_id,created_by_display_name)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[clientId,applicationId,packageId,text(body.contractorReference)||null,valid.description,valid.contractorValue,valid.previousClaim,valid.currentClaim,valid.cumulativeClaim,...actor(auth)])).rows[0];
    await db.query(`INSERT INTO subcontract_payment_application_variation_audit(client_id,line_id,action,detail,actor_user_id,actor_membership_id,actor_provider_user_id,actor_display_name) VALUES($1,$2,'recorded',$3,$4,$5,$6,$7)`,[clientId,row.id,JSON.stringify({applicationRevision:app.row.revision_number}),...actor(auth)]);await db.query('COMMIT');return {ok:true,status:201,line:mapLine(row)};
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
async function lockLine(db,clientId,packageId,applicationId,lineId){const app=await loadEditableApplication(db,clientId,packageId,applicationId);if(app.error)return app;const row=(await db.query('SELECT * FROM subcontract_payment_application_variation_lines WHERE client_id=$1 AND package_id=$2 AND application_id=$3 AND id=$4 FOR UPDATE',[clientId,packageId,applicationId,lineId])).rows[0];return row?{row,application:app.row}:{error:fail(404,'Application variation line not found.')};}
async function matchLine(clientId,packageId,applicationId,lineId,itemId,auth){
  requirePermission(auth,PERMISSIONS.VARIATION_ACCOUNT_CREATE);const db=await pool.connect();try{await db.query('BEGIN');const lock=await lockLine(db,clientId,packageId,applicationId,lineId);if(lock.error){await db.query('ROLLBACK');return lock.error;}
    const item=(await db.query('SELECT * FROM package_variation_account_items WHERE client_id=$1 AND package_id=$2 AND id=$3',[clientId,packageId,itemId])).rows[0];if(!item){await db.query('ROLLBACK');return fail(404,'Variation Account item not found for this package.');}
    const row=(await db.query(`UPDATE subcontract_payment_application_variation_lines SET variation_account_item_id=$1,reconciliation_state='matched',updated_at=NOW() WHERE id=$2 RETURNING *`,[itemId,lineId])).rows[0];
    await db.query(`INSERT INTO subcontract_payment_application_variation_audit(client_id,line_id,action,detail,actor_user_id,actor_membership_id,actor_provider_user_id,actor_display_name) VALUES($1,$2,'matched',$3,$4,$5,$6,$7)`,[clientId,lineId,JSON.stringify({variationAccountItemId:itemId,reference:item.variation_reference}),...actor(auth)]);await db.query('COMMIT');return {ok:true,status:200,line:{...mapLine(row),matchedVariation:{reference:item.variation_reference,qsForecast:Number(item.current_qs_forecast),confirmedContractorValue:item.current_contractor_value==null?null:Number(item.current_contractor_value)}}};
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
async function allocateReference(db,clientId,packageId){const row=(await db.query(`INSERT INTO package_variation_account_sequences(client_id,package_id,next_number) VALUES($1,$2,2) ON CONFLICT(client_id,package_id) DO UPDATE SET next_number=package_variation_account_sequences.next_number+1 RETURNING next_number-1 n`,[clientId,packageId])).rows[0];return `VA-${String(row.n).padStart(4,'0')}`;}
async function createVariation(clientId,packageId,applicationId,lineId,body,auth){
  requirePermission(auth,PERMISSIONS.VARIATION_ACCOUNT_CREATE);const forecast=Number(body.qsForecast),reason=text(body.reason);if(!Number.isFinite(forecast)||!reason)return fail(400,'A deliberate signed QS Forecast and reason are required.');const db=await pool.connect();
  try{await db.query('BEGIN');const lock=await lockLine(db,clientId,packageId,applicationId,lineId);if(lock.error){await db.query('ROLLBACK');return lock.error;}if(lock.row.variation_account_item_id){await db.query('ROLLBACK');return fail(409,'Application line is already matched.');}
    const pkg=(await db.query('SELECT * FROM packages WHERE client_id=$1 AND id=$2',[clientId,packageId])).rows[0],reference=await allocateReference(db,clientId,packageId),nextForecast=amount(forecast);
    const item=(await db.query(`INSERT INTO package_variation_account_items(client_id,development_id,package_id,cost_code,variation_reference,contractor_reference,description,current_contractor_value,current_qs_forecast,created_by_user_id,created_by_membership_id,created_by_provider_user_id,created_by_display_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[clientId,pkg.development_id,packageId,pkg.cost_code,reference,lock.row.contractor_reference,lock.row.contractor_description,lock.row.contractor_variation_value,nextForecast,...actor(auth)])).rows[0];
    await db.query(`INSERT INTO package_variation_account_forecast_history(client_id,variation_account_item_id,prior_qs_forecast,new_qs_forecast,reason,item_version,actor_user_id,actor_membership_id,actor_provider_user_id,actor_display_name) VALUES($1,$2,NULL,$3,$4,1,$5,$6,$7,$8)`,[clientId,item.id,nextForecast,reason,...actor(auth)]);
    await db.query(`INSERT INTO package_variation_account_contractor_positions(client_id,variation_account_item_id,contractor_value,contractor_reference,source_type,source_id,reason,item_version,actor_user_id,actor_membership_id,actor_provider_user_id,actor_display_name) VALUES($1,$2,$3,$4,'application_line',$5,$6,1,$7,$8,$9,$10)`,[clientId,item.id,lock.row.contractor_variation_value,lock.row.contractor_reference,lineId,'Created explicitly from application variation line',...actor(auth)]);
    await db.query(`INSERT INTO package_variation_account_lifecycle_audit(client_id,variation_account_item_id,action,new_status,reason,item_version,actor_user_id,actor_membership_id,actor_provider_user_id,actor_display_name) VALUES($1,$2,'created','active',$3,1,$4,$5,$6,$7)`,[clientId,item.id,`Created from application line ${lineId}`,...actor(auth)]);
    const line=(await db.query(`UPDATE subcontract_payment_application_variation_lines SET variation_account_item_id=$1,reconciliation_state='matched',updated_at=NOW() WHERE id=$2 RETURNING *`,[item.id,lineId])).rows[0];
    await db.query(`INSERT INTO subcontract_payment_application_variation_audit(client_id,line_id,action,detail,actor_user_id,actor_membership_id,actor_provider_user_id,actor_display_name) VALUES($1,$2,'created_variation',$3,$4,$5,$6,$7)`,[clientId,lineId,JSON.stringify({variationAccountItemId:item.id,reference}),...actor(auth)]);await db.query('COMMIT');return {ok:true,status:201,line:{...mapLine(line),matchedVariation:{reference,qsForecast:nextForecast,confirmedContractorValue:Number(lock.row.contractor_variation_value)}},itemId:item.id};
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
async function confirmContractorPosition(clientId,packageId,applicationId,lineId,body,auth){
  requirePermission(auth,PERMISSIONS.VARIATION_ACCOUNT_FORECAST_EDIT);const reason=text(body.reason);if(!reason)return fail(400,'A reconciliation reason is required.');const db=await pool.connect();try{await db.query('BEGIN');const lock=await lockLine(db,clientId,packageId,applicationId,lineId);if(lock.error){await db.query('ROLLBACK');return lock.error;}if(!lock.row.variation_account_item_id){await db.query('ROLLBACK');return fail(409,'Match the application line before confirming its contractor position.');}
    const item=(await db.query('SELECT * FROM package_variation_account_items WHERE client_id=$1 AND package_id=$2 AND id=$3 FOR UPDATE',[clientId,packageId,lock.row.variation_account_item_id])).rows[0],next=Number(item.version)+1;
    await db.query('UPDATE package_variation_account_items SET current_contractor_value=$1,contractor_reference=$2,version=$3,updated_at=NOW() WHERE id=$4',[lock.row.contractor_variation_value,lock.row.contractor_reference,next,item.id]);
    await db.query(`INSERT INTO package_variation_account_contractor_positions(client_id,variation_account_item_id,contractor_value,contractor_reference,source_type,source_id,reason,item_version,actor_user_id,actor_membership_id,actor_provider_user_id,actor_display_name) VALUES($1,$2,$3,$4,'application_line',$5,$6,$7,$8,$9,$10,$11)`,[clientId,item.id,lock.row.contractor_variation_value,lock.row.contractor_reference,lineId,reason,next,...actor(auth)]);
    await db.query(`INSERT INTO subcontract_payment_application_variation_audit(client_id,line_id,action,detail,actor_user_id,actor_membership_id,actor_provider_user_id,actor_display_name) VALUES($1,$2,'contractor_position_confirmed',$3,$4,$5,$6,$7)`,[clientId,lineId,JSON.stringify({variationAccountItemId:item.id,priorContractorValue:item.current_contractor_value,newContractorValue:lock.row.contractor_variation_value,itemVersion:next}),...actor(auth)]);await db.query('COMMIT');return {ok:true,status:200};
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
module.exports={listLines,addLine,matchLine,createVariation,confirmContractorPosition,mapLine};
