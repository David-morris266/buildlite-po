import { loadSetupDraft, formatPaymentTermsLabel } from '../setup/setupDraft';

const ORDER_TYPE_LABELS = {
  M: 'Materials',
  S: 'Subcontract',
  P: 'Plant',
};

const ACTION_LABELS = {
  SENT: 'Sent for approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  UPDATED: 'Updated',
  DRAFT: 'Saved as draft',
};

export function formatOrderType(type) {
  const key = String(type || 'M').toUpperCase();
  return ORDER_TYPE_LABELS[key] || key;
}

export function formatApprovalAction(action) {
  const key = String(action || '').toUpperCase();
  return ACTION_LABELS[key] || action || 'Activity';
}

export function formatPoDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatPoDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getPoDisplayStatus(po) {
  const approval = String(po?.approval?.status || '').toLowerCase();
  const status = String(po?.status || '').toLowerCase();

  if (approval === 'approved' || status === 'approved') {
    return { label: 'Approved', modifier: 'approved' };
  }
  if (approval === 'rejected' || status === 'rejected') {
    return { label: 'Rejected', modifier: 'rejected' };
  }
  if (approval === 'pending' || status === 'issued') {
    return { label: 'Pending Approval', modifier: 'pending' };
  }
  if (status === 'draft' || approval === 'draft') {
    return { label: 'Draft', modifier: 'draft' };
  }
  return { label: 'Pending Approval', modifier: 'pending' };
}

export function getPoRowActionLabel(po) {
  const { modifier } = getPoDisplayStatus(po);
  if (modifier === 'draft' || modifier === 'approved') {
    return 'Open';
  }
  return 'Review';
}

export function getDrawerHeaderMeta(po) {
  const supplier =
    po?.supplierSnapshot?.name ||
    po?.supplierName ||
    po?.supplier ||
    '—';

  const jobSnap = po?.job || {};
  const project =
    jobSnap.name ||
    jobSnap.jobNumber ||
    jobSnap.jobCode ||
    po?.costRef?.jobCode ||
    '—';

  const date = formatPoDate(po?.createdAt || po?.date);

  return { supplier, project, date };
}

export function getPoSubtitle(po) {
  const supplier =
    po?.supplierSnapshot?.name ||
    po?.supplierName ||
    po?.supplier ||
    'Supplier not set';

  const jobSnap = po?.job || {};
  const jobTag =
    jobSnap.jobNumber || jobSnap.jobCode || po?.costRef?.jobCode || '';
  const project = [jobSnap.name, jobTag].filter(Boolean).join(' · ') || 'No project';

  const date = formatPoDate(po?.createdAt || po?.date);

  return `${supplier} · ${project} · ${date}`;
}

export function getPaymentTermsLabel(po) {
  const fromPo = String(po?.paymentTerms || po?.termsLabel || '').trim();
  if (fromPo) return fromPo;

  try {
    const draft = loadSetupDraft();
    return formatPaymentTermsLabel(draft?.defaults?.paymentTerms || '30');
  } catch {
    return '—';
  }
}

export function getCommercialSummary(po) {
  const net = Number(po?.subtotal ?? po?.totals?.net ?? po?.amount ?? 0);
  const vatRate = Number(po?.totals?.vatRate ?? po?.vatRateDefault ?? 0.2);
  const vat =
    po?.totals?.vat != null
      ? Number(po.totals.vat)
      : net * vatRate;
  const gross =
    po?.totals?.gross != null ? Number(po.totals.gross) : net + vat;
  const retentionRate = Number(po?.retentionRateDefault ?? 0);
  const retentionPct = retentionRate > 0 ? `${(retentionRate * 100).toFixed(1).replace(/\.0$/, '')}%` : 'None';

  return {
    net,
    vat,
    gross,
    vatRate,
    retentionPct,
    orderType: formatOrderType(po?.type),
    paymentTerms: getPaymentTermsLabel(po),
  };
}

export function getApprovalTimelineEntries(po) {
  const history = Array.isArray(po?.approval?.history)
    ? [...po.approval.history]
    : [];

  history.sort(
    (a, b) => new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime()
  );

  return history.map((entry, index) => {
    const actionKey = String(entry.action || '').toUpperCase();
    let modifier = 'completed';
    if (actionKey === 'REJECTED') modifier = 'rejected';
    if (actionKey === 'SENT') modifier = 'sent';

    return {
      id: `${entry.at || index}-${entry.action || index}`,
      label: formatApprovalAction(entry.action),
      when: formatPoDate(entry.at),
      by: entry.by || '—',
      note: entry.note || '',
      modifier,
    };
  });
}

export function formatMoney(value) {
  const n = Number(value);
  return Number.isFinite(n)
    ? n.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : '0.00';
}
