// client/src/POList.jsx
import { useEffect, useMemo, useState } from 'react';
import {
  listPOs,
  deletePO,
  getPO,
  approvePO,
  requestApproval,
  poPdfUrl,
} from '../api';
import {
  buildApproveBody,
  buildRequestApprovalBody,
  canSendPoForApproval,
} from '../setup/setupDraft';
import { getPoRowActionLabel } from './poDrawerHelpers';
import { getPoDevelopmentListLabel } from '../developments/developmentPoHelpers';
import { syncPackageFromApprovedPo } from '../payments/subcontractOrders';
import POForm from './POForm';
import POPageHeader from './POPageHeader';
import POLoading from './POLoading';
import PODrawerShell, { PODrawerLoading } from './PODrawerShell';
import POReviewDrawerContent from './POReviewDrawerContent';
import './POList.css';

const asMoney = (v) => {
  const n = Number(v);
  return Number.isFinite(n)
    ? n.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : '0.00';
};

// Open PDF helper (now uses poPdfUrl from api.js)
const openPdf = (poNumber) => {
  if (!poNumber) return;
  window.open(poPdfUrl(poNumber), '_blank', 'noopener');
};

export default function POList({
  focusPoNumber = null,
  onFocusHandled = null,
  onCreateFirstPO = null,
  onCreateDevelopment = null,
  onOpenPackage = null,
}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // filters
  const [q, setQ] = useState('');
  const [job, setJob] = useState('');
  const [type, setType] = useState(''); // '', 'M', 'S'
  const [supplier, setSupplier] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  // drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [updatingApproval, setUpdatingApproval] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [listFeedback, setListFeedback] = useState(null);

  async function fetchData() {
    try {
      setLoading(true);
      setError('');
      const data = await listPOs({
        q,
        job,
        type,
        supplier,
        pageSize: 500,
        archived: showArchived ? 'true' : 'false',
      });
      const items = Array.isArray(data) ? data : data.items || [];
      setRows(items);
    } catch (e) {
      setError(e.message || 'Failed to load POs');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []); // initial

  useEffect(() => {
    if (!focusPoNumber) return;
    let cancelled = false;

    (async () => {
      try {
        const po = await getPO(focusPoNumber);
        if (cancelled) return;
        setSelected(po);
        setEditMode(false);
        setDrawerOpen(true);
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) onFocusHandled?.();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [focusPoNumber, onFocusHandled]);

  useEffect(() => {
    const t = setTimeout(fetchData, 250);
    return () => clearTimeout(t);
  }, [q, job, type, supplier, showArchived]);

  const totals = useMemo(() => {
    const sum = rows.reduce((acc, r) => {
      const v = r?.subtotal ?? r?.totals?.net ?? r?.amount ?? 0;
      return acc + (Number(v) || 0);
    }, 0);
    return { count: rows.length, sum };
  }, [rows]);

  const hasActiveFilters = Boolean(
    q || job || type || supplier || showArchived
  );

  async function onDelete(number) {
    if (!number) return;
    if (!confirm(`Delete PO ${number}? This cannot be undone.`)) return;
    await deletePO(number);
    await fetchData();
    if (selected?.poNumber === number) {
      setDrawerOpen(false);
      setSelected(null);
      setEditMode(false);
    }
  }

  async function onView(number) {
    if (!number) return;
    const po = await getPO(number);
    setSelected(po);
    setEditMode(false);
    setDrawerOpen(true);
  }

  async function onEdit(number) {
    if (!number) return;
    const po = await getPO(number);
    setSelected(po);
    setEditMode(true);
    setDrawerOpen(true);
  }

  async function onQuickApprove(number, newStatus) {
    if (!number) return;
    try {
      setUpdatingApproval(true);
      setListFeedback(null);
      await approvePO(number, buildApproveBody(newStatus));
      await fetchData();
      if (selected?.poNumber === number) {
        const fresh = await getPO(number);
        setSelected(fresh);
        if (newStatus === 'Approved') {
          syncPackageFromApprovedPo(fresh);
        }
      } else if (newStatus === 'Approved') {
        syncPackageFromApprovedPo(await getPO(number));
      }
      setListFeedback({
        type: newStatus === 'Approved' ? 'success' : 'warning',
        message:
          newStatus === 'Approved'
            ? `Purchase Order ${number} approved. Ready to generate your PDF.`
            : `Purchase Order ${number} rejected.`,
      });
    } catch (e) {
      console.error(e);
      setListFeedback({
        type: 'error',
        message: e.message || 'Could not update approval. Please try again.',
      });
    } finally {
      setUpdatingApproval(false);
    }
  }

  async function onSendForApproval(number) {
    if (!number) return;
    try {
      setListFeedback(null);
      await requestApproval(number, buildRequestApprovalBody());
      await fetchData();
      if (selected?.poNumber === number) {
        const fresh = await getPO(number);
        setSelected(fresh);
      }
      setListFeedback({
        type: 'success',
        message: `Purchase Order ${number} sent for approval.`,
      });
    } catch (e) {
      console.error(e);
      setListFeedback({
        type: 'error',
        message: e.message || 'Could not send for approval. Please try again.',
      });
    }
  }

  const badge = (status) => {
    const s = status || 'Pending';
    let modifier = 'pending';
    if (s === 'Approved') modifier = 'approved';
    else if (s === 'Rejected') modifier = 'rejected';
    else if (s === 'Draft') modifier = 'draft';
    return (
      <span className={`po-status-badge po-status-badge--${modifier}`}>
        {s}
      </span>
    );
  };

  const canEditStatus = (status) => {
    const s = String(status || '').toLowerCase();
    return s === 'draft' || s === 'rejected';
  };

  function closeDrawer() {
    setDrawerOpen(false);
    setSelected(null);
    setEditMode(false);
  }

  return (
    <div className="po-list-page">
      <POPageHeader
        eyebrow="Purchase orders"
        title="Purchase Orders"
        lead="Review, edit and track your Purchase Orders."
      />

      {listFeedback ? (
        <div
          className={`po-list-feedback po-list-feedback--${listFeedback.type}`}
          role="status"
        >
          {listFeedback.message}
          <button
            type="button"
            className="po-list-feedback__dismiss"
            onClick={() => setListFeedback(null)}
            aria-label="Dismiss message"
          >
            ×
          </button>
        </div>
      ) : null}

      <div className="po-module-card po-filters">
        <input
          className="input"
          placeholder="Search (PO no / text / cost code)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search Purchase Orders"
        />
        <input
          className="input"
          placeholder="Development (name or number)"
          value={job}
          onChange={(e) => setJob(e.target.value)}
          aria-label="Filter by development"
        />
        <select
          className="select"
          value={type}
          onChange={(e) => setType(e.target.value)}
          aria-label="Filter by order type"
        >
          <option value="">Type</option>
          <option value="M">M (Materials)</option>
          <option value="S">S (Sub-contract)</option>
        </select>
        <input
          className="input"
          placeholder="Supplier"
          value={supplier}
          onChange={(e) => setSupplier(e.target.value)}
          aria-label="Filter by supplier"
        />
        <label className="po-filters__checkbox">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Include archived
        </label>
      </div>

      {loading ? (
        <POLoading message="Loading Purchase Orders…" />
      ) : null}

      {error ? (
        <div className="po-error-banner" role="alert">
          {error}
        </div>
      ) : null}

      {!loading && !error && rows.length === 0 && !hasActiveFilters ? (
        <div className="po-empty-state">
          <p className="po-empty-state__message">
            You haven&apos;t created any Purchase Orders yet.
          </p>
          <button
            type="button"
            className="po-btn-primary"
            onClick={() => onCreateFirstPO?.()}
          >
            Create your first Purchase Order
          </button>
        </div>
      ) : null}

      {!loading && !error && (rows.length > 0 || hasActiveFilters) ? (
        <>
          <p className="po-summary">
            Showing <strong>{totals.count}</strong> POs · Total value £
            {asMoney(totals.sum)}
          </p>

          <div className="po-table-wrap">
            <table className="po-data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>PO No</th>
                  <th>Type</th>
                  <th>Development</th>
                  <th>Supplier</th>
                  <th>Title / Description</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th>Approval</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
             {rows.map((po, idx) => {
                  const number = po.poNumber || po.number || po.id || idx;
                  const date = (po.createdAt || po.date || '').slice(0, 10);
                  const supplierName =
                    po.supplierSnapshot?.name ||
                    po.supplierName ||
                    po.supplier ||
                    '';
                  const title = po.title || po.description || '-';

                  const developmentLabel = getPoDevelopmentListLabel(po);
                  const amount =
                    po.subtotal ?? po.totals?.net ?? po.amount ?? 0;
                  const approvalStatus = po.approval?.status;
                  const statusForBadge =
                    approvalStatus || po.status || 'Pending';
                  const rowCanEdit = canEditStatus(po.status);

                  const canSendRow = canSendPoForApproval(po);
                  const rowActionLabel = getPoRowActionLabel(po);

                  return (
                    <tr key={number}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {date}
                      </td>
                      <td>{number}</td>
                      <td>
                        {(po.type || '').toUpperCase()}
                      </td>
                      <td>
                        {developmentLabel || '—'}
                      </td>
                      <td>{supplierName}</td>
                      <td
                        style={{
                          maxWidth: 520,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {title}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        £{asMoney(amount)}
                      </td>

                      <td>{badge(statusForBadge)}</td>

                      <td>
                        <div className="po-data-table__actions">
                        <button
                          type="button"
                          className="po-list-btn-primary"
                          onClick={() => onView(number)}
                        >
                          {rowActionLabel}
                        </button>

                        <button type="button" onClick={() => openPdf(number)}>
                          🖨️ PDF
                        </button>

                        {rowCanEdit && (
                          <button type="button" onClick={() => onEdit(number)}>
                            Edit
                          </button>
                        )}

                        {canSendRow && (
                          <button
                            type="button"
                            onClick={() => onSendForApproval(number)}
                          >
                            Send for approval
                          </button>
                        )}

                        <button
                          type="button"
                          className="delete-btn"
                          onClick={() => onDelete(number)}
                        >
                          Delete
                        </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && hasActiveFilters && (
                  <tr>
                    <td colSpan={9} className="po-data-table__empty">
                      No Purchase Orders match your filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {/* Drawer */}
      <PODrawerShell
        open={drawerOpen}
        onClose={closeDrawer}
        wide={editMode}
        ariaLabel={
          editMode ? 'Edit Purchase Order' : 'Purchase Order details'
        }
      >
        {!selected && drawerOpen ? <PODrawerLoading /> : null}

        {selected && editMode ? (
          <div className="po-drawer-edit">
            <div className="po-drawer-edit__header">
              <button
                type="button"
                className="po-drawer-close"
                onClick={closeDrawer}
              >
                Close
              </button>
            </div>
            <div className="po-drawer-edit__body">
              <POForm
                initialPo={selected}
                onCreateDevelopment={onCreateDevelopment}
                onSaved={async (updatedPo) => {
                  setSelected(updatedPo);
                  setEditMode(false);
                  await fetchData();
                }}
              />
            </div>
          </div>
        ) : null}

        {selected && !editMode ? (
          <POReviewDrawerContent
            po={selected}
            feedback={listFeedback}
            updatingApproval={updatingApproval}
            onClose={closeDrawer}
            onDownloadPdf={() => openPdf(selected.poNumber)}
            onEdit={() => setEditMode(true)}
            onDelete={() => onDelete(selected.poNumber)}
            onSendForApproval={() => onSendForApproval(selected.poNumber)}
            onApprove={async () => {
              await onQuickApprove(selected.poNumber, 'Approved');
            }}
            onReject={async () => {
              await onQuickApprove(selected.poNumber, 'Rejected');
            }}
            canEdit={canEditStatus(selected.status)}
            onOpenPackage={onOpenPackage}
          />
        ) : null}
      </PODrawerShell>
    </div>
  );
}
