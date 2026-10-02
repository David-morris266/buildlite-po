// server/app.js — Express app factory (no listen; used by server.js and tests)
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { isProduction } = require("./utils/env");
const { createClerkAuthAdapter, createTestAuthAdapter } = require('./auth/authAdapters');
const { createAuthenticationMiddleware,createInvitationAuthenticationMiddleware } = require('./auth/authMiddleware');
const { PERMISSIONS } = require('./auth/permissions');

const poRoutes = require("./routes/poRoutes");
const jobRoutes = require("./routes/jobRoutes");
const clientRoutes = require("./routes/clientRoutes");
const brandRoutes = require("./routes/brandRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const developmentRoutes = require("./routes/developmentRoutes");
const packageRoutes = require("./routes/packageRoutes");
const commercialEventRoutes = require("./routes/commercialEventRoutes");
const variationOrderRoutes = require("./routes/variationOrderRoutes");
const cvrRoutes = require("./routes/cvrRoutes");
const ledgerRoutes = require("./routes/ledgerRoutes");
const revenueSettingsRoutes = require("./routes/revenueSettingsRoutes");
const sellingCostsRoutes = require("./routes/sellingCostsRoutes");
const sellingCostsTemplateRoutes = require("./routes/sellingCostsTemplateRoutes");
const developmentProgrammeRoutes = require("./routes/developmentProgrammeRoutes");
const prelimsItemRoutes = require("./routes/prelimsItemRoutes");
const prelimsTemplateRoutes = require("./routes/prelimsTemplateRoutes");
const costCodeClassificationRoutes = require("./routes/costCodeClassificationRoutes");
const costCodeMasterRoutes = require("./routes/costCodeMasterRoutes");
const subcontractTermsRoutes = require("./routes/subcontractTermsRoutes");
const paymentNoticeRoutes = require("./routes/paymentNoticeRoutes");
const commercialDocumentRoutes = require("./routes/commercialDocumentRoutes");
const authRoutes = require('./routes/authRoutes');
const variationAccountRoutes = require('./routes/variationAccountRoutes');
const paymentAuthorityRoutes = require('./routes/paymentAuthorityRoutes');
const paymentReleaseRoutes = require('./routes/paymentReleaseRoutes');
const developmentBudgetRoutes = require('./routes/developmentBudgetRoutes');
const commercialStructureRoutes = require('./routes/commercialStructureRoutes');
const platformProvisioningRoutes=require('./routes/platformProvisioningRoutes');
const companySettingsRoutes=require('./routes/companySettingsRoutes');
const tenantMembershipRoutes=require('./routes/tenantMembershipRoutes');
const membershipInvitationRoutes=require('./routes/membershipInvitationRoutes');
const db = require('./db');
const { checkMigrationReadiness } = require('./services/migrationReadiness');
const { randomUUID } = require('crypto');

function allowedOrigins() {
  const configured = String(process.env.CORS_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  return new Set([...configured, ...(!isProduction() ? ['http://localhost:5173', 'http://127.0.0.1:5173'] : [])]);
}
function defaultTestPrincipal(req) {
  const requestedActor=req?.body?.approvedBy||req?.body?.issuedBy||req?.body?.actor||req?.body?.lockedBy||'Test Commercial Manager';
  return { userId:'00000000-0000-0000-0000-000000000001', providerUserId:'test-user', displayName:requestedActor, email:'test@example.invalid', clientId:req?.get?.('X-BuildLite-Client-Id')||null, membershipId:'00000000-0000-0000-0000-000000000002', roleKey:'commercial_manager', roleName:'Commercial Manager', capabilityKeys:[],permissions:[...new Set(Object.values(PERMISSIONS))], memberships:[] };
}

function createApp(options = {}) {
  const app = express();
  const errorLogger = options.errorLogger || console.error;
  const authAdapter = options.authAdapter || ((process.env.BUILDLITE_SERVER_TEST === '1' || process.env.NODE_ENV === 'test') ? createTestAuthAdapter(options.testPrincipal || defaultTestPrincipal) : createClerkAuthAdapter());
  const origins = allowedOrigins();

  app.use(
    cors({
      origin(origin, callback) { if (!origin || origins.has(origin)) return callback(null, true); return callback(new Error('Origin not allowed by BuildLite CORS policy.')); },
      methods: "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      allowedHeaders: "Content-Type, Authorization, X-BuildLite-Client-Id",
      credentials: true,
    })
  );
  app.use(express.json({ limit: "2mb" }));
  app.use((req, res, next) => {
    if (!isProduction() || req.path === '/health') return next();
    const sendJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode < 500 || body?.referenceId) return sendJson(body);
      const referenceId = randomUUID();
      errorLogger('[unexpected-error-response]', { referenceId, status: res.statusCode, body });
      return sendJson({ message: 'An unexpected server error occurred.', referenceId });
    };
    next();
  });
  app.locals.authAdapter=authAdapter;
  const readinessCheck = options.readinessCheck || (() => checkMigrationReadiness(db));
  app.get('/health', async (_req, res) => {
    const result = await readinessCheck();
    if (result.ready) return res.status(200).json({ status: 'ready', database: 'ready', migrations: 'ready', requiredFrontier: result.requiredFrontier });
    console.error('[health] BuildLite is not ready.', { category: result.category, error: result.error });
    return res.status(503).json({ status: 'not_ready', database: 'not_ready', reason: result.category });
  });
  app.use('/api/membership-invitations',...createInvitationAuthenticationMiddleware(authAdapter),membershipInvitationRoutes);
  app.use('/api', ...createAuthenticationMiddleware(authAdapter));
  app.use('/api/auth', authRoutes);
  app.use('/api/platform',platformProvisioningRoutes);
  app.use('/api/company-settings',companySettingsRoutes);
  app.use('/api/memberships',tenantMembershipRoutes);

  app.use("/api", poRoutes);
  app.use("/api/jobs", jobRoutes);
  app.use("/api/clients", clientRoutes);
  app.use("/api/brand", brandRoutes);
  app.use("/api/payments", paymentRoutes);
  app.use("/api/developments", developmentRoutes);
  app.use("/api/developments/:developmentId", cvrRoutes);
  app.use("/api/developments/:developmentId", ledgerRoutes);
  app.use("/api/developments/:developmentId", revenueSettingsRoutes);
  app.use("/api/developments/:developmentId", sellingCostsRoutes);
  app.use("/api/selling-costs-templates", sellingCostsTemplateRoutes);
  app.use("/api/developments/:developmentId", developmentProgrammeRoutes);
  app.use("/api/developments/:developmentId", developmentBudgetRoutes);
  app.use("/api/developments/:developmentId", prelimsItemRoutes);
  app.use("/api/prelims-templates", prelimsTemplateRoutes);
  app.use("/api/cost-code-classifications", costCodeClassificationRoutes);
  app.use("/api/cost-codes", costCodeMasterRoutes);
  app.use("/api/commercial-structure", commercialStructureRoutes);
  app.use("/api/packages", packageRoutes);
  app.use("/api/commercial-events", commercialEventRoutes);
  app.use("/api/variation-orders", variationOrderRoutes);
  app.use("/api/subcontract-terms", subcontractTermsRoutes);
  app.use("/api", paymentNoticeRoutes);
  app.use("/api/commercial-documents", commercialDocumentRoutes);
  app.use("/api/variation-account", variationAccountRoutes);
  app.use("/api/payment-authority", paymentAuthorityRoutes);
  app.use("/api/payment-releases", paymentReleaseRoutes);

  if (!isProduction()) {
    const developerRoutes = require("./routes/developerRoutes");
    app.use("/api/developer", developerRoutes);
  }

  if (options.configureRoutes) options.configureRoutes(app);

  app.use((req, res) => {
    res
      .status(404)
      .json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
  });

  app.use((error, _req, res, _next) => {
    const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 ? error.status : 500;
    if (status < 500) return res.status(status).json({ message: error.message, code: error.code });
    const referenceId = randomUUID();
    errorLogger('[unexpected-error]', { referenceId, error });
    const message = isProduction() ? 'An unexpected server error occurred.' : (error?.message || 'An unexpected server error occurred.');
    return res.status(500).json({ message, referenceId });
  });

  return app;
}

module.exports = createApp;
