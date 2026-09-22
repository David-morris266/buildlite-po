import { useCallback, useEffect, useState } from 'react';
import DeveloperTools from '../DeveloperTools';
import SetupAssistant from '../../setup/SetupAssistant';
import { ADMIN_LANDING_VIEW } from '../../admin/adminNavigation';
import { isAdminView } from '../../admin/masterDataService';
import { useBuildLitePrincipal } from '../../auth/BuildLiteAuthProvider';
import { AdministrationWorkspace } from '../layout/WorkspaceShell';
import AdministrationLanding from './AdministrationLanding';
import AdminCompanyPage from './AdminCompanyPage';
import AdminCommercialStructurePage from './AdminCommercialStructurePage';
import AdminCommercialBehaviourPage from './AdminCommercialBehaviourPage';
import AdminCostCodesPage from './AdminCostCodesPage';
import AdminCostCodeBulkClassification from './AdminCostCodeBulkClassification';
import AdminReportingPreviewPage from './AdminReportingPreviewPage';
import AdminValidationDashboardPage from './AdminValidationDashboardPage';
import AdminSuppliersPage from './AdminSuppliersPage';
import AdminClientsPage from './AdminClientsPage';
import AdminUsersPage from './AdminUsersPage';
import AdminApprovalSettingsPage from './AdminApprovalSettingsPage';
import AdminPrelimsTemplatesPage from './AdminPrelimsTemplatesPage';
import AdminSellingCostsTemplatesPage from './AdminSellingCostsTemplatesPage';
import AdminSetupDataImportPage from './AdminSetupDataImportPage';
import AdminSubcontractTermsPage from './AdminSubcontractTermsPage';

const showDeveloperTools = !import.meta.env.PROD;
const COMMERCIAL_TEMPLATES_PERMISSION = 'commercial_templates.manage';
const CLASSIFICATION_PERMISSION = 'cost_code_classifications.manage';
const COMMERCIAL_TEMPLATE_VIEWS = new Set(['prelims-templates', 'selling-costs-templates']);

export default function AdministrationModule({
  onLaunchPO,
  onOpenDevelopments,
  dashboardResetToken = 0,
  initialView = null,
  returnDevelopment = null,
  onReturnToDevelopment,
  onViewChange = null,
  onViewReplace = null,
}) {
  const principal = useBuildLitePrincipal();
  const canManageCommercialTemplates = principal?.permissions?.includes(COMMERCIAL_TEMPLATES_PERMISSION) === true;
  const canManageClassifications = principal?.permissions?.includes(CLASSIFICATION_PERMISSION) === true;
  const [view, setView] = useState('landing');
  const [viewContext, setViewContext] = useState(null);
  const [setupStep, setSetupStep] = useState(null);
  const [accessError, setAccessError] = useState('');
  const goToDashboard = useCallback(() => {
    setSetupStep(null);
    setViewContext(null);
    setAccessError('');
    setView(ADMIN_LANDING_VIEW);
    onViewChange?.(ADMIN_LANDING_VIEW);
  }, [onViewChange]);

  useEffect(() => {
    if (dashboardResetToken > 0) {
      goToDashboard();
    }
  }, [dashboardResetToken, goToDashboard]);

  useEffect(() => {
    if (!initialView) return;
    if (!isAdminView(initialView)) {
      setView(ADMIN_LANDING_VIEW);
      onViewReplace?.(ADMIN_LANDING_VIEW);
      return;
    }
    if (COMMERCIAL_TEMPLATE_VIEWS.has(initialView) && !canManageCommercialTemplates) {
      setAccessError('You do not have permission to manage company commercial templates.');
      setView(ADMIN_LANDING_VIEW);
      onViewReplace?.(ADMIN_LANDING_VIEW);
      return;
    }
    if (initialView === 'cost-code-classification' && !canManageClassifications) {
      setAccessError('You do not have permission to manage Cost Code classifications.'); setView(ADMIN_LANDING_VIEW); onViewReplace?.(ADMIN_LANDING_VIEW); return;
    }
    setAccessError('');
    setView(initialView);
  }, [canManageClassifications, canManageCommercialTemplates, initialView, onViewReplace]);

  const returnAction = returnDevelopment ? (
    <div className="po-module-card admin-context-return">
      <button type="button" className="po-list-btn-secondary" onClick={() => onReturnToDevelopment?.(returnDevelopment)}>
        Return to {returnDevelopment.name}
      </button>
    </div>
  ) : null;

  function openView(nextView, context = null) {
    if (!isAdminView(nextView)) return;
    if (COMMERCIAL_TEMPLATE_VIEWS.has(nextView) && !canManageCommercialTemplates) {
      setAccessError('You do not have permission to manage company commercial templates.');
      setView(ADMIN_LANDING_VIEW);
      onViewReplace?.(ADMIN_LANDING_VIEW);
      return;
    }
    if (nextView === 'cost-code-classification' && !canManageClassifications) return;
    setAccessError('');
    setSetupStep(null);
    setViewContext(context);
    setView(nextView);
    onViewChange?.(nextView);
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
        {returnAction}
        <AdminCostCodesPage onBack={goToDashboard} issueFilter={viewContext} onClearIssueFilter={() => setViewContext(null)} onOpenBulkClassification={canManageClassifications?()=>openView('cost-code-classification'):null} />
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
          onNavigate={(nextView, context) => openView(nextView, context)}
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
    if (!canManageCommercialTemplates) {
      return null;
    }
    return (
      <AdministrationWorkspace>
        <AdminPrelimsTemplatesPage onBack={goToDashboard} onSetUpCommercialStructure={()=>openView('commercial-structure')} />
      </AdministrationWorkspace>
    );
  }
  if (view === 'cost-code-classification') {
    if (!canManageClassifications) return null;
    return <AdministrationWorkspace><AdminCostCodeBulkClassification onBack={()=>openView('cost-codes')} initialSemanticGroup={viewContext?.semanticGroup||''}/></AdministrationWorkspace>;
  }
  if (view === 'selling-costs-templates') {
    if (!canManageCommercialTemplates) {
      return null;
    }
    return <AdministrationWorkspace><AdminSellingCostsTemplatesPage onBack={goToDashboard} onSetUpCommercialStructure={()=>openView('commercial-structure')} /></AdministrationWorkspace>;
  }
  if (view === 'subcontract-terms') {
    return <AdministrationWorkspace><AdminSubcontractTermsPage onBack={goToDashboard} /></AdministrationWorkspace>;
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
        canManageCommercialTemplates={canManageCommercialTemplates}
        accessError={accessError}
      />
    </AdministrationWorkspace>
  );
}
