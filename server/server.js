// server/server.js
// Load .env first
require('dotenv').config();

const express = require('express');
const cors = require('cors');

// Routers
const poRoutes        = require('./routes/poRoutes');        // defines routes starting with '/po'
const jobRoutes       = require('./routes/jobRoutes');       // expects to be mounted at '/api/jobs'
const supplierRoutes  = require('./routes/supplierRoutes');  // defines '/suppliers' endpoints

const app = express();
const PORT = process.env.PORT || 3001;

/* ------------------------------------------------------------ *
 * GLOBAL MIDDLEWARES
 * ------------------------------------------------------------ */
app.use(cors({
  origin: '*', // allow Vite (5173) and any local tools
  methods: 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  allowedHeaders: 'Content-Type, Authorization'
}));
app.options('*', cors());
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
// IMPORTANT: poRoutes already prefixes its handlers with '/po'
app.use('/api', poRoutes);              // -> /api/po, /api/po/:poNumber, etc.

// Jobs API is scoped under /api/jobs
app.use('/api/jobs', jobRoutes);        // -> /api/jobs, /api/jobs/:id

// Suppliers API defines '/suppliers' paths; mount at /api
app.use('/api', supplierRoutes);        // -> /api/suppliers, /api/suppliers/:id

/* ------------------------------------------------------------ *
 * 404
 * ------------------------------------------------------------ */
app.use((req, res) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
});

/* ------------------------------------------------------------ *
 * START
 * ------------------------------------------------------------ */
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
