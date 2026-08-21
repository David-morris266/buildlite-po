import { useCallback, useEffect, useState } from 'react';
import DeveloperTools from '../DeveloperTools';
import SetupAssistant from '../../setup/SetupAssistant';
import { ADMIN_LANDING_VIEW } from '../../admin/adminNavigation';
import { isAdminView } from '../../admin/masterDataService';
import { AdministrationWorkspace } from '../layout/WorkspaceShell';
import AdministrationLanding from './AdministrationLanding';
import AdminCompanyPage from './AdminCompanyPage';
import AdminCommercialStructurePage from './AdminCommercialStructurePage';
import AdminCommercialBehaviourPage from './AdminCommercialBehaviourPage';
import AdminCostCodesPage from './AdminCostCodesPage';
import AdminReportingPreviewPage from './AdminReportingPreviewPage';
import AdminValidationDashboardPage from './AdminValidationDashboardPage';
import AdminSuppliersPage from './AdminSuppliersPage';
import AdminClientsPage from './AdminClientsPage';
import AdminUsersPage from './AdminUsersPage';
import AdminApprovalSettingsPage from './AdminApprovalSettingsPage';
import AdminPrelimsTemplatesPage from './AdminPrelimsTemplatesPage';
import AdminSetupDataImportPage from './AdminSetupDataImportPage';

const showDeveloperTools = !import.meta.env.PROD;

export default function AdministrationModule({
  onLaunchPO,
  onOpenDevelopments,
  dashboardResetToken = 0,
}) {
  const [view, setView] = useState('landing');
  const [setupStep, setSetupStep] = useState(null);
  const goToDashboard = useCallback(() => {
    setSetupStep(null);
    setView(ADMIN_LANDING_VIEW);
  }, []);

  useEffect(() => {
    if (dashboardResetToken > 0) {
      goToDashboard();
    }
  }, [dashboardResetToken, goToDashboard]);

  function openView(nextView) {
    if (!isAdminView(nextView)) return;
    setSetupStep(null);
    setView(nextView);
  }

  if (setupStep != null) {
    return (
      <SetupAssistant
        fromAdministration
        initialStep={setupStep}
        onExit={goToDashboard}
        onLaunchPO={(seed) => {
          goToDashboard();
          onLaunchPO?.(seed);
        }}
        onOpenAdministration={goToDashboard}
        onOpenDevelopments={() => {
          setSetupStep(null);
          onOpenDevelopments?.();
        }}
      />
    );
  }

  if (view === 'setup-data-import' || view === 'setup-assistant') {
    return (
      <AdministrationWorkspace>
        <AdminSetupDataImportPage
          onBack={goToDashboard}
          onLaunchSetup={(step) => setSetupStep(step || 1)}
        />
      </AdministrationWorkspace>
    );
  }

  if (view === 'company') {
    return (
      <AdministrationWorkspace>
        <AdminCompanyPage onBack={goToDashboard} />
      </AdministrationWorkspace>
    );
  }
  if (view === 'commercial-structure') {
    return (
      <AdministrationWorkspace>
        <AdminCommercialStructurePage onBack={goToDashboard} />
      </AdministrationWorkspace>
    );
  }
  if (view === 'commercial-behaviour') {
    return (
      <AdministrationWorkspace>
        <AdminCommercialBehaviourPage onBack={goToDashboard} />
      </AdministrationWorkspace>
    );
  }
  if (view === 'cost-codes') {
    return (
      <AdministrationWorkspace>
        <AdminCostCodesPage onBack={goToDashboard} />
      </AdministrationWorkspace>
    );
  }
  if (view === 'reporting-preview') {
    return (
      <AdministrationWorkspace>
        <AdminReportingPreviewPage onBack={goToDashboard} />
      </AdministrationWorkspace>
    );
  }
  if (view === 'validation-dashboard') {
    return (
      <AdministrationWorkspace>
        <AdminValidationDashboardPage
          onBack={goToDashboard}
          onNavigate={(nextView) => openView(nextView)}
        />
      </AdministrationWorkspace>
    );
  }
  if (view === 'suppliers') {
    return (
      <AdministrationWorkspace>
        <AdminSuppliersPage onBack={goToDashboard} />
      </AdministrationWorkspace>
    );
  }
  if (view === 'clients') {
    return (
      <AdministrationWorkspace>
        <AdminClientsPage onBack={goToDashboard} />
      </AdministrationWorkspace>
    );
  }
  if (view === 'users') {
    return (
      <AdministrationWorkspace>
        <AdminUsersPage onBack={goToDashboard} />
      </AdministrationWorkspace>
    );
  }
  if (view === 'approval-settings') {
    return (
      <AdministrationWorkspace>
        <AdminApprovalSettingsPage onBack={goToDashboard} />
      </AdministrationWorkspace>
    );
  }
  if (view === 'prelims-templates') {
    return (
      <AdministrationWorkspace>
        <AdminPrelimsTemplatesPage onBack={goToDashboard} />
      </AdministrationWorkspace>
    );
  }
  if (view === 'developer-tools' && showDeveloperTools) {
    return (
      <AdministrationWorkspace>
        <DeveloperTools onBack={goToDashboard} />
      </AdministrationWorkspace>
    );
  }

  return (
    <AdministrationWorkspace variant="dashboard">
      <AdministrationLanding
        onOpen={openView}
        showDeveloperTools={showDeveloperTools}
      />
    </AdministrationWorkspace>
  );
}
