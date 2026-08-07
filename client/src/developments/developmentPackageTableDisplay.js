/**
 * BL-022 — Compact Development → Packages table display helpers (presentation only).
 */

import { formatMoney } from '../components/poDrawerHelpers';

const DEFAULT_SUPPLIER_MAX = 28;
const DEFAULT_DESCRIPTION_MAX = 22;

function truncateText(value, maxLength) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function buildPackageTableSupplierDisplay(
  supplierLabel,
  { maxLength = DEFAULT_SUPPLIER_MAX } = {}
) {
  const full = String(supplierLabel || '').trim() || '—';
  const compact = truncateText(full, maxLength) || '—';

  return {
    full,
    compact,
    truncated: compact !== full,
  };
}

export function parseCostCodeParts(costCodeRaw) {
  const raw = String(costCodeRaw || '').trim();
  if (!raw) {
    return { code: '—', description: '' };
  }

  const separated = raw.match(/^([^\s—–-]+)\s*[—–-]\s*(.+)$/);
  if (separated) {
    return {
      code: separated[1].trim(),
      description: separated[2].trim(),
    };
  }

  return { code: raw, description: '' };
}

function resolveCostCodeDescription(pkg) {
  const parsed = parseCostCodeParts(pkg?.costCode);
  if (parsed.description) return parsed.description;

  const firstPo = pkg?.pos?.[0];
  const itemDescription = firstPo?.items?.find((item) => item?.description)?.description;
  if (itemDescription) return String(itemDescription).trim();

  if (firstPo?.title) return String(firstPo.title).trim();
  return '';
}

export function buildPackageTableCostCodeDisplay(
  pkg,
  { descriptionMaxLength = DEFAULT_DESCRIPTION_MAX } = {}
) {
  const parsed = parseCostCodeParts(pkg?.costCode);
  const description = resolveCostCodeDescription(pkg);
  const shortDescription = truncateText(description, descriptionMaxLength);

  const full = description
    ? `${parsed.code} — ${description}`
    : parsed.code;

  const compact = shortDescription
    ? `${parsed.code} · ${shortDescription}`
    : parsed.code;

  return {
    code: parsed.code,
    description,
    compact,
    full,
    truncated: Boolean(description && shortDescription !== description),
  };
}

export function buildPackageTableSecondaryTooltip(pkg, commercialDisplay = {}) {
  const parts = [];

  const commitment = Number(commercialDisplay.originalPoCommitment);
  if (Number.isFinite(commitment)) {
    parts.push(`PO commitment: £${formatMoney(commitment)}`);
  }

  const poNumbers = pkg?.poNumbers?.length
    ? pkg.poNumbers.join(', ')
    : pkg?.pos?.map((po) => po.poNumber || po.number).filter(Boolean).join(', ');

  if (poNumbers) {
    parts.push(`POs: ${poNumbers}`);
  }

  const certificateCount = Number(pkg?.certificateCount) || 0;
  parts.push(`Certificates: ${certificateCount}`);

  if (pkg?.supplierId && pkg.supplierId !== pkg?.supplierLabel) {
    parts.push(`Supplier ID: ${pkg.supplierId}`);
  }

  return parts.join(' · ');
}
