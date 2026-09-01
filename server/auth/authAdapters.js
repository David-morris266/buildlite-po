function createClerkAuthAdapter() {
  const { clerkMiddleware, getAuth } = require('@clerk/express');
  const middleware = clerkMiddleware();
  return { middleware, identity(req) { const auth=getAuth(req); return auth?.isAuthenticated ? {provider:'clerk',providerUserId:auth.userId,sessionId:auth.sessionId} : null; } };
}

function createTestAuthAdapter(principal = null) {
  return { isTestAdapter:true, middleware(_req,_res,next){next();}, identity(req){const value=typeof principal==='function'?principal(req):principal;return value ? {provider:'test',providerUserId:value.providerUserId||'test-user'} : null;}, principal(req){return typeof principal==='function'?principal(req):principal;} };
}

module.exports={createClerkAuthAdapter,createTestAuthAdapter};
