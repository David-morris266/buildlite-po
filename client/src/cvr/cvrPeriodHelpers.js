/**
 * BL-014 — CVR period and portfolio view helpers.
 */

import { formatPoDate, formatPoDateTime } from '../components/poDrawerHelpers';
import { listDevelopments } from '../developments/developmentStore';
import { isCvrServerAuthorityEnabled } from './cvrPeriodAuthority';
import { getCvrPeriodReadiness } from './cvrPeriodServerCache';
import { buildCvrModel } from './cvrEngine';
import { formatCvrMoney } from './cvrHelpers';
import {
  CVR_HISTORIC_UNAVAILABLE_SHORT,
} from './cvrHistoricConstants';
import {
  createOrOpenDraftPeriod,
  createNextCvrPeriod,
  findDraftCvrPeriod,
  getCvrPeriod,
  getCvrPeriodStatusMeta,
  isCvrPeriodLocked,
  listCvrPeriods,
} from './cvrPeriodStore';
import { isCvrHistoricSnapshotPeriod, isCvrLegacyLockedPeriod, sortPeriodKeys } from './cvrPeriodStatus';

const AUDIT_ACTION_LABELS = {
  created: 'Created',
  submitted: 'Submitted',
  approved: 'Approved',
  locked: 'Locked',
  rejected: 'Rejected',
};

export function buildCvrPeriodAuditItems(period) {
  const history = Array.isArray(period?.auditHistory) ? [...period.auditHistory] : [];

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

export function buildCvrPeriodRegisterRow(developmentId, period, pos = []) {
  const historicUnavailable = isCvrLegacyLockedPeriod(period);
  const historic = isCvrHistoricSnapshotPeriod(period);
  const model = historicUnavailable
    ? {
        unavailable: true,
        historicUnavailable: true,
        summary: {
          finalForecast: null,
          variance: null,
        },
      }
    : buildCvrModel(developmentId, { pos, periodKey: period.periodKey });
  const status = getCvrPeriodStatusMeta(period.status);
  const forecastUnavailable = Boolean(model.unavailable);

  return {
    periodKey: period.periodKey,
    status,
    statusLabel: status.label,
    forecastLabel: forecastUnavailable ? '—' : formatCvrMoney(model.summary.finalForecast),
    varianceLabel: forecastUnavailable ? '—' : formatCvrMoney(model.summary.variance),
    createdLabel: formatPoDate(period.createdAt),
    submittedLabel: period.submittedAt ? formatPoDate(period.submittedAt) : '—',
    approvedLabel: period.approvedAt ? formatPoDate(period.approvedAt) : '—',
    historic,
    historicUnavailable,
    historicNote: historicUnavailable ? CVR_HISTORIC_UNAVAILABLE_SHORT : null,
    period,
    model,
  };
}

export function buildCvrRegisterModel(development, options = {}) {
  if (isCvrServerAuthorityEnabled()) {
    const readiness = getCvrPeriodReadiness(development.id);
    if (!readiness.ready) {
      return {
        developmentId: development.id,
        developmentName: development.developmentName,
        developmentNumber: development.jobNumber,
        rows: [],
        draftPeriodKey: null,
        canCreateNext: false,
        ready: false,
        unavailable: true,
        loadState: readiness.loadState,
        error: readiness.error || null,
      };
    }
  }

  const periods = listCvrPeriods(development.id);
  const rows = periods.map((period) =>
    buildCvrPeriodRegisterRow(development.id, period, options.pos || [])
  );
  const draftPeriod = findDraftCvrPeriod(development.id);
  const latestLocked = [...periods].reverse().find((period) => isCvrPeriodLocked(period));

  return {
    developmentId: development.id,
    developmentName: development.developmentName,
    developmentNumber: development.jobNumber,
    rows,
    draftPeriodKey: draftPeriod?.periodKey || null,
    canCreateNext: Boolean(latestLocked && !draftPeriod),
    ready: true,
    unavailable: false,
    loadState: 'loaded',
    error: null,
  };
}

export function buildCvrPeriodHeaderMeta(period) {
  if (!period) return [];

  return [
    { label: 'Period', value: period.periodKey || '—' },
    { label: 'Created', value: formatPoDate(period.createdAt) },
    { label: 'Submitted', value: period.submittedAt ? formatPoDate(period.submittedAt) : '—' },
    { label: 'Approved', value: period.approvedAt ? formatPoDate(period.approvedAt) : '—' },
  ];
}

export function buildCvrPortfolioDevelopmentRow(development, pos = []) {
  if (isCvrServerAuthorityEnabled()) {
    const readiness = getCvrPeriodReadiness(development.id);
    if (!readiness.ready) {
      return {
        developmentId: development.id,
        developmentNumber: development.jobNumber,
        developmentName: development.developmentName,
        currentPeriodKey: '—',
        status: null,
        forecastLabel: '—',
        varianceLabel: '—',
        period: null,
        unresolved: true,
        loadState: readiness.loadState,
        error: readiness.error || null,
      };
    }
  }

  const periods = listCvrPeriods(development.id);
  const sortedKeys = sortPeriodKeys(periods.map((item) => item.periodKey));
  const currentKey = sortedKeys[sortedKeys.length - 1];
  const currentPeriod = currentKey ? getCvrPeriod(development.id, currentKey) : null;
  const historicUnavailable = isCvrLegacyLockedPeriod(currentPeriod);
  const model =
    currentPeriod && !historicUnavailable
      ? buildCvrModel(development.id, { pos, periodKey: currentKey })
      : null;
  const forecastUnavailable = Boolean(historicUnavailable || model?.unavailable);

  return {
    developmentId: development.id,
    developmentNumber: development.jobNumber,
    developmentName: development.developmentName,
    currentPeriodKey: currentKey || '—',
    status: currentPeriod ? getCvrPeriodStatusMeta(currentPeriod.status) : null,
    forecastLabel:
      !model || forecastUnavailable ? '—' : formatCvrMoney(model.summary.finalForecast),
    varianceLabel:
      !model || forecastUnavailable ? '—' : formatCvrMoney(model.summary.variance),
    historic: isCvrHistoricSnapshotPeriod(currentPeriod),
    historicUnavailable,
    historicNote: historicUnavailable ? CVR_HISTORIC_UNAVAILABLE_SHORT : null,
    period: currentPeriod,
    unresolved: false,
    loadState: 'loaded',
    error: null,
  };
}

export function buildCvrPortfolioModel(pos = []) {
  const developments = listDevelopments();
  const rows = developments.map((development) =>
    buildCvrPortfolioDevelopmentRow(development, pos)
  );

  let draftCount = 0;
  let submittedCount = 0;
  let lockedThisMonth = 0;
  let portfolioForecast = 0;
  let portfolioVariance = 0;
  let hasForecast = false;
  let hasVariance = false;

  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();

  const awaitingApproval = [];

  for (const development of developments) {
    if (isCvrServerAuthorityEnabled() && !getCvrPeriodReadiness(development.id).ready) {
      continue;
    }

    const periods = listCvrPeriods(development.id);

    for (const period of periods) {
      if (period.status === 'draft') draftCount += 1;
      if (period.status === 'submitted') {
        submittedCount += 1;
        const model = buildCvrModel(development.id, { pos, periodKey: period.periodKey });
        awaitingApproval.push({
          developmentId: development.id,
          developmentName: development.developmentName,
          developmentNumber: development.jobNumber,
          periodKey: period.periodKey,
          forecastLabel: model.unavailable ? '—' : formatCvrMoney(model.summary.finalForecast),
          varianceLabel: model.unavailable ? '—' : formatCvrMoney(model.summary.variance),
          submittedLabel: formatPoDate(period.submittedAt),
        });
      }
      if (isCvrPeriodLocked(period) && period.approvedAt) {
        const approvedDate = new Date(period.approvedAt);
        if (
          approvedDate.getMonth() === month &&
          approvedDate.getFullYear() === year
        ) {
          lockedThisMonth += 1;
        }
      }
    }

    const latestKey = sortPeriodKeys(periods.map((item) => item.periodKey)).pop();
    if (latestKey) {
      const model = buildCvrModel(development.id, { pos, periodKey: latestKey });
      if (model.unavailable) continue;
      if (model.summary.finalForecast != null) {
        hasForecast = true;
        portfolioForecast += model.summary.finalForecast;
      }
      if (model.summary.variance != null) {
        hasVariance = true;
        portfolioVariance += model.summary.variance;
      }
    }
  }

  return {
    rows,
    awaitingApproval,
    summaryCards: [
      {
        label: 'Developments',
        value: String(developments.length),
        modifier: 'default',
      },
      {
        label: 'Draft CVRs',
        value: String(draftCount),
        modifier: 'draft',
      },
      {
        label: 'Submitted CVRs',
        value: String(submittedCount),
        modifier: 'pending',
      },
      {
        label: 'Locked This Month',
        value: String(lockedThisMonth),
        modifier: 'approved',
      },
      {
        label: 'Portfolio Forecast',
        value: hasForecast ? formatCvrMoney(portfolioForecast) : '—',
        modifier: 'default',
      },
      {
        label: 'Portfolio Variance',
        value: hasVariance ? formatCvrMoney(portfolioVariance) : '—',
        modifier: 'default',
      },
    ],
  };
}

export { createOrOpenDraftPeriod, createNextCvrPeriod };
