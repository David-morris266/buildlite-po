import { useEffect, useMemo, useState } from 'react';
import POPageHeader from './POPageHeader';
import { buildPackageWorkspaceNavigation } from '../navigation/navigationBuilders';
import OrderMatrixPlaceholderPreview from './OrderMatrixPlaceholderPreview';
import PaymentCertificateWorkspace from './PaymentCertificateWorkspace';
import SubcontractPackageOverview, {
  SubcontractPackageDashboard,
  SubcontractPackageSummary,
} from './SubcontractPackageOverview';
import { buildPackageViewModel } from '../payments/subcontractPackage';
import PackageCommercialEvents from './PackageCommercialEvents';
import PackageCommercialHistory from './PackageCommercialHistory';
import { usePackageWorkspaceAssistantScope } from '../commercialAssistant/usePackageWorkspaceAssistantScope';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'matrix', label: 'Order Matrix' },
  { id: 'certificates', label: 'Certificates' },
  { id: 'variations', label: 'Commercial Events' },
  { id: 'history', label: 'History' },
];

export default function SubcontractPackageWorkspace({
  order,
  initialTab = 'overview',
  onBackToList,
  navigationContext = null,
  commercialEventTarget = null,
  certificateTarget = null,
  developmentName = null,
  onBackToDevelopmentList = null,
  onNavigateToLinkedCommercialEvent = null,
  packageLaunchError = '',
  commercialEventsLoading = false,
  commercialEventsError = '',
  commercialEventsReady = true,
  matricesLoading = false,
  matricesError = '',
  matricesReady = true,
  assistantDevelopmentPackages = null,
  onAssistantNavigate = null,
}) {
  const [activeTab, setActiveTab] = useState(initialTab);

  const [matrixRefresh, setMatrixRefresh] = useState(0);
  const [certRefresh, setCertRefresh] = useState(0);
  const [commercialEventRefresh, setCommercialEventRefresh] = useState(0);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (commercialEventTarget?.eventId) {
      setActiveTab('variations');
    }
  }, [commercialEventTarget?.eventId, commercialEventTarget?.navigationKey]);

  useEffect(() => {
    if (certificateTarget?.certificateId) {
      setActiveTab('certificates');
    }
  }, [certificateTarget?.certificateId, certificateTarget?.navigationKey]);

  usePackageWorkspaceAssistantScope(order, {
    developmentPackages: assistantDevelopmentPackages,
    onNavigate: onAssistantNavigate,
    enabled: Boolean(order),
  });

  const pkg = useMemo(() => {
    void matrixRefresh;
    void certRefresh;
    void commercialEventRefresh;
    return buildPackageViewModel(order);
  }, [
    order,
    matrixRefresh,
    certRefresh,
    commercialEventRefresh,
    commercialEventsLoading,
    commercialEventsReady,
    matricesLoading,
    matricesReady,
  ]);

  const packageTitle = `${order.supplierLabel} – ${order.projectLabel}`;
  const pageNavigation = buildPackageWorkspaceNavigation({
    packageTitle,
    onBack: onBackToList,
    navigationContext,
    developmentName,
    onBackToDevelopmentList,
    onBackToDevelopmentPackages: onBackToList,
  });

  return (
    <div className="po-package-workspace">
      <POPageHeader
        breadcrumbs={pageNavigation.breadcrumbs}
        title={pageNavigation.title}
        lead="Manage the commercial progress of this subcontract package — order matrix, payment certificates and commercial events."
        onBack={pageNavigation.onBack}
      />

      {packageLaunchError ? (
        <div className="po-list-feedback po-list-feedback--error" role="alert">
          {packageLaunchError}
        </div>
      ) : null}

      {commercialEventsError ? (
        <div className="po-list-feedback po-list-feedback--error" role="alert">
          {commercialEventsError}
        </div>
      ) : null}

      {matricesError ? (
        <div className="po-list-feedback po-list-feedback--error" role="alert">
          {matricesError}
        </div>
      ) : null}

      <SubcontractPackageDashboard
        pkg={pkg}
        compact={activeTab === 'variations'}
        commercialEventsLoading={commercialEventsLoading}
        commercialEventsReady={commercialEventsReady}
      />
      {activeTab !== 'variations' ? (
        <SubcontractPackageSummary
          pkg={pkg}
          compact
          commercialEventsLoading={commercialEventsLoading}
        />
      ) : null}

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
            certificateTarget={certificateTarget}
            onCertificatesChanged={() => setCertRefresh((value) => value + 1)}
          />
        ) : null}

        {activeTab === 'variations' ? (
          <PackageCommercialEvents
            order={order}
            refreshToken={commercialEventRefresh}
            commercialEventTarget={commercialEventTarget}
            commercialEventsLoading={commercialEventsLoading}
            commercialEventsReady={commercialEventsReady}
            onCommercialEventsChanged={() =>
              setCommercialEventRefresh((value) => value + 1)
            }
            onNavigateToLinkedCommercialEvent={onNavigateToLinkedCommercialEvent}
          />
        ) : null}

        {activeTab === 'history' ? (
          <PackageCommercialHistory
            order={order}
            refreshToken={commercialEventRefresh}
            certRefreshToken={certRefresh}
          />
        ) : null}
      </div>
    </div>
  );
}
