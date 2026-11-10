import { Fragment, useEffect, useMemo, useState } from 'react';
import { useBuildLitePermission } from '../auth/BuildLiteAuthProvider';
import { subscribeCommercialChanged } from '../commercial/commercialEvents';
import { listCommercialEventsByPackage } from '../commercialEvents/commercialEventStore';
import {
  getVariationOrder,
  listCertificateReadyVariationOrderLines,
  listVariationOrders,
} from '../api/variationOrders';
import { loadPackageVariationAccount } from '../api/variationAccounts';
import PackageCommercialEvents from './PackageCommercialEvents';
import DirectVariationOrderPanel from './DirectVariationOrderPanel';
import PackageVariationAccount from './PackageVariationAccount';
import VariationOrderDrawer from './VariationOrderDrawer';
import { buildPackageVariationRows } from '../payments/packageVariationAccountRows';

const money = value => new Intl.NumberFormat('en-GB', {
  style: 'currency', currency: 'GBP', minimumFractionDigits: 2,
}).format(Number(value) || 0);

const signedMoney = value => {
  const amount = Number(value) || 0;
  return `${amount > 0 ? '+' : amount < 0 ? '-' : ''}${money(Math.abs(amount))}`;
};

function TypeLabel({ kind }) {
  const labels = { ce: 'Commercial Event', vo: 'Variation Order', va: 'QS Assessment' };
  return <span className={`po-variation-account__type po-variation-account__type--${kind}`}>{labels[kind]}</span>;
}

export default function PackageVariationsWorkspace({
  order,
  pkg,
  refreshToken = 0,
  commercialEventTarget = null,
  variationAccountTarget = null,
  commercialEventsLoading = false,
  commercialEventsReady = true,
  onCommercialEventsChanged = null,
  onNavigateToLinkedCommercialEvent = null,
  onOpenCertificates = null,
}) {
  const packageId = pkg?.packageUuid || pkg?.id || order?.packageUuid || order?.packageId || order?.id;
  const canViewVa = useBuildLitePermission('variation_account.view');
  const [variationOrders, setVariationOrders] = useState([]);
  const [variationItems, setVariationItems] = useState([]);
  const [packageExposure, setPackageExposure] = useState(null);
  const [certification, setCertification] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(new Set());
  const [actionPanel, setActionPanel] = useState(null);
  const [selectedCeTarget, setSelectedCeTarget] = useState(commercialEventTarget);
  const [selectedVaTarget, setSelectedVaTarget] = useState(variationAccountTarget);
  const [selectedVo, setSelectedVo] = useState(null);
  const [voError, setVoError] = useState('');
  const [localRefresh, setLocalRefresh] = useState(0);

  const events = useMemo(() => {
    void refreshToken;
    void localRefresh;
    if (!order?.developmentId || !order?.orderKey) return [];
    return listCommercialEventsByPackage(order.developmentId, order.orderKey);
  }, [order?.developmentId, order?.orderKey, refreshToken, localRefresh]);

  useEffect(() => subscribeCommercialChanged(detail => {
    const event = detail?.detail || {};
    if (event.packageId && String(event.packageId) !== String(packageId)) return;
    setLocalRefresh(value => value + 1);
  }), [packageId]);

  useEffect(() => {
    let active = true;
    if (!packageId) return undefined;
    setLoading(true);
    setError('');
    Promise.all([
      listVariationOrders(packageId),
      canViewVa ? loadPackageVariationAccount(packageId) : Promise.resolve({ items: [], packageExposure: null }),
      listCertificateReadyVariationOrderLines(packageId),
    ]).then(([vos, account, ready]) => {
      if (!active) return;
      setVariationOrders(Array.isArray(vos) ? vos : []);
      setVariationItems(Array.isArray(account?.items) ? account.items : []);
      setPackageExposure(account?.packageExposure || null);
      setCertification(Array.isArray(ready?.lines) ? ready.lines : []);
    }).catch(cause => {
      if (active) setError(cause.message || 'The package Variation Account could not be loaded.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [packageId, canViewVa, localRefresh]);

  useEffect(() => {
    if (commercialEventTarget?.eventId) {
      setSelectedCeTarget(commercialEventTarget);
      setActionPanel('ce');
    }
  }, [commercialEventTarget, commercialEventTarget?.eventId, commercialEventTarget?.navigationKey]);

  useEffect(() => {
    if (variationAccountTarget?.itemId) {
      setSelectedVaTarget(variationAccountTarget);
      setActionPanel('va');
    }
  }, [variationAccountTarget]);

  const rows = useMemo(
    () => buildPackageVariationRows({ events, variationOrders, variationItems, certification, packageExposure }),
    [events, variationOrders, variationItems, certification, packageExposure]
  );
  const visibleRows = rows.filter(row => {
    if (filter !== 'all' && row.kind !== filter) return false;
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [row.reference, row.description, row.status, ...row.costCodes, ...row.related]
      .some(value => String(value || '').toLowerCase().includes(query));
  });

  const provenance = order?.currentContractProvenance || {};
  const directCertified = certification.reduce((sum, line) => sum + Number(line.previouslyCertifiedValue || 0), 0);
  const attention = rows.filter(row => row.attention).length;
  const exposureAvailable = canViewVa && packageExposure?.ready && packageExposure?.unresolvedExposure != null;

  function toggleExpanded(key) {
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function openVariationOrder(row) {
    setVoError('');
    try {
      const vo = await getVariationOrder(row.id);
      if (!vo || String(vo.id) !== String(row.id)
          || String(vo.packageId) !== String(packageId)
          || String(vo.orderKey) !== String(order.orderKey)) {
        throw new Error('The Variation Order does not belong to this subcontract package.');
      }
      setSelectedVo(vo);
    } catch (cause) {
      setVoError(cause.message || 'The Variation Order could not be opened.');
    }
  }

  function openCommercialEvent(row) {
    setSelectedCeTarget({ eventId: row.id, mode: 'view', navigationKey: `${row.id}:${Date.now()}` });
    setActionPanel('ce');
  }

  return <div className="po-variation-account">
    <header className="po-variation-account__header">
      <div>
        <p className="po-cert-detail__eyebrow">Subcontract package</p>
        <h2>Variations</h2>
        <p>One package account for potential change, formal instructions, QS assessment and certification evidence.</p>
      </div>
      <div className="po-variation-account__actions">
        <button type="button" className="po-list-btn-secondary" onClick={() => setActionPanel('ce')}>New / review CE</button>
        <button type="button" className="po-list-btn-secondary" onClick={() => setActionPanel('vo')}>Create Variation Order</button>
        {canViewVa ? <button type="button" className="po-list-btn-secondary" onClick={() => setActionPanel('va')}>Manage QS assessment</button> : null}
        <button type="button" className="po-list-btn-secondary" onClick={onOpenCertificates}>Open Certificates</button>
      </div>
    </header>

    <dl className="po-variation-account__summary" aria-label="Package variation account summary">
      <div><dt>Original subcontract</dt><dd>{money(provenance.originalOrder ?? pkg?.originalOrderValue)}</dd></div>
      <div><dt>Approved, not instructed</dt><dd>{signedMoney(provenance.approvedUninstructedValue)}</dd></div>
      <div><dt>Effective issued VOs</dt><dd>{signedMoney(provenance.issuedVariationOrderValue)}</dd></div>
      <div><dt>Current contract</dt><dd>{money(provenance.currentContract ?? pkg?.currentContractValue)}</dd></div>
      <div><dt>Package unresolved exposure</dt><dd>{exposureAvailable ? signedMoney(packageExposure.unresolvedExposure) : 'Unavailable'}</dd><small>Live package position before any period-specific Site Start absorption.</small></div>
      <div><dt>Certified against VO lines</dt><dd>{signedMoney(directCertified)}</dd></div>
      <div className={attention ? 'po-variation-account__attention' : ''}><dt>Needs QS attention</dt><dd>{attention}</dd></div>
    </dl>

    <div className="po-variation-account__filters">
      <label><span className="sr-only">Search Variation Account</span><input className="input" type="search" placeholder="Search reference, description or cost code" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <label><span className="sr-only">Filter record type</span><select className="input" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All records</option><option value="ce">Commercial Events</option><option value="vo">Variation Orders</option><option value="va">QS Assessments</option></select></label>
    </div>

    {error ? <div role="alert" className="po-list-feedback po-list-feedback--error">{error}</div> : null}
    {voError ? <div role="alert" className="po-list-feedback po-list-feedback--error">{voError}</div> : null}
    {loading || commercialEventsLoading || commercialEventsReady === false
      ? <p className="po-list-feedback">Loading package variation evidence…</p>
      : <div className="po-table-wrap po-variation-account__table-wrap"><table className="po-data-table po-variation-account__table">
        <thead><tr><th>Reference</th><th>Type</th><th>Description</th><th>Cost code</th><th>Contractor claim</th><th>QS assessment</th><th>Claim difference</th><th>Formally instructed</th><th>Certified</th><th>Unresolved exposure</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>{visibleRows.length ? visibleRows.map(row => <Fragment key={row.key}>
          <tr key={row.key} className={row.attention ? 'po-variation-account__row--attention' : ''}>
            <td><strong>{row.reference}</strong>{row.kind === 'vo' && row.vo?.lines?.length > 1 ? <button type="button" className="po-cert-workspace__link" onClick={() => toggleExpanded(row.key)}>{expanded.has(row.key) ? 'Hide' : 'Show'} {row.vo.lines.length} cost-code lines</button> : null}</td>
            <td><TypeLabel kind={row.kind} /></td>
            <td>{row.description}{row.related.length ? <small>Related: {row.related.join(', ')}</small> : null}</td>
            <td>{row.costCodes.join(', ') || '—'}</td>
            <td>{row.contractorClaim == null ? '—' : signedMoney(row.contractorClaim)}{row.contractorPosition != null ? <small>Recorded position {signedMoney(row.contractorPosition)}</small> : null}</td>
            <td>{row.forecast == null ? '—' : signedMoney(row.forecast)}</td>
            <td>{row.claimAssessmentDifference == null ? '—' : signedMoney(row.claimAssessmentDifference)}</td>
            <td>{row.instructed == null ? '—' : signedMoney(row.instructed)}</td>
            <td>{row.certified == null ? row.kind === 'va' ? 'VA item — see certificate' : '—' : signedMoney(row.certified)}</td>
            <td>{row.unresolved == null ? row.exposureNote || '—' : signedMoney(row.unresolved)}</td>
            <td>{row.status || 'Recorded'}</td>
            <td>{row.kind === 'vo' ? <button type="button" className="po-list-btn-secondary" onClick={() => openVariationOrder(row)}>Open VO</button> : row.kind === 'ce' ? <button type="button" className="po-list-btn-secondary" onClick={() => openCommercialEvent(row)}>Open CE</button> : <button type="button" className="po-list-btn-secondary" onClick={() => { setSelectedVaTarget({ itemId: row.id }); setActionPanel('va'); }}>Open assessment</button>}</td>
          </tr>
          {row.kind === 'vo' && expanded.has(row.key) ? <tr key={`${row.key}:detail`} className="po-variation-account__line-detail"><td colSpan="12"><table><thead><tr><th>Line</th><th>Cost code</th><th>Description</th><th>Issued value</th></tr></thead><tbody>{row.vo.lines.map(line => <tr key={line.id}><td>{line.lineNumber}</td><td>{line.costCode}{line.costCodeDescription ? ` — ${line.costCodeDescription}` : ''}</td><td>{line.description}</td><td>{signedMoney(line.netValue)}</td></tr>)}</tbody></table><p>The VO total is counted once in the account header; these lines show its cost-code allocation.</p></td></tr> : null}
        </Fragment>) : <tr><td colSpan="12" className="po-data-table__empty">No package variation records match the current filter.</td></tr>}</tbody>
      </table></div>}

    {actionPanel ? <section className="po-variation-account__workbench" aria-label="Variation account workbench">
      <header><h3>{actionPanel === 'ce' ? 'Commercial Event workflow' : actionPanel === 'vo' ? 'Variation Order workflow' : 'QS assessment and authority'}</h3><button type="button" className="po-cert-workspace__link" onClick={() => setActionPanel(null)}>Close workbench</button></header>
      {actionPanel === 'ce' ? <PackageCommercialEvents order={order} refreshToken={refreshToken + localRefresh} commercialEventTarget={selectedCeTarget} commercialEventsLoading={commercialEventsLoading} commercialEventsReady={commercialEventsReady} onCommercialEventsChanged={() => { setLocalRefresh(value => value + 1); onCommercialEventsChanged?.(); }} onNavigateToLinkedCommercialEvent={onNavigateToLinkedCommercialEvent} /> : null}
      {actionPanel === 'vo' ? <DirectVariationOrderPanel order={order} packageId={packageId} onChanged={() => setLocalRefresh(value => value + 1)} /> : null}
      {actionPanel === 'va' ? <PackageVariationAccount packageId={packageId} focusItemId={selectedVaTarget?.itemId || null} /> : null}
    </section> : null}

    <VariationOrderDrawer open={Boolean(selectedVo)} variationOrder={selectedVo} onChanged={vo => { setSelectedVo(vo); setLocalRefresh(value => value + 1); }} onClose={() => setSelectedVo(null)} />
  </div>;
}
