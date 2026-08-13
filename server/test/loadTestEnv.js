/**
 * Preload for `npm test`: load local env files and mark this process as server-test mode.
 * Must run via `node --require ./test/loadTestEnv.js` before any test file imports ../db.
 */
const path = require("path");
const dotenv = require("dotenv");

const serverRoot = path.join(__dirname, "..");

dotenv.config({ path: path.join(serverRoot, ".env") });
dotenv.config({ path: path.join(serverRoot, ".env.test.local") });

process.env.BUILDLITE_SERVER_TEST = "1";
