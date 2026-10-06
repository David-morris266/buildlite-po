const { resolveBuildLitePrincipal,resolvePlatformBootstrapPrincipal,isPlatformOperator } = require('./authorization');
const { enterAuthContext } = require('./requestContext');
const { timingStart,recordTiming } = require('../utils/safeTiming');

function createAuthenticationMiddleware(adapter) {
  return [adapter.middleware, async function buildLitePrincipal(req, res, next) {
    try {
      const direct = adapter.principal?.(req);
      if (direct) { req.buildliteAuth = direct; enterAuthContext(direct); return next(); }
      const identity = adapter.identity(req);
      if (!identity) return res.status(401).json({ message: 'Authentication required' });
      const requestedClientId=req.get('X-BuildLite-Client-Id')||null;
      const measured=/^\/api\/auth\/me\/?$/.test(req.originalUrl),principalStarted=measured?timingStart():null;
      try{req.buildliteAuth=await resolveBuildLitePrincipal(identity,requestedClientId);}
      catch(error){
        if(error.status!==403||!isPlatformOperator(identity.providerUserId))throw error;
        const verified=await adapter.verifiedIdentity?.(req);
        req.buildliteAuth=await resolvePlatformBootstrapPrincipal(verified,requestedClientId);
      }
      if(measured)recordTiming('server_principal_resolution',principalStarted);
      if(req.buildliteAuth.platformOnly&&!(/^\/auth\/me\/?$/.test(req.path)||req.path.startsWith('/platform/')))return res.status(403).json({message:'An active company membership is required.'});
      enterAuthContext(req.buildliteAuth);
      next();
    } catch (error) { res.status(error.status || 500).json({ message: error.message, code: error.code, memberships:error.memberships }); }
  }];
}
function createInvitationAuthenticationMiddleware(adapter){return [adapter.middleware,async function invitationIdentity(req,res,next){try{const identity=await adapter.invitationIdentity?.(req);if(!identity?.providerUserId||!identity?.email)return res.status(401).json({message:'Authenticated invitation identity is required.'});req.invitationIdentity=identity;next();}catch(error){res.status(error.status||500).json({message:error.message||'Invitation identity could not be verified.'});}}];}
module.exports = { createAuthenticationMiddleware,createInvitationAuthenticationMiddleware };
