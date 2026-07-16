import { describe, expect, it, vi } from 'vitest';
import { ADMIN_LANDING_VIEW, createAdminDashboardNavigator } from './adminNavigation';

describe('adminNavigation', () => {
  it('defines the administration landing view id', () => {
    expect(ADMIN_LANDING_VIEW).toBe('landing');
  });

  it('returns navigators that reset setup overlay and view', () => {
    const setView = vi.fn();
    const setSetupStep = vi.fn();
    const goToDashboard = createAdminDashboardNavigator(setView, setSetupStep);

    goToDashboard();

    expect(setSetupStep).toHaveBeenCalledWith(null);
    expect(setView).toHaveBeenCalledWith('landing');
  });
});
