// server/server.js
// Load .env first
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { init } = require("./db");

// Routers
const poRoutes = require("./routes/poRoutes");           // /api/po...
const jobRoutes = require("./routes/jobRoutes");         // /api/jobs...
const clientRoutes = require("./routes/clientRoutes");   // /api/clients...
const brandRoutes = require("./routes/brandRoutes");     // /api/brand...
const paymentRoutes = require("./routes/paymentRoutes"); // /api/payments...

const app = express();
const PORT = process.env.PORT || 3001;

/* ------------------------------------------------------------ *
 * CORS (allow Netlify frontend + local dev to call this API)
 * ------------------------------------------------------------ */
app.use(
  cors({
    origin: "*", // allow Netlify, localhost, etc.
    methods: "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    allowedHeaders: "Content-Type, Authorization",
  })
);
app.options("*", cors());

/* ------------------------------------------------------------ *
 * GLOBAL MIDDLEWARES
 * ------------------------------------------------------------ */
app.use(express.json({ limit: "2mb" }));

/* ------------------------------------------------------------ *
 * HEALTH
 * ------------------------------------------------------------ */
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "Build Lite API" });
});

/* ------------------------------------------------------------ *
 * ROUTES
 * ------------------------------------------------------------ */
// POs (and suppliers, cost codes) live inside poRoutes
// -> /api/po, /api/po/:poNumber, /api/po/suppliers, /api/po/cost-codes, ...
app.use("/api", poRoutes);

// Jobs API is scoped under /api/jobs
// -> /api/jobs, /api/jobs/:id
app.use("/api/jobs", jobRoutes);

// Clients API is scoped under /api/clients
// -> /api/clients/active (GET), /api/clients/active (POST)
app.use("/api/clients", clientRoutes);

// Brand API is scoped under /api/brand
// -> /api/brand/active (GET)
app.use("/api/brand", brandRoutes);
app.use("/api/payments", paymentRoutes);

/* ------------------------------------------------------------ *
 * 404 (must be AFTER all routes)
 * ------------------------------------------------------------ */
app.use((req, res) => {
  res
    .status(404)
    .json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
});

/* ------------------------------------------------------------ *
 * START (only after DB init)
 * ------------------------------------------------------------ */
init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✅ Server running on http://localhost:${PORT}`); // local dev
    });
  })
  .catch((err) => {
    console.error("❌ DB init failed:", err);
    process.exit(1);
  });
