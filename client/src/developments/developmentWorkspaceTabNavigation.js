export const DEVELOPMENT_WORKSPACE_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'plot-master', label: 'Plot Master' },
  { id: 'packages', label: 'Packages' },
  { id: 'commercial', label: 'Commercial Events' },
  { id: 'ledger', label: 'Ledger' },
  { id: 'revenue', label: 'Revenue' },
  { id: 'selling-costs', label: 'Selling Costs' },
  { id: 'prelims', label: 'Prelims' },
  { id: 'cvr', label: 'CVR' },
];

export function applyDevelopmentWorkspaceTabSelection(tabId) {
  const isWorkspaceTab = DEVELOPMENT_WORKSPACE_TABS.some((tab) => tab.id === tabId);
  if (!isWorkspaceTab) return null;

  return {
    activeTab: tabId,
    packageLaunch: null,
    packageLaunchError: '',
    commercialNavigationStack: [],
  };
}
