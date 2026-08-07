import { loadSetupDraft, formatPaymentTermsLabel } from '../setup/setupDraft';
import {
  getPoDevelopmentListLabel,
} from '../developments/developmentPoHelpers';

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

  const project = getPoDevelopmentListLabel(po);

  const date = formatPoDate(po?.createdAt || po?.date);

  return { supplier, project, date };
}

export function getPoSubtitle(po) {
  const supplier =
    po?.supplierSnapshot?.name ||
    po?.supplierName ||
    po?.supplier ||
    'Supplier not set';

  const project = getPoDevelopmentListLabel(po) || 'No development';

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

function trimTrailingZero(value) {
  return String(value).replace(/\.0$/, '');
}

/**
 * Compact presentation format for dashboard and overview monetary values.
 * Abbreviates thousands/millions and omits pence.
 */
export function formatDisplayMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount === 0) {
    return '£0';
  }

  const abs = Math.abs(amount);

  if (abs >= 1_000_000) {
    const millions = abs / 1_000_000;
    const text =
      millions >= 10
        ? String(Math.round(millions))
        : trimTrailingZero(millions.toFixed(1));
    return `£${text}m`;
  }

  if (abs >= 1_000) {
    const thousands = abs / 1_000;
    const text =
      thousands >= 100 && Number.isInteger(thousands)
        ? String(Math.round(thousands))
        : trimTrailingZero(thousands.toFixed(1));
    return `£${text}k`;
  }

  return `£${Math.round(abs).toLocaleString('en-GB')}`;
}

export function formatSignedDisplayMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount === 0) {
    return '£0';
  }

  const formatted = formatDisplayMoney(Math.abs(amount));
  if (amount > 0) {
    return `+${formatted}`;
  }

  return `−${formatted}`;
}
