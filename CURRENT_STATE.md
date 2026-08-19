# BuildLite Current State

## Purpose

This document is the in-repo status snapshot for a clean Cursor session. It records the actual position after **Doc 67 persistence migration** through **BL-030**, **BL-ASUS-001**, and **BL-031A–D**. **BL-031D** Test Site 1 authority-on UAT **PASSED** and is banked. BL-031 is **not** complete: immutable CVR snapshots remain **BL-031E**. Repo authority-flag defaults remain OFF; local UAT used `client/.env.local` (do not commit it).

Historic Phase 0 / BL-006 schema notes remain in `docs/DATABASE.md` and `docs/phase0/`. Do not treat those files as the current programme.

Authoritative persistence architecture: **Doc 67** in BuildLite Master Documentation.

---

## Repository / programme

| Item | Value |
|------|-------|
| Branch | `buildlite-V1-1` |
| Repository | `buildlite-po` (historic GitHub name: `dmcc-cvr-system`) |
| Programme | Doc 67 — Persistence Architecture & Migration Blueprint |
| Last completed product slice | BL-030 Payment Certificate persistence (including BL-030C cutover and historical-freeze UAT) |
| Last persistence slice implemented | **BL-031D banked** — CVR/ledger server-authority cutover + live commercial facts/forecast overlays; Test Site 1 authority-on UAT **PASSED** |
| Test isolation | BL-028B.3a — server tests fail closed unless `TEST_DATABASE_URL` is a separate database |
| Housekeeping checkpoint | BL-ASUS-001 (this document) |
| **NEXT after bank** | **BL-031E** — immutable CVR snapshot / period close. Do not start until instructed. |

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
| **BL-031** | CVR & Ledger persistence | **In progress** — **BL-031A–D** banked (Test Site 1 CVR migration and BL-031D authority-on UAT **PASSED**). **BL-031E** (snapshots) not started. Repo flag defaults remain OFF. |

BL-030 is fully complete. **BL-031D** cut CVR/ledger runtime to Postgres when local flags are ON, and applies the live commercial formulas on the CVR. It does **not** freeze historic snapshots (**BL-031E**). Persistence sprints must not add unrelated product features (Doc 67 §28).

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
- **CVR periods + purchase ledger tables** (`009_cvr_and_purchase_ledger.sql`) — **BL-031A–D**. Runtime CVR/ledger use Postgres when `VITE_CVR_SERVER_AUTHORITY` / `VITE_LEDGER_SERVER_AUTHORITY` are ON. Approve/lock is workflow-only until **BL-031E** snapshots.
- Local client uses `VITE_CE_SERVER_AUTHORITY`, `VITE_MATRIX_SERVER_AUTHORITY`, `VITE_CERTIFICATE_SERVER_AUTHORITY`, `VITE_CVR_SERVER_AUTHORITY`, and `VITE_LEDGER_SERVER_AUTHORITY` for cutover (see `client/.env.example`). Repo defaults remain OFF. Local UAT uses `.env.local`. Do not commit `.env.local`.

### Browser / localStorage authority (not yet migrated)

- CVR periods / cost centres (`buildlite_cvr_v1`) and purchase ledger (`buildlite_purchase_ledgers_v1`) — backup/rollback evidence after BL-031D. Runtime uses Postgres when the CVR/ledger flags are ON (no localStorage fallback or dual-write).
- Also still local: revenue, administration master data, setup drafts, Commercial Assistant dispositions

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
| **Test Site 1** (`docs/test-data/Test Site 1/`) | **Legacy / current historical test evidence.** Keep. Do not treat as the new clean commercial test model. Used for BL-029D, BL-030C, BL-031C migration, and **BL-031D authority-on UAT**. |

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
| CVR / ledger / revenue | Working in UI — **localStorage authority** until BL-031 (revenue not in Doc 67 persistence sequence) |
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
| Dual persistence | Expected until BL-031 complete: two browsers can still diverge on CVR and ledger. Matrices and V1 certificates are shared when their server-authority flags are ON. BL-031A does not change this. |
| API-outage matrix message | With the API stopped, matrix refresh shows a visible generic **Failed to fetch** state and does not fall back to localStorage. Intended fail-closed behaviour; wording is the raw fetch error rather than a matrix-specific sentence. Non-blocking. |
| Package summary cards | Top cards show Certified Gross / Remaining. Recoveries are visible lower down. Future UX may add Recoveries / Net Certified headline cards. Non-blocking. |
| CVR “Outstanding Certified” | Currently displays the same net certified figure (Wipe UAT: £2,150) and may need wording review. Non-blocking. |
| Mock authentication | Actor fields are not proof of identity (Doc 67 §26). Dedicated auth programme later; do not block persistence. |
| Root `package-lock.json` `name` | npm infers folder name because root `package.json` has no `name`. Reverted at BL-ASUS-001; a root `npm install` may rewrite it. Install from `client/` and `server/` to avoid churn. |

---

## BL-031A (server foundation)

Implemented: Postgres schema + server API for CVR periods, per-cost-code QS inputs (`manual_accrual` included), and purchase ledger import batches/transactions. Automated tests use `localhost:5432/buildlite_test` only.

**Not in BL-031A:** React/server cache, authority flags, localStorage cutover, clone migration, CVR snapshots, live calculation formula changes, accrual UI, revenue.

Agreed commercial rules (applied in **BL-031D**; historic snapshots remain **BL-031E**):

- Current commitment = approved PO net + approved value-changing Commercial Events (recovery-classified CEs excluded)
- CVR certified cost = frozen gross works + signed recovery (exclude retention and VAT; do not use `netValue`)
- Ledger actual for CVR = SUM(net)
- `manual_accrual` is a genuine QS input on current cost / CTC, distinct from outstanding certified
- Approve & Lock remains workflow-only until **BL-031E** atomically snapshots; V1 will not reopen locked CVRs

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

UAT also covered worksheet Accrual / Current Cost columns, explicit **Save accrual** / **Save commercial adjustment** (no blur-write; dirty/clean button state), post-save commitment hydration (CE cache stays ready), summary KPIs, server-authority ledger import + supported reversal (offsetting row, no delete), and **Draft → Submit → Reject → Draft**. **Approve & Lock was not used** (one-way; no reopen). Snapshots remain **BL-031E**.

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

## Next action

**BL-031E** — immutable CVR snapshot / period close. Do **not** start until instructed. Do not Approve & Lock UAT P01. Do not create P02. Do not push unless asked. Do not alter Wipe certificates/matrix/CEs or Hawthorn Gardens.

---

## Historic pointer (Phase 0 / BL-006)

Phase 0 migration framework, seed, and production schema reconciliation (migrations `001`–`003`) remain in the codebase. That work is complete as a baseline, not the current development programme. See `docs/DATABASE.md` (BL-006 catalogue preserved below the current persistence section) and `docs/phase0/`.
