const { resolveBuildLitePrincipal } = require('./authorization');
const { enterAuthContext } = require('./requestContext');

function createAuthenticationMiddleware(adapter) {
  return [adapter.middleware, async function buildLitePrincipal(req, res, next) {
    try {
      const direct = adapter.principal?.(req);
      if (direct) { req.buildliteAuth = direct; enterAuthContext(direct); return next(); }
      const identity = adapter.identity(req);
      if (!identity) return res.status(401).json({ message: 'Authentication required' });
      req.buildliteAuth = await resolveBuildLitePrincipal(identity, req.get('X-BuildLite-Client-Id') || null);
      enterAuthContext(req.buildliteAuth);
      next();
    } catch (error) { res.status(error.status || 500).json({ message: error.message, code: error.code }); }
  }];
}
module.exports = { createAuthenticationMiddleware };
