function createClerkAuthAdapter() {
  const { clerkMiddleware, getAuth, clerkClient } = require('@clerk/express');
  const middleware = clerkMiddleware();
  return { middleware, identity(req) { const auth=getAuth(req); return auth?.isAuthenticated ? {provider:'clerk',providerUserId:auth.userId,sessionId:auth.sessionId} : null; },
    async verifiedIdentity(req){const identity=this.identity(req);if(!identity)return null;const user=await clerkClient.users.getUser(identity.providerUserId);const primary=user.emailAddresses?.find(item=>item.id===user.primaryEmailAddressId)||user.emailAddresses?.[0];if(primary?.verification?.status!=='verified')return null;return {...identity,email:String(primary?.emailAddress||'').trim().toLowerCase(),displayName:[user.firstName,user.lastName].filter(Boolean).join(' ')||primary?.emailAddress||'BuildLite user'};},
    async invitationIdentity(req){return this.verifiedIdentity(req);},
    async sendInvitation({email,redirectUrl}){const invitation=await clerkClient.invitations.createInvitation({emailAddress:email,redirectUrl,ignoreExisting:true});return invitation?.id||null;},
    async revokeInvitation(invitationId){if(!invitationId)return;await clerkClient.invitations.revokeInvitation(invitationId);} };
}

function createTestAuthAdapter(principal = null) {
  return { isTestAdapter:true, middleware(_req,_res,next){next();}, identity(req){const value=typeof principal==='function'?principal(req):principal;return value ? {provider:value.provider||'test',providerUserId:value.providerUserId||'test-user'} : null;}, principal(req){return typeof principal==='function'?principal(req):principal;}, async verifiedIdentity(req){const value=typeof principal==='function'?principal(req):principal;return value?{provider:value.provider||'clerk',providerUserId:value.providerUserId||'test-user',email:String(value.email||'').toLowerCase(),displayName:value.displayName||value.email||'Test user'}:null;},async invitationIdentity(req){return this.verifiedIdentity(req);},async sendInvitation(){return 'test-provider-invitation';},async revokeInvitation(){} };
}

module.exports={createClerkAuthAdapter,createTestAuthAdapter};
