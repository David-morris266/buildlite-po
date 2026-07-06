import { useEffect, useMemo, useState } from 'react';
import POPageHeader from './POPageHeader';
import { formatPoDate } from './poDrawerHelpers';
import { buildDevelopmentWorkspaceModel } from '../developments/developmentHelpers';
import DevelopmentOverview, {
  DevelopmentCommercialTab,
  DevelopmentPackagesTab,
  SummaryDashboard,
} from './DevelopmentOverview';
import PlotMaster from './PlotMaster';
import PurchaseLedger from './PurchaseLedger';
import CVRWorkspace from './CVRWorkspace';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'plot-master', label: 'Plot Master' },
  { id: 'packages', label: 'Packages' },
  { id: 'commercial', label: 'Commercial' },
  { id: 'ledger', label: 'Ledger' },
  { id: 'cvr', label: 'CVR' },
];

function StatusBadge({ status }) {
  return (
    <span className={`po-status-badge po-status-badge--${status.modifier}`}>
      {status.label}
    </span>
  );
}

export default function DevelopmentWorkspace({
  development,
  onBackToList,
  onPlotsChanged,
  onLedgerChanged,
  onCvrChanged,
}) {
  const [activeTab, setActiveTab] = useState('overview');
  const [plotRefresh, setPlotRefresh] = useState(0);
  const [ledgerRefresh, setLedgerRefresh] = useState(0);
  const [cvrRefresh, setCvrRefresh] = useState(0);

  const model = useMemo(
    () => buildDevelopmentWorkspaceModel(development),
    [development, plotRefresh, ledgerRefresh, cvrRefresh]
  );

  useEffect(() => {
    setActiveTab('overview');
  }, [development?.id]);

  if (!model) return null;

  function handlePlotsChanged() {
    setPlotRefresh((value) => value + 1);
    onPlotsChanged?.();
  }

  function handleLedgerChanged() {
    setLedgerRefresh((value) => value + 1);
    setCvrRefresh((value) => value + 1);
    onLedgerChanged?.();
  }

  function handleCvrChanged() {
    setCvrRefresh((value) => value + 1);
    onCvrChanged?.();
  }

  return (
    <div className="dev-workspace">
      <POPageHeader
        eyebrow="Development Workspace"
        title={model.developmentName}
        lead={`Development ${model.jobNumber}${model.location ? ` · ${model.location}` : ''}`}
      />

      <div className="dev-workspace__meta">
        <StatusBadge status={model.statusMeta} />
        {model.client ? (
          <span className="dev-workspace__meta-item">Client: {model.client}</span>
        ) : null}
        {model.startDate ? (
          <span className="dev-workspace__meta-item">
            Start: {formatPoDate(model.startDate)}
          </span>
        ) : null}
        {model.targetCompletion ? (
          <span className="dev-workspace__meta-item">
            Target: {formatPoDate(model.targetCompletion)}
          </span>
        ) : null}
      </div>

      <SummaryDashboard cards={model.summaryCards} />

      <nav className="po-package-tabs dev-workspace__tabs" aria-label="Development sections">
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

      <div className="dev-workspace__tab-panel">
        {activeTab === 'overview' ? <DevelopmentOverview model={model} /> : null}

        {activeTab === 'plot-master' ? (
          <PlotMaster
            developmentId={model.id}
            developmentName={model.developmentName}
            refreshToken={plotRefresh}
            onPlotsChanged={handlePlotsChanged}
          />
        ) : null}

        {activeTab === 'packages' ? <DevelopmentPackagesTab /> : null}

        {activeTab === 'commercial' ? <DevelopmentCommercialTab model={model} /> : null}

        {activeTab === 'ledger' ? (
          <PurchaseLedger
            development={development}
            refreshToken={ledgerRefresh}
            onLedgerChanged={handleLedgerChanged}
          />
        ) : null}

        {activeTab === 'cvr' ? (
          <CVRWorkspace
            development={development}
            refreshToken={cvrRefresh}
            onCvrChanged={handleCvrChanged}
          />
        ) : null}
      </div>

      <div className="dev-workspace__footer">
        <button
          type="button"
          className="dev-workspace__back"
          onClick={onBackToList}
        >
          Back to Developments
        </button>
      </div>
    </div>
  );
}
