/**
 * BL-017B — Lightweight in-app navigation stack (not browser history).
 */

import { NAV_BACK_LABEL } from './navigationTypes';

export { NAV_BACK_LABEL };

/**
 * @param {import('./navigationTypes').NavigationFrame[]} stack
 * @param {import('./navigationTypes').NavigationFrame} frame
 */
export function pushNavigationFrame(stack, frame) {
  const existingIndex = stack.findIndex((item) => item.id === frame.id);
  if (existingIndex >= 0) {
    return [...stack.slice(0, existingIndex), frame];
  }
  return [...stack, frame];
}

/**
 * @param {import('./navigationTypes').NavigationFrame[]} stack
 */
export function popNavigationFrame(stack) {
  if (stack.length <= 1) return stack;
  return stack.slice(0, -1);
}

/**
 * @param {import('./navigationTypes').NavigationFrame[]} stack
 */
export function replaceNavigationStack(stack) {
  return Array.isArray(stack) ? [...stack] : [];
}

/**
 * @param {import('./navigationTypes').NavigationFrame[]} stack
 */
export function getCurrentNavigationFrame(stack) {
  return stack.length ? stack[stack.length - 1] : null;
}

/**
 * @param {import('./navigationTypes').NavigationFrame[]} stack
 */
export function getParentNavigationFrame(stack) {
  return stack.length > 1 ? stack[stack.length - 2] : null;
}

/**
 * @param {import('./navigationTypes').NavigationFrame[]} stack
 * @returns {import('./navigationTypes').NavigationBreadcrumb[]}
 */
export function buildBreadcrumbsFromStack(stack) {
  return stack.map((frame, index) => ({
    label: frame.label,
    onClick: index < stack.length - 1 ? frame.onNavigate || undefined : undefined,
  }));
}

/**
 * @param {import('./navigationTypes').NavigationBreadcrumb[]} breadcrumbs
 * @returns {import('./navigationTypes').NavigationBreadcrumb[]}
 */
export function normalizeBreadcrumbs(breadcrumbs = []) {
  if (!Array.isArray(breadcrumbs) || breadcrumbs.length === 0) return [];

  return breadcrumbs.map((item, index) => {
    const isLast = index === breadcrumbs.length - 1;
    return {
      label: item.label,
      onClick: isLast ? undefined : item.onClick || undefined,
    };
  });
}

/**
 * @param {import('./navigationTypes').NavigationBreadcrumb[]} breadcrumbs
 */
export function resolveBackNavigation(breadcrumbs = []) {
  if (!Array.isArray(breadcrumbs) || breadcrumbs.length < 2) {
    return { label: NAV_BACK_LABEL, onBack: null, parentLabel: null };
  }

  const parent = breadcrumbs[breadcrumbs.length - 2];
  return {
    label: NAV_BACK_LABEL,
    onBack: parent.onClick || null,
    parentLabel: parent.label,
  };
}

/**
 * @param {import('./navigationTypes').NavigationFrame[]} stack
 */
export function goBackOnStack(stack) {
  const parent = getParentNavigationFrame(stack);
  if (!parent?.onNavigate) {
    return { stack, handled: false };
  }

  parent.onNavigate();
  return { stack: popNavigationFrame(stack), handled: true };
}
