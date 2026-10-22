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
  'certificates',
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
const COMPANY_TABS = new Set(['identity', 'financial', 'commercial-defaults', 'numbering', 'branding']);
const CERTIFICATE_STATUSES = new Set(['draft', 'submitted', 'locked']);
const CERTIFICATE_SORTS = new Set(['newest', 'oldest', 'certificate_desc']);

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

function safeSearch(value) { return String(value || '').slice(0, 200); }
function safePositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 1 ? Math.min(parsed, 1000000) : 1;
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
    companyTab: null,
    plotMasterView: null,
    certificateId: null,
    certificateSearch: '',
    certificateDevelopmentId: null,
    certificateSupplierId: null,
    certificateStatus: '',
    certificateSort: 'newest',
    certificatePage: 1,
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
    route.companyTab = route.administrationSection === 'company' && COMPANY_TABS.has(params.get('companyTab'))
      ? params.get('companyTab')
      : route.administrationSection === 'company' ? 'identity' : null;
  }

  if (view === 'certificates') {
    route.certificateSearch = safeSearch(params.get('certificateSearch'));
    route.certificateDevelopmentId = safeValue(params.get('certificateDevelopment'));
    route.certificateSupplierId = safeValue(params.get('certificateSupplier'));
    route.certificateStatus = CERTIFICATE_STATUSES.has(params.get('certificateStatus')) ? params.get('certificateStatus') : '';
    route.certificateSort = CERTIFICATE_SORTS.has(params.get('certificateSort')) ? params.get('certificateSort') : 'newest';
    route.certificatePage = safePositiveInteger(params.get('certificatePage'));
    route.developmentId = safeValue(params.get('development'));
    route.packageKey = safePackageKey(params.get('package'));
    route.certificateId = safeValue(params.get('certificate'));
    return route;
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
  if (view === 'certificates') {
    if (safeSearch(route?.certificateSearch)) params.set('certificateSearch', safeSearch(route.certificateSearch));
    if (safeValue(route?.certificateDevelopmentId)) params.set('certificateDevelopment', route.certificateDevelopmentId);
    if (safeValue(route?.certificateSupplierId)) params.set('certificateSupplier', route.certificateSupplierId);
    if (CERTIFICATE_STATUSES.has(route?.certificateStatus)) params.set('certificateStatus', route.certificateStatus);
    if (CERTIFICATE_SORTS.has(route?.certificateSort) && route.certificateSort !== 'newest') params.set('certificateSort', route.certificateSort);
    if (safePositiveInteger(route?.certificatePage) > 1) params.set('certificatePage', String(safePositiveInteger(route.certificatePage)));
  }
  if (view === 'certificates' && safeValue(route?.certificateId) && safePackageKey(route?.packageKey) && safeValue(route?.developmentId)) {
    params.set('development', route.developmentId);
    params.set('package', route.packageKey);
    params.set('certificate', route.certificateId);
  }
  if (
    view === 'administration' &&
    route?.administrationSection !== 'landing' &&
    safeValue(route?.administrationSection)
  ) {
    params.set('section', route.administrationSection);
    if (route.administrationSection === 'company' && COMPANY_TABS.has(route.companyTab) && route.companyTab !== 'identity') {
      params.set('companyTab', route.companyTab);
    }
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
  if (url === current) return false;
  globalThis.history[replace ? 'replaceState' : 'pushState']({ buildliteRoute: true }, '', url);
  return true;
}
