/**
 * BL-011D.03 — Payment Certificate approval view helpers (Doc 36 / Doc 37).
 */

import { formatPoDate, formatPoDateTime } from '../components/poDrawerHelpers';
import {
  canCreateNextCertificate,
  getCertificateStatusMeta,
  isApprovedCommercialCertificate,
  isCertificateEditable,
  isCertificateSubmitted,
} from './paymentCertificateStore';

const AUDIT_ACTION_LABELS = {
  created: 'Created',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
};

export function getCertificateListAction(certificate) {
  if (isCertificateEditable(certificate)) {
    return { label: 'Open', mode: 'open' };
  }
  if (isCertificateSubmitted(certificate)) {
    return { label: 'Review', mode: 'review' };
  }
  return { label: 'View', mode: 'view' };
}

export function buildCertificateAuditItems(certificate) {
  const history = Array.isArray(certificate?.auditHistory)
    ? [...certificate.auditHistory]
    : [];

  return history
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .map((entry) => ({
      id: entry.id,
      action: entry.action,
      label: AUDIT_ACTION_LABELS[entry.action] || entry.action,
      actor: entry.actor || '—',
      at: entry.at,
      dateLabel: formatPoDate(entry.at),
      timeLabel: formatPoDateTime(entry.at).split(', ').pop() || '',
      comment: entry.comment || '',
    }));
}

export function buildCertificateHeaderMeta(certificate) {
  if (!certificate) return [];

  const items = [
    {
      label: 'Date',
      value: formatPoDate(certificate.certificateDate),
    },
  ];

  if (certificate.submittedBy && certificate.submittedAt) {
    items.push(
      {
        label: 'Submitted By',
        value: certificate.submittedBy,
      },
      {
        label: 'Submitted Date',
        value: formatPoDateTime(certificate.submittedAt),
      }
    );
  }

  if (certificate.approvedBy && certificate.approvedAt) {
    items.push(
      {
        label: 'Approved By',
        value: certificate.approvedBy,
      },
      {
        label: 'Approved Date',
        value: formatPoDateTime(certificate.approvedAt),
      }
    );
  }

  return items;
}

export function getCreateCertificateState(orderKey, certificateCount) {
  const gate = canCreateNextCertificate(orderKey);
  const nextNumber = certificateCount + 1;

  return {
    ok: gate.ok,
    reason: gate.reason || '',
    label:
      certificateCount === 0
        ? 'Create Certificate No. 1'
        : `Create Certificate No. ${nextNumber}`,
  };
}

export {
  getCertificateStatusMeta,
  isApprovedCommercialCertificate,
  isCertificateEditable,
  isCertificateSubmitted,
};
