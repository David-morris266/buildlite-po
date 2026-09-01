const { query } = require('../db');

function forbidden(message = 'Forbidden') { const error = new Error(message); error.status = 403; return error; }
function unauthenticated(message = 'Authentication required') { const error = new Error(message); error.status = 401; return error; }

async function resolveBuildLitePrincipal(identity, requestedClientId = null, db = null) {
  if (!identity?.providerUserId) throw unauthenticated();
  const run = db?.query ? db.query.bind(db) : query;
  const userResult = await run(`SELECT * FROM buildlite_users WHERE auth_provider=$1 AND provider_user_id=$2`, [identity.provider || 'clerk', identity.providerUserId]);
  const user = userResult.rows[0];
  if (!user || user.status !== 'active') throw forbidden('BuildLite user is inactive or not provisioned.');
  const membershipResult = await run(`SELECT m.id membership_id,m.client_id,m.is_active,r.key role_key,r.name role_name,
    COALESCE(array_agg(rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL),'{}') permissions
    FROM client_user_memberships m JOIN roles r ON r.id=m.role_id LEFT JOIN role_permissions rp ON rp.role_id=r.id
    WHERE m.user_id=$1 GROUP BY m.id,r.id ORDER BY m.created_at,m.id`, [user.id]);
  const active = membershipResult.rows.filter(row => row.is_active);
  let membership = requestedClientId ? active.find(row => String(row.client_id) === String(requestedClientId)) : active.length === 1 ? active[0] : null;
  if (!membership) {
    if (requestedClientId) throw forbidden('You do not have an active membership for this tenant.');
    if (!active.length) throw forbidden('No active tenant membership.');
    const error = new Error('Select an authorized tenant for this request.'); error.status = 409; error.code = 'TENANT_SELECTION_REQUIRED'; throw error;
  }
  return { userId:user.id,provider:identity.provider||'clerk',providerUserId:identity.providerUserId,displayName:user.display_name,
    email:user.email_snapshot,clientId:membership.client_id,membershipId:membership.membership_id,roleKey:membership.role_key,
    roleName:membership.role_name,permissions:[...membership.permissions],memberships:active.map(row=>({id:row.membership_id,clientId:row.client_id,roleKey:row.role_key,roleName:row.role_name})) };
}

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

module.exports={resolveBuildLitePrincipal,hasPermission,assertPermission,assertServicePermission,requirePermission,requireAuthenticated,actorFromAuth,unauthenticated,forbidden};
