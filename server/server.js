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
  const runner = await require('./services/paymentNoticePreparationRunner').startPreparationRunner();
  const server = app.listen(PORT, () => {
      console.log(`✅ Server running on http://localhost:${PORT}`);
  });
  server.stopNoticePreparation = runner.stop;
  return server;
}

if (require.main === module) {
  start().then(server => {
    let stopping=false;
    const stop=async()=>{if(stopping)return;stopping=true;await Promise.all([new Promise(resolve=>server.close(resolve)),server.stopNoticePreparation()]);await require('./db').pool.end();};
    process.once('SIGTERM',stop);process.once('SIGINT',stop);
  }).catch((err) => {
    console.error("❌ DB init failed:", err);
    process.exit(1);
  });
}

module.exports = { start };
