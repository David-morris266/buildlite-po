import CommercialAssistantIndicator from '../commercialAssistant/CommercialAssistantIndicator';
import { useBuildLitePrincipal } from '../auth/BuildLiteAuthProvider';

import { useOptionalUnsavedChanges } from '../navigation/UnsavedChangesContext.js';

export default function BrandHeader({ navigationOpen = false, onOpenNavigation }) {
  const unsavedChanges = useOptionalUnsavedChanges();
  const principal = useBuildLitePrincipal();
  const memberships = principal?.memberships || [];
  const activeCompanyName = principal?.activeTenant?.name || principal?.activeTenant?.code || 'Company unavailable';
  const switchCompany = (clientId) => {
    if (!clientId || clientId === principal?.activeTenant?.clientId) return;
    const navigate = () => principal?.switchTenant?.(clientId);
    if (unsavedChanges) unsavedChanges.requestNavigation(navigate);
    else navigate();
  };
  return (
    <header className="brandbar">
      <button type="button" className="brand-menu" aria-label="Open navigation" aria-controls="buildlite-primary-navigation" aria-expanded={navigationOpen} onClick={onOpenNavigation}>☰</button>
      <CommercialAssistantIndicator />

      <div className="brand-company" aria-label="Active company context">
        <span className="brand-company__label">Company</span>
        {memberships.length > 1 ? (
          <select
            className="brand-company__select"
            aria-label="Switch active company"
            value={principal.activeTenant.clientId}
            onChange={(event) => switchCompany(event.target.value)}
          >
            {memberships.map((membership) => (
              <option key={membership.clientId} value={membership.clientId}>
                {membership.clientName || membership.clientCode} · {membership.roleName}
              </option>
            ))}
          </select>
        ) : <strong className="brand-company__name">{activeCompanyName}</strong>}
      </div>

      <div className="brand-user"><span aria-hidden="true">{String(principal?.user?.displayName || 'User').split(/\s+/).map(value => value[0]).join('').slice(0, 2).toUpperCase()}</span><div><strong>{principal?.user?.displayName || 'BuildLite user'}</strong><small>{principal?.activeTenant?.roleName || principal?.roleName || 'Authenticated user'}</small></div></div>
    </header>
  );
}
