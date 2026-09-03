const { pool, query } = require('../db');
const { assertServicePermission } = require('../auth/authorization');
const { PERMISSIONS } = require('../auth/permissions');

const text = value => String(value ?? '').trim();
const money = value => Math.round(Number(value) * 100) / 100;
const runWith = db => db?.query ? db.query.bind(db) : query;
const fail = (status, message) => ({ ok:false, status, message });

function requireActor(auth, permission) {
  assertServicePermission(auth, permission);
  if (!auth?.userId || !auth?.membershipId || !auth?.providerUserId) {
    const error = new Error('Authenticated BuildLite identity is required.');
    error.status = 401;
    throw error;
  }
}

function mapItem(row) {
  return row && {
    id:row.id, clientId:row.client_id, developmentId:row.development_id,
    packageId:row.package_id, costCode:row.cost_code, reference:row.variation_reference,
    contractorReference:row.contractor_reference, description:row.description,
    contractorValue:row.current_contractor_value == null ? null : Number(row.current_contractor_value),
    qsForecast:Number(row.current_qs_forecast), status:row.status, version:Number(row.version),
    createdAt:row.created_at, updatedAt:row.updated_at,
    createdBy:{ userId:row.created_by_user_id, membershipId:row.created_by_membership_id,
      providerUserId:row.created_by_provider_user_id, displayName:row.created_by_display_name },
  };
}

async function allocateReference(db, clientId, packageId) {
  const { rows } = await db.query(
    `INSERT INTO package_variation_account_sequences(client_id,package_id,next_number) VALUES($1,$2,2)
     ON CONFLICT(client_id,package_id) DO UPDATE SET next_number=package_variation_account_sequences.next_number+1
     RETURNING next_number-1 allocated`, [clientId,packageId]);
  return `VA-${String(rows[0].allocated).padStart(4,'0')}`;
}

async function listItems(clientId, { packageId, status = null } = {}, auth, db = null) {
  requireActor(auth, PERMISSIONS.VARIATION_ACCOUNT_VIEW);
  if (!packageId) return [];
  const params=[clientId,packageId]; let suffix='';
  if (status) { params.push(status); suffix=` AND status=$${params.length}`; }
  const { rows } = await runWith(db)(
    `SELECT * FROM package_variation_account_items WHERE client_id=$1 AND package_id=$2${suffix} ORDER BY created_at,id`,params);
  const items=rows.map(mapItem);
  const authority=require('./variationAccountAuthorityRepository');
  return Promise.all(items.map(async item=>({...item,authority:await authority.getProjection(clientId,item.id,auth,db)})));
}

async function getItem(clientId, id, auth, db = null) {
  requireActor(auth, PERMISSIONS.VARIATION_ACCOUNT_VIEW);
  const run=runWith(db);
  const { rows }=await run('SELECT * FROM package_variation_account_items WHERE client_id=$1 AND id=$2',[clientId,id]);
  if (!rows[0]) return null;
  const [forecasts,positions,lifecycle,compatibility]=await Promise.all([
    run('SELECT * FROM package_variation_account_forecast_history WHERE client_id=$1 AND variation_account_item_id=$2 ORDER BY created_at,id',[clientId,id]),
    run('SELECT * FROM package_variation_account_contractor_positions WHERE client_id=$1 AND variation_account_item_id=$2 ORDER BY created_at,id',[clientId,id]),
    run('SELECT * FROM package_variation_account_lifecycle_audit WHERE client_id=$1 AND variation_account_item_id=$2 ORDER BY created_at,id',[clientId,id]),
    run('SELECT payment_discovered_item_id,linked_at FROM package_variation_account_payment_discovered_links WHERE client_id=$1 AND variation_account_item_id=$2 ORDER BY linked_at,id',[clientId,id]),
  ]);
  const mapped=mapItem(rows[0]);
  const authority=await require('./variationAccountAuthorityRepository').getProjection(clientId,id,auth,db);
  return {...mapped,authority,
    forecastHistory:forecasts.rows.map(row=>({id:row.id,priorValue:row.prior_qs_forecast==null?null:Number(row.prior_qs_forecast),newValue:Number(row.new_qs_forecast),reason:row.reason,itemVersion:Number(row.item_version),at:row.created_at,actor:{userId:row.actor_user_id,membershipId:row.actor_membership_id,providerUserId:row.actor_provider_user_id,displayName:row.actor_display_name}})),
    contractorPositionHistory:positions.rows.map(row=>({id:row.id,value:Number(row.contractor_value),contractorReference:row.contractor_reference,sourceType:row.source_type,sourceId:row.source_id,reason:row.reason,itemVersion:Number(row.item_version),at:row.created_at})),
    lifecycleHistory:lifecycle.rows.map(row=>({id:row.id,action:row.action,priorStatus:row.prior_status,newStatus:row.new_status,reason:row.reason,itemVersion:Number(row.item_version),at:row.created_at})),
    paymentDiscoveredLinks:compatibility.rows.map(row=>({paymentDiscoveredItemId:row.payment_discovered_item_id,linkedAt:row.linked_at})),
  };
}

function readerAuth(auth) {
  return {...auth,permissions:[...new Set([...(auth.permissions||[]),PERMISSIONS.VARIATION_ACCOUNT_VIEW])]};
}

async function createItem(clientId, packageId, body, auth) {
  requireActor(auth, PERMISSIONS.VARIATION_ACCOUNT_CREATE);
  const description=text(body.description), forecast=Number(body.qsForecast);
  const contractor=body.contractorValue==null||body.contractorValue===''?null:Number(body.contractorValue);
  if(!description)return fail(400,'Description is required.');
  if(!Number.isFinite(forecast))return fail(400,'QS Forecast must be a valid signed amount.');
  if(contractor!=null&&!Number.isFinite(contractor))return fail(400,'Contractor value must be a valid signed amount.');
  const db=await pool.connect();
  try {
    await db.query('BEGIN');
    const pkg=(await db.query('SELECT id,development_id,cost_code FROM packages WHERE client_id=$1 AND id=$2',[clientId,packageId])).rows[0];
    if(!pkg){await db.query('ROLLBACK');return fail(404,'Package not found.');}
    const reference=await allocateReference(db,clientId,packageId);
    const values={forecast:money(forecast),contractor:contractor==null?null:money(contractor),contractorReference:text(body.contractorReference)||null};
    const item=(await db.query(`INSERT INTO package_variation_account_items
      (client_id,development_id,package_id,cost_code,variation_reference,contractor_reference,description,current_contractor_value,current_qs_forecast,created_by_user_id,created_by_membership_id,created_by_provider_user_id,created_by_display_name)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [clientId,pkg.development_id,packageId,pkg.cost_code,reference,values.contractorReference,description,values.contractor,values.forecast,auth.userId,auth.membershipId,auth.providerUserId,auth.displayName])).rows[0];
    await db.query(`INSERT INTO package_variation_account_forecast_history
      (client_id,variation_account_item_id,prior_qs_forecast,new_qs_forecast,reason,item_version,actor_user_id,actor_membership_id,actor_provider_user_id,actor_display_name)
      VALUES($1,$2,NULL,$3,$4,1,$5,$6,$7,$8)`,[clientId,item.id,values.forecast,text(body.reason)||'Initial QS forecast',auth.userId,auth.membershipId,auth.providerUserId,auth.displayName]);
    if(values.contractor!=null)await db.query(`INSERT INTO package_variation_account_contractor_positions
      (client_id,variation_account_item_id,contractor_value,contractor_reference,reason,item_version,actor_user_id,actor_membership_id,actor_provider_user_id,actor_display_name)
      VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9)`,[clientId,item.id,values.contractor,values.contractorReference,text(body.contractorReason)||'Initial contractor position',auth.userId,auth.membershipId,auth.providerUserId,auth.displayName]);
    await db.query(`INSERT INTO package_variation_account_lifecycle_audit
      (client_id,variation_account_item_id,action,prior_status,new_status,reason,item_version,actor_user_id,actor_membership_id,actor_provider_user_id,actor_display_name)
      VALUES($1,$2,'created',NULL,'active',$3,1,$4,$5,$6,$7)`,[clientId,item.id,text(body.creationReason)||'Variation Account item created',auth.userId,auth.membershipId,auth.providerUserId,auth.displayName]);
    await db.query('COMMIT');
    return {ok:true,status:201,item:await getItem(clientId,item.id,readerAuth(auth))};
  } catch(error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
}

async function lockedItem(db,clientId,id,version) {
  const row=(await db.query('SELECT * FROM package_variation_account_items WHERE client_id=$1 AND id=$2 FOR UPDATE',[clientId,id])).rows[0];
  if(!row)return {error:fail(404,'Variation Account item not found.')};
  if(Number(version)!==Number(row.version))return {error:fail(409,'Variation Account item changed elsewhere. Refresh and retry.')};
  return {row,next:Number(row.version)+1};
}

async function updateForecast(clientId,id,body,auth) {
  requireActor(auth,PERMISSIONS.VARIATION_ACCOUNT_FORECAST_EDIT);
  const value=Number(body.qsForecast),reason=text(body.reason);
  if(!Number.isFinite(value)||!reason)return fail(400,'A valid signed QS Forecast and reason are required.');
  const db=await pool.connect();try{await db.query('BEGIN');const lock=await lockedItem(db,clientId,id,body.version);if(lock.error){await db.query('ROLLBACK');return lock.error;}if(lock.row.status==='withdrawn'){await db.query('ROLLBACK');return fail(409,'Withdrawn Variation Account items cannot be edited.');}
    const nextValue=money(value);await db.query('UPDATE package_variation_account_items SET current_qs_forecast=$3,version=$4,updated_at=NOW() WHERE client_id=$1 AND id=$2',[clientId,id,nextValue,lock.next]);
    await db.query(`INSERT INTO package_variation_account_forecast_history(client_id,variation_account_item_id,prior_qs_forecast,new_qs_forecast,reason,item_version,actor_user_id,actor_membership_id,actor_provider_user_id,actor_display_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[clientId,id,lock.row.current_qs_forecast,nextValue,reason,lock.next,auth.userId,auth.membershipId,auth.providerUserId,auth.displayName]);await db.query('COMMIT');return {ok:true,status:200,item:await getItem(clientId,id,readerAuth(auth))};
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}

async function recordContractorPosition(clientId,id,body,auth) {
  requireActor(auth,PERMISSIONS.VARIATION_ACCOUNT_FORECAST_EDIT);
  const value=Number(body.contractorValue),reason=text(body.reason);if(!Number.isFinite(value)||!reason)return fail(400,'A valid signed contractor value and reconciliation reason are required.');
  const db=await pool.connect();try{await db.query('BEGIN');const lock=await lockedItem(db,clientId,id,body.version);if(lock.error){await db.query('ROLLBACK');return lock.error;}if(lock.row.status==='withdrawn'){await db.query('ROLLBACK');return fail(409,'Withdrawn Variation Account items cannot be edited.');}
    const nextValue=money(value),contractorReference=text(body.contractorReference)||lock.row.contractor_reference;await db.query('UPDATE package_variation_account_items SET current_contractor_value=$3,contractor_reference=$4,version=$5,updated_at=NOW() WHERE client_id=$1 AND id=$2',[clientId,id,nextValue,contractorReference,lock.next]);
    await db.query(`INSERT INTO package_variation_account_contractor_positions(client_id,variation_account_item_id,contractor_value,contractor_reference,reason,item_version,actor_user_id,actor_membership_id,actor_provider_user_id,actor_display_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[clientId,id,nextValue,contractorReference,reason,lock.next,auth.userId,auth.membershipId,auth.providerUserId,auth.displayName]);await db.query('COMMIT');return {ok:true,status:200,item:await getItem(clientId,id,readerAuth(auth))};
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}

async function transitionItem(clientId,id,action,body,auth) {
  requireActor(auth,PERMISSIONS.VARIATION_ACCOUNT_RESOLVE);
  const rules={resolve:['active','resolved','resolved'],reopen:['resolved','active','reopened'],withdraw:['active','withdrawn','withdrawn']};const rule=rules[action],reason=text(body.reason);if(!rule)return fail(400,'Unsupported lifecycle action.');if(!reason)return fail(400,'A reason is required.');
  const db=await pool.connect();try{await db.query('BEGIN');const lock=await lockedItem(db,clientId,id,body.version);if(lock.error){await db.query('ROLLBACK');return lock.error;}if(lock.row.status!==rule[0]){await db.query('ROLLBACK');return fail(409,`Only ${rule[0]} Variation Account items can ${action}.`);}
    await db.query('UPDATE package_variation_account_items SET status=$3,version=$4,updated_at=NOW() WHERE client_id=$1 AND id=$2',[clientId,id,rule[1],lock.next]);await db.query(`INSERT INTO package_variation_account_lifecycle_audit(client_id,variation_account_item_id,action,prior_status,new_status,reason,item_version,actor_user_id,actor_membership_id,actor_provider_user_id,actor_display_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[clientId,id,rule[2],lock.row.status,rule[1],reason,lock.next,auth.userId,auth.membershipId,auth.providerUserId,auth.displayName]);await db.query('COMMIT');return {ok:true,status:200,item:await getItem(clientId,id,readerAuth(auth))};
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}

module.exports={listItems,getItem,createItem,updateForecast,recordContractorPosition,transitionItem,mapItem};
