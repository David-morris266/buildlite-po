/**
 * BL-032A — Developer-only revenue settings migration console helpers.
 *
 * Attached on window in Vite DEV only. Not a customer-facing wizard.
 * Does not run automatically. Do not run against Test Site 1 in this slice.
 */

import {
  AUTO_MIGRATE_REVENUE_SETTINGS_ON_STARTUP,
  executeRevenueSettingsMigration,
  listLocalRevenueDevelopmentIds,
  preflightRevenueSettingsMigration,
} from './revenueSettingsMigration';

export function attachRevenueSettingsMigrationDevtools(target = globalThis) {
  if (!import.meta.env.DEV) return false;
  if (!target || AUTO_MIGRATE_REVENUE_SETTINGS_ON_STARTUP) return false;

  target.buildliteRevenueSettingsMigration = {
    listLocalDevelopmentIds: () => listLocalRevenueDevelopmentIds(),
    preflight: (developmentId, options) => preflightRevenueSettingsMigration(developmentId, options),
    execute: (developmentId, options = {}) =>
      executeRevenueSettingsMigration(developmentId, options),
    help: () =>
      [
        'BL-032A controlled revenue settings migration (authority flag stays OFF).',
        '1. buildliteRevenueSettingsMigration.listLocalDevelopmentIds()',
        '2. await buildliteRevenueSettingsMigration.preflight(developmentId)',
        '3. await buildliteRevenueSettingsMigration.execute(developmentId, { confirm: true })',
        'Does not run at startup. Does not delete localStorage. Do not run on Test Site 1 in BL-032A.',
      ].join('\n'),
  };
  return true;
}
