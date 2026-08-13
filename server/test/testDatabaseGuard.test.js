/**
 * BL-028B.3a — Fail-closed test database guard regression tests (no UAT DB access).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawnSync } = require("child_process");

const {
  parseDatabaseUrl,
  areEquivalentDatabaseTargets,
} = require("../utils/databaseUrl");
const {
  assertTestDatabaseIsolation,
  GUARD_PREFIX,
} = require("../utils/testDatabaseGuard");
const { getConnectionString, isServerTestMode } = require("../utils/env");

test("parseDatabaseUrl normalises host, port, and database name", () => {
  assert.deepEqual(
    parseDatabaseUrl("postgresql://user:secret@LOCALHOST:5432/BuildLite_Test/"),
    { host: "localhost", port: "5432", database: "buildlite_test" }
  );
  assert.deepEqual(
    parseDatabaseUrl("postgres://user:secret@127.0.0.1/buildlite_clone"),
    { host: "127.0.0.1", port: "5432", database: "buildlite_clone" }
  );
});

test("areEquivalentDatabaseTargets treats trivial URL differences as the same database", () => {
  const a = "postgresql://user:secret@localhost:5432/buildlite_clone";
  const b = "postgres://USER:other@LOCALHOST/buildlite_clone/";
  assert.equal(areEquivalentDatabaseTargets(a, b), true);

  const c = "postgresql://user:secret@localhost:5432/buildlite_test";
  assert.equal(areEquivalentDatabaseTargets(a, c), false);
});

test("assertTestDatabaseIsolation fails when TEST_DATABASE_URL is missing", () => {
  assert.throws(
    () =>
      assertTestDatabaseIsolation({
        DATABASE_URL: "postgresql://user:secret@localhost:5432/buildlite_clone",
      }),
    (err) => {
      assert.match(err.message, /TEST_DATABASE_URL is missing/);
      assert.match(err.message, new RegExp(GUARD_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.doesNotMatch(err.message, /secret/);
      return true;
    }
  );
});

test("assertTestDatabaseIsolation fails when TEST_DATABASE_URL matches DATABASE_URL", () => {
  const url = "postgresql://user:secret@localhost:5432/buildlite_clone";
  assert.throws(
    () =>
      assertTestDatabaseIsolation({
        DATABASE_URL: url,
        TEST_DATABASE_URL: "postgres://other:pw@localhost/buildlite_clone",
      }),
    (err) => {
      assert.match(err.message, /same database as DATABASE_URL/);
      assert.match(err.message, /buildlite_clone/);
      assert.doesNotMatch(err.message, /secret/);
      assert.doesNotMatch(err.message, /other:pw/);
      return true;
    }
  );
});

test("assertTestDatabaseIsolation permits a separate TEST_DATABASE_URL", () => {
  assert.doesNotThrow(() =>
    assertTestDatabaseIsolation({
      DATABASE_URL: "postgresql://user:secret@localhost:5432/buildlite_clone",
      TEST_DATABASE_URL: "postgresql://user:secret@localhost:5432/buildlite_test",
    })
  );
});

test("runtime/dev mode uses DATABASE_URL when BUILDLITE_SERVER_TEST is unset", () => {
  const previousTestFlag = process.env.BUILDLITE_SERVER_TEST;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousTestDatabaseUrl = process.env.TEST_DATABASE_URL;

  delete process.env.BUILDLITE_SERVER_TEST;
  process.env.DATABASE_URL = "postgresql://user:secret@localhost:5432/buildlite_clone";
  process.env.TEST_DATABASE_URL =
    "postgresql://user:secret@localhost:5432/buildlite_test";

  try {
    assert.equal(isServerTestMode(), false);
    assert.equal(
      getConnectionString(),
      "postgresql://user:secret@localhost:5432/buildlite_clone"
    );
  } finally {
    if (previousTestFlag === undefined) {
      delete process.env.BUILDLITE_SERVER_TEST;
    } else {
      process.env.BUILDLITE_SERVER_TEST = previousTestFlag;
    }
    process.env.DATABASE_URL = previousDatabaseUrl;
    process.env.TEST_DATABASE_URL = previousTestDatabaseUrl;
  }
});

test("db.js refuses to load in server test mode when TEST_DATABASE_URL is missing", () => {
  const serverRoot = path.join(__dirname, "..");
  const result = spawnSync(
    process.execPath,
    [
      "--require",
      path.join(serverRoot, "test", "loadTestEnv.js"),
      "-e",
      "require('./db')",
    ],
    {
      cwd: serverRoot,
      env: {
        ...process.env,
        TEST_DATABASE_URL: "",
        DATABASE_URL: "postgresql://user:secret@localhost:5432/buildlite_clone",
      },
      encoding: "utf8",
    }
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /TEST_DATABASE_URL is missing/);
  assert.doesNotMatch(result.stderr, /secret/);
});

test("db.js refuses to load in server test mode when TEST_DATABASE_URL matches DATABASE_URL", () => {
  const serverRoot = path.join(__dirname, "..");
  const sameTarget = "postgresql://user:secret@localhost:5432/buildlite_clone";
  const result = spawnSync(
    process.execPath,
    [
      "--require",
      path.join(serverRoot, "test", "loadTestEnv.js"),
      "-e",
      "require('./db')",
    ],
    {
      cwd: serverRoot,
      env: {
        ...process.env,
        DATABASE_URL: sameTarget,
        TEST_DATABASE_URL: "postgres://other:pw@localhost/buildlite_clone",
      },
      encoding: "utf8",
    }
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /same database as DATABASE_URL/);
  assert.doesNotMatch(result.stderr, /secret/);
  assert.doesNotMatch(result.stderr, /other:pw/);
});
