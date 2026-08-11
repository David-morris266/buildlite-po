// server/server.js
require("dotenv").config();

const createApp = require("./app");
const { init } = require("./db");

const PORT = process.env.PORT || 3001;
const app = createApp();

init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✅ Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ DB init failed:", err);
    process.exit(1);
  });
