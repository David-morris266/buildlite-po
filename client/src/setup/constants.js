/**
 * BuildLite Setup Assistant — journey steps (Doc 25).
 * progressTitle must match each screen's h1 title.
 */
export const SETUP_TOTAL_STEPS = 7;

export const SETUP_FORM_IDS = {
  business: "setup-form-business",
  identity: "setup-form-identity",
  defaults: "setup-form-defaults",
};

export const SETUP_STEPS = [
  {
    id: "welcome",
    label: "Welcome",
    progressTitle: "Let's get BuildLite ready",
  },
  {
    id: "business",
    label: "Tell us about your business",
    progressTitle: "Tell us about your business",
  },
  {
    id: "identity",
    label: "Make BuildLite yours",
    progressTitle: "Make BuildLite yours",
  },
  {
    id: "trade",
    label: "How you usually trade",
    progressTitle: "How you usually trade",
  },
  {
    id: "team",
    label: "Your commercial team",
    progressTitle: "Your commercial team",
  },
  {
    id: "lists",
    label: "Bring your lists",
    progressTitle: "Bring your lists",
  },
  { id: "ready", label: "You're ready", progressTitle: "You're ready" },
];
