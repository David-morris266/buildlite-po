/**
 * BL-027A.2 — Read-only localStorage Development backup (import/rollback source).
 *
 * buildlite_developments_v1 is NOT authoritative after server cutover.
 * Do not write Development records here after cutover.
 */

export const DEVELOPMENTS_LOCAL_BACKUP_KEY = 'buildlite_developments_v1';
export const DEVELOPMENTS_IMPORT_ATTEMPTED_KEY =
  'buildlite_developments_server_import_attempted_v1';

export function readLocalDevelopmentsBackup() {
  try {
    const raw = localStorage.getItem(DEVELOPMENTS_LOCAL_BACKUP_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function hasImportBeenAttempted() {
  return localStorage.getItem(DEVELOPMENTS_IMPORT_ATTEMPTED_KEY) === '1';
}

export function markImportAttempted() {
  localStorage.setItem(DEVELOPMENTS_IMPORT_ATTEMPTED_KEY, '1');
}

export function clearImportAttemptedFlagForTests() {
  localStorage.removeItem(DEVELOPMENTS_IMPORT_ATTEMPTED_KEY);
}
