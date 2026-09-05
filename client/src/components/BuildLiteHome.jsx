import { useBuildLitePermission, useBuildLitePrincipal } from '../auth/BuildLiteAuthProvider';

function HomeLink({ title, description, onClick }) {
  return <button type="button" className="buildlite-home__link" onClick={onClick}>
    <strong>{title}</strong><span>{description}</span>
  </button>;
}

export default function BuildLiteHome({ onNavigate }) {
  const principal = useBuildLitePrincipal();
  const canCreatePo = useBuildLitePermission('po.create');
  const canViewApproval = useBuildLitePermission('payment_approval_run.view');
  const canRelease = useBuildLitePermission('payment_release.execute');
  const canAdmin = ['tenant.configure', 'users.manage', 'roles.manage', 'terms.publish']
    .some(permission => principal?.permissions?.includes(permission));
  const tenant = principal?.activeTenant?.name || principal?.activeTenant?.code || 'your organisation';
  return <section className="buildlite-home">
    <header className="buildlite-home__header"><p className="buildlite-home__eyebrow">Lean commercial control</p>
      <h1>Welcome to BuildLite</h1>
      {principal?.user?.displayName ? <p className="buildlite-home__user">{principal.user.displayName}</p> : null}
      <p className="buildlite-home__tenant">Company: {tenant}</p>
    </header>
    <div className="buildlite-home__groups">
      <section className="po-module-card"><h2>Developments &amp; commercial control</h2>
        <HomeLink title="Developments & Packages" description="Open packages to manage applications, certificates, variations and commercial events." onClick={() => onNavigate({ view: 'developments' })} />
        <HomeLink title="CVRs" description="Review development CVR periods and commercial exposure." onClick={() => onNavigate({ view: 'cvrs' })} />
      </section>
      <section className="po-module-card"><h2>Orders &amp; certificates</h2>
        <HomeLink title="Purchase Orders" description="Review and manage purchase orders." onClick={() => onNavigate({ view: 'purchase-orders' })} />
        {canCreatePo ? <HomeLink title="New Purchase Order" description="Create a new purchase order." onClick={() => onNavigate({ view: 'new-purchase-order' })} /> : null}
      </section>
      {canViewApproval || canRelease ? <section className="po-module-card"><h2>Payment control</h2>
        {canViewApproval ? <HomeLink title="Payment Approval" description="Review and authorise eligible payments." onClick={() => onNavigate({ view: 'payment-approval' })} /> : null}
        {canRelease ? <HomeLink title="Payment Release" description="Release authorised payments to Accounts." onClick={() => onNavigate({ view: 'payment-release' })} /> : null}
      </section> : null}
      {canAdmin ? <section className="po-module-card"><h2>Administration</h2>
        <HomeLink title="Administration" description="Open available tenant and commercial configuration." onClick={() => onNavigate({ view: 'administration' })} />
      </section> : null}
    </div>
  </section>;
}
