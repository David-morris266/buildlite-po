const { query, pool } = require('../db');

function forbidden(message = 'Forbidden') { const error = new Error(message); error.status = 403; return error; }
function unauthenticated(message = 'Authentication required') { const error = new Error(message); error.status = 401; return error; }

async function resolveBuildLitePrincipal(identity, requestedClientId = null, db = null) {
  if (!identity?.providerUserId) throw unauthenticated();
  const run = db?.query ? db.query.bind(db) : query;
  const userResult = await run(`SELECT * FROM buildlite_users WHERE auth_provider=$1 AND provider_user_id=$2`, [identity.provider || 'clerk', identity.providerUserId]);
  const user = userResult.rows[0];
  if (!user || user.status !== 'active') throw forbidden('BuildLite user is inactive or not provisioned.');
  const membershipResult = await run(`SELECT m.id membership_id,m.client_id,m.is_active,m.version,r.key role_key,r.name role_name,c.code client_code,c.name client_name,
    COALESCE(array_agg(DISTINCT effective.permission_key) FILTER (WHERE effective.permission_key IS NOT NULL),'{}') permissions,
    COALESCE(array_agg(DISTINCT mc.capability_key) FILTER (WHERE mc.is_active),'{}') capability_keys
    FROM client_user_memberships m JOIN clients c ON c.id=m.client_id JOIN roles r ON r.id=m.role_id
    LEFT JOIN LATERAL (SELECT rp.permission_key FROM role_permissions rp WHERE rp.role_id=r.id UNION SELECT cp.permission_key FROM client_user_membership_capabilities cm JOIN membership_capability_permissions cp ON cp.capability_key=cm.capability_key WHERE cm.client_id=m.client_id AND cm.membership_id=m.id AND cm.is_active) effective ON true
    LEFT JOIN client_user_membership_capabilities mc ON mc.client_id=m.client_id AND mc.membership_id=m.id
    WHERE m.user_id=$1 GROUP BY m.id,r.id,c.id ORDER BY m.created_at,m.id`, [user.id]);
  const active = membershipResult.rows.filter(row => row.is_active);
  let membership = requestedClientId ? active.find(row => String(row.client_id) === String(requestedClientId)) : active.length === 1 ? active[0] : null;
  if (!membership) {
    if (requestedClientId) throw forbidden('You do not have an active membership for this tenant.');
    if (!active.length) throw forbidden('No active tenant membership.');
    const error = new Error('Select an authorized company for this request.'); error.status = 409; error.code = 'TENANT_SELECTION_REQUIRED'; error.memberships=active.map(row=>({id:row.membership_id,clientId:row.client_id,clientCode:row.client_code,clientName:row.client_name,roleKey:row.role_key,roleName:row.role_name})); throw error;
  }
  return { userId:user.id,provider:identity.provider||'clerk',providerUserId:identity.providerUserId,displayName:user.display_name,
    email:user.email_snapshot,clientId:membership.client_id,membershipId:membership.membership_id,roleKey:membership.role_key,
    roleName:membership.role_name,membershipVersion:Number(membership.version||1),capabilityKeys:[...(membership.capability_keys||[])],permissions:[...(membership.permissions||[])],platformPermissions:platformPermissions(identity.providerUserId),memberships:active.map(row=>({id:row.membership_id,clientId:row.client_id,clientCode:row.client_code,clientName:row.client_name,roleKey:row.role_key,roleName:row.role_name,capabilityKeys:[...(row.capability_keys||[])]})) };
}
function platformPermissions(providerUserId){return String(process.env.BUILDLITE_PLATFORM_OPERATOR_IDS||'').split(',').map(x=>x.trim()).filter(Boolean).includes(String(providerUserId||''))?['platform.tenant_provision']:[];}
function isPlatformOperator(providerUserId){return platformPermissions(providerUserId).includes('platform.tenant_provision');}
async function resolvePlatformBootstrapPrincipal(identity,requestedClientId=null){
  if(!identity?.providerUserId||identity.provider!=='clerk'||!identity.email||!identity.displayName)throw forbidden('Verified Clerk identity is required for platform bootstrap.');
  if(!isPlatformOperator(identity.providerUserId))throw forbidden('BuildLite user is inactive or not provisioned.');
  if(requestedClientId)throw forbidden('You do not have an active membership for this tenant.');
  const email=String(identity.email).trim().toLowerCase(),displayName=String(identity.displayName).trim();
  if(!email.includes('@')||!displayName)throw forbidden('Verified Clerk identity is required for platform bootstrap.');
  const c=await pool.connect();let user;
  try{
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`platform-bootstrap:${identity.providerUserId}`]);
    user=(await c.query(`SELECT * FROM buildlite_users WHERE auth_provider='clerk' AND provider_user_id=$1 FOR UPDATE`,[identity.providerUserId])).rows[0];
    const emailUsers=(await c.query(`SELECT * FROM buildlite_users WHERE lower(email_snapshot)=$1 FOR UPDATE`,[email])).rows;
    if(emailUsers.some(item=>item.auth_provider!=='clerk'||item.provider_user_id!==identity.providerUserId))throw Object.assign(new Error('Verified Clerk identity conflicts with an existing BuildLite identity.'),{status:409});
    if(user&&user.status!=='active')throw forbidden('BuildLite user is inactive or not provisioned.');
    if(!user)user=(await c.query(`INSERT INTO buildlite_users(auth_provider,provider_user_id,email_snapshot,display_name,status) VALUES('clerk',$1,$2,$3,'active') RETURNING *`,[identity.providerUserId,email,displayName])).rows[0];
    await c.query(`INSERT INTO platform_identity_bootstrap_audit(user_id,auth_provider,provider_user_id,email_snapshot,display_name,authority) VALUES($1,'clerk',$2,$3,$4,'platform.tenant_provision') ON CONFLICT(user_id) DO NOTHING`,[user.id,identity.providerUserId,email,displayName]);
    await c.query('COMMIT');
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
  const active=Number((await query('SELECT count(*)::int count FROM client_user_memberships WHERE user_id=$1 AND is_active',[user.id])).rows[0].count);
  if(active)return resolveBuildLitePrincipal({provider:'clerk',providerUserId:identity.providerUserId},null);
  return {userId:user.id,provider:'clerk',providerUserId:identity.providerUserId,displayName:user.display_name,email:user.email_snapshot,clientId:null,membershipId:null,roleKey:null,roleName:null,membershipVersion:null,capabilityKeys:[],permissions:[],platformPermissions:['platform.tenant_provision'],memberships:[],platformOnly:true};
}
function assertPlatformPermission(auth,permission){if(!auth?.platformPermissions?.includes(permission))throw forbidden(`Platform permission required: ${permission}`);}

function hasPermission(auth, permission) { return Boolean(auth?.permissions?.includes(permission)); }
function assertPermission(auth, permission) { if (!auth?.userId) throw unauthenticated(); if (!hasPermission(auth,permission)) throw forbidden(`Permission required: ${permission}`); return auth; }
function assertServicePermission(auth, permission) {
  const legacyTestCall=(process.env.BUILDLITE_SERVER_TEST==='1'||process.env.NODE_ENV==='test')&&process.env.BUILDLITE_STRICT_SERVICE_AUTH!=='1';
  if(legacyTestCall&&!auth)return null;
  return assertPermission(auth,permission);
}
async function recordAuthorization(auth,permission,req) {
  try {
    await query(`INSERT INTO authorization_action_audit(client_id,user_id,membership_id,provider_user_id,display_name,role_key,permission_key,request_method,request_path,resource_params)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[auth.clientId,auth.userId,auth.membershipId,auth.providerUserId,auth.displayName,auth.roleKey,permission,req.method,req.baseUrl+req.path,JSON.stringify(req.params||{})]);
  } catch(error) {
    if(process.env.BUILDLITE_SERVER_TEST==='1'||process.env.NODE_ENV==='test')return;
    throw error;
  }
}
function requirePermission(permission) { return async (req,res,next)=>{ try { assertPermission(req.buildliteAuth,permission); await recordAuthorization(req.buildliteAuth,permission,req); req.requiredPermission=permission; next(); } catch(error) { res.status(error.status||500).json({message:error.message,code:error.code}); } }; }
function requireAuthenticated(req,res,next) { if(!req.buildliteAuth)return res.status(401).json({message:'Authentication required'}); next(); }
function actorFromAuth(auth, permission = null) { if(!auth?.userId)throw unauthenticated(); return { actor:auth.displayName, actorEnvelope:{userId:auth.userId,displayName:auth.displayName,membershipId:auth.membershipId,roleKey:auth.roleKey,permission:permission||null,providerUserId:auth.providerUserId} }; }

module.exports={resolveBuildLitePrincipal,resolvePlatformBootstrapPrincipal,hasPermission,assertPermission,assertPlatformPermission,platformPermissions,isPlatformOperator,assertServicePermission,requirePermission,requireAuthenticated,actorFromAuth,unauthenticated,forbidden};
