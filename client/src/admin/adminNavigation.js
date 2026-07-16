/**
 * BL-016F.1 / BL-017B — Administration in-module navigation helpers.
 */

import { createNavigationFrame } from '../navigation/navigationTypes';

export const ADMIN_LANDING_VIEW = 'landing';

export function createAdminDashboardNavigator(setView, setSetupStep) {
  return function goToAdminDashboard() {
    setSetupStep(null);
    setView(ADMIN_LANDING_VIEW);
  };
}

export function createAdminNavigationFrame(viewId, title, onNavigate) {
  return createNavigationFrame({
    id: `admin-${viewId}`,
    label: title,
    title,
    onNavigate,
  });
}
