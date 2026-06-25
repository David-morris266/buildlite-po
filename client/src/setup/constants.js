/**
 * BuildLite Setup Assistant — journey steps (Doc 25).
 * Welcome is step 1; subsequent screens added in BL-007A.02+.
 */
export const SETUP_TOTAL_STEPS = 7;

export const SETUP_STEPS = [
  { id: "welcome", label: "Welcome" },
  { id: "business", label: "About your business" },
  { id: "identity", label: "Your company identity" },
  { id: "trade", label: "How you usually trade" },
  { id: "team", label: "Your commercial team" },
  { id: "lists", label: "Bring your lists" },
  { id: "ready", label: "You're ready" },
];
