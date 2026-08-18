/**
 * BL-031C — Developer-only CVR/ledger migration console helpers.
 *
 * Attached on window in Vite DEV only. Not a customer-facing wizard.
 * Does not run automatically.
 */

import {
  AUTO_MIGRATE_ON_STARTUP,
  executeCvrLedgerMigration,
  formatMigrationReport,
  listLocalCvrLedgerDevelopmentIds,
  preflightCvrLedgerMigration,
} from './cvrLedgerMigration';

export function attachCvrLedgerMigrationDevtools(target = globalThis) {
  if (!import.meta.env.DEV) return false;
  if (!target || AUTO_MIGRATE_ON_STARTUP) return false;

  target.buildliteCvrLedgerMigration = {
    listLocalDevelopmentIds: () => listLocalCvrLedgerDevelopmentIds(),
    preflight: (developmentId, options) => preflightCvrLedgerMigration(developmentId, options),
    execute: (developmentId, options = {}) =>
      executeCvrLedgerMigration(developmentId, options),
    formatReport: formatMigrationReport,
    help: () =>
      [
        'BL-031C controlled migration (authority flags stay OFF).',
        '1. buildliteCvrLedgerMigration.listLocalDevelopmentIds()',
        '2. await buildliteCvrLedgerMigration.preflight(developmentId)',
        '3. console.log(buildliteCvrLedgerMigration.formatReport(plan))',
        '4. await buildliteCvrLedgerMigration.execute(developmentId, { confirm: true, developmentName: "Test Site 1" })',
        'Does not run at startup. Does not flip VITE_CVR_SERVER_AUTHORITY / VITE_LEDGER_SERVER_AUTHORITY.',
      ].join('\n'),
  };
  return true;
}
