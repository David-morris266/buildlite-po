const APPLICATION_VIEWS = new Set([
  'home',
  'administration',
  'cvrs',
  'developments',
  'form',
  'list',
  'archive',
  'payment-approval',
  'payment-release',
]);

const DEVELOPMENT_TABS = new Set([
  'overview',
  'plot-master',
  'packages',
  'commercial',
  'variation-account',
  'ledger',
  'budget',
  'revenue',
  'selling-costs',
  'prelims',
  'cvr',
]);

const PACKAGE_TABS = new Set([
  'overview', 'matrix', 'certificates', 'variations', 'variation-account', 'history',
]);

const CVR_SUBVIEWS = new Set(['summary', 'worksheet', 'movements', 'exceptions', 'commentary']);

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,199}$/;

function safeValue(value) {
  const text = String(value || '').trim();
  return SAFE_ID.test(text) ? text : null;
}

function safePackageKey(value) {
  const text = String(value || '').trim();
  const hasControlCharacter = [...text].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  return text && text.length <= 500 && !hasControlCharacter ? text : null;
}

export function homeApplicationRoute() {
  return {
    view: 'home',
    developmentId: null,
    workspaceTab: null,
    periodKey: null,
    cvrSubview: null,
    cvrHierarchyFilterKey: null,
    packageKey: null,
    packageTab: null,
    administrationSection: null,
    plotMasterView: null,
  };
}

export function parseApplicationRoute(locationLike = globalThis.location) {
  const params = new URLSearchParams(locationLike?.search || '');
  if (params.get('setup') === '1') return { ...homeApplicationRoute(), view: 'setup' };

  const requestedView = params.get('view');
  const view = APPLICATION_VIEWS.has(requestedView) ? requestedView : 'home';
  const route = { ...homeApplicationRoute(), view };

  if (view === 'administration') {
    route.administrationSection = safeValue(params.get('section'));
  }

  if (view !== 'developments') return route;

  route.developmentId = safeValue(params.get('development'));
  if (!route.developmentId) return route;

  const workspaceTab = params.get('workspace');
  route.workspaceTab = DEVELOPMENT_TABS.has(workspaceTab) ? workspaceTab : 'overview';
  if (route.workspaceTab === 'plot-master') route.plotMasterView = params.get('plotView') === 'tenure-review' ? 'tenure-review' : null;
  if (route.workspaceTab === 'cvr') {
    route.periodKey = safeValue(params.get('period'));
    route.cvrSubview = route.periodKey && CVR_SUBVIEWS.has(params.get('cvrView'))
      ? params.get('cvrView')
      : route.periodKey ? 'summary' : null;
    route.cvrHierarchyFilterKey = route.cvrSubview === 'worksheet'
      ? safeValue(params.get('cvrFilter'))
      : null;
  }
  if (route.workspaceTab === 'packages') {
    route.packageKey = safePackageKey(params.get('package'));
    route.packageTab = PACKAGE_TABS.has(params.get('packageTab'))
      ? params.get('packageTab')
      : 'overview';
  }
  return route;
}

export function serializeApplicationRoute(route, locationLike = globalThis.location) {
  const pathname = locationLike?.pathname || '/';
  const params = new URLSearchParams();
  const view = APPLICATION_VIEWS.has(route?.view) ? route.view : 'home';

  if (view !== 'home') params.set('view', view);
  if (
    view === 'administration' &&
    route?.administrationSection !== 'landing' &&
    safeValue(route?.administrationSection)
  ) {
    params.set('section', route.administrationSection);
  }
  if (view === 'developments' && safeValue(route?.developmentId)) {
    params.set('development', route.developmentId);
    const workspaceTab = DEVELOPMENT_TABS.has(route?.workspaceTab)
      ? route.workspaceTab
      : 'overview';
    params.set('workspace', workspaceTab);
    if (workspaceTab === 'plot-master' && route?.plotMasterView === 'tenure-review') params.set('plotView', 'tenure-review');
    if (workspaceTab === 'cvr' && safeValue(route?.periodKey)) {
      params.set('period', route.periodKey);
      if (CVR_SUBVIEWS.has(route?.cvrSubview) && route.cvrSubview !== 'summary') {
        params.set('cvrView', route.cvrSubview);
      }
      if (route?.cvrSubview === 'worksheet' && safeValue(route?.cvrHierarchyFilterKey)) {
        params.set('cvrFilter', route.cvrHierarchyFilterKey);
      }
    }
    if (workspaceTab === 'packages' && safePackageKey(route?.packageKey)) {
      params.set('package', route.packageKey);
      if (PACKAGE_TABS.has(route?.packageTab) && route.packageTab !== 'overview') {
        params.set('packageTab', route.packageTab);
      }
    }
  }

  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ''}${locationLike?.hash || ''}`;
}

export function writeApplicationRoute(route, { replace = false } = {}) {
  const url = serializeApplicationRoute(route);
  const current = `${globalThis.location.pathname}${globalThis.location.search}${globalThis.location.hash}`;
  if (url === current) return;
  globalThis.history[replace ? 'replaceState' : 'pushState']({ buildliteRoute: true }, '', url);
}
