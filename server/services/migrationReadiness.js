const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIRECTORY = path.join(__dirname, '..', 'migrations');

function requiredMigrationFiles(directory = MIGRATIONS_DIRECTORY) {
  return fs.readdirSync(directory).filter((name) => name.endsWith('.sql')).sort();
}

function migrationFrontier(files = requiredMigrationFiles()) {
  const last = files.at(-1);
  return last ? last.split('_', 1)[0] : null;
}

async function checkMigrationReadiness(database, files = requiredMigrationFiles()) {
  try {
    await database.query('SELECT 1');
    const result = await database.query('SELECT filename FROM schema_migrations ORDER BY filename');
    const applied = new Set(result.rows.map((row) => row.filename));
    const missing = files.filter((file) => !applied.has(file));
    return { ready: missing.length === 0, category: missing.length === 0 ? 'ready' : 'migration_behind', requiredFrontier: migrationFrontier(files) };
  } catch (error) {
    return { ready: false, category: error?.code === '42P01' ? 'migration_ledger_unavailable' : 'database_unavailable', requiredFrontier: migrationFrontier(files), error };
  }
}

module.exports = { MIGRATIONS_DIRECTORY, requiredMigrationFiles, migrationFrontier, checkMigrationReadiness };
