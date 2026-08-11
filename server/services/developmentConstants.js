/** BL-027A.1 — Development statuses aligned with client developmentStore.js */

const DEVELOPMENT_STATUSES = [
  "planning",
  "pre-construction",
  "live",
  "complete",
];

const DEFAULT_DEVELOPMENT_STATUS = "planning";

const DEVELOPMENT_ID_PATTERN = /^dev-[a-zA-Z0-9_-]+$/;

function generateDevelopmentId() {
  return `dev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isValidDevelopmentId(id) {
  return typeof id === "string" && DEVELOPMENT_ID_PATTERN.test(id.trim());
}

function isValidDevelopmentStatus(status) {
  return DEVELOPMENT_STATUSES.includes(status);
}

module.exports = {
  DEVELOPMENT_STATUSES,
  DEFAULT_DEVELOPMENT_STATUS,
  DEVELOPMENT_ID_PATTERN,
  generateDevelopmentId,
  isValidDevelopmentId,
  isValidDevelopmentStatus,
};
