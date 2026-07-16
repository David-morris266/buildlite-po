import { useMemo } from 'react';
import POPageHeader from './POPageHeader';
import { buildDevelopmentsListNavigation } from '../navigation/navigationBuilders';
import { listDevelopments } from '../developments/developmentStore';
import { formatDevelopmentListRow } from '../developments/developmentHelpers';

function StatusBadge({ status }) {
  return (
    <span className={`po-status-badge po-status-badge--${status.modifier}`}>
      {status.label}
    </span>
  );
}

export default function DevelopmentList({
  refreshToken = 0,
  onNewDevelopment,
  onOpenDevelopment,
}) {
  const rows = useMemo(() => {
    void refreshToken;
    return listDevelopments().map(formatDevelopmentListRow);
  }, [refreshToken]);

  const navigation = buildDevelopmentsListNavigation();

  return (
    <div className="dev-list-page">
      <div className="dev-list-page__header">
        <POPageHeader
          breadcrumbs={navigation.breadcrumbs}
          title={navigation.title}
          lead="The commercial home for each development — plot schedules, purchase orders, packages and reporting."
          showBack={false}
        />
        <button
          type="button"
          className="po-btn-primary dev-list-page__action"
          onClick={() => onNewDevelopment?.()}
        >
          New Development
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="po-module-card po-empty-state">
          <p className="po-empty-state__message">
            No developments yet. Create your first development to begin building
            the commercial record for a site.
          </p>
          <button
            type="button"
            className="po-btn-primary"
            onClick={() => onNewDevelopment?.()}
          >
            New Development
          </button>
        </div>
      ) : (
        <div className="po-table-wrap">
          <table className="po-data-table">
            <thead>
              <tr>
                <th>Development Number</th>
                <th>Development</th>
                <th>Status</th>
                <th style={{ textAlign: 'center' }}>Plots</th>
                <th style={{ textAlign: 'center' }}>Packages</th>
                <th>Last Updated</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.jobNumber}</td>
                  <td>{row.developmentName}</td>
                  <td>
                    <StatusBadge status={row.statusMeta} />
                  </td>
                  <td style={{ textAlign: 'center' }}>{row.plotsLabel}</td>
                  <td style={{ textAlign: 'center' }}>{row.packagesLabel}</td>
                  <td>{row.lastUpdatedLabel}</td>
                  <td>
                    <button
                      type="button"
                      className="po-list-btn-primary"
                      onClick={() => onOpenDevelopment?.(row.id)}
                    >
                      Open Workspace
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
