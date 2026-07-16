/**
 * BL-016F — Setup progress persistence (localStorage).
 */

export const SETUP_PROGRESS_KEY = 'buildlite_setup_progress_v1';

export const SETUP_SECTIONS = [
  { id: 'company', label: 'Company Setup' },
  { id: 'commercialDefaults', label: 'Commercial Defaults' },
  { id: 'costCodes', label: 'Cost Codes' },
  { id: 'supplier', label: 'First Supplier' },
  { id: 'approval', label: 'Approval Defaults' },
  { id: 'development', label: 'First Development' },
  { id: 'complete', label: 'Ready to Go' },
];

function emptyProgress() {
  return {
    version: 1,
    completed: {},
    lastRunAt: null,
    completedAt: null,
    startedAt: null,
  };
}

export function getSetupProgress() {
  try {
    const raw = localStorage.getItem(SETUP_PROGRESS_KEY);
    if (!raw) return emptyProgress();
    const parsed = JSON.parse(raw);
    return {
      ...emptyProgress(),
      ...parsed,
      completed: { ...emptyProgress().completed, ...(parsed.completed || {}) },
    };
  } catch {
    return emptyProgress();
  }
}

function saveProgress(progress) {
  localStorage.setItem(SETUP_PROGRESS_KEY, JSON.stringify(progress));
  return progress;
}

export function markSetupStarted() {
  const current = getSetupProgress();
  if (current.startedAt) return current;
  return saveProgress({ ...current, startedAt: new Date().toISOString() });
}

export function markSectionComplete(sectionId) {
  const current = getSetupProgress();
  const next = {
    ...current,
    completed: { ...current.completed, [sectionId]: true },
    lastRunAt: new Date().toISOString(),
  };
  if (sectionId === 'complete') {
    next.completedAt = new Date().toISOString();
  }
  return saveProgress(next);
}

export function getCompletedSectionCount() {
  const { completed } = getSetupProgress();
  return SETUP_SECTIONS.filter((section) => completed[section.id]).length;
}

export function getSetupPercentComplete() {
  return Math.round((getCompletedSectionCount() / SETUP_SECTIONS.length) * 100);
}

export function isSectionComplete(sectionId) {
  return Boolean(getSetupProgress().completed[sectionId]);
}

export function getFirstIncompleteStep() {
  const { completed } = getSetupProgress();
  const stepBySection = {
    company: 2,
    commercialDefaults: 3,
    costCodes: 4,
    supplier: 5,
    approval: 6,
    development: 7,
    complete: 8,
  };

  for (const section of SETUP_SECTIONS) {
    if (!completed[section.id]) {
      return stepBySection[section.id] || 2;
    }
  }

  return stepBySection.complete;
}

export function getResumeStep(savedStep = 1) {
  const firstIncomplete = getFirstIncompleteStep();
  if (savedStep <= 1) return firstIncomplete;
  return firstIncomplete;
}

export function isSetupComplete() {
  return isSectionComplete('complete');
}

export function shouldAutoLaunchSetup() {
  return !isSetupComplete();
}

export function formatLastRunDate(isoValue) {
  if (!isoValue) return 'Not started';
  try {
    return new Date(isoValue).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}
