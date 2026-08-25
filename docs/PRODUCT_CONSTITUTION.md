# BuildLite Product Constitution

**Purpose:** Durable product intent and deferred-decision register for future development sessions. Read this **before planning a product slice**.

**Not:** a status log, a rewrite of the external Master Documentation, or a substitute for banked code.

**Companion files:** `CURRENT_STATE.md` (what is banked now) · `PROJECT_SPINE.md` (development principles) · `docs/DATABASE.md` (schema/runbook).

**Baseline when this file was created:** HEAD `b34ea608b1547548422c87e5a87994f4b0d9be33` — `BL-034B - Add Simple Selling Costs proposal` on `buildlite-V1-1`.

---

## 1. Product identity

BuildLite is a **commercial-control layer** for SME housebuilders and residential developers. It is **not** an accounting package, payroll system, CIS system, or Sage/Xero/COINS Financials replacement.

It is intended to sit between spreadsheets and enterprise ERP: commitment control, forecasting, certification, CVR, and commercial reporting, with accounting remaining the financial system of record (Design Authority v1.1; Doc 39).

### Intended commercial chain

```
Budget
  → Purchase Order / Commitment
  → Commercial Event / Variation (including potential / pending liability)
  → Forecast
  → Measurement
  → Certificate
  → Payment Notice / Pay Less          ← original design; not built (see PC-014, HD-004)
  → CVR
  → Management Reporting               ← partly built (see PC-013, PC-027)
```

Do not invent missing links merely to complete this diagram. Status of each stage is in §3 and §4.

---

## 2. Authority hierarchy

| Rank | Source | Role |
|------|--------|------|
| **A** | Banked repo code, tests, and database behaviour | **Implementation truth.** What the product actually does. |
| **B** | `CURRENT_STATE.md` / `PROJECT_SPINE.md` | **Current programme truth.** Slice status, UAT guards, “do not touch P04”. |
| **C** | This file (`docs/PRODUCT_CONSTITUTION.md`) | **Durable intent + deferred-decision register.** Survives chats and external Word docs. |
| **D** | External folder `BuildLite Master Documentation` (sibling of this repo) | **Original design authority / historical constitution.** Docs 17–67, Design Authority v1.1, etc. |
| **E** | Old chats, recovery audits, canvases, uncommitted notes | **Evidence/context only**, unless promoted into A–C. |

**Rules:**

1. Later **explicit banked** decisions supersede older design documents.
2. Where A/B and D **conflict**, do **not** silently pick a winner. Record the conflict here (Human Decision or Deferred Register) until a human settles it and the settling slice updates this file.
3. The Master Documentation folder is **stale after Doc 67 / July 2026 Doc 49** for Prelims, Selling Costs, reporting-month, and later CVR work. Those designs live in the repo. Do not treat June 2026 gap analyses as current.

External Master Docs cited below in plain text: Doc 18, Doc 39, Doc 42, Doc 43 / 43A, Doc 45, Doc 47, Doc 48, Doc 67, Design Authority v1.1.

---

## 3. Current commercial backbone

Orientation only. Detail and UAT evidence stay in `CURRENT_STATE.md`.

| Area | Implementation (concise) |
|------|--------------------------|
| Developments / Plot Master | Server-backed developments; plots and sales lifecycle dates on `developments.payload`. Typed `development_programme` exists beside payload dates. |
| Cost Code Master / classification | Server master when `VITE_COST_CODE_SERVER_AUTHORITY` is ON (repo default OFF). Semantic groups including PRELIMS / SELLING. Commercial Structure catalog still browser-local. |
| Purchase Orders | Working Postgres JSON POs; PDF; archive; types include subcontract / materials / plant. |
| Packages / measurement / certificates | Materialised on subcontract PO approval; order matrix; V1 certs with historic freeze. Legacy `payment_certificates` table is **not** the V1 engine. |
| Commercial Events | Server-authoritative variations, recoveries, contra; pending/draft exist as workflow, not as CVR system-forecast inputs. |
| CVR | Draft → Submit → Approve & Lock; immutable snapshots (v2 includes Revenue); QS accrual + commercial adjustment; carry-forward. System forecast = approved commitment / budget / actual hierarchy — **not** pending CEs (HD-001). |
| Revenue | Strategy + private plot Secured lifecycle + live/v2 GP. `recognitionPolicy=exchange` stored only (HD-009). HA/package revenue, extras, scenario forecasting not live. |
| Prelims | Templates, site setup, TIME/LUMP_SUM, Review, **Adopt into Draft CVR** (replacement adjustment). Unresolved lines excluded, not £0. Missing Draft lines can be **Added to CVR** via 037A; Adopt still will not create rows. |
| Selling Costs | **BL-034B banked:** Simple % × live Forecast Revenue; proposal only; 5400 hint; 5405 forbidden as Simple destination. **No Review/Adopt.** |
| Ledger | CSV import; COINS/Sage/Xero **column templates**; fingerprint de-dupe; reversal not delete. Not live accounting APIs. |
| Administration | Shell exists. Company/structure/behaviour largely localStorage. Users and Approval Settings are **placeholders** (Doc 47). |
| Assistant | Rule recommendations (certs, CEs); local dispositions; not an LLM product. |
| Auth / tenancy | Mock `localStorage` identity; one global active client; unauthenticated API. Acceptable for controlled internal UAT per Doc 67; not for hosted multi-user SaaS. |

**Test Site 1 guards (do not casually violate):** P04 remains Draft; no P05; do not lock P04; do not switch `5231` to TIME; do not treat Hawthorn Gardens as started.

---

## 4. Durable deferred / parked register

Importance: **V1 blocker** (hosted trial) · **V1 important** · **post-pilot** · **future** · **needs human decision**.

| ID | Topic | Original authority | Current status | Importance | Dependency / decision | Target disposition | Notes |
|----|--------|-------------------|----------------|------------|----------------------|--------------------|-------|
| PC-001 | Simple Selling Costs proposal | Doc 42 BL-PB-040 (High); BL-034A/B | **Banked** BL-034B. % × Forecast Revenue. | — | — | Done | Product default 2.00%; Test Site 1 saved 1.75%. Calculated £ is derived, not stored as authority. 5400 is an empty P04 overlay from Manual Add UAT, **not** Selling Costs adoption. |
| PC-002 | Selling Costs Review against CVR | CURRENT_STATE: BL-034C | **Not started.** | V1 important | HD-002, PC-008 | Next commercial pair after BL-037 | Original High CVR backlog (Doc 42). See HD-008 for 034C/D numbering. |
| PC-003 | Selling Costs Adopt into Draft CVR | CURRENT_STATE: BL-034D | **Not started.** | V1 important | PC-002, HD-002, PC-008 | Same pair as Review unless numbering revised | Must not silent-write CVR. Do not Adopt onto sacred P04 if a clean development is available. |
| PC-004 | Detailed / itemised Selling Costs | BL-034B constants `DETAILED`; Master Docs unnamed | **Deferred.** Mode constant only. | future / P3 | HD-002, HD-006 | After Simple Review/Adopt | Section 6 of this file currently labels this BL-034D for *internal sequencing*; that **conflicts** with CURRENT_STATE’s 034D = Adopt (HD-008). |
| PC-005 | Unsaved % live preview | CURRENT_STATE BL-034B UX note | **Not implemented.** | post-pilot | — | UX follow-up | Optional; not commercial maths. |
| PC-006 | Prelims engine + adopt | Doc 42 BL-PB-039 (High); BL-033D.* | **Adopt implemented** (x.4C). Landing UX x.5 done. | — | — | Core done | Remaining: basis-select clip; QUANTITY/MILESTONE/… drivers; Standard v2 must not mutate v1 copies. |
| PC-007 | Conceptual stack `max(system, engine)+QS` | BL-033A | **Not an invariant.** Live Prelims adopt uses **replacement adjustment**. | needs human decision | HD-002 | Do not revive silently | Recorded so 034C does not copy the unused formula. |
| PC-008 | CVR destination membership (add missing cost code to Draft) | Recovery audit; Prelims x.4B/C contract | **BL-037A banked.** **BL-037B banked.** **BL-037C human UAT PASS; awaiting bank.** Prelims Adopt still will not create rows. | V1 important | HD-007 | Honest 034C after 037C bank | Empty P04 overlays: 5400 (Manual Add) and `uat-cc-001` (Prelims Add). Proposal £ is not copied. Selling Costs adoption not started. HD-002 unset. |
| PC-009 | Pending variations in Forecast Liability | Design Authority Docs 2–3 | System forecast = **approved** PO net + approved contract-value CEs only. | needs human decision | HD-001 | **No formula change** until decided | Original: Forecast Liability = approved commitment **+ pending variations**. |
| PC-010 | Selling Costs adoption formula | Prelims x.4C pattern vs unused BL-033A stack | **Unset** for Selling Costs. 5400 typically has **no commitment**. | needs human decision | HD-002 | Settle **before** 034C writes | Replacement-adjustment on a £0 system forecast is a different commercial meaning than Prelims on 5231. |
| PC-011 | Commercial Journals | Doc 43A; Doc 45 | Cost-centre drawer **Future**. | V1 important | After core commercial completion | Candidate P2 | Explain timing differences **without** rewriting budget/commitment/cert/ledger. Differentiator, not a stub. |
| PC-012 | Executive CVR Summary (command centre) | Doc 45 | Summary KPIs exist; commentary, intelligence panel, sales bridge largely absent. | P1/P2 | — | After 034C or parallel UX | Original: “How is this development performing?” in seconds. |
| PC-013 | CVR navigation UX | CURRENT_STATE / Spine deferred | Functionally working; not intuitive. | post-pilot / V1 important | — | Broader UX pass | Register / Summary / Worksheet / Open Draft / Back. |
| PC-014 | Payment Notice / Pay Less | Doc 18 MVP; Design Authority pillar; Spine chain | **Not built.** Doc 67 §28 forbade adding during persistence. | Original V1, parked | HD-004 | First post-pilot compliance slice **unless** V1 is deliberately shrunk | Do not treat as trivia. |
| PC-015 | Ledger CSV-first; Sage/Xero/COINS **profiles** | Doc 39 | Templates exist; import + reversal work. **No live APIs.** | — | — | CSV remains V1 path | Do not imply Sage/Xero integrations exist. |
| PC-016 | Export approved POs/certs into accounts | Doc 39 §33 | **Not built.** | post-pilot | PC-014 helpful but not required | After pilot | Eliminate duplicate accounts keying. |
| PC-017 | Material / Plant dedicated workspaces | Doc 39 §§21–22; V1 checklist | PO types M/S/P exist; no separate modules. Materials: commitment without certificates. | needs human decision | HD-005 | Decide before building modules | |
| PC-018 | Trial Envelope (thin safety) | Doc 67 §26; recovery audit BL-035 | **Not started.** | **V1 blocker for hosted/multi-user trial.** Not required to continue single-operator internal UAT. | HD-003 | Before hosted trial | Lock tenant switch, CORS, health, backup drill, mock-auth warning. **Not** full RBAC. |
| PC-019 | Authority-flag deploy contract | Doc 67 §23 dual-write ban; `.env.example` defaults OFF | Flags default OFF in repo. | V1 blocker for shared UAT | HD-003 | With PC-018 for hosted trial | Named ON set for claimed source of truth. |
| PC-020 | Persisted Commercial Structure / company admin | Doc 47; Doc 42 “Next = Company Administration” | Structure/company settings **localStorage**. Cost Code Master can be server. Save trap if `reporting_group` missing from local catalog. | V1 important | HD-011 | BL-036 when admin/customer setup is in play | Not a hard dependency of BL-037 if 5400 already exists on Cost Code Master. |
| PC-021 | Full users / RBAC / auth | Doc 18 MVP **includes**; Doc 47 **placeholders only**; Doc 67 **before SaaS** | Mock identity; no server roles. | Before commercial SaaS. **Not** the next internal commercial slice. | HD-003 | Dedicated programme | Do not delay remaining commercial UAT for JWT/RBAC. |
| PC-022 | Welcome / setup wizard refresh | Doc 43 IDEA-040; V1 checklist | Setup Assistant exists; not a polished customer onboarding. | P2 | After engine completion | Later | |
| PC-023 | Certificate PDF | V1 checklist; Doc 67 §28 parked in persistence | PO PDF exists; V1 cert PDF does not. | P2 / trial expectation | — | After persistence era | |
| PC-024 | Budget revisions; adjustment categories; uncommitted forecast | Doc 43 IDEA-001/002; Doc 17 Release 7 | Adjustment is a single £ + reason. Current vs original budget exist as fields. | future | — | Post-core | |
| PC-025 | Cash flow, ROCE, scenario forecasting, director dashboards | Doc 17 R9; Doc 48 §§15–17; Doc 42 future | Not built. Revenue stores enough for later ROCE/cash (Doc 48). | future | — | P3 | |
| PC-026 | HA / package revenue; extras; recognitionPolicy live | Doc 18 excluded Revenue then Doc 48 built it; BL-032 not-do lists | Private plot revenue live. HA/extras/`exchange` policy not live. | future / HD-009 | HD-006 related | Later | |
| PC-027 | Portfolio / management reporting suite | Doc 17 R9; Doc 45 Phase 4 | CVR Portfolio is **cost-only**. | P2/P3 | PC-012 | Later | |
| PC-028 | Hard refresh lands on New PO | CURRENT_STATE BL-032A deferred UX | `App.jsx` default tab `"form"`. | V1 important | — | Small UX slice | Not a commercial formula. |
| PC-029 | Hawthorn Gardens known-answer UAT import | `docs/test-data/README.md` | Pack in repo; **not imported**. | V1 important (regression) | Flags ON | Later UAT | Test Site 1 is contaminated evidence. |
| PC-030 | Portals, AI/LLM product, benchmarking, risk/opportunity register | Doc 17–18 post-MVP; Doc 43 ideas | Assistant is rules-only. | future | — | Out of V1 core | Do not invent an AI roadmap because development used AI. |

---

## 5. Human decision register

**No implementation of a decided formula or workflow until the named HD is settled in this file by the same banked slice.**

### HD-001 — Pending variations in Forecast Liability

**Original (Design Authority Docs 2–3):** Forecast Liability = approved commitment **+ pending variations**. Potential liabilities must be visible before approval.

**Current (banked CVR):** System forecast uses **approved** subcontract PO net + **approved/closed contract-value** CEs. Draft/submitted CEs do not enter system forecast. Recovery CEs excluded from commitment.

**Do not change the formula** until a human commercial decision. Options: keep approved-only (current); include pending in a separate “potential” column (closer to original, lower risk); include pending in system forecast (moves money).

### HD-002 — Selling Costs adoption treatment

Must settle **before BL-034C writes CVR**.

Prelims Adopt **replaces** the current commercial adjustment so final forecast equals the resolved Prelims proposal. That is proven on 5231 (which had substantial commitment).

Simple Selling Costs target (5400) typically has **no commitment**, so copying replacement-adjustment is a different commercial meaning. Alternatives: replacement adjustment; adopted engine layer; system-forecast override; new row with budget = proposal. **Do not copy Prelims blindly.**

### HD-003 — External trial gate

| Audience | Gate |
|----------|------|
| Controlled **internal / single-operator** UAT | Commercial slices may continue. Mock auth acceptable (Doc 67 §26; Doc 47). |
| **Hosted external / multi-user** trial or real customer data on a reachable API | **PC-018 + PC-019 (BL-035 / 035B) mandatory.** Full RBAC is still the later SaaS programme, not the first commercial slice. |

### HD-004 — V1 definition / Pay Less

Doc 18 and the Design Authority include Payment Notice / Pay Less / compliance dashboard **in MVP**. Doc 67 §28 parked them during persistence. Human must decide whether BuildLite V1 still includes payment compliance or whether V1 is deliberately the commercial engine without notices.

### HD-005 — Material / Plant

Doc 39: materials/plant contribute **committed value**, actuals from ledger, **no payment certificates**. Repo already has PO types. Decide: existing types + CVR/ledger are enough, or dedicated workspaces are required.

### HD-006 — Sales incentives / 5405

Doc 48 treats incentives/extras as **revenue adjustments**. Repo: CE subcategory `salesIncentive` exists; Simple Selling Costs **forbids 5405** as destination; “Sales Incentive Revenue Treatment” deferred (BL-034A/B). **Do not change current CE behaviour.** Risk: cost CE + revenue reduction + 5405/Detailed Selling Costs could triple-count. Preserve deferred status.

### HD-007 — What establishes CVR membership for a development period?

**Settled principles (BL-037A banked; BL-037B banked; BL-037C human UAT PASS, awaiting bank):**

Master eligibility, live CVR visibility, and period overlay membership are different facts.

- **Master eligibility:** the code exists and is **active** on the current tenant Cost Code Master. New deliberate membership requires this. Classification (STANDARD_CVR / PRELIMS / SELLING / BUILD / …) does **not** grant membership and does **not** auto-populate sites.
- **Live visibility (facts):** approved PO/CE commitment, certified package value, and ledger actuals appear on the live CVR / close candidate through the existing **fact union**. Booked facts do **not** silently create `cvr_cost_code_inputs` overlays.
- **Period overlay membership (QS CVR line):** a Draft `cvr_cost_code_inputs` row. This is what is editable (budget / adjustment / accrual), adoptable, audited as membership, and copied by next-period carry-forward (BL-031F remains authoritative). A fact must **not** be copied into the overlay when a CVR line is added.
- **Valid budget import** of Master codes **is** a membership-establishing structure decision for the **current Draft** (BL-037B; not all Master codes). Unknown/inactive codes fail closed. Omitted members are not deleted.
- **Manual QS Add** creates membership via the same Master-backed command and searchable picker (BL-037B).
- **Prelims missing-line Add** is an explicit Draft **Add to CVR** action (BL-037C). It does **not** Adopt. Adopt stays fail-closed (`COST_CODE_NOT_ON_CVR`) until an overlay exists.
- **First overlay edit** on a fact-only live row establishes membership via the same 037A command, then PATCHes the intended overlay field. Opening the CVR still creates no overlay.
- **Selling Costs proposals** still never silently create membership. BL-034C/D and HD-002 remain unset.
- New membership is **Draft-only**. Locked/submitted periods and snapshots are untouched.

**Structural UI routes proven (BL-037B human UAT PASS, 25 Aug 2026):** Manual Add of 5400 on Test Site 1 P04 (empty overlay; proposal remains separate); Budget Import on throwaway P01 (1110/2300/5105 including explicit £0; unknown 9999 blocked with zero writes). HD-002 remains unset.

**BL-037C** human UAT **PASS** (25 Aug 2026): Prelims Add to CVR for a valid missing Master code, and first overlay edit on fact-only auto-rows. Test Site 1 P04 has empty overlay `uat-cc-001` from one Add click. Preview matches overlay identity case-insensitively while keeping the Prelims/Master display key `UAT-CC-001`. Do not Add again. Do not Adopt in this slice. Do not mark 037C banked until the commit. BL-034C/D not started. HD-002 remains unset.

**HD-002 is separate** and remains unset.

### HD-008 — BL-034C / BL-034D numbering

**CURRENT_STATE / BL-034B:** 034C = Review, 034D = Adopt; Detailed mode unnumbered/deferred.

**This file §6 (internal sequence as instructed):** 034C = Review/Adopt pair, 034D = Detailed/itemised.

Do not implement under the wrong label. Settle numbering in the slice that starts Review or Adopt.

### HD-009 — `recognitionPolicy=exchange`

Stored; **not** live CVR/accounting behaviour. Secured Revenue is status/`sellingPrice` derived (BL-032B). Two different “exchange” concepts. Leave stored-only until a QS policy is written.

### HD-010 — Jobs vs Developments

Master model is Company → Site. Product still has `jobs` / `JobSelect` on POs **and** Developments. Decide commercial identity before a cleanup.

### HD-011 — Commercial Structure vs server Cost Code `reporting_group`

Do not Save migrated Admin cost-code rows whose server `reporting_group` is absent from the local dropdown catalog (`CURRENT_STATE`). Persist Structure (PC-020) or constrain the picker.

---

## 6. Near-term sequencing

### Internal / single-operator commercial development (current recommendation)

```
BL-037A  Authoritative Draft CVR membership command  BANKED
  → BL-037B  Budget Import + Master picker consume 037A  BANKED
  → BL-037C  Controlled missing-line CVR integration     (human UAT PASS; awaiting bank)
  → settle  HD-002 Selling Costs formula          (and HD-008 numbering)
  → BL-034C Selling Costs Review / Adopt          (as a pair unless HD-008 splits them)
  → BL-034D Detailed Selling Costs                (only after Simple is adopted and numbered)
```

**BL-036** (persisted Commercial Structure / admin setup) is **not** a hard prerequisite of BL-037 if destination codes already exist on Cost Code Master. Place BL-036 when customer Admin setup or the reporting_group save trap (HD-011) is in the critical path — typically **parallel** to 034C or **after** Simple Selling Costs is in CVR, not before 037 by default.

Do **not** start 034C/D, 035, or 036 until instructed. Keep P04 Draft. Do not create P05. Do not Adopt UAT-CC-001. Do not mark BL-037C complete/banked until the bank commit. HD-002 remains unset.

### Before hosted external / multi-user trial

**BL-035 Trial Envelope + BL-035B authority-flag contract are mandatory gates** (HD-003, PC-018, PC-019).

Full RBAC/users/JWT is **not** the immediate next commercial slice (Doc 47; Doc 67 §26).

---

## 7. Maintenance rule

Every future slice that **parks** functionality, **changes product intent**, **creates or resolves a human decision**, **supersedes Master Documentation**, **changes V1 scope**, or **resolves an item in this register** must update **this file in the same banked slice**.

- Do **not** turn this file into a chronological changelog.
- `CURRENT_STATE.md` remains the implementation / UAT status log.
- This file remains the durable intent / decision register.
- Promote important chat/audit findings here if they must survive; otherwise they are rank E.
