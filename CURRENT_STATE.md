# BuildLite Current State

## Purpose

This document is the in-repo status snapshot for a clean Cursor session. It records the actual position after **Doc 67 persistence migration** through **BL-030**, **BL-ASUS-001**, **BL-031A–F**, **BL-032A**, **BL-032B**, **BL-032C**, **BL-032D**, **BL-033B**, **BL-033C**, **BL-033C.1**, **BL-033D.1**, **BL-033D.x.1**, **BL-033D.x.2A.1**, and **BL-033D.x.2A.2**. **BL-031E is COMPLETE.** **BL-031F is COMPLETE.** **BL-032A is COMPLETE.** **BL-032B is COMPLETE.** **BL-032C is COMPLETE.** **BL-032D is COMPLETE.** **BL-033A design is ACCEPTED.** **BL-033B is COMPLETE.** **BL-033C is COMPLETE.** **BL-033C.1 is COMPLETE.** **BL-033D.1 is COMPLETE.** **BL-033D.x.1 is COMPLETE.** **BL-033D.x.2A.1 is IMPLEMENTED AND BANKED.** **BL-033D.x.2A.2 is IMPLEMENTED AND BANKED** (awaiting controlled Cost Code Master cutover/UAT). Test Site 1 development programme UAT **PASSED**. Test Site 1 classification UAT **PASSED** (`5231` Cleaning → PRELIMS + STANDARD_CVR; CVR money unchanged). Test Site 1 P03 is the first schema-v2 whole-CVR snapshot. Test Site 1 reporting-month UAT **PASSED**: P04 is **Draft** v1 with explicit `reporting_month` **2026-08**; P01/P02/P03 remain NULL. Test Site 1 Prelims UAT **PASSED**: calculation-only TIME / LUMP_SUM proposal, multiple lines per cost code, unresolved FIRST_COMPLETION, no CVR adoption. Company-template UAT **PASSED**: one company-owned copy of BuildLite Standard v1 (25 lines, unmapped, no £ defaults). `recognitionPolicy=exchange` is **not** live CVR/accounting behaviour. Repo authority-flag defaults remain OFF; local UAT used `client/.env.local` (do not commit it).

Historic Phase 0 / BL-006 schema notes remain in `docs/DATABASE.md` and `docs/phase0/`. Do not treat those files as the current programme.

Authoritative persistence architecture: **Doc 67** in BuildLite Master Documentation.

---

## Repository / programme

| Item | Value |
|------|-------|
| Branch | `buildlite-V1-1` |
| Repository | `buildlite-po` (historic GitHub name: `dmcc-cvr-system`) |
| Programme | Doc 67 — Persistence Architecture & Migration Blueprint |
| Last completed product slice | **BL-033D.x.1 — COMPLETE.** Company Prelims templates + BuildLite Standard v1. Company-template UAT **PASSED**. |
| Last persistence slice implemented | **BL-033D.x.2A.2 IMPLEMENTED AND BANKED.** Admin Cost Codes can use server authority when the flag is ON. Flag remains **OFF**. Browser master not migrated. Clone has not received 017. Awaiting controlled x.2A.3 cutover/UAT. |
| Test isolation | BL-028B.3a — server tests fail closed unless `TEST_DATABASE_URL` is a separate database |
| Housekeeping checkpoint | BL-ASUS-001 (this document) |
| **NEXT** | **BL-033D.x.2A.3** — controlled Test Site 1 Cost Code Master cutover (apply 017 to clone + compare/copy browser master). Do **not** turn the flag ON against the current thin clone. **D.x.2 mapping remains blocked** until that cutover. Do **not** Submit or Approve & Lock P04. Do **not** create P05. Do **not** switch 5231 to TIME. Do **not** implement Review & Adopt / CVR adoption. Do **not** start D.x.3 development instantiation. Historic P01/P02/P03 `reporting_month` remains NULL. |

---

## Persistence programme (Doc 67 §25)

| ID | Domain | Status |
|----|--------|--------|
| BL-027A | Developments → Postgres | **Complete** — server authority |
| BL-027B | Packages → Postgres | **Complete** — server authority; materialised on subcontract PO approval |
| BL-028 | Commercial Events → Postgres | **Complete** — schema/API (BL-028A), cache/overlays (BL-028B.1–2), **server-authority cutover (BL-028B.3)** |
| BL-028B.3a | Isolated server test database | **Complete** — `TEST_DATABASE_URL` / `buildlite_test`; must not use `buildlite_clone` |
| **BL-029** | Order Matrix Persistence | **Complete** — schema/API (BL-029A), cache/hydration (BL-029B), **server-authority cutover (BL-029D)** |
| **BL-030** | Payment Certificate persistence & atomic approval | **Complete** — schema/API (BL-030A), cache/hydration (BL-030B), **server-authority cutover (BL-030C)**, historical-freeze UAT **PASSED**. |
| **BL-031** | CVR & Ledger persistence | **BL-031A–F complete.** Authority-on live CVR/ledger (**D**), immutable snapshots (**E**), next-period carry-forward (**F**). Snapshot creation UAT **PASSED**. Historic freeze UAT **PASSED**. P02 monthly-cycle UAT **PASSED**. P03 Draft UAT **PASSED** under BL-032C. |
| **BL-032A** | Revenue settings persistence (foundation) | **COMPLETE.** `development_revenue_settings` + GET/PUT. Authority-on UAT **PASSED** on Test Site 1. `VITE_REVENUE_SERVER_AUTHORITY` default OFF. Plot commercial fields remain on `developments.payload`. Categories remain local. Not in CVR. `recognitionPolicy=exchange` is stored only; it is not live behaviour. |
| **BL-032B** | Private plot revenue lifecycle / Secured Revenue | **COMPLETE.** Same-price and differing-price Plot 31 UATs **PASSED**. Available/Reserved forecast-only; Exchanged/Completed secured at contractual `sellingPrice`; Completion is not a second money event; differing exchange price substitutes forecast (−£5,100 proven). Dashboard: Forecast / Secured / Remaining. Payload dates `reservedAt` / `exchangedAt` / `completedAt`. Selling Price HTML `step` `0.01`. |
| **BL-032C** | Live CVR Revenue + Gross Profit | **COMPLETE.** Live Draft/Submitted CVR Summary composes the existing Revenue engine with existing CVR `finalForecast`. Shows Forecast / Secured / Remaining Revenue, Forecast Cost, Gross Profit, Gross Margin % (1 d.p.), Plots Sold. GP = Forecast Revenue − `finalForecast`. Locked v1 P01/P02 remain Revenue/GP/Margin unavailable (no live fallback, no £0). Revenue/GP movement vs v1 previous is unavailable; cost movement continues. Submit is not blocked if Revenue is unavailable. Close-engine keys remain cost-only. Portfolio remains cost-only. Test Site 1 P03 Draft UAT **PASSED**. P03 was later locked under BL-032D. |
| **BL-032D** | Whole-CVR Revenue-bearing snapshot | **COMPLETE.** New locks are schema **v2** or they do not lock. Server Revenue close + GP/Margin freeze into `cvr_period_snapshots` plus plot rows in `cvr_period_snapshot_plots`. Migration `012` additive; applied on `buildlite_test` and local `buildlite_clone`. Historic v1 remains Revenue unavailable. Historic v2 uses snapshot only. Portfolio remains cost-only. Test Site 1 P03 lock/freeze UAT **PASSED**. |
| **BL-033A** | Prelims / semantic classification design | **ACCEPTED** with UNCLASSIFIED default and deferred adoption formula. Commercial Head remains tenant reporting hierarchy. Semantic Group is BuildLite engine taxonomy. |
| **BL-033B** | Cost-code semantic classification | **COMPLETE.** `cost_code_classifications` tenant mapping `(client_id, cost_code_key)` → `semantic_group` + `forecast_driver`. Unmapped = UNCLASSIFIED + STANDARD_CVR (no row). OTHER is explicit. No CVR formula change. No Prelims engine. Migration `013` applied on `buildlite_test` and local `buildlite_clone`. Test Site 1 classification UAT **PASSED**: `5231` Cleaning → PRELIMS + STANDARD_CVR; CVR money did not move. `forecast_driver` is a default/suggested driver only; a future Prelims line will own its actual driver. |
| **BL-033C** | Development programme + calendar months | **COMPLETE.** Typed `development_programme` (GET seed from payload without write; PUT optimistic version). Inclusive calendar-month helpers (no proration). Test Site 1 programme UAT **PASSED**: one row `9ff45e90-8412-4e3e-a6d9-45a0d6abd177` v1, site start 2026-09-01, first completion NULL, final completion 2029-10-01, 31 plots, 38 months. Payload unchanged. P01–P03 / 5231 / snapshots unchanged. Migration `014` applied on `buildlite_test` and local `buildlite_clone`. |
| **BL-033C.1** | Explicit CVR reporting-month selection | **COMPLETE.** Create Next shows a YYYY-MM dialog before creating a new period. Prefill previous+1 when safe; otherwise require an explicit choice. No today default. No period-key / historic inference. Selected month persists on the new period only. Test Site 1 reporting-month UAT **PASSED**: P04 Draft `0f513191-cd25-4812-834f-37dcf66487e0` v1, `reporting_month` **2026-08**; P01/P02/P03 remain NULL. No schema change. No Prelims / TIME engine. |
| **BL-033D.1** | Development Prelims TIME / LUMP_SUM proposal | **COMPLETE.** Calculation-only proposal/assumption layer. Multiple lines per customer cost code. TIME and LUMP_SUM only. Add and Edit are separate (POST vs PUT). Does not change CVR money, snapshots, classification, or programme. No Review & Adopt. Migration `015` applied on `buildlite_test` and local `buildlite_clone`. Test Site 1 Prelims UAT **PASSED**. |
| **BL-033D.x.1** | Company Prelims templates + BuildLite Standard | **COMPLETE.** Product-owned BuildLite Standard v1 (25 lines); tenant-owned copies; multiple named templates per client; at most one default. Migration `016` applied on `buildlite_test` and local `buildlite_clone`. Company-template UAT **PASSED**. No development instantiation. No silent Standard upgrades. No CVR adoption. |
| **BL-033D.x.2A.1** | Tenant Cost Code Master server foundation | **IMPLEMENTED AND BANKED.** Additive `017_cost_codes_tenant_master.sql` evolves existing `cost_codes`. `VITE_COST_CODE_SERVER_AUTHORITY` default OFF. Browser master **not** migrated. Clone has **not** received 017. Clone `lower(btrim(code))` collision check: **0**. D.x.2 mapping remains blocked. Not an Admin authority cutover. |
| **BL-033D.x.2A.2** | Admin Cost Codes server-authority UI | **IMPLEMENTED AND BANKED.** Flag-controlled Admin path. Default **OFF**. ON uses `/api/cost-codes` only (no localStorage fallback/dual-write). Commercial Structure catalog remains browser-local. ON against current clone would be incomplete/thin and is **not** the approved cutover. D.x.2 mapping still blocked until x.2A.3. |

BL-030 is fully complete. **BL-031D** cut CVR/ledger runtime to Postgres when local flags are ON, and applies the live commercial formulas on the CVR. **BL-031E** freezes that position onto an immutable snapshot at Approve & Lock. **BL-031F** copies persisted QS period inputs into the next Draft period. Persistence sprints must not add unrelated product features (Doc 67 §28).

---

## Current persistence boundary

### Postgres / server authority

- Clients, brand profiles, jobs
- Cost codes, suppliers, purchase orders (`payload` JSONB)
- **Developments** (`004_developments.sql`)
- **Packages** + PO membership (`005_packages.sql`)
- **Commercial Events** + CE audit (`006_commercial_events.sql`)
- **Order matrices** (`007_package_order_matrices.sql`) — plot-stage structure, committed value, versioned PUT
- **V1 Payment Certificates** (`008_package_payment_certificates.sql`) — draft progress, commercial/recovery lines, submit/reject/approve, frozen snapshots
- **CVR periods + purchase ledger tables** (`009_cvr_and_purchase_ledger.sql`) — **BL-031A–D**. Runtime CVR/ledger use Postgres when `VITE_CVR_SERVER_AUTHORITY` / `VITE_LEDGER_SERVER_AUTHORITY` are ON.
- **CVR snapshots** (`010_cvr_period_snapshots.sql`) — **BL-031E COMPLETE**. Approve & Lock persists an immutable snapshot atomically. Locked periods render from that snapshot (or explicit historic-unavailable if none). Test Site 1 snapshot creation UAT **PASSED**. Historic freeze UAT **PASSED**. **BL-031F COMPLETE**: P02 monthly-cycle UAT **PASSED** (two independent locked snapshots on Test Site 1).
- **Development revenue settings** (`011_development_revenue_settings.sql`) — **BL-032A COMPLETE**. Typed strategy/settings row per development. Runtime uses Postgres only when `VITE_REVENUE_SERVER_AUTHORITY=true`. Default remains OFF. Migration `011` is applied on local `buildlite_clone` (additive; no backfill). Plot Master commercial fields stay on `developments.payload`.
- **Whole-CVR Revenue snapshot** (`012_cvr_period_snapshot_revenue.sql`) — **BL-032D COMPLETE**. Additive nullable Revenue/GP columns on `cvr_period_snapshots` plus `cvr_period_snapshot_plots`. Applied on `buildlite_test` and local `buildlite_clone`. New Approve & Lock writes schema **v2** or does not lock. Historic v1 rows stay NULL (no default £0, no backfill). Test Site 1 P03 is the first v2 snapshot.
- **Cost-code semantic classification** (`013_cost_code_classifications.sql`) — **BL-033B COMPLETE**. Tenant-level mapping only. Unmapped codes resolve as UNCLASSIFIED + STANDARD_CVR without inserting a row. Applied on `buildlite_test` and local `buildlite_clone`. Does not enter CVR close or snapshots. Test Site 1 `5231` is PRELIMS + STANDARD_CVR. `forecast_driver` is a default/suggested driver only.
- **Development programme** (`014_development_programme.sql`) — **BL-033C COMPLETE**. Typed site start / first completion / final completion / plot count + version. GET seeds from `payload.startDate` / `targetCompletion` / `plotCount` without inserting until PUT. PUT is optimistic. Applied on `buildlite_test` and local `buildlite_clone`. Does not dual-write payload. Does not enter CVR close or snapshots. Test Site 1 has one programme row (version 1). **BL-033C.1 COMPLETE** (no migration): Create Next requires an explicit YYYY-MM; Test Site 1 P04 is Draft with `reporting_month` **2026-08**.
- **Development Prelims items** (`015_development_prelims_items.sql`) — **BL-033D.1 COMPLETE**. TIME / LUMP_SUM proposal lines beside the CVR. Applied on `buildlite_test` and local `buildlite_clone`. GET does not mutate programme, CVR, or classification. Calculated months/money are derived live. Not adopted into the CVR.
- **Company Prelims templates** (`016_client_prelims_templates.sql`) — **BL-033D.x.1 COMPLETE**. Tenant-owned headers + lines. BuildLite Standard is a product-owned application definition, not tenant rows. Applied on `buildlite_test` and local `buildlite_clone`. Company-template UAT **PASSED**. Does not write `development_prelims_items`. Does not enter CVR.
- **Tenant Cost Code Master columns** (`017_cost_codes_tenant_master.sql`) — **BL-033D.x.2A.1 IMPLEMENTED AND BANKED.** Additive Admin-master fields on existing `cost_codes`. Unique `(client_id, lower(btrim(code)))`. No browser-master backfill. No `element` → `description` copy. Applied by tests on `buildlite_test` only. **Not** applied to `buildlite_clone`. Clone collision check under `lower(btrim(code))`: **0**. **BL-033D.x.2A.2 IMPLEMENTED AND BANKED:** Admin Cost Codes can use this table when `VITE_COST_CODE_SERVER_AUTHORITY=true`. Repo default remains OFF, so live Admin still uses `buildlite_cost_codes_master_v1`. ON against the current thin clone is not the approved cutover.
- Local client uses `VITE_CE_SERVER_AUTHORITY`, `VITE_MATRIX_SERVER_AUTHORITY`, `VITE_CERTIFICATE_SERVER_AUTHORITY`, `VITE_CVR_SERVER_AUTHORITY`, `VITE_LEDGER_SERVER_AUTHORITY`, `VITE_REVENUE_SERVER_AUTHORITY`, and `VITE_COST_CODE_SERVER_AUTHORITY` for cutover (see `client/.env.example`). Repo defaults remain OFF. Local UAT uses `.env.local`. Do not commit `.env.local`.

### Browser / localStorage authority (not yet migrated)

- CVR periods / cost centres (`buildlite_cvr_v1`) and purchase ledger (`buildlite_purchase_ledgers_v1`) — backup/rollback evidence after BL-031D. Runtime uses Postgres when the CVR/ledger flags are ON (no localStorage fallback or dual-write).
- Also still local: revenue categories / administration master data, setup drafts, Commercial Assistant dispositions. Development revenue **strategy/settings** use Postgres when `VITE_REVENUE_SERVER_AUTHORITY=true` (no localStorage fallback). They remain localStorage (`buildlite_revenue_v1`) when the flag is OFF. Plot-level commercial fields remain on Plot Master / `developments.payload` (including BL-032B lifecycle dates). Dashboard Secured Revenue is status/`sellingPrice` derived and is **not** driven by `recognitionPolicy`. Internal `calculateRecognisedRevenue` remains Completed-only for compatibility. `recognitionPolicy=exchange` is not live CVR/accounting behaviour. Live Draft/Submitted CVR shows Revenue/GP (BL-032C COMPLETE). New locked snapshots are schema v2 whole-CVR (BL-032D COMPLETE). Locked v1 snapshots do not store Revenue.
- Cost-code **master records** remain browser `buildlite_cost_codes_master_v1` while `VITE_COST_CODE_SERVER_AUTHORITY` is OFF (default). BL-033D.x.2A.2 wired Administration → Cost Codes to the server cache/API when the flag is ON (no localStorage fallback, no dual-write, failed GET is not an empty master). Browser master has **not** been migrated. Clone has **not** received 017. Commercial Structure Head/Family/Reporting Group catalog remains browser-local. D.x.2 mapping remains blocked until x.2A.3. BL-033B classification metadata is **server-authoritative** (`cost_code_classifications`) and is not stored in the cost-code master.

`buildlite_order_matrices_v1` is backup/rollback evidence only after BL-029D. Runtime matrix reads/writes use Postgres when `VITE_MATRIX_SERVER_AUTHORITY=true`.

`buildlite_subcontract_packages_v1` certificate arrays are backup/rollback evidence only after BL-030C. Runtime certificate reads/writes use Postgres when `VITE_CERTIFICATE_SERVER_AUTHORITY=true`.

The legacy Postgres `payment_certificates` table is **not** the BuildLite V1 certificate engine (Doc 67 §21). Do not merge those models during persistence work.

---

## BL-029D local UAT (passed)

Authority ON locally via `client/.env.local` (`VITE_MATRIX_SERVER_AUTHORITY=true`). Test Site 1 / Wipe It Cleaners / PO S0012. Hawthorn Gardens was not imported.

| Check | Result |
|-------|--------|
| First import | Created one `package_order_matrices` row |
| Hard refresh | Matrix restored from the server |
| Payment Certificates route | Same server-backed matrix |
| Re-import | Same DB row; version incremented to 2 |
| Two-tab stale update | User-facing 409: “This order matrix was changed elsewhere. Refresh and retry.” |
| Matrix localStorage | `buildlite_order_matrices_v1` did not exist on `localhost:5173` after server-authority imports |
| API stopped + refresh | Visible error; no matrix localStorage fallback |
| API restored + refresh | Server matrix restored |
| Draft Cert 1 overlay | Plot 1 / Joists 50% survived full browser refresh; matrix stage value remained £750; certificate valuation remained £376 |

BL-029 boundary confirmed: server-authoritative matrix structure. Certificate progress is server-authoritative after BL-030C.

---

## BL-030C local UAT (passed)

Authority ON locally via `client/.env.local` (`VITE_CERTIFICATE_SERVER_AUTHORITY=true`, with CE and matrix flags also ON). Test Site 1 / Wipe It Cleaners / package `c71ac6fa-63f6-403e-992d-a25f8fe88752`. Hawthorn Gardens was not imported or touched. Certs 1–4 were locked against matrix version 3; the live matrix was later replaced under the freeze check below.

### Package position after Certs 1–4

| Item | Result |
|------|--------|
| Original order | £50,000 (S0012) |
| Approved positive CE | CE-0020 Variation +£250 |
| Current contract | £50,250 |
| Approved direct recovery | CE-0021 Contra Charge £100 |
| Gross certified | £2,250 |
| Gross remaining | £48,000 |
| Net / CVR certified | £2,150 (£2,250 gross less £100 recovery) |

### Certificate lifecycle

| Cert | Result |
|------|--------|
| **1** | Server-created draft. Plot 2 Joists 50% = £375; Plot 3 Roof 100% = £1,250; gross £1,625. Submit, reject (progress preserved), resubmit, approve/lock. Hard refresh preserved frozen snapshot. |
| **2** | Opening previous certified £1,625. Plot 2 Joists previous 50%; +25% this cert → 75% cumulative; Complete then certified **only the remaining 50%** (£375), not the full cell again. Cumulative gross £2,000. Submit / approve / hard refresh passed. |
| **3** | CE inclusion £250; matrix valuation £0; gross this certificate £250; certified to date £2,250; remaining £48,000. Hard refresh preserved the CE line. Submit / approve passed. |
| **4** | Recovery −£100 did **not** reduce gross works. Matrix £0; gross this certificate £0; certified gross to date £2,250; remaining £48,000; net payment −£100. Package recovery showed £100 recovered / £0 outstanding. Submit / approve / lock passed. |

### CVR hydration

Test Site 1 CVR loaded from server-backed certificate histories. Cost code 5231 Cleaning showed Certified **£2,150**. Wipe package drawer also showed £2,150. No false £0 loading state observed.

### Live defect fixed during BL-030C

Authority-on Stage Details Set % / Complete initially failed: the client API wrapper injected `createdBy`/`updatedBy` onto PATCH via `withActor`; the server correctly rejected those forbidden keys (400). Progress did not persist and the UI showed no error. Fix: PATCH/submit/reject/approve/delete send `actor` only; create may send `createdBy`; progress errors surface on the certificate page; Stage Details keeps the typed value until save succeeds; a real UI authority-on regression was added. After the fix, Set %, Complete, and hard-refresh persistence passed live.

### Historical-freeze UAT (PASSED)

Controlled replacement of the live Wipe It Cleaners matrix after Certs 1–4 were locked. Same matrix id `3ecc8395-17d4-4e05-99c4-947d1220dd69`: version **3 → 4**, committed still £50,000, 30 plots / 7 stages. Plot 2 / Joists **£750 → £999**. Stages reordered to Type, Roof, Joists, Low Levels, 1st fix, 2nd Fix, Finals. Plot 2 id stayed `plot-1-2`; Joists label unchanged. Hawthorn Gardens, Certs 1–4, CE-0020 / CE-0021, and authority flags were not altered.

Locked result: Cert 1 still v9 £1,625 / £1,625, snapshot matrix **v3**, Plot 2 / Joists historic **£750 / 50%**, Plot 3 / Roof historic **£1,250 / 100%**. Cert 2 still v6 £375 / £375, Joists historic **£750** (previous 50 / this 50 / cumulative 100). Cert 3 still CE £250 / gross £250. Cert 4 still recovery −£100 / gross £0 / net −£100. Live £999 does not appear in locked history. Package gross certified remained **£2,250**; CVR net certified remained **£2,150**.

Disposable draft **Cert 5** `8c040bd3-7faf-499d-8f1f-f43f1c5c1050` was created to prove future work uses the new matrix, then deleted from `buildlite_clone` via the V1 certificate API before BL-031. It is not business evidence. While it existed: live Plot 2 / Joists **£999**, previous progress **100%** via `plot-1-2` + `Joists`, this cert 0, remaining 0. Stage reorder did not move historic progress onto Roof. Wipe now has locked Certs 1–4 only.

Local freeze-test xlsx and other Test Site 1 spreadsheet copies are UAT artefacts — do not stage or commit them.

### Non-blocking UX observations (do not change in BL-030)

- Package summary top cards show Certified Gross / Remaining; recoveries are visible lower down. A future UX pass may add Recoveries / Net Certified headline cards.
- CVR “Outstanding Certified” currently displays the same £2,150 certified value and may need wording review.

---

## UAT / test data

See `docs/test-data/README.md`.

| Pack | Role |
|------|------|
| **Hawthorn Gardens** (`docs/test-data/Hawthorn Gardens UAT/`) | Intended **clean fictional known-answer** end-to-end UAT development. Permanent regression/UAT material. Not yet the imported live UAT model; import is a later task, not BL-029. |
| **Test Site 1** (`docs/test-data/Test Site 1/`) | **Legacy / current historical test evidence.** Keep. Do not treat as the new clean commercial test model. Used for BL-029D, BL-030C, BL-031C–F (including **BL-031E** snapshot/freeze UAT and **BL-031F** P02 monthly-cycle UAT), **BL-032C** P03 Draft UAT, and **BL-032D** P03 whole-CVR lock/freeze UAT. |

---

## ASUS development-machine checkpoint (BL-ASUS-001)

Verified on the new ASUS PC after migration from the previous Windows laptop:

- PostgreSQL 18.6 installed
- Local `buildlite_clone` restored from the previous machine (UAT/dev data — **do not run automated tests against it**)
- Isolated `buildlite_test` created and initialised
- Server automated tests: **93 tests, 0 failures** (isolated to `TEST_DATABASE_URL`)
- Local server ran on `localhost:3001`
- Vite client ran on `localhost:5173`

---

## Working commercial chain (implemented)

Development → Purchase Order → Subcontract Package → Commercial Events → Current Contract Value → Payment Certificate (matrix valuation, CE value inclusions, recovery deductions) → Certificate approval

Purchase Orders remain the foundation. Commercial Events record why a package value changed; they are not additional POs.

Login remains mock (`localStorage` identity). No production-grade authentication.

---

## Module snapshot (high level)

| Area | Status |
|------|--------|
| Purchase Orders | Working — Postgres JSON payload |
| Developments / Plot Master | Working — developments are server-backed |
| Packages / order matrices | Working — package identity and **order matrices are server-backed** after BL-029D |
| Commercial Events | Working — **server authority** after BL-028B.3 |
| V1 Payment Certificates | Working — **server authority** after BL-030C when `VITE_CERTIFICATE_SERVER_AUTHORITY=true`. Historical freeze vs later matrix replacement **PASSED**. |
| CVR / ledger / revenue | Working — **CVR/ledger server authority** after BL-031D when flags are ON. **Historic locked CVRs** render from immutable snapshots after BL-031E. **Create Next Period** copies persisted QS inputs after BL-031F. Live Draft/Submitted Revenue/GP after BL-032C. New locks freeze schema-v2 whole-CVR Revenue after BL-032D. |
| Administration / Setup Assistant | Working — largely localStorage master data |
| Commercial Assistant | Working foundation — local dispositions |
| User login / RBAC | Mock only |
| Payment notices / Pay Less | Not built |

---

## Non-blocking technical debt (recorded only — do not fix in persistence housekeeping)

| Item | Note |
|------|------|
| `GET /health` | `server/services/health.js` exists; route is not mounted in `app.js`. README historically documented it. |
| Missing `docs/uat/` export | CE import scripts default to `docs/uat/test-site-1-commercial-events-export.json`; that path does not exist. |
| `server/routes/supplierRoutes.js` | Unmounted orphan; file content is not a live Express router. |
| Stale historic documents | `docs/phase0/migration-run-log.md` is an empty template; Master Documentation index and Doc 49 predate BL-028. Preserve as historic. |
| Dual persistence | Matrices, V1 certificates, CVR periods and purchase ledger are shared when their server-authority flags are ON. Two browsers can still diverge if those flags are OFF, or on revenue / admin / assistant data that remains local. |
| API-outage matrix message | With the API stopped, matrix refresh shows a visible generic **Failed to fetch** state and does not fall back to localStorage. Intended fail-closed behaviour; wording is the raw fetch error rather than a matrix-specific sentence. Non-blocking. |
| Package summary cards | Top cards show Certified Gross / Remaining. Recoveries are visible lower down. Future UX may add Recoveries / Net Certified headline cards. Non-blocking. |
| CVR “Outstanding Certified” | Currently displays the same net certified figure (Wipe UAT: £2,150) and may need wording review. Non-blocking. |
| Mock authentication | Actor fields are not proof of identity (Doc 67 §26). Dedicated auth programme later; do not block persistence. |
| Root `package-lock.json` `name` | npm infers folder name because root `package.json` has no `name`. Reverted at BL-ASUS-001; a root `npm install` may rewrite it. Install from `client/` and `server/` to avoid churn. |

---

## BL-031A (server foundation)

Implemented: Postgres schema + server API for CVR periods, per-cost-code QS inputs (`manual_accrual` included), and purchase ledger import batches/transactions. Automated tests use `localhost:5432/buildlite_test` only.

**Not in BL-031A:** React/server cache, authority flags, localStorage cutover, clone migration, CVR snapshots, live calculation formula changes, accrual UI, revenue.

Agreed commercial rules (applied in **BL-031D**; historic snapshots delivered in **BL-031E**):

- Current commitment = approved PO net + approved value-changing Commercial Events (recovery-classified CEs excluded)
- CVR certified cost = frozen gross works + signed recovery (exclude retention and VAT; do not use `netValue`)
- Ledger actual for CVR = SUM(net)
- `manual_accrual` is a genuine QS input on current cost / CTC, distinct from outstanding certified
- Approve & Lock records workflow only in BL-031A; **BL-031E** now persists the immutable snapshot atomically. V1 will not reopen locked CVRs

## BL-031B (client cache / hydration / readiness)

Implemented: client API modules, camelCase mappers, per-development CVR/ledger caches, read facades, engine/UI readiness, and authority-ON tests. Vite test env forces `VITE_CVR_SERVER_AUTHORITY` and `VITE_LEDGER_SERVER_AUTHORITY` OFF. Live UI still reads `buildlite_cvr_v1` / `buildlite_purchase_ledgers_v1`. Mutation wrappers exist but are unwired.

**Not in BL-031B:** authority cutover, localStorage import, live API writes, formula changes, accrual UI, snapshots, BL-031C.

## BL-031C (server-write + migration preparation)

Implemented: unwired CVR/ledger mutation facades, cache patch helpers, deterministic localStorage→server mappers, and a developer-only preflight/execute migration tool (`window.buildliteCvrLedgerMigration` in Vite DEV). Live UI still reads/writes `buildlite_cvr_v1` / `buildlite_purchase_ledgers_v1`. Authority flags remain OFF. Live CVR formulas are unchanged (commitment = PO net; certified = certificate net; manualAccrual unused).

**Not done in BL-031C:** authority cutover, dual-write, snapshots, formula correction, Hawthorn Gardens.

### Live Test Site 1 migration (PASSED)

Executed from the real browser store against `buildlite_clone` for `dev-1785599776666-zck5pl`. Do not re-execute as new work; do not flip authority flags.

| Table | Count |
|-------|-------|
| `cvr_periods` | 1 |
| `cvr_cost_code_inputs` | 9 |
| `cvr_period_audit` | 2 (`created`, `inputs_upserted`) |
| `ledger_import_batches` | 0 |
| `ledger_transactions` | 0 |

P01 is `draft` (workflow version later advanced by BL-031D submit/reject UAT). Nine unique active inputs (`1110`, `2300`, `5105`, `5206`, `5212`, `5213`, `5215`, `5218`, `5231`). No local ledger existed at migration, so no batches were created then. Other developments (including `dev-1785843994416-19t8ha`) have 0 CVR periods.

## BL-031D (authority cutover + live formulas) — BANKED

Test Site 1 **authority-on UAT PASSED**. Server cache/API is the runtime store when flags are ON (no localStorage fallback, no dual-write). Repo `.env.example` defaults remain OFF. Local UAT used `client/.env.local`. Do not commit `.env.local`.

Live commercial facts / forecast overlays:

- **Committed** = approved subcontract PO net + approved/closed contract-value CEs. Recovery-relationship events (including CE-0021) excluded. No PO/CE double count. Unresolved CE/package data stays unavailable (not silent £0). Wipe 5231: **£50,250**. Development: **£2,364,873**.
- **Certified** = frozen gross works + signed recovery. Does **not** use certificate `netValue`, VAT, or retention. Wipe 5231: **£2,150**.
- **Actual** = SUM(ledger `net_amount`). VAT/gross are evidence only.
- **Current cost** = actual + **manualAccrual**. Accrual does not change committed, certified, or ledger actual.
- **System forecast** = commitment if > 0, else non-zero current budget, else actual > 0, else 0.
- **Final forecast** = system forecast + commercial adjustment (reason required when non-zero; adjustment history audited).
- **Cost to complete** = final forecast − current cost.
- **Outstanding certified** = max(0, certified − actual).
- **Variance** = current budget − final forecast.

UAT also covered worksheet Accrual / Current Cost columns, explicit **Save accrual** / **Save commercial adjustment** (no blur-write; dirty/clean button state), post-save commitment hydration (CE cache stays ready), summary KPIs, server-authority ledger import + supported reversal (offsetting row, no delete), and **Draft → Submit → Reject → Draft**. At the close of BL-031D, Approve & Lock had not been used. Snapshots were delivered in **BL-031E**.

### Test Site 1 clone evidence after UAT (do not delete)

| Check | Result |
|-------|--------|
| P01 | `draft`; submitted/approved fields null after Reject |
| Audit | `created`, `inputs_upserted`, `submitted`, `rejected` (`BL-031D UAT lifecycle test`) |
| P02 | **not created** |
| 5231 overlay | accrual **£100**, adjustment **+£500**, reason `BL-031D UAT test adjustment` |
| Ledger | 1 batch (`BL031D-UAT-001.csv`); 2 transactions (+£25 origin, −£25 reversal); net/VAT/gross **£0**; 5231 actual **£0** |
| Wipe certs 1–4 | locked 1625 / 375 / 250 / 0 (cert 4 net −£100) |
| CE-0020 / CE-0021 | approved +£250 / approved −£100 recovery |

## BL-031E (immutable CVR snapshots) — COMPLETE

**Snapshot creation UAT — PASSED. Historic freeze UAT — PASSED.**

Implemented:

| Slice | What it did |
|-------|-------------|
| **E.1 / E.2** | Migration `010_cvr_period_snapshots.sql`. Server close engine. Authoritative close candidate. Readiness/blocker model. BL-031D formula parity. Calculate-only until Approve & Lock. |
| **E.3** | Approve & Lock creates the immutable snapshot. Close candidate + snapshot INSERT + `submitted → locked` + audit occur atomically on one Postgres transaction / one transaction-scoped connection. Rollback on failure. One snapshot per period. |
| **E.4** | Locked periods render from the snapshot only. Draft/submitted periods remain live. Locked legacy period without a snapshot is historic-unavailable. No live PO/CE/certificate/ledger fallback for locked historic financials. |

Approve & Lock remains one-way. V1 does not reopen locked CVRs.

### Test Site 1 snapshot creation UAT (PASSED)

P01 Submit for Approval → Approve & Lock on `buildlite_clone` (`dev-1785599776666-zck5pl`).

| Check | Result |
|-------|--------|
| Period id | `a2d5f821-d43a-4fb0-8a77-44fac88bebfb` |
| P01 | **locked** version **5** |
| Snapshot id | `aa6839cc-eace-40dd-a011-6ca90afa7980` |
| Schema version | **1** |
| Headers / rows | **1** snapshot header; **9** snapshot rows |
| P02 | **not created** |

Frozen P01 development: committed **£2,364,873**; certified **£2,150**; actual **£0**; accrual **£100**; current cost **£100**; system forecast **£2,364,873**; adjustment **+£500**; final forecast **£2,365,373**; CTC **£2,365,273**; outstanding certified **£2,150**; variance **−£2,365,373**.

Frozen P01 5231: committed **£50,250**; certified **£2,150**; actual **£0**; accrual **£100**; current cost **£100**; system forecast **£50,250**; adjustment **+£500**; final forecast **£50,750**; CTC **£50,650**; outstanding certified **£2,150**; variance **−£50,750**.

Ledger, Wipe certs 1–4, CE-0020 / CE-0021, live Wipe matrix, and the P01 5231 overlay were not rewritten by the lock.

### Historic freeze UAT (PASSED)

After P01 was locked, approved live commercial event **CE-0022** (Variation, `BL-031E historic freeze UAT`, **+£10**, Wipe It Cleaners / 5231). Approved after the P01 snapshot was created.

Authoritative **current live** commitment moved:

| | At lock | After CE-0022 |
|--|---------|----------------|
| 5231 committed | £50,250 | **£50,260** |
| Development committed | £2,364,873 | **£2,364,883** |

The locked P01 snapshot **did not move**. Same snapshot id, created timestamp, 1 header and 9 rows. Frozen 5231 committed remained **£50,250**; frozen development committed remained **£2,364,873**.

This proves subsequent live commercial changes do not rewrite historic locked CVRs.

## BL-031F (next-period CVR carry-forward) — COMPLETE

**P02 monthly-cycle UAT — PASSED.** Functional fix banked at `007c0baa091c40399b9d98ce653018d7a7b392e9` (*BL-031F - Fix next-period CVR carry-forward*).

Create Next Period now sources **persisted QS period inputs**, not the locked period's empty `costCentres` list shape. Empty locked-period `costCentres` no longer suppress carry-forward.

| Behaviour | Result |
|-----------|--------|
| Source | Persisted `cvr_cost_code_inputs` on the locked period |
| Carried fields | Manual accrual, commercial adjustment, reason, notes |
| Adjustment history | Resets empty on the new Draft period |
| Live commercial facts | Remain derived from current PO/CE/certificate/ledger sources; not copied as historic money |
| Empty Draft recovery | Supported (Open Draft CVR / Create Next Period recovery PUT) |
| Create/copy failure | Fails visibly; does not report success with empty inputs |
| Navigation | Summary and Worksheet return to CVR Register after successful create/recovery |

### Recurring monthly CVR lifecycle (proven end-to-end)

locked P01 → continued commercial activity → Create Next Period → Draft P02 → carried QS opening state → current live commercial facts → P02-specific QS judgement → movement vs frozen P01 → Submit → Approve & Lock → independent immutable P02 snapshot.

P03 Draft UAT **PASSED** under BL-032C. P03 was later **locked** under BL-032D as the first schema-v2 whole-CVR snapshot. P04 was later created under **BL-033C.1** as Draft with explicit `reporting_month` **2026-08**.

### Test Site 1 P02 monthly-cycle UAT (PASSED)

`buildlite_clone` / Test Site 1 (`dev-1785599776666-zck5pl`). Wipe It Cleaners / cost code **5231**. Clone snapshot totals after lock: **2** headers / **18** rows.

**P01** (unchanged by P02 close):

| Check | Result |
|-------|--------|
| Period | **locked** version **5** |
| Snapshot id | `aa6839cc-eace-40dd-a011-6ca90afa7980` |
| Snapshot rows | **9** |
| Frozen development committed | **£2,364,873** |
| Frozen development final forecast | **£2,365,373** |
| Frozen 5231 committed | **£50,250** |
| Frozen 5231 accrual | **£100** |
| Frozen 5231 adjustment | **+£500** |
| Frozen 5231 final forecast | **£50,750** |

**P02:**

| Check | Result |
|-------|--------|
| Period id | `82454b78-04e5-4f89-8289-406f2ce3e1fa` |
| P02 | **locked** version **3** (Draft v1 → Submitted v2 → Locked v3) |
| Snapshot id | `e8dea429-ff33-4218-81e6-5102bd110a7f` |
| Snapshot rows | **9** |
| Distinct from P01 | yes |

**P02 month activity:**

- **CE-0022** approved Variation **+£10** after P01 lock (`BL-031E historic freeze UAT`)
- **CE-0023** approved Variation **+£20** during P02 (`BL-031F P02 monthly-cycle UAT`)
- Live 5231 commitment reached **£50,280**
- Live development commitment reached **£2,364,903**

**P02 QS overlay** (period-owned inputs retained after lock): accrual **£120**; adjustment **+£520**; reason `BL-031F P02 monthly-cycle overlay`; adjustment history **one** P02 entry **£500 → £520**.

**P02 frozen 5231 snapshot:** committed **£50,280**; certified **£2,150**; actual **£0**; accrual **£120**; current cost **£120**; system forecast **£50,280**; adjustment **+£520**; final forecast **£50,800**; CTC **£50,680**; outstanding certified **£2,150**; variance **−£50,800**.

**P02 frozen development snapshot:** committed **£2,364,903**; certified **£2,150**; actual **£0**; accrual **£120**; current cost **£120**; system forecast **£2,364,903**; adjustment **+£520**; final forecast **£2,365,423**; CTC **£2,365,303**; outstanding certified **£2,150**; variance **−£2,365,423**.

**Movement vs frozen P01:** Forecast Cost **+£50**; CTC **+£30**.

P01 and P02 remain independent immutable historic snapshots. Locked P02 renders from its snapshot, not the live model. Wipe locked certs 1–4 and the ledger origin/reversal pair were not rewritten. **BL-032C later created P03 Draft** from this locked P02; P01/P02 snapshots and P02 QS overlay/history were not rewritten.

## BL-032A (development revenue settings) — COMPLETE

**Authority-on UAT — PASSED** on `buildlite_clone` / Test Site 1 (`dev-1785599776666-zck5pl`). Implementation was banked at `f6a6a42d5e789e4363b27b114ce9a27f2447abe5` (*BL-032A - Persist revenue settings with server authority*).

### What BL-032A does

- Development Revenue **strategy/settings** can be Postgres-authoritative when `VITE_REVENUE_SERVER_AUTHORITY=true`
- Server persistence and optimistic versioning proven (GET does not INSERT; PUT creates on first write)
- No browser-only strategy authority when the flag is ON (no `buildlite_revenue_v1` fallback)
- Hard-refresh and second-session persistence proven

### What BL-032A does **not** do

Not yet implemented. Do **not** imply any of these are live:

- Exchange recognition (`recognitionPolicy=exchange` may be stored; it is **not** applied)
- Secured / exchanged Revenue lifecycle
- Revenue in CVR
- Gross Profit / Margin
- HA package revenue
- Discounts / physical incentives / customer extras
- Selling cost engine
- Prelims engine
- Overhead / finance / PBT
- Whole-CVR snapshot revenue fields

Recognised revenue remains **Completed-only**. Historic P01/P02 Revenue remains unavailable. Do not backfill snapshots with revenue or £0.

### Clone schema cutover

Migration `011_development_revenue_settings.sql` was applied to local `buildlite_clone`. Table `development_revenue_settings` exists. Additive only: no destructive effect and no P01/P02 snapshot backfill.

### Initial Test Site 1 state

- No local `buildlite_revenue_v1` payload
- Live browser helper: `listLocalDevelopmentIds() → []`; `preflight(Test Site 1) → NO_LOCAL`
- No localStorage migration was required or executed
- Initial server GET: `exists: false`, `version: 0`, `recognitionPolicy: completion`
- Defaults matched prior BL-019 behaviour (OM £350/ft², existing AH percentages, garage £0 / £12,500 / £22,500, empty house-type pricing / adjustments / recognitionSettings)

### Authority cutover

`VITE_REVENUE_SERVER_AUTHORITY=true` was set in ignored `client/.env.local` only. Repo `client/.env.example` default remains OFF. Do not commit `.env.local`.

RevenueWorkspace loaded from server authority. No localStorage fallback. Initial GET/load did **not** create a server row. Authority-on values matched the prior BL-019 defaults. Plot-level data still came from `developments.payload`.

### First write UAT

Open Market £/ft² **£350 → £351** through the normal Revenue UI. **Save Strategy → No** (settings only; no Auto-priced plot payload application).

First server row:

| Check | Result |
|-------|--------|
| id | `b2157b36-a243-414e-9169-2d192dad8301` |
| version | **1** |
| recognitionPolicy | **completion** |
| OM rate | **351** |
| Plot Master payload | unchanged |
| Plot 31 stored `forecastSellingPrice` | **£255,100** |
| Recognised revenue | **£0** (Completed-only) |

### Persistence proof

Hard refresh returned OM **351** from Postgres. A second browser session also showed **351**. `buildlite_revenue_v1` remained **null**. GET after read-only refresh stayed **version 1**.

### Restore

OM **£351 → £350** through the normal Revenue UI (**Save Strategy → No**). Same row advanced to **version 2**. Hard refresh returned the original baseline.

### Final Test Site 1 revenue settings (leave in place)

Exactly **one** `development_revenue_settings` row. Do **not** delete it; it is BL-032A authority-on UAT evidence.

| Check | Result |
|-------|--------|
| id | `b2157b36-a243-414e-9169-2d192dad8301` |
| version | **2** |
| recognition_policy | **completion** |
| OM rate | **350** |
| AH % | 58 / 72 / 70 / 65 / 70 / 100 |
| Garage premiums | 0 / 12500 / 22500 |
| house_type_pricing | `{}` |
| revenue_adjustments | `[]` |
| recognition_settings | `{}` |

Revenue baseline after restore: **31** plots, all **Available**; recognised revenue **£0**; forecast/GDV **£10,444,608**; Plot 31 stored `forecastSellingPrice` **£255,100** unchanged.

### Historic CVR protection (read-only confirmation)

| Check | Result |
|-------|--------|
| P01 | **locked** v5; snapshot `aa6839cc-eace-40dd-a011-6ca90afa7980` |
| P02 | **locked** v3; snapshot `e8dea429-ff33-4218-81e6-5102bd110a7f` |
| Snapshots | **2** headers / **18** rows; schema v1; unchanged |
| P03 | **absent at this UAT**; later created as Draft under BL-032C without changing these snapshots |
| Historic Revenue | still unavailable; not backfilled |

CE-0022 / CE-0023, Wipe locked certs 1–4, and the ledger origin/reversal pair were not rewritten.

### Deferred UI/UX observations (not this slice)

- Dashboard Average OM £/ft² can differ from the strategy rate because of plot premiums
- Hard refresh currently drops SPA navigation to New PO
- Revenue save distinguishes strategy save from applying values to Auto-priced plots (**Save Strategy → No** vs **Yes**)
- Broader CVR/navigation review remains deferred

Do not fix these here.

### Deferred UI/UX (not this slice)

CVR navigation is functionally working but not intuitive across CVR Register, Summary, Worksheet, Open Draft CVR, Continue to CVR, Back, and period navigation. Defer to the broader application UI/UX review. Do not redesign it here.

## BL-032B (private plot secured revenue lifecycle) — COMPLETE

Implementation was banked at `de1a9da549bc475261fc18e74cf5580b16c3716e` (*BL-032B - Add private plot secured revenue lifecycle*). Selling Price HTML `step` fix was banked at `3ad984adaab3f6b482ee614d92cb29749bd24180` (*BL-032B - Bank private revenue lifecycle UAT*). Same-price and differing-price Plot 31 human UATs **PASSED** on `buildlite_clone` / Test Site 1 (`dev-1785599776666-zck5pl`). Plot 31 was restored to its Available baseline after both proofs.

### Proven commercial rules

| Status | Forecast Revenue | Secured Revenue |
|--------|------------------|-----------------|
| Available | derived forecast | £0 |
| Reserved | derived forecast | £0 |
| Exchanged | contractual `sellingPrice` | contractual `sellingPrice` |
| Completed | same contractual `sellingPrice` | unchanged from Exchange |
| Cancelled | £0 (excluded) | £0 (excluded) |

Development: Forecast Revenue = sum of status-aware plot Forecast; Secured Revenue = sum of Exchanged + Completed contractual values; Remaining Forecast = Forecast − Secured. `plotsSold` = Exchanged + Completed. Exchange at a different price legitimately **moves** development Forecast (substitution, not addition).

### Selling Price UAT defect (pre-existing; fixed during BL-032B UAT)

Native HTML `type="number"` Selling Price used `step="1000"`. The browser rejected **£255,100** (“nearest valid values are 255000 and 256000”). This was a pre-existing UI defect, not a BL-032B calculation defect. Corrected to `step="0.01"` in `3ad984adaab3f6b482ee614d92cb29749bd24180` so contractual selling prices accept GBP pence. App `validatePlot` already accepted 255100; the form never submitted.

### Same-price Plot 31 UAT (PASSED)

Save Strategy → **No**. Contractual exchange **£255,100** equalled stored forecast.

| Step | Result |
|------|--------|
| Available | Forecast £255,100; Secured £0 |
| Reserved | Forecast-only; stray/absent sellingPrice did not secure |
| Exchanged at £255,100 | Secured **£255,100**; development Forecast **unchanged**; Remaining reduced by £255,100; Plots Sold **1**; exchange date persisted |
| Completed at £255,100 | Secured **unchanged** £255,100; not a second money event |
| Hard refresh / second session | lifecycle state survived |
| Restore | Plot 31 returned to Available sales baseline |

### Differing-price Plot 31 UAT (PASSED)

Save Strategy → **No**. Baseline Plot 31 forecast **£255,100**. Contractual exchange **£250,000**.

| Position | Forecast | Secured | Remaining | Plots Sold |
|----------|----------|---------|-----------|------------|
| Before | £10,444,608 | £0 | £10,444,608 | 0 |
| Exchanged at £250,000 | **£10,439,508** | **£250,000** | **£10,189,508** | **1** |
| Completed at £250,000 | £10,439,508 | £250,000 | £10,189,508 | 1 |
| Restored | £10,444,608 | £0 | £10,444,608 | 0 |

Forecast movement **−£5,100**. Plot 31 Forecast/Secured became **£250,000**; Remaining **£0**. This proves BuildLite **substitutes** contractual exchange value for the prior forecast. It does not retain £255,100 and add £250,000. Completion at the same £250,000 did not double-count.

### Lifecycle dates

`reservedAt` / `exchangedAt` / `completedAt` are lightweight Plot Master payload fields (no sales table, CRM, or purchaser workflow). Dates persisted during UAT and were cleared when Plot 31 was restored.

### Final Test Site 1 Plot 31 baseline (leave in place)

| Check | Result |
|-------|--------|
| revenueStatus | **Available** |
| forecastSellingPrice | **£255,100** |
| sellingPrice | **£0** |
| reservedAt / exchangedAt / completedAt | **cleared** |
| All 31 plots | **Available** |

Revenue settings evidence row unchanged: `b2157b36-a243-414e-9169-2d192dad8301`, version **2**, OM **350**, `recognition_policy` **completion**. Do **not** delete it. Secured Revenue is derived from plot lifecycle/status and `sellingPrice`, not from `recognitionPolicy`.

### Historic CVR protection (read-only confirmation)

| Check | Result |
|-------|--------|
| P01 | **locked** v5; snapshot `aa6839cc-eace-40dd-a011-6ca90afa7980` |
| P02 | **locked** v3; snapshot `e8dea429-ff33-4218-81e6-5102bd110a7f` |
| Snapshots | **2** headers / **18** rows; schema v1; unchanged |
| P03 | **absent at this UAT**; later created as Draft under BL-032C without changing these snapshots |
| Historic Revenue | unavailable; not backfilled |
| Revenue in CVR | **not wired in this slice**; snapshots remain cost-only |

CE-0022 / CE-0023, Wipe locked certs 1–4, and the ledger origin/reversal pair were not rewritten.

### What BL-032B does **not** do

Not provided. Do **not** imply any of these are live:

- Revenue in the CVR
- Gross Profit / Gross Margin
- Revenue in immutable CVR snapshots
- HA / package revenue
- Cash discounts / physical incentive treatment / customer extras
- Reservation price
- Selling cost forecast engine
- Prelims engine
- Company overhead
- Finance / PBT
- Cash flow / ROCE
- `recognitionPolicy=exchange` as live CVR/accounting behaviour (stored only; Secured is status/`sellingPrice` derived)
- P03 (created later as Draft under BL-032C; not part of this slice)

## BL-032C (live CVR Revenue + Gross Profit) — COMPLETE

Implementation was banked at `9cbf2e6bad92946e8087fe6bad0c4b1fce590d3d` (*BL-032C - Add live CVR revenue and gross profit*). Test Site 1 P03 Draft UAT **PASSED** on `buildlite_clone` / Test Site 1 (`dev-1785599776666-zck5pl`).

### What BL-032C does

Live Draft/Submitted CVR Summary composes the existing Revenue engine with the existing CVR cost engine. It does **not** add Revenue formulas to `cvrEngine.js`.

- Forecast Revenue, Secured Revenue, Remaining Forecast
- Forecast Cost (existing CVR `finalForecast`)
- Gross Profit = Forecast Revenue − Forecast Cost
- Gross Margin = Gross Profit / Forecast Revenue, displayed to 1 decimal place
- Plots Sold
- Revenue false-zero protection; cost remains available if Revenue is unavailable
- Submit is not blocked by unavailable Revenue
- Historic schema-v1 P01/P02 show Revenue/GP/Margin unavailable; no live Revenue fallback; no £0 substitution
- Revenue/GP/Margin movement against a v1 previous period is unavailable; existing cost movement continues
- Snapshot schema remains **v1**; close-engine source keys remain cost-only; Portfolio remains cost-only

### Test Site 1 P03 Draft UAT (PASSED)

Create Next Period from locked P02 created **P03 Draft v1** (`804e7777-4249-41a4-9698-9431c8942ebc`). At that UAT P04 did not exist. P03 has **no snapshot** in this Draft record. Live Revenue/GP values are Draft compose only and are **not** stored in a CVR snapshot.

**Carry-forward:** exactly **9** active QS rows copied from locked P02. Cost code **5231**: accrual **£120**; adjustment **+£520**; reason `BL-031F P02 monthly-cycle overlay`; notes empty; adjustment history **reset to empty**. P02 5231 overlay and its **£500 → £520** history entry were not altered.

**Live P03 development cost:** committed **£2,364,903**; certified **£2,150**; actual **£0**; accrual **£120**; commercial adjustment **+£520**; system forecast **£2,364,903**; Forecast Cost / final forecast **£2,365,423**; CTC **£2,365,303**; Forecast Variance **−£2,365,423**; outstanding certified **£2,150**.

**Live P03 5231:** committed **£50,280**; certified **£2,150**; actual **£0**; accrual **£120**; adjustment **+£520**; system forecast **£50,280**; final forecast **£50,800**; CTC **£50,680**.

**Live P03 Revenue / GP:** Forecast Revenue **£10,444,608**; Secured Revenue **£0**; Remaining Forecast **£10,444,608**; Plots Sold **0**; Forecast Cost **£2,365,423**; Gross Profit **£8,079,185**; Gross Margin **77.4%**.

**Movement vs P02:** Revenue / Secured / Remaining / Gross Profit / Gross Margin movement **unavailable** (P02 is schema-v1 cost-only; missing historic Revenue is not treated as £0). Live P03 cost equals frozen P02 cost, so zero cost movement is not shown.

**Historic protection:** P01 locked v5 snapshot `aa6839cc-eace-40dd-a011-6ca90afa7980` (9 rows) and P02 locked v3 snapshot `e8dea429-ff33-4218-81e6-5102bd110a7f` (9 rows) remain schema **v1**. Clone snapshot totals still **2** headers / **18** rows. P01/P02 continue to show Revenue **—**, Gross Profit **—**, Gross Margin **—**, and “Revenue was not captured in this historic CVR.” No live Revenue fallback.

Revenue settings evidence row unchanged: `b2157b36-a243-414e-9169-2d192dad8301`, version **2**, OM **350**, `recognition_policy` **completion**. Plot Master remains the restored BL-032B baseline: **31** plots, all **Available**; Plot 31 forecast **£255,100**, sellingPrice **£0**, lifecycle dates empty.

## BL-032D (whole-CVR Revenue-bearing snapshot) — COMPLETE

Implementation was banked at `50c09ab26debd4ae1250d6c3350b0df523a5b439` (*BL-032D - Add revenue-bearing CVR snapshots*). Migration `012_cvr_period_snapshot_revenue.sql` was applied to local `buildlite_clone`. Test Site 1 P03 whole-CVR lock/freeze UAT **PASSED**.

### What BL-032D does

New Approve & Lock persists schema **v2** whole-CVR snapshots: existing cost totals/rows plus Forecast/Secured/Remaining Revenue, Plots Sold/Remaining, Gross Profit, Gross Margin (NULL when Forecast Revenue is effectively zero), frozen `revenue_assumptions` JSON, settings id/version evidence, and plot Revenue rows in `cvr_period_snapshot_plots`. Server-derived only. Submit remains allowed if Revenue is unavailable; Approve & Lock fails closed until cost + Revenue are complete. Invalid Exchanged/Completed `sellingPrice <= 0` blocks lock and lists plot numbers. Historic v1 stays NULL/unavailable. Historic v2 reads snapshot only. Portfolio remains cost-only.

### Test Site 1 P03 whole-CVR lock/freeze UAT (PASSED)

`buildlite_clone` / Test Site 1 (`dev-1785599776666-zck5pl`). P03 `804e7777-4249-41a4-9698-9431c8942ebc` **locked** v3. First schema-v2 snapshot: `0ad18cb8-0b1a-469a-8fa0-10216728150a`.

| Check | Result |
|-------|--------|
| Lifecycle | Draft v1 (created 2026-08-20) → submitted 2026-08-21T07:30:10.192Z → locked/approved 2026-08-21T07:30:29.768Z |
| Audit | `created`, `inputs_upserted`, `submitted`, `approved`, `locked` |
| Snapshot | **1** header, schema **v2**, 9 cost rows, **31** Revenue plot rows |
| Forecast Revenue | **£10,444,608** |
| Secured / Remaining | **£0** / **£10,444,608** |
| Plots Sold / Remaining | **0** / **31** |
| Forecast Cost (`finalForecast`) | **£2,365,423** |
| Gross Profit | **£8,079,185** (= Forecast Revenue − finalForecast) |
| Gross Margin | **77.3527%** stored (GP / Forecast Revenue × 100) |
| Frozen 5231 | committed **£50,280**; certified **£2,150**; actual **£0**; accrual **£120**; current cost **£120**; adjustment **+£520**; final forecast **£50,800**; CTC **£50,680** |
| Frozen Plot 31 | Available; forecast **£255,100**; secured **£0**; remaining **£255,100**; sellingPrice NULL; NIA 686 ft²; premium **£15,000**; source House Type; dates empty |
| Assumptions | settings `b2157b36-a243-414e-9169-2d192dad8301` version **2**; OM **£350/ft²**; `completion`; AH 58/72/70/65/70/100; garage 0/12500/22500; empty house-type pricing / adjustments / recognitionSettings |
| QS inputs | **9** P03 overlays still present; 5231 unchanged; lock did not rewrite them |

**Historic freeze:** human UI moved live Plot 31 after lock then restored status/dates/forecast. Plot Master `updated_at` **2026-08-21T07:35:07.993Z** is after lock. The temporary Exchanged/Reserved state is **not** retained in Postgres after restore. Locked P03 snapshot did not move. Live Revenue after restore is again Forecast **£10,444,608** / Secured **£0** / Remaining **£10,444,608** / Plots Sold **0**. Live Plot 31 is Available / forecast **£255,100** / dates empty. Live `sellingPrice` was left at **£255,100** (other 30 plots remain £0). Available KPIs ignore that leftover contractual price; frozen P03 Plot 31 sellingPrice remains NULL.

**Historic protection:** P01 locked v5 snapshot `aa6839cc-eace-40dd-a011-6ca90afa7980` and P02 locked v3 snapshot `e8dea429-ff33-4218-81e6-5102bd110a7f` remain schema **v1** with all Revenue/GP fields **NULL** and **0** plot rows. Clone totals at P03 lock: **3** headers / **27** cost rows / **31** Revenue plot rows. CE 23 / certs 4 locked / ledger 1 batch + 2 txns / POs 10 / packages 10 unchanged. Settings row still version **2**. P04 was later created under **BL-033C.1** as Draft.

### What BL-032D does **not** do

Not provided. Do **not** imply any of these are live:

- HA / package Revenue
- extras / incentives / discounts
- selling costs / prelims / overhead / finance / PBT
- plot cost allocation / profitability
- P04 / Create Next Period from P03
- `recognitionPolicy=exchange` as live CVR/accounting behaviour
- CVR navigation redesign

## BL-033A / BL-033B (semantic classification) — COMPLETE

BL-033A design is **ACCEPTED**. Client cost codes remain the commercial/accounting identity. Commercial Head / Family / Reporting Group remain the tenant reporting hierarchy and are **not** the engine taxonomy.

Proven architectural rule:

Client cost-code identity  
+  
BuildLite semantic classification  
+  
forecast-driver metadata  

are separate concerns. **PRELIMS does not automatically mean TIME.** `STANDARD_CVR` remains valid for a PRELIMS-classified cost code. TIME remains metadata only until a later forecasting-engine slice.

Stable semantic groups: `UNCLASSIFIED` / `LAND` / `FEES` / `INFRASTRUCTURE` / `BUILD` / `PRELIMS` / `SELLING` / `OTHER`.

Forecast-driver metadata (no calculations in this slice): `STANDARD_CVR` / `TIME` / `LUMP_SUM` / `QUANTITY` / `MILESTONE` / `PERCENTAGE` / `MANUAL`.

Unmapped = `UNCLASSIFIED` + `STANDARD_CVR`. `OTHER` is explicit only. GET/default creates no row.

Adoption architecture is **deferred**. Do **not** treat `finalForecast = max(systemForecast, adoptedEngineFinal) + qsAdjustment` as an invariant. Conceptual future stack only: System Forecast → Engine Recommended Forecast → Adopted Forecast → QS Adjustment → Final Forecast.

BL-033B adds tenant-level `cost_code_classifications` only. No development-specific driver overrides, rates, dates, quantities, or programme fields. No Prelims forecast engine. No CVR formula change. No snapshot schema change.

### Test Site 1 classification UAT (PASSED)

`buildlite_clone` / Test Site 1 (`dev-1785599776666-zck5pl`). One tenant classification row:

| Field | Value |
|-------|-------|
| id | `131acfb1-d2e9-4d53-86b9-df5f4f8306b6` |
| cost_code_key | `5231` |
| semantic_group | **PRELIMS** |
| forecast_driver | **STANDARD_CVR** |
| version | 1 |
| created_at / updated_at | 2026-08-21T09:26:22.157Z |
| actor | Commercial Manager |

No duplicate/case-variant `5231` row. Tenant classification count **1**.

Classification persisted server-side after refresh. Frozen P03 snapshot `0ad18cb8-0b1a-469a-8fa0-10216728150a` created_at remains **2026-08-21T07:30:29.768Z** (before the classification write). Snapshot money did not move:

| Check | Result |
|-------|--------|
| Forecast Revenue | **£10,444,608** |
| Forecast Cost (`finalForecast`) | **£2,365,423** |
| Gross Profit | **£8,079,185** |
| Frozen 5231 committed / certified / actual | **£50,280** / **£2,150** / **£0** |
| Frozen 5231 accrual / adjustment | **£120** / **+£520** |
| Frozen 5231 final forecast / CTC | **£50,800** / **£50,680** |
| P01 / P02 / P03 | locked v5 / v3 / v3; snapshots unchanged |
| Snapshot totals | **3** headers / **27** cost rows / **31** plot rows |
| P04 | absent |

`5231` continues through existing STANDARD_CVR calculation. PRELIMS + STANDARD_CVR is classification metadata only.

### What BL-033B does **not** do

- Prelims forecast engine / TIME calculations
- programme assumptions / monthly profiles
- Review & Adopt
- Selling Costs
- automatic classification from Commercial Head labels
- P04 / P01–P03 mutation
- switching 5231 to TIME

## BL-033C (development programme) — COMPLETE

BL-033C adds a typed server-authoritative `development_programme` row per development. GET seeds `siteStart` / `finalCompletion` / `totalPlots` from `developments.payload` (`startDate`, `targetCompletion`, `plotCount`) **without inserting**. `firstCompletion` is never seeded. PUT uses optimistic `version` (0 creates v1; stale = 409). Programme PUT does not dual-write payload.

Inclusive calendar months, no proration. Month 1 is the calendar month containing `siteStart`.

Future TIME bases accepted: SITE_START / FIRST_COMPLETION / FINAL_COMPLETION / FIXED_DATE. A FIRST_COMPLETION line remains unresolved if `firstCompletion` is absent. LUMP_SUM remaining-assumption rule is implemented in BL-033D.1. The Prelims forecast engine is calculation-only and is not adopted into the CVR.

`cvr_periods.reporting_month` is calendar meaning beside the period key, not a replacement for `P01`/`P02`/`P03`. Historic Test Site 1 P01/P02/P03 remain NULL and must stay so (no backfill, no today, no historic inference). New periods persist `reportingMonth` when supplied. Create Next copies previous reporting month + 1 calendar month when that previous month exists. When previous is NULL, the new period stays NULL unless the caller supplies a month.

**BL-033D.1 COMPLETE.** TIME / LUMP_SUM proposal calculations exist beside the CVR. BL-033C.1 UAT **PASSED**. Create Next requires an explicit `YYYY-MM` reporting month (prefill previous+1 when safe).

### Test Site 1 programme UAT (PASSED)

`buildlite_clone` / Test Site 1 (`dev-1785599776666-zck5pl`). Migration `014` applied. One typed programme row:

| Field | Value |
|-------|-------|
| id | `9ff45e90-8412-4e3e-a6d9-45a0d6abd177` |
| client_id | `7e23d356-63b6-4bea-b4eb-065c9977ac03` |
| siteStart | **2026-09-01** |
| firstCompletion | **NULL** |
| finalCompletion | **2029-10-01** |
| totalPlots | **31** |
| durationMonths | **38** |
| version | **1** |
| actor | Commercial Manager |
| created_at / updated_at | 2026-08-21T10:51:28.752Z |

Payload still `startDate=2026-09-01` / `targetCompletion=2029-10-01` / `plotCount=31` (no dual-write). P01/P02/P03 and 5231 unchanged. P04 absent. Snapshot totals remain 3 headers / 27 cost rows / 31 plot rows. P03 money unchanged (Forecast Revenue £10,444,608; Forecast Cost £2,365,423; GP £8,079,185).

### What BL-033C does **not** do

- `development_prelims_items`
- TIME / LUMP_SUM / QUANTITY / MILESTONE / PERCENTAGE / MANUAL calculations
- monthly financial profiles / Prelims workspace / Review & Adopt
- CVR formula or snapshot schema changes
- Selling Costs / cash flow
- P04 / reporting-month picker (**BL-033C.1**) — **COMPLETE**; P04 Draft exists with `reporting_month` **2026-08**
- switching 5231 to TIME

## BL-033C.1 (explicit CVR reporting-month selection) — COMPLETE

`reportingMonth` is explicit calendar meaning beside the period key (`P01` / `P02` / `P03` / `P04`). It is not inferred from today's date, from the period key, or from programme dates. BL-033D.1 TIME uses the open CVR `reportingMonth` as `forecastAsAt`. No today fallback.

Create Next Period always shows a small reporting-month dialog before creating a **new** period:

- If the latest period has a valid `reportingMonth`, the picker is prefilled with previous + 1 calendar month (December rolls to January). The user may change it.
- If no safe suggestion exists (previous `reportingMonth` NULL), the picker is empty. No today default. No period-key inference. The user must explicitly choose YYYY-MM. Blank Create is disabled.
- Cancel creates nothing.
- Create `{nextPeriodKey}` persists the selected month on the **new** period only. Historic periods are not backfilled.

Empty-draft recovery / Open Draft still opens the existing draft without inventing a month and without creating a duplicate period. Historic P01/P02/P03 remain NULL unless a separate explicit historic-correction feature is ever designed. API create may still omit `reportingMonth` for fixtures/tests; the standard Create Next UX cannot.

No schema change. No Prelims engine in that slice. TIME / LUMP_SUM calculations arrived later in BL-033D.1.

### Test Site 1 reporting-month UAT (PASSED)

`buildlite_clone` / Test Site 1 (`dev-1785599776666-zck5pl`). P04 is the first Test Site 1 CVR with explicit reporting-month semantics. The agreed commercial month was **user-selected** August 2026 (`2026-08`), not derived from today / P03 / P04 / programme.

Cancel proof: first dialog opened empty; Create P04 disabled while blank; Cancel left P04 absent.

Create: second dialog also empty; user selected **2026-08**; one Create P04 click.

| Field | Value |
|-------|-------|
| id | `0f513191-cd25-4812-834f-37dcf66487e0` |
| period_key | **P04** |
| status | **draft** |
| version | **1** |
| reporting_month | **2026-08** |
| submitted_at / approved_at | **NULL** |
| snapshot | **none** |
| QS rows | **9** active |

Reporting months: P01 NULL, P02 NULL, P03 NULL, P04 **2026-08**. No historic backfill.

P04 5231 carry-forward: accrual **£120**; adjustment **+£520**; reason `BL-031F P02 monthly-cycle overlay`; notes empty; adjustment history reset. P03 5231 `updated_at` remained `2026-08-20T17:37:49.233Z`. Classification still PRELIMS + STANDARD_CVR v1 (`131acfb1-d2e9-4d53-86b9-df5f4f8306b6`).

Live P04 Draft (existing Cost/Revenue engines; no TIME calculation): Forecast Revenue **£10,444,608**; Forecast Cost **£2,365,423**; Gross Profit **£8,079,185**; Gross Margin **77.4%**; Cost To Complete **£2,365,303**; Forecast Variance **−£2,365,423**; Secured **£0**; Remaining Forecast **£10,444,608**.

Programme unchanged: `9ff45e90-8412-4e3e-a6d9-45a0d6abd177` v1; site start 2026-09-01; first completion NULL; final 2029-10-01; 31 plots; 38 months. Snapshot totals remain **3** headers / **27** cost rows / **31** plot rows. P03 snapshot `0ad18cb8-0b1a-469a-8fa0-10216728150a` schema v2 unchanged. **P05 absent.**

If a later locked/current period has `reporting_month` **2026-08**, the next suggested month is **2026-09** (previous + 1 calendar month). Do not create P05 merely to prove this.

Deferred UX (not fixed in this bank): Create Next can require scrolling after first interaction; `reporting_month` is persisted but not shown on the P04 Summary header.

## BL-033D.1 (Development Prelims TIME / LUMP_SUM proposal) — COMPLETE

Calculation-only forecast proposal / assumption layer beside the existing CVR. It does **not** write `systemForecast`, `finalForecast`, QS `commercialAdjustment`, close-engine formulas, snapshots, or P04 money. There is **no Review & Adopt** and **no CVR adoption**.

Grain: multiple `development_prelims_items` per customer `cost_code_key`. Each line owns TIME or LUMP_SUM. STANDARD_CVR is not persisted as a Prelims line. Add always POSTs a new row; Edit is entered only from an existing line and PUTs that id.

TIME uses inclusive calendar months, independent start/end bases (`SITE_START` / `FIRST_COMPLETION` / `FINAL_COMPLETION` / `FIXED_DATE`), and `forecastAsAt =` open CVR `reportingMonth`. Never today. Missing FIRST_COMPLETION or reporting month is unresolved, not a genuine £0.

LUMP_SUM amount + status. Spend does not rewrite the assumption. ACTIVE participates; COMPLETE keeps the original assumption with remaining exposure £0 and excludes it from the active proposal; CANCELLED is excluded without deleting the assumption; reactivating restores either.

Migration `015_development_prelims_items.sql` is applied on `buildlite_test` and local `buildlite_clone`. No unique constraint on `cost_code_key`. Migration `016` is a later company-template slice and is **not** applied to clone.

### Test Site 1 Prelims UAT — PASSED

`buildlite_clone` / Test Site 1 (`dev-1785599776666-zck5pl`), cost code **5231**. Three rows after human UAT (including COMPLETE / CANCELLED / reactivate proofs on the LUMP_SUM line):

| id | name | driver | status | version | assumption |
|----|------|--------|--------|---------|------------|
| `3e9402bf-3093-4228-be69-0d163e5b5bda` | BL-033D.1 LUMP SUM UAT | LUMP_SUM | active | 6 | £20,000 |
| `da5b67be-8432-454e-b6a5-37e163078f1c` | BL-033D.1 TIME UAT | TIME | active | 1 | SITE_START → FINAL_COMPLETION, £1,000/month, 38 months / £38,000 |
| `da6668b7-329c-4cab-a0aa-1233184d79cb` | BL-033D.1 UNRESOLVED UAT | TIME | active | 1 | FIRST_COMPLETION → FINAL_COMPLETION; unresolved `MISSING_FIRST_COMPLETION` |

Resolved active proposal **£58,000**. Unresolved lines present (the FIRST_COMPLETION line is excluded from the resolved total; firstCompletion remains NULL). Add vs Edit: creating a second line POSTs a new id; explicit Edit updates only the selected line.

Programme unchanged: `9ff45e90-8412-4e3e-a6d9-45a0d6abd177` v1; site start 2026-09-01; first completion NULL; final 2029-10-01; 31 plots; 38 months. 5231 classification still PRELIMS + STANDARD_CVR v1 (`131acfb1-d2e9-4d53-86b9-df5f4f8306b6`). P04 remains Draft v1 `reporting_month` **2026-08**, no snapshot. P05 absent. Standard CVR money unchanged: 5231 committed **£50,280** / accrual **£120** / adjustment **+£520** / systemForecast **£50,280** / finalForecast **£50,800**; development Forecast Cost **£2,365,423** / Revenue **£10,444,608** / GP **£8,079,185**. P01/P02/P03 snapshots unchanged (**3** headers / **27** cost rows / **31** plot rows).

Company-level reusable Prelims templates are **BL-033D.x.1 COMPLETE**. They do not copy into `development_prelims_items` yet.

## BL-033D.x.1 (Company Prelims templates + BuildLite Standard) — COMPLETE

Company-template UAT **PASSED** on `buildlite_clone`. Product-owned **BuildLite Standard Prelims Template v1** (`BUILDLITE_STANDARD_PRELIMS_TEMPLATE` in `server/services/buildliteStandardPrelimsTemplate.js`) remains an application definition, not tenant DB rows. 25 commercially reviewed guidance lines, stable `bl.prelims.v1.*` keys, no customer cost codes, no £ rates, no development dates. Tenant APIs cannot mutate the Standard. Future Standard v2 must not mutate company templates copied from v1.

**Commercial principle:** BuildLite template lines represent forecast assumptions/behaviours, not a prescribed client cost-code structure. Multiple template lines may map to the same client cost code. Example: `5231` Cleaning could later hold Ongoing Site Cleaning (TIME) and Final Clean (LUMP_SUM) as separate assumptions.

### Company-template UAT — PASSED

One company-owned copy, client `7e23d356-63b6-4bea-b4eb-065c9977ac03`:

| Field | Value |
|-------|--------|
| id | `57d780fc-dac3-48ac-bbd0-03cf99bb8646` |
| name | BuildLite Standard Prelims |
| origin | `buildlite_standard` |
| source_standard_version | 1 |
| is_default | true |
| header version | 1 |
| lines | 25, unique `template_key`s, all enabled |
| cost_code_key | all NULL (unmapped) |
| monthly_rate / lump_sum_amount | all NULL |
| TIME/LUMP_SUM and TIME bases | match Standard v1 |

No duplicate company template. Creating this copy did not insert `development_prelims_items`. CVR, programme, classification, and the three D.1 UAT rows are unchanged.

Migration `016_client_prelims_templates.sql` is applied on `buildlite_test` and local `buildlite_clone`.

## BL-033D.x.2A.1 (Tenant Cost Code Master server foundation) — IMPLEMENTED AND BANKED

Server foundation exists; tenant Cost Code Master authority has **not** been cut over. Additive migration `017_cost_codes_tenant_master.sql` evolves existing `cost_codes` with Admin-master fields, optimistic `version`, and case-insensitive trimmed uniqueness on `(client_id, code)`. Canonical identity remains the customer code as entered (`5231`, `P100-SM`). UUID is technical only. Code is immutable after create. No DELETE; deactivate retains the row.

`VITE_COST_CODE_SERVER_AUTHORITY` remains **OFF**. The live Admin Cost Codes screen still uses `buildlite_cost_codes_master_v1` unless the flag is turned on. The browser master has **not** been copied. `017` is **not** applied to `buildlite_clone`. Clone `cost_codes` remains 95 rows in the old seven-column schema; `lower(btrim(code))` collision check: **0**. GET `/api/po/cost-codes` is unchanged as a compatibility view of the same table. Classification 013 remains independent. D.x.2 mapping remains blocked.

## BL-033D.x.2A.2 (Admin Cost Codes server-authority UI) — IMPLEMENTED AND BANKED

Awaiting controlled Cost Code Master cutover/UAT. Administration → Cost Codes supports the server path when `VITE_COST_CODE_SERVER_AUTHORITY=true`: list/search/add/edit/deactivate via `/api/cost-codes`, optimistic version, immutable code, classification still saved separately via 013. Failed GET is not a genuine empty master. Commercial Structure catalog remains browser-local for dropdowns. Flag remains **OFF**. Test Site 1 browser master not migrated. Clone has not received 017. Turning the flag ON against the current clone would show the thin 95-row PO-era table and is **not** the approved cutover.

## Next action

**NEXT: BL-033D.x.2A.3** — controlled Test Site 1 Cost Code Master cutover: apply `017` to `buildlite_clone`, compare/copy the richer browser master, then a flag-ON UAT. Do **not** turn the flag ON against the current thin clone. **D.x.2 company-template mapping remains blocked** until that cutover. Do **not** implement D.x.3 development instantiation. Do **not** implement Review & Adopt. Do **not** adopt Prelims into the CVR. P04 remains Draft. Do **not** Submit P04. Do **not** Approve & Lock P04. Do **not** create P05. Do **not** switch 5231 to TIME. Do **not** alter the three Test Site 1 Prelims UAT rows. Do **not** alter the 25-line BuildLite Standard v1.

Do **not** alter P01/P02/P03 `reporting_month` except by a future explicit historic-correction feature. Do not delete programme row `9ff45e90-8412-4e3e-a6d9-45a0d6abd177`. Do not delete P04 `0f513191-cd25-4812-834f-37dcf66487e0` except by a later controlled commercial task.

Do not treat Hawthorn Gardens as started. Repo flag default remains OFF. Local UAT left `VITE_REVENUE_SERVER_AUTHORITY=true` in ignored `client/.env.local` (do not commit it). Test Site 1 has one `development_revenue_settings` row (version 2, OM 350, completion) as evidence — do not delete it. Do not delete locked P03 snapshot `0ad18cb8-0b1a-469a-8fa0-10216728150a`. Do not delete classification row `131acfb1-d2e9-4d53-86b9-df5f4f8306b6`.

---

## Historic pointer (Phase 0 / BL-006)

Phase 0 migration framework, seed, and production schema reconciliation (migrations `001`–`003`) remain in the codebase. That work is complete as a baseline, not the current development programme. See `docs/DATABASE.md` (BL-006 catalogue preserved below the current persistence section) and `docs/phase0/`.
