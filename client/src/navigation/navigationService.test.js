import { describe, expect, it } from 'vitest';
import {
  buildBreadcrumbsFromStack,
  goBackOnStack,
  normalizeBreadcrumbs,
  pushNavigationFrame,
  resolveBackNavigation,
} from './navigationService';
import { createNavigationFrame } from './navigationTypes';
import {
  buildAdminPageNavigation,
  buildDevelopmentWorkspaceNavigation,
} from './navigationBuilders';

describe('navigationService', () => {
  it('builds clickable breadcrumbs from a navigation stack', () => {
    const stack = [
      createNavigationFrame({ id: 'devs', label: 'Developments', onNavigate: () => {} }),
      createNavigationFrame({ id: 'dev-1', label: 'Oakwood Meadows', onNavigate: () => {} }),
      createNavigationFrame({ id: 'cvr', label: 'CVR Register' }),
    ];

    const breadcrumbs = buildBreadcrumbsFromStack(stack);
    expect(breadcrumbs).toHaveLength(3);
    expect(breadcrumbs[0].onClick).toBeTypeOf('function');
    expect(breadcrumbs[2].onClick).toBeUndefined();
  });

  it('resolves back navigation from breadcrumb parents', () => {
    const breadcrumbs = [
      { label: 'Developments', onClick: () => {} },
      { label: 'Oakwood Meadows', onClick: () => {} },
      { label: 'Worksheet' },
    ];

    const back = resolveBackNavigation(breadcrumbs);
    expect(back.onBack).toBe(breadcrumbs[1].onClick);
    expect(back.parentLabel).toBe('Oakwood Meadows');
  });

  it('pops the stack when going back', () => {
    const calls = [];
    const stack = [
      createNavigationFrame({
        id: 'devs',
        label: 'Developments',
        onNavigate: () => calls.push('devs'),
      }),
      createNavigationFrame({
        id: 'dev-1',
        label: 'Oakwood Meadows',
        onNavigate: () => calls.push('dev-1'),
      }),
      createNavigationFrame({ id: 'worksheet', label: 'Worksheet' }),
    ];

    const result = goBackOnStack(stack);
    expect(result.handled).toBe(true);
    expect(calls).toEqual(['dev-1']);
    expect(result.stack).toHaveLength(2);
  });

  it('normalizes breadcrumbs so only parents are clickable', () => {
    const breadcrumbs = normalizeBreadcrumbs([
      { label: 'Administration', onClick: () => {} },
      { label: 'Suppliers', onClick: () => {} },
    ]);

    expect(breadcrumbs[1].onClick).toBeUndefined();
  });

  it('replaces an existing frame when the same id is pushed again', () => {
    const first = pushNavigationFrame([], createNavigationFrame({ id: 'a', label: 'A' }));
    const second = pushNavigationFrame(first, createNavigationFrame({ id: 'a', label: 'A updated' }));
    expect(second).toHaveLength(1);
    expect(second[0].label).toBe('A updated');
  });
});

describe('navigationBuilders', () => {
  it('builds administration page navigation', () => {
    const onDashboard = () => {};
    const nav = buildAdminPageNavigation({ pageTitle: 'Suppliers', onDashboard });
    expect(nav.breadcrumbs[0].label).toBe('Administration');
    expect(nav.onBack).toBe(onDashboard);
  });

  it('builds development workspace breadcrumbs for CVR worksheet', () => {
    const nav = buildDevelopmentWorkspaceNavigation({
      developmentName: 'Oakwood Meadows',
      activeTab: 'cvr',
      cvrView: 'worksheet',
      periodKey: 'Period 2',
      onBackToList: () => {},
      onSelectTab: () => {},
      onBackToCvrRegister: () => {},
      onBackToCvrSummary: () => {},
    });

    expect(nav.breadcrumbs.map((item) => item.label)).toEqual([
      'Developments',
      'Oakwood Meadows',
      'CVRs',
      'Period 2',
      'Worksheet',
    ]);
    expect(nav.title).toBe('Oakwood Meadows');
    expect(nav.onBack).toBeTypeOf('function');
  });

  it('builds development workspace breadcrumbs for CVR register and summary', () => {
    const registerNav = buildDevelopmentWorkspaceNavigation({
      developmentName: 'Test Site A',
      activeTab: 'cvr',
      cvrView: 'register',
      onBackToList: () => {},
      onSelectTab: () => {},
      onBackToCvrRegister: () => {},
      onBackToCvrSummary: () => {},
    });

    expect(registerNav.breadcrumbs.map((item) => item.label)).toEqual([
      'Developments',
      'Test Site A',
      'CVRs',
      'Register',
    ]);

    const summaryNav = buildDevelopmentWorkspaceNavigation({
      developmentName: 'Test Site A',
      activeTab: 'cvr',
      cvrView: 'summary',
      periodKey: 'P02',
      onBackToList: () => {},
      onSelectTab: () => {},
      onBackToCvrRegister: () => {},
      onBackToCvrSummary: () => {},
    });

    expect(summaryNav.breadcrumbs.map((item) => item.label)).toEqual([
      'Developments',
      'Test Site A',
      'CVRs',
      'P02',
      'Summary',
    ]);
  });

  it('builds development workspace breadcrumbs for Revenue tab', () => {
    const nav = buildDevelopmentWorkspaceNavigation({
      developmentName: 'Oakwood Meadows',
      activeTab: 'revenue',
      onBackToList: () => {},
      onSelectTab: () => {},
      onBackToCvrRegister: () => {},
      onBackToCvrSummary: () => {},
    });

    expect(nav.breadcrumbs.map((item) => item.label)).toEqual([
      'Developments',
      'Oakwood Meadows',
      'Revenue',
    ]);
    expect(nav.title).toBe('Oakwood Meadows');
  });
});
