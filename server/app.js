// server/app.js — Express app factory (no listen; used by server.js and tests)
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { isProduction } = require("./utils/env");

const poRoutes = require("./routes/poRoutes");
const jobRoutes = require("./routes/jobRoutes");
const clientRoutes = require("./routes/clientRoutes");
const brandRoutes = require("./routes/brandRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const developmentRoutes = require("./routes/developmentRoutes");
const packageRoutes = require("./routes/packageRoutes");
const commercialEventRoutes = require("./routes/commercialEventRoutes");
const cvrRoutes = require("./routes/cvrRoutes");
const ledgerRoutes = require("./routes/ledgerRoutes");
const revenueSettingsRoutes = require("./routes/revenueSettingsRoutes");
const developmentProgrammeRoutes = require("./routes/developmentProgrammeRoutes");
const prelimsItemRoutes = require("./routes/prelimsItemRoutes");
const costCodeClassificationRoutes = require("./routes/costCodeClassificationRoutes");

function createApp() {
  const app = express();

  app.use(
    cors({
      origin: "*",
      methods: "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      allowedHeaders: "Content-Type, Authorization",
    })
  );
  app.options("*", cors());

  app.use(express.json({ limit: "2mb" }));

  app.use("/api", poRoutes);
  app.use("/api/jobs", jobRoutes);
  app.use("/api/clients", clientRoutes);
  app.use("/api/brand", brandRoutes);
  app.use("/api/payments", paymentRoutes);
  app.use("/api/developments", developmentRoutes);
  app.use("/api/developments/:developmentId", cvrRoutes);
  app.use("/api/developments/:developmentId", ledgerRoutes);
  app.use("/api/developments/:developmentId", revenueSettingsRoutes);
  app.use("/api/developments/:developmentId", developmentProgrammeRoutes);
  app.use("/api/developments/:developmentId", prelimsItemRoutes);
  app.use("/api/cost-code-classifications", costCodeClassificationRoutes);
  app.use("/api/packages", packageRoutes);
  app.use("/api/commercial-events", commercialEventRoutes);

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
