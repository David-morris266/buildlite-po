const VARIATION_ORDER_STATUSES = Object.freeze({
  draft: "draft",
  submitted: "submitted",
  approved: "approved",
  issued: "issued",
  rejected: "rejected",
});

const VARIATION_ORDER_TRANSITIONS = Object.freeze({
  submit: { from: VARIATION_ORDER_STATUSES.draft, to: VARIATION_ORDER_STATUSES.submitted },
  approve: { from: VARIATION_ORDER_STATUSES.submitted, to: VARIATION_ORDER_STATUSES.approved },
  issue: { from: VARIATION_ORDER_STATUSES.approved, to: VARIATION_ORDER_STATUSES.issued },
  reject: { from: VARIATION_ORDER_STATUSES.submitted, to: VARIATION_ORDER_STATUSES.rejected },
});

const VAT_TREATMENTS = new Set(["inherit", "standard", "zeroRated", "exempt", "outsideScope"]);
const RETENTION_TREATMENTS = new Set(["inherit", "applicable", "notApplicable"]);

module.exports = { VARIATION_ORDER_STATUSES, VARIATION_ORDER_TRANSITIONS, VAT_TREATMENTS, RETENTION_TREATMENTS };
