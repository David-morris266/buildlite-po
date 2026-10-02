// server/server.js
require("dotenv").config();

const { assertProductionConfig } = require('./utils/productionConfig');

const PORT = process.env.PORT || 3001;
async function start() {
  assertProductionConfig();
  const createApp = require('./app');
  const { init } = require('./db');
  await init();
  const app = createApp();
  return app.listen(PORT, () => {
      console.log(`✅ Server running on http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error("❌ DB init failed:", err);
    process.exit(1);
  });
}

module.exports = { start };
