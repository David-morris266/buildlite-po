/**
 * BL-014 — CVR period and portfolio view helpers.
 */

import { formatPoDate, formatPoDateTime } from '../components/poDrawerHelpers';
import { listDevelopments } from '../developments/developmentStore';
import { isCvrServerAuthorityEnabled } from './cvrPeriodAuthority';
import { getCvrPeriodReadiness } from './cvrPeriodServerCache';
import { buildCvrModel } from './cvrEngine';
import { getVarianceState } from './cvrCalculations';
import {
  buildCvrCommercialPosition,
  calculateCvrGrossMarginPercent,
  calculateCvrGrossProfit,
  formatCvrGrossMarginPercent,
} from './cvrCommercialPosition';
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
import { isCvrHistoricSnapshotPeriod, isCvrLegacyLockedPeriod, periodOrdinal, sortPeriodKeys } from './cvrPeriodStatus';
import { formatReportingPeriod } from './cvrReportingMonth';

const MONTHLY_CVR = 'monthly_cvr';
const PORTFOLIO_MARGIN_POPULATION_HINT = 'Latest monthly CVRs; reporting months may differ.';
const PORTFOLIO_MARGIN_MOVEMENT_HINT = 'Compared with each development\'s preceding locked monthly CVR; reporting months may differ.';

function isMonthlyCvr(period) {
  if (period?.periodType === 'site_start') return false;
  if (String(period?.periodKey || '').toUpperCase() === 'SITE_START') return false;
  return (period?.periodType || MONTHLY_CVR) === MONTHLY_CVR;
}

export function selectCvrPortfolioMarginPeriods(periods = []) {
  const monthlyPeriods = periods.filter(isMonthlyCvr);
  const latestMonthlyKey = sortPeriodKeys(monthlyPeriods.map((item) => item.periodKey)).pop();
  const current = monthlyPeriods.find((item) => item.periodKey === latestMonthlyKey) || null;
  if (!current) return { current: null, previous: null };
  const previous = monthlyPeriods
    .filter((item) => isCvrPeriodLocked(item))
    .filter((item) => periodOrdinal(item) < periodOrdinal(current))
    .sort((a, b) => periodOrdinal(a) - periodOrdinal(b))
    .at(-1) || null;
  return { current, previous };
}

function moneyToPence(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

function marginFromPence(revenuePence, efcPence) {
  if (!Number.isFinite(revenuePence) || revenuePence === 0 || !Number.isFinite(efcPence)) return null;
  return calculateCvrGrossMarginPercent(
    calculateCvrGrossProfit(revenuePence / 100, efcPence / 100),
    revenuePence / 100
  );
}

function formatMarginMovement(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const rounded = Math.abs(Number(value)) < 0.05 ? 0 : Number(value);
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)} pp`;
}

function movementModifier(value) {
  if (value == null || Math.abs(Number(value)) < 0.05) return 'default';
  return Number(value) > 0 ? 'saving' : 'overspend';
}

export function buildCvrPortfolioMarginKpis(positions = []) {
  const totalDevelopments = positions.length;
  const eligible = positions.filter((item) => item?.eligibility === 'eligible');
  const excluded = positions.filter((item) => item?.eligibility === 'no-monthly-cvr');
  const unresolved = positions.filter((item) => item?.eligibility === 'unresolved');
  const coverage = `${eligible.length} of ${totalDevelopments} developments included; ${excluded.length} without a monthly CVR excluded.`;

  if (unresolved.length) {
    return {
      margin: null,
      movement: null,
      marginHint: `Unavailable because monthly-CVR eligibility could not be established for ${unresolved.length} development${unresolved.length === 1 ? '' : 's'}. ${coverage} ${PORTFOLIO_MARGIN_POPULATION_HINT}`,
      movementHint: `Unavailable because the portfolio population is unresolved. ${coverage} ${PORTFOLIO_MARGIN_MOVEMENT_HINT}`,
      coverage: { totalDevelopments, includedDevelopments: eligible.length, excludedNoMonthly: excluded.length, unresolvedDevelopments: unresolved.length },
    };
  }

  if (!eligible.length) {
    return {
      margin: null,
      movement: null,
      marginHint: `No monthly CVR positions are available. ${coverage} ${PORTFOLIO_MARGIN_POPULATION_HINT}`,
      movementHint: `No monthly CVR positions are available. ${coverage} ${PORTFOLIO_MARGIN_MOVEMENT_HINT}`,
      coverage: { totalDevelopments, includedDevelopments: 0, excludedNoMonthly: excluded.length, unresolvedDevelopments: 0 },
    };
  }

  const currentComplete = eligible.every((item) =>
    item?.current?.revenueAvailable === true
      && moneyToPence(item.current.forecastRevenue) != null
      && moneyToPence(item.current.forecastCost) != null
  );

  if (!currentComplete) {
    return {
      margin: null,
      movement: null,
      marginHint: `Unavailable because one or more included monthly CVRs lack complete revenue or EFC evidence. ${coverage} ${PORTFOLIO_MARGIN_POPULATION_HINT}`,
      movementHint: `Unavailable because the current portfolio evidence is incomplete. ${coverage} ${PORTFOLIO_MARGIN_MOVEMENT_HINT}`,
      coverage: { totalDevelopments, includedDevelopments: eligible.length, excludedNoMonthly: excluded.length, unresolvedDevelopments: 0 },
    };
  }

  const currentRevenuePence = eligible.reduce(
    (total, item) => total + moneyToPence(item.current.forecastRevenue), 0
  );
  const currentEfcPence = eligible.reduce(
    (total, item) => total + moneyToPence(item.current.forecastCost), 0
  );
  const margin = marginFromPence(currentRevenuePence, currentEfcPence);

  if (margin == null) {
    return {
      margin: null,
      movement: null,
      marginHint: `Unavailable because aggregate Forecast Revenue is zero. ${coverage} ${PORTFOLIO_MARGIN_POPULATION_HINT}`,
      movementHint: `Unavailable because the current portfolio margin is unavailable. ${coverage} ${PORTFOLIO_MARGIN_MOVEMENT_HINT}`,
      coverage: { totalDevelopments, includedDevelopments: eligible.length, excludedNoMonthly: excluded.length, unresolvedDevelopments: 0 },
    };
  }

  const previousComplete = eligible.every((item) =>
    item?.previous?.revenueAvailable === true
      && item.previous.frozenRevenue === true
      && moneyToPence(item.previous.forecastRevenue) != null
      && moneyToPence(item.previous.forecastCost) != null
  );
  if (!previousComplete) {
    return {
      margin,
      movement: null,
      marginHint: `${coverage} ${PORTFOLIO_MARGIN_POPULATION_HINT}`,
      movementHint: `Unavailable because one or more included developments lack a preceding locked monthly CVR with frozen revenue. ${coverage} ${PORTFOLIO_MARGIN_MOVEMENT_HINT}`,
      coverage: { totalDevelopments, includedDevelopments: eligible.length, excludedNoMonthly: excluded.length, unresolvedDevelopments: 0 },
    };
  }

  const previousRevenuePence = eligible.reduce(
    (total, item) => total + moneyToPence(item.previous.forecastRevenue), 0
  );
  const previousEfcPence = eligible.reduce(
    (total, item) => total + moneyToPence(item.previous.forecastCost), 0
  );
  const previousMargin = marginFromPence(previousRevenuePence, previousEfcPence);
  if (previousMargin == null) {
    return {
      margin,
      movement: null,
      marginHint: `${coverage} ${PORTFOLIO_MARGIN_POPULATION_HINT}`,
      movementHint: `Unavailable because preceding aggregate Forecast Revenue is zero. ${coverage} ${PORTFOLIO_MARGIN_MOVEMENT_HINT}`,
      coverage: { totalDevelopments, includedDevelopments: eligible.length, excludedNoMonthly: excluded.length, unresolvedDevelopments: 0 },
    };
  }

  return {
    margin,
    movement: margin - previousMargin,
    marginHint: `${coverage} ${PORTFOLIO_MARGIN_POPULATION_HINT}`,
    movementHint: `${coverage} ${PORTFOLIO_MARGIN_MOVEMENT_HINT}`,
    coverage: { totalDevelopments, includedDevelopments: eligible.length, excludedNoMonthly: excluded.length, unresolvedDevelopments: 0 },
  };
}

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
    displayPeriodLabel: period.periodType === 'site_start' ? 'Site Start' : period.periodKey,
    status,
    statusLabel: status.label,
    reportingPeriodLabel: period.periodType === 'site_start'
      ? `Forecast as at ${formatReportingPeriod(period.forecastAsAtMonth)}`
      : formatReportingPeriod(period.reportingMonth),
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

  if (period.periodType === 'site_start') {
    return [
      { label: 'Forecast as at', value: formatReportingPeriod(period.forecastAsAtMonth) },
      { label: 'Period', value: 'Site Start' },
      { label: 'Created', value: formatPoDate(period.createdAt) },
      { label: 'Submitted', value: period.submittedAt ? formatPoDate(period.submittedAt) : '—' },
      { label: 'Approved', value: period.approvedAt ? formatPoDate(period.approvedAt) : '—' },
      { label: 'Approved By', value: period.approvedBy || '—' },
    ];
  }

  return [
    { label: 'Reporting Period', value: formatReportingPeriod(period.reportingMonth) },
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
    varianceState:
      !model || forecastUnavailable ? 'neutral' : getVarianceState(model.summary.variance),
    historic: isCvrHistoricSnapshotPeriod(currentPeriod),
    historicUnavailable,
    historicNote: historicUnavailable ? CVR_HISTORIC_UNAVAILABLE_SHORT : null,
    period: currentPeriod,
    unresolved: false,
    loadState: 'loaded',
    error: null,
  };
}

export function buildCvrPortfolioModel(pos = [], dependencies = {}) {
  const developments = dependencies.developments || listDevelopments();
  const serverAuthorityEnabled = dependencies.serverAuthorityEnabled ?? isCvrServerAuthorityEnabled();
  const periodReadiness = dependencies.getPeriodReadiness || getCvrPeriodReadiness;
  const periodsForDevelopment = dependencies.listPeriods || listCvrPeriods;
  const buildModel = dependencies.buildModel || buildCvrModel;
  const buildCommercialPosition = dependencies.buildCommercialPosition || buildCvrCommercialPosition;
  const buildDevelopmentRow = dependencies.buildDevelopmentRow || buildCvrPortfolioDevelopmentRow;
  const rows = developments.map((development) =>
    buildDevelopmentRow(development, pos)
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
  const marginPositions = [];

  for (const development of developments) {
    if (serverAuthorityEnabled && !periodReadiness(development.id).ready) {
      marginPositions.push({ developmentId: development.id, eligibility: 'unresolved', reason: 'periods-unavailable' });
      continue;
    }

    const periods = periodsForDevelopment(development.id);
    const { current: currentPeriod, previous: previousPeriod } = selectCvrPortfolioMarginPeriods(periods);
    if (!currentPeriod) {
      marginPositions.push({ developmentId: development.id, eligibility: 'no-monthly-cvr' });
    } else {
      const currentModel = buildModel(development.id, {
        pos,
        periodKey: currentPeriod.periodKey,
        period: currentPeriod,
      });
      const currentCommercial = currentModel.unavailable
        ? null
        : buildCommercialPosition({
          developmentId: development.id,
          historic: currentModel.historic,
          historicUnavailable: currentModel.historicUnavailable,
          costSummary: currentModel.summary,
          snapshot: currentPeriod.snapshot || null,
        });
      const previousModel = previousPeriod
        ? buildModel(development.id, {
          pos,
          periodKey: previousPeriod.periodKey,
          period: previousPeriod,
        })
        : null;
      const previousCommercial = previousModel && !previousModel.unavailable
        ? buildCommercialPosition({
          developmentId: development.id,
          historic: previousModel.historic,
          historicUnavailable: previousModel.historicUnavailable,
          costSummary: previousModel.summary,
          snapshot: previousPeriod.snapshot || null,
        })
        : null;

      marginPositions.push({
        developmentId: development.id,
        eligibility: 'eligible',
        current: currentCommercial,
        previous: previousCommercial
          ? { ...previousCommercial, frozenRevenue: previousModel.historic === true }
          : null,
      });
    }

    for (const period of periods) {
      if (period.status === 'draft') draftCount += 1;
      if (period.status === 'submitted') {
        submittedCount += 1;
        const model = buildModel(development.id, { pos, periodKey: period.periodKey });
        awaitingApproval.push({
          developmentId: development.id,
          developmentName: development.developmentName,
          developmentNumber: development.jobNumber,
          periodKey: period.periodKey,
          forecastLabel: model.unavailable ? '—' : formatCvrMoney(model.summary.finalForecast),
          varianceLabel: model.unavailable ? '—' : formatCvrMoney(model.summary.variance),
          varianceState: model.unavailable ? 'neutral' : getVarianceState(model.summary.variance),
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
      const model = buildModel(development.id, { pos, periodKey: latestKey });
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

  const marginKpis = buildCvrPortfolioMarginKpis(marginPositions);

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
        label: 'Portfolio EFC',
        value: hasForecast ? formatCvrMoney(portfolioForecast) : '—',
        modifier: 'default',
      },
      {
        label: 'Portfolio Variance',
        value: hasVariance ? formatCvrMoney(portfolioVariance) : '—',
        modifier: hasVariance ? getVarianceState(portfolioVariance) : 'default',
      },
      {
        label: 'Forecast GP Margin',
        value: formatCvrGrossMarginPercent(marginKpis.margin),
        modifier: 'default',
        hint: marginKpis.marginHint,
      },
      {
        label: 'Margin Movement (pp)',
        value: formatMarginMovement(marginKpis.movement),
        modifier: movementModifier(marginKpis.movement),
        hint: marginKpis.movementHint,
      },
    ],
  };
}

export { createOrOpenDraftPeriod, createNextCvrPeriod };
export { resolveCreateNextReportingMonthAction } from './cvrCreateNextReportingMonth';
