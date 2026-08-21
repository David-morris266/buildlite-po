import { describe, expect, it } from 'vitest';
import {
  applyDevelopmentWorkspaceTabSelection,
  DEVELOPMENT_WORKSPACE_TABS,
} from './developmentWorkspaceTabNavigation';

describe('developmentWorkspaceTabNavigation', () => {
  it('clears package launch when selecting Revenue', () => {
    const next = applyDevelopmentWorkspaceTabSelection('revenue');

    expect(next).toEqual({
      activeTab: 'revenue',
      packageLaunch: null,
      packageLaunchError: '',
      commercialNavigationStack: [],
    });
  });

  it('clears package launch when selecting CVR', () => {
    const next = applyDevelopmentWorkspaceTabSelection('cvr');

    expect(next?.activeTab).toBe('cvr');
    expect(next?.packageLaunch).toBeNull();
  });

  it('clears package launch when selecting Overview', () => {
    const next = applyDevelopmentWorkspaceTabSelection('overview');

    expect(next?.activeTab).toBe('overview');
    expect(next?.packageLaunch).toBeNull();
  });

  it('ignores unknown tab ids', () => {
    expect(applyDevelopmentWorkspaceTabSelection('unknown-tab')).toBeNull();
  });

  it('covers every standard workspace tab', () => {
    expect(DEVELOPMENT_WORKSPACE_TABS.map((tab) => tab.id)).toEqual([
      'overview',
      'plot-master',
      'packages',
      'commercial',
      'ledger',
      'revenue',
      'prelims',
      'cvr',
    ]);
  });
});
