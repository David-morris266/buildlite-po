/**
 * BL-013 — Cross-module refresh when commercial data changes.
 */

export const COMMERCIAL_CHANGED = 'buildlite:commercial-changed';

export function notifyCommercialChanged(detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(COMMERCIAL_CHANGED, { detail }));
}

export function subscribeCommercialChanged(handler) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(COMMERCIAL_CHANGED, handler);
  return () => window.removeEventListener(COMMERCIAL_CHANGED, handler);
}
