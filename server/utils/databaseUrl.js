/**
 * Parse and compare Postgres connection URLs without exposing credentials.
 */

function parseDatabaseUrl(urlString) {
  if (!urlString || typeof urlString !== "string") {
    return null;
  }

  const trimmed = urlString.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const normalized = trimmed.replace(/^postgres:\/\//i, "postgresql://");
    const parsed = new URL(normalized);
    const database = decodeURIComponent(
      (parsed.pathname || "").replace(/^\//, "").split("/")[0] || ""
    );

    return {
      host: (parsed.hostname || "localhost").toLowerCase(),
      port: parsed.port || "5432",
      database: database.toLowerCase(),
    };
  } catch {
    return null;
  }
}

function areEquivalentDatabaseTargets(urlA, urlB) {
  const a = parseDatabaseUrl(urlA);
  const b = parseDatabaseUrl(urlB);
  if (!a || !b) {
    return false;
  }
  return a.host === b.host && a.port === b.port && a.database === b.database;
}

function describeDatabaseTarget(urlString) {
  const parsed = parseDatabaseUrl(urlString);
  if (!parsed) {
    return "(unparseable database URL)";
  }
  if (!parsed.database) {
    return `${parsed.host}:${parsed.port}/(no database name)`;
  }
  return `${parsed.host}:${parsed.port}/${parsed.database}`;
}

module.exports = {
  parseDatabaseUrl,
  areEquivalentDatabaseTargets,
  describeDatabaseTarget,
};
