function isProduction() {
  return process.env.NODE_ENV === "production";
}

function isServerTestMode() {
  return process.env.BUILDLITE_SERVER_TEST === "1";
}

function isDbConfigured() {
  if (isServerTestMode()) {
    return Boolean(process.env.TEST_DATABASE_URL);
  }
  return Boolean(process.env.DATABASE_URL);
}

function getConnectionString() {
  if (isServerTestMode()) {
    return process.env.TEST_DATABASE_URL;
  }
  return process.env.DATABASE_URL;
}

module.exports = {
  isProduction,
  isServerTestMode,
  isDbConfigured,
  getConnectionString,
};
