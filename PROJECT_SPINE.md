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

Complete: BL-027A Developments, BL-027B Packages, BL-028 Commercial Events (including BL-028B.3 server-authority cutover), BL-029 Order Matrix Persistence (including BL-029D server-authority cutover), BL-030 Payment Certificate Persistence (including BL-030C server-authority cutover and passed historical-freeze UAT), **BL-031A–F** CVR/ledger persistence including immutable snapshots and next-period carry-forward. **BL-030 is fully complete.** **BL-031E is COMPLETE** (Test Site 1 snapshot creation UAT **PASSED**; historic freeze UAT **PASSED**). **BL-031F is COMPLETE** (P02 monthly-cycle UAT **PASSED**). **BL-032A is COMPLETE** (development revenue settings persistence; Test Site 1 authority-on UAT **PASSED**). **BL-032B is COMPLETE** (private plot Secured Revenue lifecycle; same-price and differing-price Plot 31 UATs **PASSED**; Selling Price HTML `step` corrected to `0.01`). **BL-032C is COMPLETE** (live Draft/Submitted CVR Revenue + GP; Test Site 1 P03 Draft UAT **PASSED**; P03 remains Draft with no snapshot). **BL-032D is IMPLEMENTED / awaiting P03 lock/freeze UAT** (schema-v2 whole-CVR Revenue snapshot; migration `012` not applied to `buildlite_clone`). Repo CVR/ledger/revenue flag defaults remain OFF.

1. **NEXT: Controlled apply of migration `012` to `buildlite_clone`, then P03 Submit / Approve & Lock / freeze UAT.** Do **not** mark BL-032D COMPLETE until that UAT.
2. Do **not** Submit / Approve & Lock P03 until `012` is on clone. Do **not** create P04.
3. Deferred: CVR navigation UI/UX (Register / Summary / Worksheet / Open Draft CVR / Continue to CVR / Back / period navigation). Functionally working; not intuitive. Broader application UI/UX review.
4. See `CURRENT_STATE.md`.

---

## Important Instruction

Do not redesign or rewrite existing working modules without explicit approval.
