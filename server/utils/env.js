function isProduction() {
  return process.env.NODE_ENV === "production";
}

function isDbConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

module.exports = { isProduction, isDbConfigured };
