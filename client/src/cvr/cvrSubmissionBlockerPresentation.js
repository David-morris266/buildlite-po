const BLOCKER_MESSAGES = {
  forecast_unassessed: (reference) => `${reference} requires a QS Forecast before this CVR can be submitted.`,
  cost_code_mapping_ambiguous: (reference) => `${reference} does not have a clear CVR cost code.`,
  incomplete_source_provenance: (reference) => `${reference} has incomplete variation authority evidence.`,
  opposing_sign_exposure: (reference) => `${reference} has conflicting signed variation exposure.`,
};

export function formatCvrSubmissionBlockers(blockers = []) {
  const messages = blockers.map((blocker) => {
    const reference = String(blocker?.reference || 'Variation item').trim();
    const reason = String(blocker?.reason || '').trim();
    return BLOCKER_MESSAGES[reason]?.(reference) ||
      `${reference} is not ready for CVR submission${reason ? ` (${reason.replaceAll('_', ' ')})` : ''}.`;
  });
  if (!messages.length) return '';
  if (messages.length === 1) return messages[0];
  return `Resolve these variation exposure items before submitting:\n${messages.map((message) => `• ${message}`).join('\n')}`;
}
