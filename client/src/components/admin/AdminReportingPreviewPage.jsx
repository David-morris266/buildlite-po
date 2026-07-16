import { useMemo } from 'react';
import { getCommercialBehaviourSettings } from '../../admin/commercialBehaviourStore';
import { buildReportingStructurePreview } from '../../admin/masterDataValidation';
import AdminPageShell from './AdminPageShell';
import { AdminKpiGrid } from './adminUi';

export default function AdminReportingPreviewPage({ onBack }) {
  const preview = useMemo(() => buildReportingStructurePreview(), []);
  const behaviour = useMemo(() => getCommercialBehaviourSettings(), []);

  const executiveHeads = preview.filter(
    (head) => behaviour.behaviours[head.name]?.includeOnExecutiveSummary !== false
  );

  return (
    <AdminPageShell
      title="Reporting Preview"
      lead="Read-only view of the commercial reporting structure as it will appear on the Executive Summary."
      onBack={onBack}
    >
      <AdminKpiGrid
        items={[
          { label: 'Executive Heads', value: executiveHeads.length },
          {
            label: 'Total Cost Codes',
            value: preview.reduce((sum, head) => sum + head.costCodeCount, 0),
          },
        ]}
      />

      <section className="admin-report-preview po-module-card" aria-label="Commercial reporting structure">
        {executiveHeads.map((head) => (
          <article key={head.id} className="admin-report-preview__head">
            <header className="admin-report-preview__head-title">
              <h2>{head.name}</h2>
              <span className="admin-report-preview__count">{head.costCodeCount} codes</span>
            </header>

            {head.families.map((family) => (
              <div key={family.id} className="admin-report-preview__family">
                <h3>{family.name}</h3>
                <ul className="admin-report-preview__trade-list">
                  {family.trades
                    .filter((trade) => trade.name !== 'General' || trade.costCodeCount > 0)
                    .map((trade) => (
                      <li key={trade.id} className="admin-report-preview__trade">
                        <span>{trade.name}</span>
                        {trade.costCodeCount ? (
                          <span className="admin-report-preview__trade-count">{trade.costCodeCount}</span>
                        ) : null}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </article>
        ))}
      </section>
    </AdminPageShell>
  );
}
