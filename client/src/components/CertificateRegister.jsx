import { useCallback, useEffect, useMemo, useState } from 'react';
import { listCertificateRegister } from '../api';
import POPageHeader from './POPageHeader';
import POLoading from './POLoading';

const PAGE_SIZE = 25;
const DEFAULT_STATE = { search: '', developmentId: '', supplierId: '', status: '', sort: 'newest', page: 1 };
const STATUS_LABELS = { draft: 'Draft', submitted: 'Submitted', locked: 'Locked' };

function money(value) {
  if (value == null || !Number.isFinite(Number(value))) return 'Unavailable';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(Number(value));
}
function date(value) {
  if (!value) return 'Unavailable';
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? 'Unavailable' : parsed.toLocaleDateString('en-GB', { timeZone: 'UTC' });
}

export default function CertificateRegister({ initialState = DEFAULT_STATE, onStateChange, onOpenCertificate }) {
  const [filters, setFilters] = useState(() => ({ ...DEFAULT_STATE, ...initialState }));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const query = useMemo(() => ({ ...filters, pageSize: PAGE_SIZE }), [filters]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true); setError('');
      try { const next = await listCertificateRegister(query); if (!cancelled) setData(next); }
      catch (caught) { if (!cancelled) setError(caught?.message || 'Certificate Register could not be loaded.'); }
      finally { if (!cancelled) setLoading(false); }
    }, filters.search ? 250 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, filters.search]);

  const update = useCallback((next) => { setFilters(next); onStateChange?.(next); }, [onStateChange]);
  const change = (key, value) => update({ ...filters, [key]: value, page: 1 });
  const clear = () => update({ ...DEFAULT_STATE });
  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / PAGE_SIZE));
  const hasFilters = Boolean(filters.search || filters.developmentId || filters.supplierId || filters.status);

  useEffect(() => {
    if (!data?.options) return;
    const developmentValid = !filters.developmentId || data.options.developments?.some(item => item.id === filters.developmentId);
    const supplierValid = !filters.supplierId || data.options.suppliers?.some(item => item.id === filters.supplierId);
    if (developmentValid && supplierValid) return;
    update({ ...filters, developmentId: developmentValid ? filters.developmentId : '', supplierId: supplierValid ? filters.supplierId : '', page: 1 });
  }, [data?.options, filters, update]); // stale tenant-specific selectors are cleared after company switching

  useEffect(() => {
    if (!loading && data && filters.page > totalPages) update({ ...filters, page: totalPages });
  }, [data, filters, loading, totalPages, update]);

  return <section className="certificate-register">
    <POPageHeader eyebrow="Commercial control" title="Certificate Register" lead="Find and review certificates across every development in the selected company." showBack={false} />
    <section className="po-module-card certificate-register__filters" aria-label="Certificate filters">
      <label className="certificate-register__search"><span>Search</span><input value={filters.search} onChange={event => change('search', event.target.value)} placeholder="Certificate, supplier, development, package, cost code or PO" /></label>
      <label><span>Development</span><select value={filters.developmentId} onChange={event => change('developmentId', event.target.value)}><option value="">All developments</option>{(data?.options?.developments || []).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label><span>Supplier</span><select value={filters.supplierId} onChange={event => change('supplierId', event.target.value)}><option value="">All suppliers</option>{(data?.options?.suppliers || []).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label><span>Lifecycle</span><select value={filters.status} onChange={event => change('status', event.target.value)}><option value="">All statuses</option><option value="draft">Draft</option><option value="submitted">Submitted</option><option value="locked">Locked</option></select></label>
      <label><span>Order</span><select value={filters.sort} onChange={event => change('sort', event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="certificate_desc">Certificate number</option></select></label>
      <button type="button" className="po-list-btn-secondary" onClick={clear}>Clear filters</button>
    </section>
    {error ? <div className="po-error-banner" role="alert">{error}<button type="button" className="po-list-btn-secondary" onClick={() => setFilters(current => ({ ...current }))}>Try again</button></div> : null}
    {loading && !data ? <POLoading message="Loading Certificate Register…" /> : null}
    {!loading && !error && data?.total === 0 ? <div className="po-empty-state"><p className="po-empty-state__message">{hasFilters ? 'No certificates match the current filters.' : 'No certificates exist for the selected company.'}</p><p className="po-empty-state__hint">{hasFilters ? 'Clear or change the filters to broaden the register.' : 'Certificates are created from an existing Package.'}</p></div> : null}
    {!error && data?.items?.length ? <>
      <p className="po-summary" aria-live="polite"><strong>{data.total}</strong> certificate{data.total === 1 ? '' : 's'}{loading ? ' · Refreshing…' : ''}</p>
      <div className="po-table-wrap certificate-register__table-wrap"><table className="po-data-table certificate-register__table"><thead><tr><th>Certificate / Package</th><th>Development</th><th>Supplier</th><th>Date</th><th>Status</th><th className="certificate-register__money">Gross value</th><th className="certificate-register__money">Retention</th><th className="certificate-register__money">Net payment</th><th>Context</th><th>Action</th></tr></thead><tbody>{data.items.map(item => {
        const developmentLabel = item.developmentName || item.developmentNumber || 'Development unavailable';
        const supplierLabel = item.supplierName || 'Supplier unavailable';
        const context = `Certificate ${item.certificateNumber}, ${supplierLabel}, ${item.packageDescription || item.costCode || 'package'}, ${developmentLabel}`;
        return <tr key={item.id}><td><strong>Certificate {item.certificateNumber}</strong><small>{item.poReferences || item.orderKey}</small><small>{[item.costCode, item.packageDescription].filter(Boolean).join(' · ') || 'Package details unavailable'}</small></td><td><strong>{developmentLabel}</strong>{item.developmentName && item.developmentNumber ? <small>{item.developmentNumber}</small> : null}</td><td>{item.supplierName || 'Unavailable'}</td><td>{date(item.certificateDate)}</td><td><span className={`po-status-badge po-status-badge--${item.status === 'submitted' ? 'pending' : item.status === 'locked' ? 'approved' : 'draft'}`}>{STATUS_LABELS[item.status] || item.status}</span></td><td className="certificate-register__money">{money(item.grossValue)}</td><td className="certificate-register__money">{money(item.retention)}</td><td className="certificate-register__money"><strong>{money(item.netPayment)}</strong></td><td>{item.status === 'locked' ? <><span>Locked / Approved</span><small>{item.approvedBy || 'Actor unavailable'}</small></> : item.status === 'submitted' ? <><span>Awaiting commercial approval</span><small>{item.submittedBy || 'Actor unavailable'}</small></> : 'Requires QS action'}</td><td><button type="button" className="po-list-btn-secondary" aria-label={`Open ${context}`} onClick={() => onOpenCertificate?.(item, filters)}>Open</button></td></tr>;
      })}</tbody></table></div>
      <nav className="po-pagination" aria-label="Certificate Register pages"><span>Page {filters.page} of {totalPages}</span><div className="po-pagination__controls"><button type="button" className="po-list-btn-secondary" disabled={filters.page <= 1 || loading} onClick={() => update({ ...filters, page: filters.page - 1 })}>Previous</button><button type="button" className="po-list-btn-secondary" disabled={filters.page >= totalPages || loading} onClick={() => update({ ...filters, page: filters.page + 1 })}>Next</button></div></nav>
    </> : null}
  </section>;
}
