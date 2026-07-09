/**
 * BL-014 — CVR period status model (mirrors Payment Certificate philosophy).
 */

export const CVR_PERIOD_STATUSES = {
  draft: { value: 'draft', label: 'Draft', modifier: 'draft' },
  submitted: { value: 'submitted', label: 'Submitted', modifier: 'pending' },
  approved: { value: 'approved', label: 'Approved', modifier: 'approved' },
  locked: { value: 'locked', label: 'Locked', modifier: 'approved' },
};

export const CVR_PERIOD_DEFAULT_STATUS = 'draft';

export function getCvrPeriodStatusMeta(statusValue) {
  if (statusValue === 'approved') {
    return CVR_PERIOD_STATUSES.locked;
  }
  return (
    CVR_PERIOD_STATUSES[statusValue] ||
    CVR_PERIOD_STATUSES[CVR_PERIOD_DEFAULT_STATUS]
  );
}

export function isCvrPeriodDraft(period) {
  return period?.status === CVR_PERIOD_DEFAULT_STATUS;
}

export function isCvrPeriodSubmitted(period) {
  return period?.status === 'submitted';
}

export function isCvrPeriodLocked(period) {
  const status = period?.status;
  return status === 'locked' || status === 'approved';
}

export function isCvrPeriodEditable(period) {
  return isCvrPeriodDraft(period);
}

export function canSubmitCvrPeriod(period) {
  return isCvrPeriodDraft(period);
}

export function canApproveCvrPeriod(period) {
  return isCvrPeriodSubmitted(period);
}

export function canRejectCvrPeriod(period) {
  return isCvrPeriodSubmitted(period);
}

export function canCreateNextCvrPeriod(periods = []) {
  const draft = periods.find((item) => isCvrPeriodDraft(item));
  if (draft) {
    return {
      ok: false,
      reason: `Period ${draft.periodKey} is still in draft. Complete or submit it before creating another.`,
      draftPeriodKey: draft.periodKey,
    };
  }

  const sorted = sortPeriodKeys(periods.map((item) => item.periodKey));
  const latestKey = sorted[sorted.length - 1];
  const latest = periods.find((item) => item.periodKey === latestKey);

  if (!latest) {
    return { ok: true };
  }

  if (!isCvrPeriodLocked(latest)) {
    return {
      ok: false,
      reason: `Period ${latest.periodKey} must be locked before creating the next period.`,
    };
  }

  return { ok: true };
}

export function sortPeriodKeys(keys = []) {
  return [...keys].sort((a, b) => parsePeriodNumber(a) - parsePeriodNumber(b));
}

export function parsePeriodNumber(periodKey) {
  const match = String(periodKey || '').match(/P(\d+)/i);
  return match ? Number.parseInt(match[1], 10) : 0;
}

export function formatNextPeriodKey(existingKeys = []) {
  const numbers = existingKeys.map(parsePeriodNumber).filter((n) => n > 0);
  const next = numbers.length ? Math.max(...numbers) + 1 : 1;
  return `P${String(next).padStart(2, '0')}`;
}
