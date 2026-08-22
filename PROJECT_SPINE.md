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

Complete: BL-027A Developments, BL-027B Packages, BL-028 Commercial Events (including BL-028B.3 server-authority cutover), BL-029 Order Matrix Persistence (including BL-029D server-authority cutover), BL-030 Payment Certificate Persistence (including BL-030C server-authority cutover and passed historical-freeze UAT), **BL-031A–F** CVR/ledger persistence including immutable snapshots and next-period carry-forward. **BL-030 is fully complete.** **BL-031E is COMPLETE** (Test Site 1 snapshot creation UAT **PASSED**; historic freeze UAT **PASSED**). **BL-031F is COMPLETE** (P02 monthly-cycle UAT **PASSED**). **BL-032A is COMPLETE** (development revenue settings persistence; Test Site 1 authority-on UAT **PASSED**). **BL-032B is COMPLETE** (private plot Secured Revenue lifecycle; same-price and differing-price Plot 31 UATs **PASSED**; Selling Price HTML `step` corrected to `0.01`). **BL-032C is COMPLETE** (live Draft/Submitted CVR Revenue + GP; Test Site 1 P03 Draft UAT **PASSED**). **BL-032D is COMPLETE** (schema-v2 whole-CVR Revenue snapshot; Test Site 1 P03 lock/freeze UAT **PASSED**; migration `012` applied to `buildlite_clone`). **BL-033A design is ACCEPTED.** **BL-033B is COMPLETE** (tenant cost-code semantic classification; Test Site 1 `5231` → PRELIMS + STANDARD_CVR; CVR money unchanged; migration `013` applied to clone). **BL-033C is COMPLETE** (typed `development_programme`; Test Site 1 programme UAT **PASSED**; migration `014` applied to clone). **BL-033C.1 is COMPLETE** (explicit CVR reporting-month selection; Test Site 1 reporting-month UAT **PASSED**). **BL-033D.1 is COMPLETE** (calculation-only TIME / LUMP_SUM Prelims proposal; Test Site 1 Prelims UAT **PASSED**; migration `015` applied to `buildlite_clone`). **BL-033D.x.1 is COMPLETE** (BuildLite Standard v1 + company-owned template copy; company-template UAT **PASSED**; migration `016` applied to clone). **BL-033D.x.2A.1 is IMPLEMENTED AND BANKED** (tenant Cost Code Master server foundation). **BL-033D.x.2A.2 is IMPLEMENTED AND BANKED** (Admin Cost Codes server-authority UI behind the flag). **BL-033D.x.2A.3 is COMPLETE** (Test Site 1 Cost Code Master cutover UAT **PASSED**; `017` applied on `buildlite_clone`; 98 rows / 98 active; flag-ON Admin proven; repo flag default remains OFF). **BL-033D.x.2 is COMPLETE** (company template mapping UAT **PASSED**; canonical many-to-one mapping; 26 lines / 2 mapped to `5231`; no money defaults; no development instantiation). Repo CVR/ledger/revenue/cost-code flag defaults remain OFF.

1. **NEXT: BL-033D.x.3 — Development Prelims setup from company template.** Do **not** Submit or Approve & Lock P04. Do **not** create P05. Do **not** switch 5231 to TIME. Do **not** implement Review & Adopt / CVR adoption. Do **not** Save migrated Admin cost-code rows whose server `reporting_group` is absent from the local Commercial Structure catalog. Historic P01/P02/P03 `reporting_month` remains NULL. P04 remains Draft with `reporting_month` **2026-08**.
2. Deferred: CVR navigation UI/UX (Register / Summary / Worksheet / Open Draft CVR / Continue to CVR / Back / period navigation). Functionally working; not intuitive. Broader application UI/UX review.
3. See `CURRENT_STATE.md`.

---

## Important Instruction

Do not redesign or rewrite existing working modules without explicit approval.
