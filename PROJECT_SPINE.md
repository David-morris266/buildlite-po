# BuildLite Project Spine

## Product Vision

BuildLite is a lean commercial-control platform for SME housebuilders and residential developers.

The platform focuses on:

- Commercial Governance
- Commitment Control
- Payment Compliance
- Forecasting
- CVR Reporting

BuildLite is NOT an accounting package.

Founding Product Principles (SME first; one capable QS; faster than Excel; client cost codes are identity; facts flow once; Final Forecast is expected outturn; System Forecast remains fact-based; QS judgement is first-class and auditable; never destroy the fact) are authoritative in `docs/PRODUCT_CONSTITUTION.md` §1.

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

4. Cost-code **identity** is client-owned and must be controlled as a Master. BuildLite must not impose its own numbering chart.

5. Measurement Schedules remain flexible.

6. Approved commitments drive **System Forecast**. They do not, by themselves, equal expected outturn.

7. Potential liabilities remain visible before approval.

8. QS expected-liability treatment and other forecast adjustments remain visible, auditable, and must not rewrite the underlying fact. **HD-001 resolved:** submitted CE expected liability defaults to full submitted value and feeds **Final Forecast**, not System Forecast. **HD-038-2:** Final Forecast = System Forecast + CE Expected Liability + Commercial Adjustment. **BL-038C BANKED** at `b036bc9`; human UAT + forensic PASS.

9. Commercial Governance overrides convenience.

10. Auditability is mandatory.

11. Client cost-code identity is authoritative. BuildLite classification is metadata. Test Site 1 `5231` / `5400` are UAT examples, not a mandatory chart.

---

## Current Development Priority

Doc 67 persistence migration on branch `buildlite-V1-1`.

Complete: BL-027A Developments, BL-027B Packages, BL-028 Commercial Events (including BL-028B.3 server-authority cutover), BL-029 Order Matrix Persistence (including BL-029D server-authority cutover), BL-030 Payment Certificate Persistence (including BL-030C server-authority cutover and passed historical-freeze UAT), **BL-031A–F** CVR/ledger persistence including immutable snapshots and next-period carry-forward. **BL-030 is fully complete.** **BL-031E is COMPLETE** (Test Site 1 snapshot creation UAT **PASSED**; historic freeze UAT **PASSED**). **BL-031F is COMPLETE** (P02 monthly-cycle UAT **PASSED**). **BL-032A is COMPLETE** (development revenue settings persistence; Test Site 1 authority-on UAT **PASSED**). **BL-032B is COMPLETE** (private plot Secured Revenue lifecycle; same-price and differing-price Plot 31 UATs **PASSED**; Selling Price HTML `step` corrected to `0.01`). **BL-032C is COMPLETE** (live Draft/Submitted CVR Revenue + GP; Test Site 1 P03 Draft UAT **PASSED**). **BL-032D is COMPLETE** (schema-v2 whole-CVR Revenue snapshot; Test Site 1 P03 lock/freeze UAT **PASSED**; migration `012` applied to `buildlite_clone`). **BL-033A design is ACCEPTED.** **BL-033B is COMPLETE** (tenant cost-code semantic classification; Test Site 1 `5231` → PRELIMS + STANDARD_CVR; CVR money unchanged; migration `013` applied to clone). **BL-033C is COMPLETE** (typed `development_programme`; Test Site 1 programme UAT **PASSED**; migration `014` applied to clone). **BL-033C.1 is COMPLETE** (explicit CVR reporting-month selection; Test Site 1 reporting-month UAT **PASSED**). **BL-033D.1 is COMPLETE** (calculation-only TIME / LUMP_SUM Prelims proposal; Test Site 1 Prelims UAT **PASSED**; migration `015` applied to `buildlite_clone`). **BL-033D.x.1 is COMPLETE** (BuildLite Standard v1 + company-owned template copy; company-template UAT **PASSED**; migration `016` applied to clone). **BL-033D.x.2A.1 is IMPLEMENTED AND BANKED** (tenant Cost Code Master server foundation). **BL-033D.x.2A.2 is IMPLEMENTED AND BANKED** (Admin Cost Codes server-authority UI behind the flag). **BL-033D.x.2A.3 is COMPLETE** (Test Site 1 Cost Code Master cutover UAT **PASSED**; `017` applied on `buildlite_clone`; 98 rows / 98 active; flag-ON Admin proven; repo flag default remains OFF). **BL-033D.x.2 is COMPLETE** (company template mapping UAT **PASSED**; canonical many-to-one mapping; 26 lines / 2 mapped to `5231`; no money defaults; no development instantiation). **BL-033D.x.3 is COMPLETE** (development Prelims setup worksheet + `018` provenance; Test Site 1 setup UAT **PASSED** on `buildlite_clone`; four development Prelims rows; resolved proposal **£59,000** + unresolved FIRST_COMPLETION; no CVR adoption). **BL-033D.x.3R is COMPLETE** (flexible Prelims timing + setup UX: signed month offsets via `019`, FIXED_DATE overrides, development TIME↔LUMP_SUM driver override, searchable Cost Code Master picker, compact worksheet; human UAT **PASSED**; deferred basis-select clipping note). **BL-033D.x.4A is COMPLETE** (Prelims adoption compare engine + metadata contract; fingerprint includes offsets; pure logic; no CVR writes). **BL-033D.x.4B is COMPLETE** (read-only Prelims Review against CVR; GET-only preview; replacement-adjustment semantics; human UAT **PASSED**; no CVR writes). **BL-033D.x.4C.1 is BANKED** (server Prelims → Draft CVR adoption command + transactional consistency). **BL-033D.x.4C.2 is COMPLETE** (explicit selection + confirmation Adopt UI; human UAT **PASSED**; forensic clone UAT **PASSED**; controlled 5231 → Draft P04 adoption proven). **BL-033D.x.5 is COMPLETE** (Prelims landing UX consolidation: Set up/Manage primary; site-specific add secondary; forecast landing retained; human visual UAT **PASSED**). Repo CVR/ledger/revenue/cost-code flag defaults remain OFF.

1. **NEXT:** **BL-038E — CE Expected Liability snapshot/Create Next integrity.** Explicit historic preservation and roll-forward proof are required before Hawthorn. Do **not** start Hawthorn, Detailed Selling Costs, or a Hawthorn remap. Keep Test Site 1 P04 Draft; do not Submit or Approve & Lock it, create P05, or Adopt UAT-CC-001.
2. **BL-038D DEFERRED pending pilot evidence:** remaining CE/CVR drilldown and detail UX is not a pre-pilot blocker. Also deferred: broader CVR navigation/application UX review. Durable parked list and human decisions: `docs/PRODUCT_CONSTITUTION.md`.
3. See `CURRENT_STATE.md` for implementation/UAT status. See `docs/PRODUCT_CONSTITUTION.md` **before planning a new product slice** (founding principles, intent, deferred register, internal vs hosted-trial sequencing).

The backbone diagram above is **original design intent**. **HD-001** settles: Potential Liability stays visible; System Forecast stays approved facts; expected liability feeds Final Forecast. **HD-038-2** settles the live identity: Final Forecast = System + CE Expected + Commercial Adjustment. Payment Notice / Pay Less is not implemented. Built vs deferred is in the constitution, not in this spine.

---

## Important Instruction

Do not redesign or rewrite existing working modules without explicit approval.

Read `docs/PRODUCT_CONSTITUTION.md` before planning product slices. Where original Master Documentation conflicts with banked behaviour, surface the conflict; do not silently pick a side.
