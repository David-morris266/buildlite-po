/**
 * BL-024A.2 — Certificate intelligence recommendation provider (Doc 63).
 */

import { listCommercialEventsByDevelopment } from '../commercialEvents/commercialEventStore';
import { formatSignedCommercialEventValue } from '../commercialEvents/commercialEventPackageValue';
import { isRecoveryCommercialEvent } from '../commercialEvents/commercialEventRegisterBadges';
import { PACKAGE_VALUE_STATUSES } from '../commercialEvents/commercialEventTypes';
import { isActiveRecovery } from '../commercialEvents/commercialEventRecovery';
import { COMMERCIAL_ASSISTANT_CONFIG } from './commercialAssistantConfig';
import {
  buildPackageAssistantFacts,
  formatCertificateStatusLabel,
  getOutstandingRecoveryAmount,
  isPackageInDevelopment,
  listApprovedEventsAwaitingValuation,
} from './certificateAssistantHelpers';
import { getCommercialEventRecoveryPresentation } from '../commercialEvents/commercialEventRecoveryOverlay';
import { buildRecommendationFingerprint } from './recommendationFingerprint';
import {
  COMMERCIAL_ASSISTANT_NAVIGATION_KIND,
  RECOMMENDATION_CATEGORY,
  RECOMMENDATION_GENERATED_BY,
  RECOMMENDATION_PRIORITY,
  RECOMMENDATION_SOURCE_MODULE,
} from './commercialAssistantTypes';

export const CERTIFICATE_RULE_ID = {
  certificateDue: 'cert.certificate-due.v1',
  certificateOverdue: 'cert.certificate-overdue.v1',
  approvedEventsAwaitingValuation: 'cert.approved-events-awaiting-valuation.v1',
  outstandingRecovery: 'cert.outstanding-recovery.v1',
  draftAwaitingApproval: 'cert.draft-awaiting-approval.v1',
};

function parseWhen(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildPackageCertificatesNavigationTarget(developmentId, packageRow, certificateId = null) {
  return {
    kind: COMMERCIAL_ASSISTANT_NAVIGATION_KIND.packageCertificates,
    developmentId,
    orderKey: packageRow.orderKey,
    packageId: packageRow.orderKey,
    certificateId: certificateId || null,
  };
}

function buildPackageCommercialEventsNavigationTarget(developmentId, packageRow) {
  return {
    kind: COMMERCIAL_ASSISTANT_NAVIGATION_KIND.packageCommercialEvents,
    developmentId,
    orderKey: packageRow.orderKey,
    packageId: packageRow.orderKey,
  };
}

function buildRecoveryNavigationTarget(event, developmentId) {
  return {
    kind: COMMERCIAL_ASSISTANT_NAVIGATION_KIND.developmentCommercialEvent,
    developmentId,
    eventId: event.id,
    packageId: event.packageId || null,
  };
}

function buildCertificateDueRecommendation(packageRow, facts, developmentId, now = new Date()) {
  const daysSince = facts.daysSinceLastCertificate;
  const reminderDays = COMMERCIAL_ASSISTANT_CONFIG.certificateReminderDays;
  const overdueThreshold =
    reminderDays + (COMMERCIAL_ASSISTANT_CONFIG.certificateOverdueGraceDays || 0);

  if (daysSince == null || daysSince < reminderDays) return null;
  if (daysSince >= overdueThreshold) return null;
  if (facts.activeOpenCertificate) return null;

  return {
    fingerprint: buildRecommendationFingerprint(
      RECOMMENDATION_SOURCE_MODULE.certificates,
      CERTIFICATE_RULE_ID.certificateDue,
      facts.orderKey
    ),
    ruleId: CERTIFICATE_RULE_ID.certificateDue,
    type: CERTIFICATE_RULE_ID.certificateDue,
    category: RECOMMENDATION_CATEGORY.warning,
    priority: RECOMMENDATION_PRIORITY.medium,
    title: 'Certificate due',
    description: `${facts.supplierLabel} (${facts.costCode}) appears due for its next routine valuation.`,
    recommendation: 'Consider preparing the next payment certificate.',
    sourceModule: RECOMMENDATION_SOURCE_MODULE.certificates,
    sourceRecordId: facts.orderKey,
    navigationTarget: buildPackageCertificatesNavigationTarget(developmentId, packageRow),
    evidence: [
      { label: 'Supplier', value: facts.supplierLabel },
      { label: 'Cost code', value: String(facts.costCode) },
      { label: 'Last certificate date', value: facts.lastCertificateDate || '—' },
      { label: 'Days since last certificate', value: String(daysSince) },
      {
        label: 'Last certificate',
        value: facts.lastApprovedCertificate
          ? `No. ${facts.lastApprovedCertificate.certificateNumber}`
          : '—',
      },
      { label: 'Current package value', value: facts.currentPackageValueLabel || '—' },
    ],
    generatedBy: RECOMMENDATION_GENERATED_BY.rule,
    observedAt:
      parseWhen(facts.lastApprovedCertificate?.approvedAt || facts.lastApprovedCertificate?.createdAt) ||
      now.toISOString(),
    createdAt: now.toISOString(),
  };
}

function buildCertificateOverdueRecommendation(packageRow, facts, developmentId, now = new Date()) {
  const daysSince = facts.daysSinceLastCertificate;
  const reminderDays = COMMERCIAL_ASSISTANT_CONFIG.certificateReminderDays;
  const overdueThreshold =
    reminderDays + (COMMERCIAL_ASSISTANT_CONFIG.certificateOverdueGraceDays || 0);

  if (daysSince == null || daysSince < overdueThreshold) return null;
  if (facts.activeOpenCertificate) return null;

  return {
    fingerprint: buildRecommendationFingerprint(
      RECOMMENDATION_SOURCE_MODULE.certificates,
      CERTIFICATE_RULE_ID.certificateOverdue,
      facts.orderKey
    ),
    ruleId: CERTIFICATE_RULE_ID.certificateOverdue,
    type: CERTIFICATE_RULE_ID.certificateOverdue,
    category: RECOMMENDATION_CATEGORY.actionRequired,
    priority: RECOMMENDATION_PRIORITY.high,
    title: 'Certificate overdue for valuation',
    description:
      'Package appears overdue for valuation based on the current BuildLite valuation cycle.',
    recommendation: 'Consider preparing the next payment certificate.',
    sourceModule: RECOMMENDATION_SOURCE_MODULE.certificates,
    sourceRecordId: facts.orderKey,
    navigationTarget: buildPackageCertificatesNavigationTarget(developmentId, packageRow),
    evidence: [
      { label: 'Supplier', value: facts.supplierLabel },
      { label: 'Cost code', value: String(facts.costCode) },
      { label: 'Last certificate date', value: facts.lastCertificateDate || '—' },
      { label: 'Days since last certificate', value: String(daysSince) },
      {
        label: 'Reminder threshold (days)',
        value: String(reminderDays),
      },
      { label: 'Current package value', value: facts.currentPackageValueLabel || '—' },
    ],
    generatedBy: RECOMMENDATION_GENERATED_BY.rule,
    observedAt:
      parseWhen(facts.lastApprovedCertificate?.approvedAt || facts.lastApprovedCertificate?.createdAt) ||
      now.toISOString(),
    createdAt: now.toISOString(),
  };
}

function buildApprovedEventsAwaitingValuationRecommendation(
  packageRow,
  events,
  facts,
  developmentId,
  now = new Date()
) {
  if (!events.length) return null;

  const netMovement = events.reduce((total, event) => total + toNumber(event.value), 0);
  const eventNumbers = events
    .map((event) => event.eventNumber || event.id)
    .slice(0, 5)
    .join(', ');

  return {
    fingerprint: buildRecommendationFingerprint(
      RECOMMENDATION_SOURCE_MODULE.certificates,
      CERTIFICATE_RULE_ID.approvedEventsAwaitingValuation,
      facts.orderKey
    ),
    ruleId: CERTIFICATE_RULE_ID.approvedEventsAwaitingValuation,
    type: CERTIFICATE_RULE_ID.approvedEventsAwaitingValuation,
    category: RECOMMENDATION_CATEGORY.warning,
    priority: RECOMMENDATION_PRIORITY.medium,
    title: 'Approved commercial events awaiting valuation',
    description: `${facts.supplierLabel} (${facts.costCode}) has approved commercial events not yet included in a certificate.`,
    recommendation: 'Review approved commercial events before preparing the next certificate.',
    financialImpact: formatSignedCommercialEventValue(netMovement),
    financialImpactValue: netMovement,
    sourceModule: RECOMMENDATION_SOURCE_MODULE.certificates,
    sourceRecordId: facts.orderKey,
    navigationTarget: buildPackageCommercialEventsNavigationTarget(developmentId, packageRow),
    evidence: [
      { label: 'Supplier', value: facts.supplierLabel },
      { label: 'Cost code', value: String(facts.costCode) },
      { label: 'Approved event count', value: String(events.length) },
      { label: 'Signed net movement', value: formatSignedCommercialEventValue(netMovement) },
      { label: 'Commercial events', value: eventNumbers || '—' },
      { label: 'Current package value', value: facts.currentPackageValueLabel || '—' },
    ],
    generatedBy: RECOMMENDATION_GENERATED_BY.rule,
    observedAt: now.toISOString(),
    createdAt: now.toISOString(),
  };
}

function buildOutstandingRecoveryRecommendation(event, developmentId, now = new Date()) {
  const orderKey = event.packageId || null;
  const outstanding = getOutstandingRecoveryAmount(event, orderKey);
  if (outstanding <= 0) return null;

  const presentation = orderKey
    ? getCommercialEventRecoveryPresentation(event, orderKey)
    : null;
  const recoveredToDate = toNumber(presentation?.recoveredToDate ?? event.recoveredAmount);

  return {
    fingerprint: buildRecommendationFingerprint(
      RECOMMENDATION_SOURCE_MODULE.certificates,
      CERTIFICATE_RULE_ID.outstandingRecovery,
      event.id
    ),
    ruleId: CERTIFICATE_RULE_ID.outstandingRecovery,
    type: CERTIFICATE_RULE_ID.outstandingRecovery,
    category: RECOMMENDATION_CATEGORY.actionRequired,
    priority: RECOMMENDATION_PRIORITY.high,
    title: 'Outstanding recovery to consider',
    description: `Approved recovery ${event.eventNumber || event.id} has an outstanding balance for certificate consideration.`,
    recommendation: 'Consider recovery on the next payment certificate.',
    financialImpact: formatSignedCommercialEventValue(-outstanding),
    financialImpactValue: -outstanding,
    sourceModule: RECOMMENDATION_SOURCE_MODULE.certificates,
    sourceRecordId: event.id,
    navigationTarget: buildRecoveryNavigationTarget(event, developmentId),
    evidence: [
      { label: 'Event', value: event.eventNumber || event.id, recordRef: event.id },
      { label: 'Outstanding', value: formatSignedCommercialEventValue(-outstanding) },
      { label: 'Recovered to date', value: formatSignedCommercialEventValue(recoveredToDate) },
    ],
    generatedBy: RECOMMENDATION_GENERATED_BY.rule,
    observedAt: parseWhen(event.updatedAt || event.createdAt) || now.toISOString(),
    createdAt: now.toISOString(),
  };
}

function buildDraftAwaitingApprovalRecommendation(
  packageRow,
  certificate,
  facts,
  developmentId,
  now = new Date()
) {
  if (!certificate) return null;

  const submitted = certificate.status === 'submitted';
  const category = submitted
    ? RECOMMENDATION_CATEGORY.warning
    : RECOMMENDATION_CATEGORY.information;

  return {
    fingerprint: buildRecommendationFingerprint(
      RECOMMENDATION_SOURCE_MODULE.certificates,
      CERTIFICATE_RULE_ID.draftAwaitingApproval,
      certificate.id
    ),
    ruleId: CERTIFICATE_RULE_ID.draftAwaitingApproval,
    type: CERTIFICATE_RULE_ID.draftAwaitingApproval,
    category,
    priority: submitted ? RECOMMENDATION_PRIORITY.medium : RECOMMENDATION_PRIORITY.low,
    title: submitted ? 'Certificate awaiting approval' : 'Draft certificate in progress',
    description: submitted
      ? `Certificate No. ${certificate.certificateNumber} for ${facts.supplierLabel} is submitted and awaiting approval.`
      : `Certificate No. ${certificate.certificateNumber} for ${facts.supplierLabel} remains in draft.`,
    recommendation: submitted
      ? 'Review and approve or reject the submitted certificate.'
      : 'Continue preparing the draft certificate or submit when ready.',
    sourceModule: RECOMMENDATION_SOURCE_MODULE.certificates,
    sourceRecordId: certificate.id,
    navigationTarget: buildPackageCertificatesNavigationTarget(
      developmentId,
      packageRow,
      certificate.id
    ),
    evidence: [
      { label: 'Supplier', value: facts.supplierLabel },
      { label: 'Cost code', value: String(facts.costCode) },
      { label: 'Certificate number', value: String(certificate.certificateNumber) },
      { label: 'Certificate status', value: formatCertificateStatusLabel(certificate) },
      {
        label: 'Certificate date',
        value: certificate.certificateDate || certificate.createdAt?.slice(0, 10) || '—',
      },
    ],
    generatedBy: RECOMMENDATION_GENERATED_BY.rule,
    observedAt: parseWhen(certificate.updatedAt || certificate.createdAt) || now.toISOString(),
    createdAt: now.toISOString(),
  };
}

export function evaluateOutstandingRecoveryCertificateRecommendation(
  event,
  developmentId,
  now = new Date()
) {
  if (!event?.id || !developmentId) return null;
  if (!isRecoveryCommercialEvent(event)) return null;
  if (!PACKAGE_VALUE_STATUSES.has(event.status)) return null;
  if (!isActiveRecovery(event)) return null;

  return buildOutstandingRecoveryRecommendation(event, developmentId, now);
}

export function buildCertificateRecommendations(context = {}, now = new Date()) {
  const developmentId = context.developmentId || null;
  const packages = Array.isArray(context.packages) ? context.packages : [];
  if (!developmentId) return [];

  const recommendations = [];
  const scopedPackages = packages.filter((packageRow) =>
    isPackageInDevelopment(packageRow, developmentId)
  );

  for (const packageRow of scopedPackages) {
    try {
      const facts = buildPackageAssistantFacts(packageRow, developmentId, now);

      const due = buildCertificateDueRecommendation(packageRow, facts, developmentId, now);
      if (due) recommendations.push(due);

      const overdue = buildCertificateOverdueRecommendation(packageRow, facts, developmentId, now);
      if (overdue) recommendations.push(overdue);

      const awaitingEvents = listApprovedEventsAwaitingValuation(
        developmentId,
        facts.orderKey
      );
      const awaiting = buildApprovedEventsAwaitingValuationRecommendation(
        packageRow,
        awaitingEvents,
        facts,
        developmentId,
        now
      );
      if (awaiting) recommendations.push(awaiting);

      if (facts.activeOpenCertificate) {
        const draftRecommendation = buildDraftAwaitingApprovalRecommendation(
          packageRow,
          facts.activeOpenCertificate,
          facts,
          developmentId,
          now
        );
        if (draftRecommendation) recommendations.push(draftRecommendation);
      }
    } catch {
      // Legacy or malformed records must not break provider evaluation.
    }
  }

  for (const event of listCommercialEventsByDevelopment(developmentId)) {
    try {
      const recovery = evaluateOutstandingRecoveryCertificateRecommendation(
        event,
        developmentId,
        now
      );
      if (recovery) recommendations.push(recovery);
    } catch {
      // Legacy or malformed records must not break provider evaluation.
    }
  }

  return recommendations;
}

export const certificateRecommendationProvider = {
  id: RECOMMENDATION_SOURCE_MODULE.certificates,
  getRecommendations: buildCertificateRecommendations,
};
