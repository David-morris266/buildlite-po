// client/src/POList.jsx
import { useEffect, useMemo, useState } from 'react';
import { listPOs, deletePO, getPO, approvePO, requestApproval } from '../api';
import POForm from './POForm';
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

// Open PDF helper
const openPdf = (poNumber) => {
  if (!poNumber) return;
  window.open(
    `/api/po/${encodeURIComponent(poNumber)}/pdf`,
    '_blank',
    'noopener'
  );
};

export default function POList() {
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

  // --- ROLE HANDLING -------------------------------------------------
const rawRole =
  (localStorage.getItem('role') ||
    localStorage.getItem('userRole') ||
    'requester') + '';
const normalisedRole = rawRole.toLowerCase();
const isApprover = normalisedRole === 'approver';
const userRoleLabel = isApprover ? 'Approver' : 'Requester';

// Logged-in user email
const userEmail = localStorage.getItem('userEmail') || '';

// Allow toggle only for authorised emails
const allowedEmails = [
  'david@dmcommercialconsulting.co.uk',
  // Add others below if needed, e.g.:
  // 'russell@cotswoldoak.co.uk',
  // 'karl@levisonrose.co.uk',
];
const canToggleRole = allowedEmails.some(
  (e) => e.toLowerCase() === userEmail.toLowerCase()
);

const handleToggleRole = () => {
  const next = isApprover ? 'requester' : 'approver';
  localStorage.setItem('role', next);
  localStorage.setItem('userRole', next);
  window.location.reload();
};
  // -------------------------------------------------------------------

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
      await approvePO(number, {
        status: newStatus,
        approver: 'manager',
        note: '',
      });
      await fetchData();
      if (selected?.poNumber === number) {
        const fresh = await getPO(number);
        setSelected(fresh);
      }
      alert(`PO ${number} ${newStatus.toLowerCase()}`);
    } catch (e) {
      console.error(e);
      alert(e.message || 'Error updating approval');
    } finally {
      setUpdatingApproval(false);
    }
  }

  async function onSendForApproval(number) {
    if (!number) return;
    try {
      await requestApproval(number);
      await fetchData();
      if (selected?.poNumber === number) {
        const fresh = await getPO(number);
        setSelected(fresh);
      }
      alert(`PO ${number} sent for approval`);
    } catch (e) {
      console.error(e);
      alert(e.message || 'Error sending for approval');
    }
  }

  const badge = (status) => {
    let bg = '#1f2937';
    const s = status || 'Pending';
    if (s === 'Approved') bg = '#064e3b';
    else if (s === 'Rejected') bg = '#4c0519';
    else if (s === 'Draft') bg = '#111827';
    return (
      <span
        style={{
          padding: '2px 8px',
          borderRadius: 999,
          border: '1px solid #374151',
          background: bg,
          color: '#e5e7eb',
          fontSize: 12,
        }}
      >
        {s}
      </span>
    );
  };

  const canEditStatus = (status) => {
    const s = String(status || '').toLowerCase();
    return s === 'draft' || s === 'rejected';
  };

  return (
    <div
      style={{ maxWidth: 1600, margin: '1rem auto', padding: '0 24px 24px' }}
    >
      {/* HEADER WITH ROLE + TOGGLE */}
<div
  style={{
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 8,
  }}
>
  <h2 style={{ marginBottom: 0 }}>Purchase Orders</h2>

  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    {/* Role badge */}
    <span
      style={{
        fontSize: 12,
        padding: '2px 10px',
        borderRadius: 999,
        border: '1px solid #4b5563',
        background: isApprover ? '#14532d' : '#111827',
        color: '#e5e7eb',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}
      title={
        isApprover
          ? 'Approver mode: you can approve or reject POs that are pending.'
          : 'Requester mode: you can create POs and send them for approval.'
      }
    >
      {isApprover ? 'APPROVER MODE' : 'REQUESTER MODE'}
    </span>

    {/* Toggle button (only for authorised emails) */}
    {canToggleRole && (
      <button
        onClick={handleToggleRole}
        title={
          isApprover
            ? 'Switch back to Requester mode (no approve/reject buttons).'
            : 'Switch to Approver mode so you can approve/reject POs.'
        }
        style={{
          fontSize: 12,
          padding: '4px 10px',
          borderRadius: 999,
          border: '1px solid #4b5563',
          background: '#111827',
          color: '#e5e7eb',
          cursor: 'pointer',
        }}
      >
        Switch to {isApprover ? 'Requester' : 'Approver'}
      </button>
    )}
  </div>
</div>
      {/* Filters */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr 120px 1fr auto',
          gap: 8,
          marginBottom: 12,
          alignItems: 'center',
        }}
      >
        <input
          placeholder="Search (PO no / text / cost code)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <input
          placeholder="Job (code or id)"
          value={job}
          onChange={(e) => setJob(e.target.value)}
        />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Type</option>
          <option value="M">M (Materials)</option>
          <option value="S">S (Sub-contract)</option>
        </select>
        <input
          placeholder="Supplier"
          value={supplier}
          onChange={(e) => setSupplier(e.target.value)}
        />
        <label
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            whiteSpace: 'nowrap',
          }}
        >
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Include archived
        </label>
      </div>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {!loading && !error && (
        <>
          <div style={{ marginBottom: 8, fontSize: 14 }}>
            Showing <strong>{totals.count}</strong> POs · Total value £
            {asMoney(totals.sum)}
          </div>

          <div
            style={{
              overflowX: 'auto',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', background: '#11161d' }}>
                  <th style={{ padding: 10 }}>Date</th>
                  <th style={{ padding: 10 }}>PO No</th>
                  <th style={{ padding: 10 }}>Type</th>
                  <th style={{ padding: 10 }}>Supplier</th>
                  <th style={{ padding: 10 }}>Title / Description</th>
                  <th style={{ padding: 10, textAlign: 'right' }}>Total</th>
                  <th style={{ padding: 10 }}>Approval</th>
                  <th style={{ padding: 10 }}>Actions</th>
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
                  const amount =
                    po.subtotal ?? po.totals?.net ?? po.amount ?? 0;
                  const approvalStatus = po.approval?.status;
                  const statusForBadge =
                    approvalStatus || po.status || 'Pending';
                  const rowCanEdit = canEditStatus(po.status);

                  const approvalStatusLower = (approvalStatus || '').toLowerCase();
                  const canApproveRow =
                    isApprover &&
                    (!approvalStatusLower || approvalStatusLower === 'pending');
                  const canSendRow =
                    !isApprover &&
                    (!approvalStatusLower ||
                      approvalStatusLower === 'rejected');

                  return (
                    <tr
                      key={number}
                      style={{ borderTop: '1px solid #1f2732' }}
                    >
                      <td style={{ padding: 10, whiteSpace: 'nowrap' }}>
                        {date}
                      </td>
                      <td style={{ padding: 10 }}>{number}</td>
                      <td style={{ padding: 10 }}>
                        {(po.type || '').toUpperCase()}
                      </td>
                      <td style={{ padding: 10 }}>{supplierName}</td>
                      <td
                        style={{
                          padding: 10,
                          maxWidth: 520,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {title}
                      </td>
                      <td style={{ padding: 10, textAlign: 'right' }}>
                        £{asMoney(amount)}
                      </td>

                      <td style={{ padding: 10 }}>{badge(statusForBadge)}</td>

                      <td
                        style={{
                          padding: 10,
                          display: 'flex',
                          gap: 8,
                          flexWrap: 'wrap',
                        }}
                      >
                        <button onClick={() => openPdf(number)}>🖨️ PDF</button>
                        <button onClick={() => onView(number)}>View</button>

                        {rowCanEdit && (
                          <button onClick={() => onEdit(number)}>Edit</button>
                        )}

                        {canApproveRow && (
                          <>
                            <button
                              disabled={updatingApproval}
                              onClick={() =>
                                onQuickApprove(number, 'Approved')
                              }
                            >
                              Approve
                            </button>
                            <button
                              disabled={updatingApproval}
                              onClick={() =>
                                onQuickApprove(number, 'Rejected')
                              }
                            >
                              Reject
                            </button>
                          </>
                        )}

                        {canSendRow && (
                          <button onClick={() => onSendForApproval(number)}>
                            Send for approval
                          </button>
                        )}

                        <button
                          className="delete-btn"
                          onClick={() => onDelete(number)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      style={{
                        padding: 14,
                        textAlign: 'center',
                        color: '#6b7280',
                      }}
                    >
                      No POs match your filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Drawer */}
      {drawerOpen && (
        <>
          <div
            onClick={() => {
              setDrawerOpen(false);
              setSelected(null);
              setEditMode(false);
            }}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.35)',
            }}
          />
          <div
            style={{
              position: 'fixed',
              top: 0,
              right: 0,
              height: '100vh',
              width: editMode ? '880px' : '480px',
              background: '#0d1117',
              color: '#e5e7eb',
              boxShadow: '-2px 0 10px rgba(0,0,0,0.15)',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              borderLeft: '1px solid #1f2732',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <h3 style={{ margin: 0 }}>
                {editMode ? 'Edit Purchase Order' : 'PO Details'}
              </h3>
              <button
                onClick={() => {
                  setDrawerOpen(false);
                  setSelected(null);
                  setEditMode(false);
                }}
              >
                Close
              </button>
            </div>

            {!selected && <p>Loading…</p>}

            {selected && editMode && (
              <div
                style={{
                  flex: 1,
                  overflow: 'auto',
                  paddingRight: 4,
                }}
              >
                <POForm
                  initialPo={selected}
                  onSaved={async (updatedPo) => {
                    setSelected(updatedPo);
                    setEditMode(false);
                    await fetchData();
                  }}
                />
              </div>
            )}

            {selected && !editMode && (
              <div
                style={{
                  display: 'grid',
                  gap: 8,
                  overflow: 'auto',
                  paddingRight: 4,
                }}
              >
                <div>
                  <strong>PO No:</strong> {selected.poNumber}
                </div>
                <div>
                  <strong>Date:</strong>{' '}
                  {(selected.createdAt || selected.date || '').slice(0, 10)}
                </div>
                <div>
                  <strong>Type:</strong>{' '}
                  {(selected.type || '').toUpperCase()}
                </div>
                <div>
                  <strong>Supplier:</strong>{' '}
                  {selected.supplierSnapshot?.name ||
                    selected.supplierName ||
                    selected.supplier}
                </div>
                <div>
                  <strong>Title:</strong>{' '}
                  {selected.title || selected.description || '-'}
                </div>
                <div>
                  <strong>Status:</strong> {selected.status} ·{' '}
                  <strong>Approval:</strong> {selected.approval?.status}
                </div>
                <div>
                  <strong>Net:</strong> £
                  {asMoney(
                    selected.subtotal ?? selected.totals?.net ?? 0
                  )}
                </div>
                {selected.totals?.vat != null && (
                  <div>
                    <strong>VAT:</strong> £
                    {asMoney(selected.totals.vat)}
                  </div>
                )}
                {selected.totals?.gross != null && (
                  <div>
                    <strong>Gross:</strong> £
                    {asMoney(selected.totals.gross)}
                  </div>
                )}

                {Array.isArray(selected.approval?.history) &&
                  selected.approval.history.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          marginBottom: 6,
                        }}
                      >
                        Approval Timeline
                      </div>
                      <div
                        style={{
                          border: '1px solid #1f2732',
                          borderRadius: 8,
                          maxHeight: '22vh',
                          overflow: 'auto',
                        }}
                      >
                        <table
                          style={{
                            width: '100%',
                            borderCollapse: 'collapse',
                          }}
                        >
                          <thead>
                            <tr
                              style={{
                                textAlign: 'left',
                                background: '#11161d',
                              }}
                            >
                              <th style={{ padding: 8, width: 120 }}>When</th>
                              <th style={{ padding: 8, width: 120 }}>Action</th>
                              <th style={{ padding: 8, width: 180 }}>By</th>
                              <th style={{ padding: 8 }}>Note</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...selected.approval.history]
                              .reverse()
                              .map((h, i) => (
                                <tr
                                  key={i}
                                  style={{
                                    borderTop: '1px solid #1f2732',
                                  }}
                                >
                                  <td style={{ padding: 8 }}>
                                    {(h.at || '')
                                      .slice(0, 19)
                                      .replace('T', ' ')}
                                  </td>
                                  <td style={{ padding: 8 }}>{h.action}</td>
                                  <td style={{ padding: 8 }}>
                                    {h.by || '-'}
                                  </td>
                                  <td style={{ padding: 8 }}>
                                    {h.note || ''}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                {Array.isArray(selected.items) &&
                  selected.items.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          marginBottom: 6,
                        }}
                      >
                        Items
                      </div>
                      <div
                        style={{
                          border: '1px solid #1f2732',
                          borderRadius: 8,
                          maxHeight: '30vh',
                          overflow: 'auto',
                        }}
                      >
                        <table
                          style={{
                            width: '100%',
                            borderCollapse: 'collapse',
                          }}
                        >
                          <thead>
                            <tr
                              style={{
                                textAlign: 'left',
                                background: '#11161d',
                              }}
                            >
                              <th style={{ padding: 8 }}>Description</th>
                              <th style={{ padding: 8 }}>Qty</th>
                              <th style={{ padding: 8 }}>Rate</th>
                              <th
                                style={{
                                  padding: 8,
                                  textAlign: 'right',
                                }}
                              >
                                Line Total
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {selected.items.map((it, i) => (
                              <tr
                                key={i}
                                style={{
                                  borderTop: '1px solid #1f2732',
                                }}
                              >
                                <td style={{ padding: 8 }}>
                                  {it.description}
                                </td>
                                <td style={{ padding: 8 }}>
                                  {it.qty ?? it.quantity ?? ''}
                                </td>
                                <td style={{ padding: 8 }}>
                                  £
                                  {asMoney(
                                    it.rate ?? it.unitRate ?? 0
                                  )}
                                </td>
                                <td
                                  style={{
                                    padding: 8,
                                    textAlign: 'right',
                                  }}
                                >
                                  £
                                  {asMoney(
                                    it.total ??
                                      (Number(it.qty || it.quantity || 0) *
                                        Number(
                                          it.rate || it.unitRate || 0
                                        ))
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    marginTop: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  <button onClick={() => openPdf(selected.poNumber)}>
                    🖨️ PDF
                  </button>

                  {canEditStatus(selected.status) && (
                    <button onClick={() => setEditMode(true)}>Edit</button>
                  )}

                  {isApprover &&
                    (!selected.approval?.status ||
                      (selected.approval?.status + '')
                        .toLowerCase() === 'pending') && (
                      <>
                        <button
                          disabled={updatingApproval}
                          onClick={async () => {
                            await onQuickApprove(
                              selected.poNumber,
                              'Approved'
                            );
                          }}
                        >
                          Approve
                        </button>
                        <button
                          disabled={updatingApproval}
                          onClick={async () => {
                            await onQuickApprove(
                              selected.poNumber,
                              'Rejected'
                            );
                          }}
                        >
                          Reject
                        </button>
                      </>
                    )}

                  {!isApprover &&
                    (!selected.approval?.status ||
                      (selected.approval?.status + '')
                        .toLowerCase() === 'rejected') && (
                      <button
                        onClick={() =>
                          onSendForApproval(selected.poNumber)
                        }
                      >
                        Send for approval
                      </button>
                    )}

                  <button
                    className="delete-btn"
                    onClick={() => onDelete(selected.poNumber)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
