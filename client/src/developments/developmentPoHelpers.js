/**
 * BL-009A.03 — Development references on Purchase Orders (Doc 35).
 */

import { getDevelopment, listDevelopments } from './developmentStore';
import { getDevelopmentStatusMeta } from './developmentStore';
import { formatPlotsSummary } from './developmentHelpers';
import { getPlotCount } from './plotMaster';

export const UNKNOWN_DEVELOPMENT_LABEL = 'Unknown Development';

function normalise(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function buildDevelopmentSnapshot(development) {
  if (!development) return null;

  return {
    id: development.id,
    developmentNumber: development.jobNumber || '',
    developmentName: development.developmentName || '',
    status: development.status || 'planning',
    client: development.client || '',
  };
}

export function getPoDevelopmentRef(po) {
  if (!po) return null;

  if (po.development?.id) {
    return po.development;
  }

  const developmentId = po.developmentId || po.costRef?.developmentId;
  if (developmentId) {
    const live = getDevelopment(developmentId);
    if (live) {
      return buildDevelopmentSnapshot(live);
    }
    return {
      id: developmentId,
      developmentNumber: po.developmentNumber || '',
      developmentName: po.developmentName || UNKNOWN_DEVELOPMENT_LABEL,
      status: po.developmentStatus || '',
      client: po.client || '',
    };
  }

  return null;
}

export function getPoDevelopmentId(po) {
  return getPoDevelopmentRef(po)?.id || null;
}

export function mapJobToDevelopment(job) {
  if (!job) return null;

  const developments = listDevelopments();
  if (!developments.length) return null;

  const jobNumber = normalise(job.jobNumber || job.jobCode);
  const jobName = normalise(job.name);

  if (jobNumber) {
    const byNumber = developments.find(
      (dev) => normalise(dev.jobNumber) === jobNumber
    );
    if (byNumber) return byNumber;
  }

  if (jobName) {
    const byName = developments.find(
      (dev) => normalise(dev.developmentName) === jobName
    );
    if (byName) return byName;

    const loose = developments.find(
      (dev) =>
        normalise(dev.developmentName).includes(jobName) ||
        jobName.includes(normalise(dev.developmentName))
    );
    if (loose) return loose;
  }

  return null;
}

export function resolvePoDevelopment(po) {
  const direct = getPoDevelopmentRef(po);
  if (direct?.id) {
    const live = getDevelopment(direct.id);
    return {
      ref: direct,
      live,
      label: direct.developmentName || UNKNOWN_DEVELOPMENT_LABEL,
      number: direct.developmentNumber || '—',
      statusMeta: getDevelopmentStatusMeta(direct.status),
      client: direct.client || live?.client || '—',
      plotCount: live ? getPlotCount(live) : null,
      unknown: false,
    };
  }

  const mapped = mapJobToDevelopment(po?.job);
  if (mapped) {
    const snapshot = buildDevelopmentSnapshot(mapped);
    return {
      ref: snapshot,
      live: mapped,
      label: snapshot.developmentName,
      number: snapshot.developmentNumber || '—',
      statusMeta: getDevelopmentStatusMeta(snapshot.status),
      client: snapshot.client || '—',
      plotCount: getPlotCount(mapped),
      unknown: false,
      mappedFromJob: true,
    };
  }

  const job = po?.job || {};
  const legacyLabel = [job.name, job.jobNumber || job.jobCode || po?.costRef?.jobCode]
    .filter(Boolean)
    .join(' · ');

  return {
    ref: null,
    live: null,
    label: legacyLabel || UNKNOWN_DEVELOPMENT_LABEL,
    number: job.jobNumber || job.jobCode || po?.costRef?.jobCode || '—',
    statusMeta: null,
    client: job.client || '—',
    plotCount: null,
    unknown: !legacyLabel,
  };
}

export function getPoDevelopmentListLabel(po) {
  const resolved = resolvePoDevelopment(po);
  if (resolved.unknown && !po?.job?.name && !po?.development?.developmentName) {
    return UNKNOWN_DEVELOPMENT_LABEL;
  }
  return resolved.label;
}

export function formatDevelopmentSelectorOption(development) {
  const status = getDevelopmentStatusMeta(development.status);
  return {
    id: development.id,
    number: development.jobNumber || '—',
    name: development.developmentName || 'Untitled development',
    statusLabel: status.label,
    statusModifier: status.modifier,
    display: `${development.jobNumber || '—'} – ${development.developmentName || 'Untitled development'}`,
  };
}

export function buildDevelopmentSummaryModel(development) {
  if (!development) return null;

  const status = getDevelopmentStatusMeta(development.status);
  const plotCount = getPlotCount(development);

  return {
    developmentName: development.developmentName || '—',
    developmentNumber: development.jobNumber || '—',
    statusLabel: status.label,
    statusModifier: status.modifier,
    client: development.client || '—',
    plotsLabel: formatPlotsSummary(plotCount),
  };
}

export function buildPoDevelopmentPayload(development) {
  const snapshot = buildDevelopmentSnapshot(development);
  if (!snapshot) return {};

  return {
    developmentId: snapshot.id,
    developmentNumber: snapshot.developmentNumber,
    developmentName: snapshot.developmentName,
    developmentStatus: snapshot.status,
    development: snapshot,
  };
}
