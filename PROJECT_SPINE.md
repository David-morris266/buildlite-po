# BuildLite Project Spine

## Product Vision

BuildLite is a Commercial Control Platform for SME housebuilders and residential developers.

The platform focuses on:

- Commercial Governance
- Commitment Control
- Payment Compliance
- Forecasting
- CVR Reporting

BuildLite is NOT an accounting package.

---

## Core Commercial Backbone

Budget

↓

Purchase Order

↓

Approved Commitment

↓

Potential Liability

↓

Forecast Liability

↓

Measurement Schedule

↓

Certificate

↓

Payment Notice / Pay Less Notice

↓

Approved Payment

↓

CVR

↓

Management Reporting

---

## Development Principles

1. Existing working functionality must not be rewritten unless specifically instructed.

2. New modules must integrate with existing modules.

3. Purchase Orders remain the foundation of the platform.

4. Cost Codes are controlled.

5. Measurement Schedules remain flexible.

6. Commitments drive forecasts.

7. Potential Liabilities remain visible.

8. Forecast Adjustments remain visible.

9. Commercial Governance overrides convenience.

10. Auditability is mandatory.

---

## Current Development Priority

Doc 67 persistence migration on branch `buildlite-V1-1`.

Complete: BL-027A Developments, BL-027B Packages, BL-028 Commercial Events (including BL-028B.3 server-authority cutover), BL-029 Order Matrix Persistence (including BL-029D server-authority cutover), BL-030 Payment Certificate Persistence (including BL-030C server-authority cutover and passed historical-freeze UAT). **BL-030 is fully complete.** **BL-031A** (server persistence/API), **BL-031A.1** (clone migrate), **BL-031B** (client cache/hydration/readiness), and **BL-031C** (server-write facades + Test Site 1 CVR migration **PASSED**) are implemented; BL-031 is **not** complete. Runtime CVR/ledger authority remains localStorage. Ledger tables remain empty (no local ledger existed to migrate).

1. **BL-031D** — **NEXT after bank**. Authority cutover. Do not start in this slice.
2. **BL-031E** — immutable snapshot / period close.
3. Do not flip CVR/ledger authority flags until BL-031D. Do not change live CVR calculations until instructed. See `CURRENT_STATE.md`.

---

## Important Instruction

Do not redesign or rewrite existing working modules without explicit approval.
