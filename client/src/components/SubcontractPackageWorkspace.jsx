import { useEffect, useMemo, useState } from 'react';
import POPageHeader from './POPageHeader';
import { buildCertificatePackageNavigation } from '../navigation/navigationBuilders';
import OrderMatrixPlaceholderPreview from './OrderMatrixPlaceholderPreview';
import PaymentCertificateWorkspace from './PaymentCertificateWorkspace';
import SubcontractPackageOverview, {
  SubcontractPackageDashboard,
  SubcontractPackageSummary,
  SubcontractPackageTabPlaceholder,
} from './SubcontractPackageOverview';
import { buildPackageViewModel } from '../payments/subcontractPackage';
import PackageCommercialEvents from './PackageCommercialEvents';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'matrix', label: 'Order Matrix' },
  { id: 'certificates', label: 'Certificates' },
  { id: 'variations', label: 'Variations' },
  { id: 'history', label: 'History' },
];

export default function SubcontractPackageWorkspace({
  order,
  initialTab = 'overview',
  onBackToList,
}) {
  const [activeTab, setActiveTab] = useState(initialTab);

  const [matrixRefresh, setMatrixRefresh] = useState(0);
  const [certRefresh, setCertRefresh] = useState(0);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const pkg = useMemo(() => {
    void matrixRefresh;
    void certRefresh;
    return buildPackageViewModel(order);
  }, [order, matrixRefresh, certRefresh]);

  const packageTitle = `${order.supplierLabel} – ${order.projectLabel}`;
  const pageNavigation = buildCertificatePackageNavigation({
    packageTitle,
    onBack: onBackToList,
  });

  return (
    <div className="po-package-workspace">
      <POPageHeader
        breadcrumbs={pageNavigation.breadcrumbs}
        title={pageNavigation.title}
        lead="Manage the commercial progress of this subcontract package, including your plot × stage valuation matrix, Certificates and Variations."
        onBack={pageNavigation.onBack}
      />

      <SubcontractPackageDashboard pkg={pkg} />
      <SubcontractPackageSummary pkg={pkg} />

      <nav className="po-package-tabs" aria-label="Package sections">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`po-package-tabs__tab${
              activeTab === tab.id ? ' po-package-tabs__tab--active' : ''
            }`}
            onClick={() => setActiveTab(tab.id)}
            aria-current={activeTab === tab.id ? 'page' : undefined}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="po-package-tab-panel">
        {activeTab === 'overview' ? (
          <SubcontractPackageOverview
            pkg={pkg}
            onOpenMatrix={() => setActiveTab('matrix')}
          />
        ) : null}

        {activeTab === 'matrix' ? (
          <OrderMatrixPlaceholderPreview
            embedded
            order={order}
            hasMatrix={pkg.matrixExists}
            onCancel={() => setActiveTab('overview')}
            onMatrixImported={() => setMatrixRefresh((value) => value + 1)}
          />
        ) : null}

        {activeTab === 'certificates' ? (
          <PaymentCertificateWorkspace
            order={order}
            pkg={pkg}
            refreshToken={certRefresh}
            onCertificatesChanged={() => setCertRefresh((value) => value + 1)}
          />
        ) : null}

        {activeTab === 'variations' ? (
          <PackageCommercialEvents order={order} />
        ) : null}

        {activeTab === 'history' ? (
          <SubcontractPackageTabPlaceholder
            title="History"
            lead="A full commercial history for this package will appear here."
            points={[
              'Purchase Order approvals and matrix imports.',
              'Certificate decisions and variation approvals.',
              'Everything you need for audit and handover.',
            ]}
          />
        ) : null}
      </div>
    </div>
  );
}
