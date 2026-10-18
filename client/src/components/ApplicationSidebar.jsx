import { useEffect, useRef } from 'react';
import { useBuildLitePrincipal } from '../auth/BuildLiteAuthProvider';
import { useOptionalUnsavedChanges } from '../navigation/UnsavedChangesContext.js';

const NAVIGATION_ITEMS = [
  { id: 'home', label: 'Home', icon: '\u2302' },
  { id: 'payment-approval', label: 'Payment Approval', icon: '\u2713', permission: 'payment_approval_run.view' },
  { id: 'payment-release', label: 'Accounts', icon: '\u00a3', permission: 'payment_release.execute' },
  { id: 'administration', label: 'Administration', icon: '\u2699', administration: true },
  { id: 'cvrs', label: 'CVRs', icon: '\u2197' },
  { id: 'developments', label: 'Developments', icon: '\u25f1' },
  { id: 'form', label: 'New Purchase Order', icon: '+', permission: 'po.create' },
  { id: 'list', label: 'Purchase Orders', icon: '\u2261' },
  { id: 'archive', label: 'Archive', icon: '\u25a1' },
];

const ADMIN_PERMISSIONS = ['tenant.configure', 'users.manage', 'roles.manage', 'terms.publish', 'commercial_templates.manage', 'cost_code_classifications.manage', 'commercial_head_categories.manage'];

export default function ApplicationSidebar({ activeTab, collapsed, open, onTab, onToggle, onClose }) {
  const principal = useBuildLitePrincipal();
  const unsavedChanges = useOptionalUnsavedChanges();
  const closeButtonRef = useRef(null);
  const sidebarRef = useRef(null);
  const returnFocusRef = useRef(null);
  const canAdmin = principal?.platformPermissions?.includes('platform.tenant_provision') || ADMIN_PERMISSIONS.some(permission => principal?.permissions?.includes(permission));

  useEffect(() => {
    if (!open) return undefined;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const handleOverlayKeyboard = event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...(sidebarRef.current?.querySelectorAll('button:not([disabled]),a[href],select:not([disabled]),[tabindex]:not([tabindex="-1"])') || [])]
        .filter(element => element.getClientRects().length > 0 || element === document.activeElement);
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (!sidebarRef.current?.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleOverlayKeyboard);
    return () => {
      document.removeEventListener('keydown', handleOverlayKeyboard);
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      if (target?.isConnected) target.focus();
    };
  }, [open, onClose]);

  const permitted = item => !item.permission || principal?.permissions?.includes(item.permission);
  const visibleItems = NAVIGATION_ITEMS.filter(item => (!item.administration || canAdmin) && permitted(item));
  const selectTab = tab => {
    const navigate = () => { onTab(tab); onClose(); };
    if (tab === activeTab) navigate();
    else if (unsavedChanges) unsavedChanges.requestNavigation(navigate);
    else navigate();
  };

  return <>
    <button type="button" className={`app-nav-scrim${open ? ' app-nav-scrim--open' : ''}`} aria-label="Close navigation" tabIndex={open ? 0 : -1} onClick={onClose} />
    <aside ref={sidebarRef} id="buildlite-primary-navigation" className={`app-sidebar${collapsed ? ' app-sidebar--collapsed' : ''}${open ? ' app-sidebar--open' : ''}`} role={open ? 'dialog' : undefined} aria-label="Primary navigation" aria-modal={open ? 'true' : undefined}>
      <div className="app-sidebar__brand"><img src="/buildlite-skyline-symbol.svg" alt="" /><span className="app-sidebar__wordmark"><strong>Build <em>Lite</em></strong><small>Lean Commercial Control</small></span></div>
      <button ref={closeButtonRef} type="button" className="app-sidebar__mobile-close" aria-label="Close navigation" onClick={onClose}>{'\u00d7'}</button>
      <button type="button" className="app-sidebar__collapse" aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} aria-expanded={!collapsed} onClick={onToggle}><span aria-hidden="true">{collapsed ? '\u00bb' : '\u00ab'}</span><span className="app-sidebar__label">Collapse</span></button>
      <nav className="app-sidebar__nav">
        {visibleItems.map(item => <button key={item.id} type="button" className={`app-sidebar__item${activeTab === item.id ? ' app-sidebar__item--active' : ''}`} aria-label={item.label} aria-current={activeTab === item.id ? 'page' : undefined} title={collapsed ? item.label : undefined} onClick={() => selectTab(item.id)}><span className="app-sidebar__icon" aria-hidden="true">{item.icon}</span><span className="app-sidebar__label">{item.label}</span></button>)}
      </nav>
    </aside>
  </>;
}
