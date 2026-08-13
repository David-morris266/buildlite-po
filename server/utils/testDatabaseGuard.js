const {
  areEquivalentDatabaseTargets,
  describeDatabaseTarget,
  parseDatabaseUrl,
} = require("./databaseUrl");

const GUARD_PREFIX =
  "Server integration tests require an isolated TEST_DATABASE_URL and refuse to run against the normal DEV/UAT database.";

function assertTestDatabaseIsolation(env = process.env) {
  const testUrl = env.TEST_DATABASE_URL;
  const devUrl = env.DATABASE_URL;

  if (!testUrl || !String(testUrl).trim()) {
    throw new Error(
      `${GUARD_PREFIX}\n` +
        "TEST_DATABASE_URL is missing.\n" +
        "Set TEST_DATABASE_URL in server/.env.test.local to a dedicated Postgres database (for example buildlite_test).\n" +
        "Do not reuse DATABASE_URL for automated server tests."
    );
  }

  if (!parseDatabaseUrl(testUrl)) {
    throw new Error(
      `${GUARD_PREFIX}\n` +
        "TEST_DATABASE_URL is present but could not be parsed as a Postgres URL.\n" +
        "Check server/.env.test.local."
    );
  }

  if (devUrl && areEquivalentDatabaseTargets(testUrl, devUrl)) {
    throw new Error(
      `${GUARD_PREFIX}\n` +
        `TEST_DATABASE_URL resolves to the same database as DATABASE_URL (${describeDatabaseTarget(testUrl)}).\n` +
        "Point TEST_DATABASE_URL at a separate database such as buildlite_test."
    );
  }
}

module.exports = {
  GUARD_PREFIX,
  assertTestDatabaseIsolation,
};
