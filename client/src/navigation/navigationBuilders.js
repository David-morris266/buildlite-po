/**
 * BL-017B — Breadcrumb builders for module hierarchies.
 */

import { createBreadcrumb } from './navigationTypes';

const DEVELOPMENT_TAB_LABELS = {
  overview: 'Overview',
  'plot-master': 'Plot Master',
  packages: 'Packages',
  commercial: 'Commercial Events',
  ledger: 'Ledger',
  revenue: 'Revenue',
  'selling-costs': 'Selling Costs',
  prelims: 'Prelims',
  cvr: 'CVRs',
};

export function buildAdminPageNavigation({ pageTitle, onDashboard }) {
  const breadcrumbs = [
    createBreadcrumb('Administration', onDashboard),
    createBreadcrumb(pageTitle),
  ];

  return {
    breadcrumbs,
    title: pageTitle,
    onBack: onDashboard,
  };
}

export function buildDevelopmentsListNavigation() {
  return {
    breadcrumbs: [createBreadcrumb('Developments')],
    title: 'Developments',
    onBack: null,
  };
}

export function buildDevelopmentFormNavigation({ onCancel }) {
  const breadcrumbs = [
    createBreadcrumb('Developments', onCancel),
    createBreadcrumb('New Development'),
  ];

  return {
    breadcrumbs,
    title: 'New Development',
    onBack: onCancel,
  };
}

export function buildDevelopmentWorkspaceNavigation({
  developmentName,
  activeTab,
  cvrView = 'register',
  periodKey = null,
  costCodeLabel = null,
  origin = null,
  onBackToList,
  onSelectTab,
  onBackToCvrRegister,
  onBackToCvrSummary,
}) {
  const breadcrumbs = [];

  if (origin?.label && origin.onReturn) {
    breadcrumbs.push(createBreadcrumb(origin.label, origin.onReturn));
  }

  breadcrumbs.push(createBreadcrumb('Developments', onBackToList));
  breadcrumbs.push(
    createBreadcrumb(developmentName, () => {
      onSelectTab?.('overview');
      onBackToCvrRegister?.();
    })
  );

  if (activeTab && activeTab !== 'overview') {
    const tabLabel = DEVELOPMENT_TAB_LABELS[activeTab] || activeTab;
    breadcrumbs.push(
      createBreadcrumb(tabLabel, () => {
        onSelectTab?.(activeTab);
        if (activeTab === 'cvr') onBackToCvrRegister?.();
      })
    );
  }

  if (activeTab === 'cvr') {
    if (cvrView === 'register') {
      breadcrumbs.push(createBreadcrumb('Register'));
    } else if (cvrView === 'summary' && periodKey) {
      breadcrumbs.push(createBreadcrumb(periodKey, onBackToCvrRegister));
      breadcrumbs.push(createBreadcrumb('Summary'));
    } else if (cvrView === 'worksheet' && periodKey) {
      breadcrumbs.push(createBreadcrumb(periodKey, onBackToCvrSummary));
      breadcrumbs.push(createBreadcrumb('Worksheet'));
    }
  }

  if (costCodeLabel) {
    breadcrumbs.push(createBreadcrumb(costCodeLabel));
  }

  const parent = breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2] : null;

  return {
    breadcrumbs,
    title: developmentName,
    onBack: parent?.onClick || onBackToList,
  };
}

export function buildCvrRegisterNavigation({
  developmentName,
  developmentNumber,
  breadcrumbs = [],
  onBack,
}) {
  return {
    breadcrumbs: breadcrumbs.length
      ? breadcrumbs
      : [createBreadcrumb('Developments'), createBreadcrumb(developmentName), createBreadcrumb('CVR Register')],
    title: developmentName,
    lead: `Development ${developmentNumber || '—'} · Monthly CVR register`,
    onBack,
  };
}

export function buildCvrSummaryNavigation({
  developmentName,
  periodLabel,
  breadcrumbs = [],
  onBack,
}) {
  return {
    breadcrumbs,
    title: `${developmentName} · ${periodLabel}`,
    lead: 'CVR Summary',
    onBack,
  };
}

export function buildCvrWorksheetNavigation({
  developmentName,
  periodKey,
  breadcrumbs = [],
  onBack,
}) {
  return {
    breadcrumbs,
    title: `${developmentName} · ${periodKey}`,
    lead: 'CVR Worksheet',
    onBack,
  };
}

export function buildProcurementRegisterNavigation() {
  return {
    breadcrumbs: [createBreadcrumb('Purchase Orders')],
    title: 'Purchase Orders',
    onBack: null,
  };
}

export function buildProcurementCreateNavigation({ onBack }) {
  const breadcrumbs = [
    createBreadcrumb('Purchase Orders', onBack),
    createBreadcrumb('New Purchase Order'),
  ];

  return {
    breadcrumbs,
    title: 'New Purchase Order',
    onBack,
  };
}

export function buildProcurementEditNavigation({ poNumber, onBack }) {
  const breadcrumbs = [
    createBreadcrumb('Purchase Orders', onBack),
    createBreadcrumb(poNumber),
  ];

  return {
    breadcrumbs,
    title: poNumber,
    onBack,
  };
}

export function buildProcurementArchiveNavigation() {
  return {
    breadcrumbs: [createBreadcrumb('Purchase Orders'), createBreadcrumb('Archive')],
    title: 'Purchase Order Archive',
    onBack: null,
  };
}

export function buildCertificatesRegisterNavigation() {
  return {
    breadcrumbs: [createBreadcrumb('Certificates')],
    title: 'Subcontract Orders',
    onBack: null,
  };
}

export function buildCertificatePackageNavigation({ packageTitle, onBack }) {
  const breadcrumbs = [
    createBreadcrumb('Certificates', onBack),
    createBreadcrumb(packageTitle),
  ];

  return {
    breadcrumbs,
    title: packageTitle,
    onBack,
  };
}

export function buildPackageWorkspaceNavigation({
  packageTitle,
  onBack,
  navigationContext = null,
  developmentName = null,
  onBackToDevelopmentList = null,
  onBackToDevelopmentPackages = null,
}) {
  if (
    navigationContext?.openedFrom === 'DevelopmentPackages' ||
    navigationContext?.openedFrom === 'CommercialEventLink'
  ) {
    const breadcrumbs = [
      createBreadcrumb('Developments', onBackToDevelopmentList),
      createBreadcrumb(developmentName || 'Development', onBackToDevelopmentPackages),
      createBreadcrumb('Packages', onBack),
      createBreadcrumb(packageTitle),
    ];

    if (navigationContext?.openedFrom === 'CommercialEventLink') {
      breadcrumbs.push(createBreadcrumb('Commercial Events'));
    }

    return {
      breadcrumbs,
      title: packageTitle,
      onBack,
    };
  }

  return buildCertificatePackageNavigation({ packageTitle, onBack });
}

export function buildCertificateDetailNavigation({
  certificateNumber,
  packageTitle,
  onBackToRegister = null,
  onBackToPackage,
}) {
  const breadcrumbs = [
    createBreadcrumb('Certificates', onBackToRegister || undefined),
    createBreadcrumb(packageTitle, onBackToPackage),
    createBreadcrumb(`Certificate ${certificateNumber}`),
  ];

  return {
    breadcrumbs,
    title: `Certificate No. ${certificateNumber}`,
    onBack: onBackToPackage,
  };
}

export function buildCvrPortfolioNavigation() {
  return {
    breadcrumbs: [createBreadcrumb('CVR Portfolio')],
    title: 'CVR Portfolio',
    onBack: null,
  };
}

export function buildDrawerNavigation({
  breadcrumbs = [],
  title,
  onBack,
}) {
  return {
    breadcrumbs,
    title,
    onBack,
  };
}
