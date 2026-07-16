/**
 * BL-019C.4 — Revenue source consistency validation.
 */

import { DEFAULT_REVENUE_SOURCE } from './revenueTypes';

export const CANONICAL_REVENUE_SOURCES = [
  'Development Strategy',
  'House Type',
  'Plot Override',
  'Manual Value',
];

export function resolveCanonicalRevenueSource(plot = {}) {
  const source = String(plot.revenueSource || plot.pricingSource || DEFAULT_REVENUE_SOURCE).trim();
  if (CANONICAL_REVENUE_SOURCES.includes(source)) return source;
  return DEFAULT_REVENUE_SOURCE;
}

export function validatePlotPricingConsistency(plot = {}) {
  const source = resolveCanonicalRevenueSource(plot);
  const issues = [];

  if (!CANONICAL_REVENUE_SOURCES.includes(source)) {
    issues.push(`Unknown revenue source "${source}".`);
  }

  if (source === 'Plot Override' && !Number(plot.plotOverrideValue)) {
    issues.push('Plot Override selected without an override value.');
  }

  if (source === 'Manual Value' && !Number(plot.manualForecastValue) && !plot.manualOverrideExplicit) {
    issues.push('Manual Value selected without a manual forecast.');
  }

  const declaredSources = [
    plot.revenueSource,
    plot.pricingSource,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  const uniqueSources = [...new Set(declaredSources)];
  if (uniqueSources.length > 1) {
    issues.push(`Multiple revenue sources declared: ${uniqueSources.join(', ')}.`);
  }

  return {
    valid: issues.length === 0,
    source,
    issues,
  };
}

export function auditPlotPricingSources(plots = []) {
  const inconsistentPlots = [];
  const sourceCounts = {
    'Development Strategy': 0,
    'House Type': 0,
    'Plot Override': 0,
    'Manual Value': 0,
  };

  for (const plot of plots) {
    const audit = validatePlotPricingConsistency(plot);
    sourceCounts[audit.source] = (sourceCounts[audit.source] || 0) + 1;
    if (!audit.valid) inconsistentPlots.push({ plotId: plot.id, plotNumber: plot.plotNumber, issues: audit.issues });
  }

  return {
    sourceCounts,
    inconsistentPlots,
    inconsistentCount: inconsistentPlots.length,
    isConsistent: inconsistentPlots.length === 0,
  };
}
