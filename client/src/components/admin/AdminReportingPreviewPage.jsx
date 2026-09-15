import { useEffect,useMemo,useState } from 'react';
import { getCommercialBehaviourSettings } from '../../admin/commercialBehaviourStore';
import { buildReportingStructurePreview } from '../../admin/masterDataValidation';
import {loadCommercialStructure} from '../../admin/commercialStructureService';
import {ensureAdminCostCodesReady,listAdminCostCodeRecords} from '../../admin/costCodeAdminService';
import AdminPageShell from './AdminPageShell';
import { AdminKpiGrid } from './adminUi';

export default function AdminReportingPreviewPage({ onBack }) {
  const [authority,setAuthority]=useState({structure:{heads:[],families:[],reportingGroups:[]},records:[]});
  const [loadState,setLoadState]=useState({loading:true,error:''});
  useEffect(()=>{let live=true;Promise.all([loadCommercialStructure(),ensureAdminCostCodesReady()]).then(([structure])=>{const records=listAdminCostCodeRecords();if(records==null)throw new Error('Cost Code Master is unavailable.');if(live){setAuthority({structure,records});setLoadState({loading:false,error:''});}}).catch(error=>{if(live)setLoadState({loading:false,error:error?.message||'BuildLite could not load the company Commercial Structure and Cost Code Master.'});});return()=>{live=false};},[]);
  const preview = useMemo(() => buildReportingStructurePreview(authority.structure,authority.records), [authority]);
  const behaviour = useMemo(() => getCommercialBehaviourSettings(preview.map(x=>x.name)), [preview]);

  const executiveHeads = preview.filter(
    (head) => behaviour.behaviours[head.name]?.includeOnExecutiveSummary !== false
  );

  return (
    <AdminPageShell
      title="Reporting Preview"
      lead="Read-only view of the commercial reporting structure as it will appear on the Executive Summary."
      onBack={onBack}
    >
      {loadState.error ? <p className="admin-inline-warning" role="alert">{loadState.error}</p> : null}
      {!loadState.loading && !loadState.error ? <><AdminKpiGrid
        items={[
          { label: 'Executive Heads', value: executiveHeads.length },
          {
            label: 'Total Cost Codes',
            value: authority.records.length,
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

            {head.directReportingGroups?.length ? (
              <ul className="admin-report-preview__trade-list">
                {head.directReportingGroups.map((group) => (
                  <li key={group.id} className="admin-report-preview__trade">
                    <span>{group.name}</span>
                    {group.costCodeCount ? (
                      <span className="admin-report-preview__trade-count">{group.costCodeCount}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}

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
      </section></> : null}
    </AdminPageShell>
  );
}
