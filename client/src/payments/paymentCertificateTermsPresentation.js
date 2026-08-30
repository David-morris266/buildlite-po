const FROZEN_STATES = {
  submitted: {
    key: 'submissionGoverningTermsSnapshot',
    label: 'Submitted snapshot',
  },
  locked: {
    key: 'lockedGoverningTermsSnapshot',
    label: 'Locked snapshot',
  },
};

function sourceLabel(source, frozen) {
  const prefix = frozen ? 'Bound PO terms' : 'Bound PO terms';
  switch (source) {
    case 'tenant_default':
      return `${prefix} (company default at PO approval)`;
    case 'development_default':
      return `${prefix} (development default at PO approval)`;
    case 'order_override':
      return `${prefix} (PO override at PO approval)`;
    case 'legacy_confirmed':
      return 'Prospectively confirmed legacy terms';
    case 'po_binding':
    case 'bound_po':
      return 'Bound PO terms';
    default:
      return source ? source.replaceAll('_', ' ') : null;
  }
}

function unavailable(stateLabel, message) {
  return {
    available: false,
    stateLabel,
    message: message || 'Contract terms unavailable',
    capturedAt: null,
  };
}

function fromSnapshot(snapshot, stateLabel) {
  if (!snapshot || snapshot.readiness === 'unavailable' || snapshot.state === 'unconfigured') {
    return unavailable(stateLabel, snapshot?.message);
  }

  return {
    available: Boolean(snapshot.familyName || snapshot.versionLabel || snapshot.revisionNumber),
    stateLabel,
    familyName: snapshot.familyName || null,
    versionLabel: snapshot.versionLabel || null,
    revisionNumber: snapshot.revisionNumber ?? null,
    sourceLabel: sourceLabel(snapshot.source, true),
    capturedAt: snapshot.capturedAt || null,
    message: snapshot.message || null,
  };
}

function fromLive(packageTerms) {
  if (!packageTerms || packageTerms.state === 'unconfigured' || packageTerms.state === 'legacy') {
    return unavailable(
      'Live Draft authority',
      packageTerms?.state === 'legacy'
        ? 'Legacy / not formally configured'
        : packageTerms?.message
    );
  }

  if (packageTerms.state === 'mixed') {
    return unavailable('Live Draft authority', packageTerms.message || 'Contract terms unavailable');
  }

  const version = packageTerms.version;
  if (!version) return unavailable('Live Draft authority', packageTerms.message);

  return {
    available: true,
    stateLabel: 'Live Draft authority',
    familyName: version.familyName || null,
    versionLabel: version.versionLabel || null,
    revisionNumber: version.revisionNumber ?? null,
    sourceLabel: sourceLabel(packageTerms.source, false),
    capturedAt: null,
    message: packageTerms.message || null,
  };
}

export function selectPaymentCertificateTerms(certificate, packageTerms) {
  const status = String(certificate?.status || 'draft').toLowerCase();
  const frozen = FROZEN_STATES[status];
  if (frozen) return fromSnapshot(certificate?.[frozen.key], frozen.label);

  // Rejection returns a certificate to Draft. Any prior submission snapshot is
  // audit history and must not become the current Draft authority.
  return fromLive(packageTerms);
}
