/**
 * BL-017B — Application navigation types and constants.
 */

export const NAV_BACK_LABEL = 'Back';

export const NAV_MODULES = {
  ADMINISTRATION: 'administration',
  DEVELOPMENTS: 'developments',
  CVRS: 'cvrs',
  PROCUREMENT_REGISTER: 'procurement-register',
  PROCUREMENT_CREATE: 'procurement-create',
  PROCUREMENT_ARCHIVE: 'procurement-archive',
  CERTIFICATES: 'certificates',
};

export const NAV_MODULE_LABELS = {
  [NAV_MODULES.ADMINISTRATION]: 'Administration',
  [NAV_MODULES.DEVELOPMENTS]: 'Developments',
  [NAV_MODULES.CVRS]: 'CVR Portfolio',
  [NAV_MODULES.PROCUREMENT_REGISTER]: 'Purchase Orders',
  [NAV_MODULES.PROCUREMENT_CREATE]: 'New Purchase Order',
  [NAV_MODULES.PROCUREMENT_ARCHIVE]: 'Purchase Order Archive',
  [NAV_MODULES.CERTIFICATES]: 'Certificates',
};

/**
 * @typedef {Object} NavigationBreadcrumb
 * @property {string} label
 * @property {(() => void)=} onClick
 */

/**
 * @typedef {Object} NavigationFrame
 * @property {string} id
 * @property {string} label
 * @property {string=} title
 * @property {string=} lead
 * @property {(() => void)=} onNavigate
 * @property {Record<string, unknown>=} meta
 */

export function createNavigationFrame({
  id,
  label,
  title = '',
  lead = '',
  onNavigate = null,
  meta = {},
}) {
  return {
    id,
    label,
    title,
    lead,
    onNavigate,
    meta,
  };
}

export function createBreadcrumb(label, onClick = null) {
  return { label, onClick };
}
