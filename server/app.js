// server/app.js — Express app factory (no listen; used by server.js and tests)
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { isProduction } = require("./utils/env");
const { createClerkAuthAdapter, createTestAuthAdapter } = require('./auth/authAdapters');
const { createAuthenticationMiddleware } = require('./auth/authMiddleware');
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
const developmentProgrammeRoutes = require("./routes/developmentProgrammeRoutes");
const prelimsItemRoutes = require("./routes/prelimsItemRoutes");
const prelimsTemplateRoutes = require("./routes/prelimsTemplateRoutes");
const costCodeClassificationRoutes = require("./routes/costCodeClassificationRoutes");
const costCodeMasterRoutes = require("./routes/costCodeMasterRoutes");
const subcontractTermsRoutes = require("./routes/subcontractTermsRoutes");
const paymentNoticeRoutes = require("./routes/paymentNoticeRoutes");
const commercialDocumentRoutes = require("./routes/commercialDocumentRoutes");
const authRoutes = require('./routes/authRoutes');

function allowedOrigins() {
  const configured = String(process.env.CORS_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  return new Set([...configured, ...(!isProduction() ? ['http://localhost:5173', 'http://127.0.0.1:5173'] : [])]);
}
function defaultTestPrincipal(req) {
  const requestedActor=req?.body?.approvedBy||req?.body?.issuedBy||req?.body?.actor||req?.body?.lockedBy||'Test Commercial Manager';
  return { userId:'00000000-0000-0000-0000-000000000001', providerUserId:'test-user', displayName:requestedActor, email:'test@example.invalid', clientId:null, membershipId:'00000000-0000-0000-0000-000000000002', roleKey:'commercial_manager', roleName:'Commercial Manager', permissions:[...new Set(Object.values(PERMISSIONS))], memberships:[] };
}

function createApp(options = {}) {
  const app = express();
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
  app.use('/api', ...createAuthenticationMiddleware(authAdapter));
  app.use('/api/auth', authRoutes);

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
  app.use("/api/developments/:developmentId", developmentProgrammeRoutes);
  app.use("/api/developments/:developmentId", prelimsItemRoutes);
  app.use("/api/prelims-templates", prelimsTemplateRoutes);
  app.use("/api/cost-code-classifications", costCodeClassificationRoutes);
  app.use("/api/cost-codes", costCodeMasterRoutes);
  app.use("/api/packages", packageRoutes);
  app.use("/api/commercial-events", commercialEventRoutes);
  app.use("/api/variation-orders", variationOrderRoutes);
  app.use("/api/subcontract-terms", subcontractTermsRoutes);
  app.use("/api", paymentNoticeRoutes);
  app.use("/api/commercial-documents", commercialDocumentRoutes);

  if (!isProduction()) {
    const developerRoutes = require("./routes/developerRoutes");
    app.use("/api/developer", developerRoutes);
  }

  app.use((req, res) => {
    res
      .status(404)
      .json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
  });

  return app;
}

module.exports = createApp;
