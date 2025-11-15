// server/server.js
// Load .env first
require('dotenv').config();

const express = require('express');
const cors    = require('cors');

// Routers
const poRoutes  = require('./routes/poRoutes');   // /po...
const jobRoutes = require('./routes/jobRoutes');  // /jobs...

const app  = express();
const PORT = process.env.PORT || 3001;

/* ------------------------------------------------------------ *
 * CORS (allow Netlify frontend + local dev to call this API)
 * ------------------------------------------------------------ */
app.use(cors({
  origin: '*', // allow Netlify, localhost, etc.
  methods: 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  allowedHeaders: 'Content-Type, Authorization',
}));
app.options('*', cors());

/* ------------------------------------------------------------ *
 * GLOBAL MIDDLEWARES
 * ------------------------------------------------------------ */
app.use(express.json({ limit: '2mb' }));

/* ------------------------------------------------------------ *
 * HEALTH
 * ------------------------------------------------------------ */
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'Build Lite API' });
});

/* ------------------------------------------------------------ *
 * ROUTES
 * ------------------------------------------------------------ */
// POs (and suppliers, cost codes) live inside poRoutes
// -> /api/po, /api/po/:poNumber, /api/po/suppliers, /api/po/cost-codes, ...
app.use('/api', poRoutes);

// Jobs API is scoped under /api/jobs
// -> /api/jobs, /api/jobs/:id
app.use('/api/jobs', jobRoutes);

/* ------------------------------------------------------------ *
 * 404
 * ------------------------------------------------------------ */
app.use((req, res) => {
  res
    .status(404)
    .json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
});

/* ------------------------------------------------------------ *
 * START
 * ------------------------------------------------------------ */
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
