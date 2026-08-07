/**
 * BL-024A.1 — Commercial Assistant configuration.
 */

export const COMMERCIAL_ASSISTANT_CONFIG = {
  draftCommercialEventAgeDays: 14,
  refreshDebounceMs: 150,
  /**
   * Operational Assistant reminder threshold only.
   * NOT a contractual payment notice / pay-less notice deadline.
   */
  certificateReminderDays: 28,
  /**
   * Additional days beyond certificateReminderDays before classifying a package
   * as overdue for valuation. Operational only — not a legal deadline.
   */
  certificateOverdueGraceDays: 14,
};
