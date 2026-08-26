# BuildLite Product Constitution

**Purpose:** Durable product intent and deferred-decision register for future development sessions. Read this **before planning a product slice**.

**Not:** a status log, a rewrite of the external Master Documentation, or a substitute for banked code.

**Companion files:** `CURRENT_STATE.md` (what is banked now) · `PROJECT_SPINE.md` (development principles) · `docs/DATABASE.md` (schema/runbook).

**Baseline when this file was created:** HEAD `b34ea608b1547548422c87e5a87994f4b0d9be33` — `BL-034B - Add Simple Selling Costs proposal` on `buildlite-V1-1`.

**Last design-authority settlement:** HD-038-1 / HD-038-2 / HD-038-3 resolved after the BL-038A preflight. Design-authority HEAD remains `b5fe388d2e9234257aafa2b299ada6d2f7285912` — `HD-038 - Settle CE expected liability treatment`. **BL-038C BANKED** at `b036bc9`; human UAT and SELECT-only forensic PASS.

---

## 1. Founding Product Principles

These principles sit above slice sequencing. Later banked code implements them; it does not silently replace them. HD-002 remains settled and is not reopened by this section.

1. **SME FIRST**  
   BuildLite is built primarily for SME housebuilders / developers and their small commercial functions, not for an enterprise office full of administrators.

2. **ONE CAPABLE QS CAN RUN IT**  
   A key product objective is that one capable QS can operate the commercial controls of a small developer efficiently. Requiring unnecessary administration or additional headcount is a product failure.

3. **FASTER THAN EXCEL**  
   BuildLite should reduce routine QS administration compared with disconnected Excel worksheets. If a normal commercial-control task is materially slower or more cumbersome in BuildLite than the spreadsheet method it replaces, the workflow should be challenged.

4. **CLIENT COST CODES ARE IDENTITY**  
   Clients own their cost-code structures. BuildLite must not require clients to adopt a BuildLite standard numbering structure. Cost-code classification / metadata may tell BuildLite what a code does, but must not replace the client's own cost-code identity. Test Site 1 codes such as **5231** and **5400** are UAT examples / recommendations, not a mandatory BuildLite chart. Hawthorn Gardens must retain its own cost-code structure when recovered as an end-to-end UAT.

5. **FACTS FLOW ONCE**  
   Budget, PO/package, Commercial Event/variation, certificate, ledger actual and other commercial facts should flow into the commercial model without duplicate re-keying.

6. **FINAL FORECAST MEANS EXPECTED OUTTURN**  
   The CVR Final Forecast should represent the QS's current best commercial view of expected final liability/outturn, not merely approved accounting facts.

7. **SYSTEM FORECAST REMAINS FACT-BASED**  
   System Forecast remains the mechanically derived position from the authoritative commercial facts defined by the close engine. Do not misrepresent an unapproved CE as an approved commitment. This does **not** mean unapproved/pending commercial liability should disappear from the expected forecast.

8. **QS JUDGEMENT IS FIRST-CLASS**  
   QS judgement must be easy to express, linked to the commercial fact where practical, auditable, and reversible. The operator must be able to include, reduce, hold or exclude expected liability without changing the underlying fact.

9. **NEVER DESTROY THE FACT**  
   Forecast treatment must not rewrite the underlying PO, CE, certificate, ledger transaction or budget.

10. **AUTOMATE COMPLEXITY BEHIND SIMPLE UX**  
    Concurrency, locking, provenance, stale checks, transaction boundaries and audit controls may be sophisticated internally. The QS should not have to operate that sophistication.

11. **CVR IS THE ASSEMBLED COMMERCIAL OUTCOME**  
    The CVR should assemble the live commercial position rather than becoming another spreadsheet requiring duplicate entry. Membership / adoption controls exist to prevent silent or unauthorised writes. They must not make normal QS forecasting unnecessarily ceremonial.

12. **PARKED HUMAN DECISIONS STAY PARKED**  
    A banked implementation does not automatically settle an explicitly parked product-owner decision. Where this constitution says a human decision is required, only an explicit owner settlement closes it. **HD-002 remains settled and must not be reopened.**

---

## 2. Product identity

BuildLite is a **commercial-control layer** for SME housebuilders and residential developers. It is **not** an accounting package, payroll system, CIS system, or Sage/Xero/COINS Financials replacement.

It is intended to sit between spreadsheets and enterprise ERP: commitment control, forecasting, certification, CVR, and commercial reporting, with accounting remaining the financial system of record (Design Authority v1.1; Doc 39).

**Cost-code flexibility:** BuildLite does not own the client's numbering scheme. Master Cost Code **identity** is client-owned (for example 4360, 5231, CLN01, or Hawthorn's own chart). PRELIMS / SELLING / other classifications are **semantic metadata** used by BuildLite engines. A recommended code such as **5400** is a recommendation/default for current Test Site 1 data, not a universal requirement. Different SMEs may use entirely different codes for equivalent commercial purposes. Hawthorn should later test this flexibility. Commercial Structure Head / Family / `reporting_group` persistence remains a known onboarding issue (HD-011 / PC-020); it is not solved here.

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

Do not invent missing links merely to complete this diagram. Status of each stage is in §4 and §5.

---

## 3. Authority hierarchy

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
4. Rank A (banked code) is **implementation truth**. It does **not** close an explicitly parked human decision in this file. Only an explicit owner settlement in Rank C closes it (Founding Principle 12). HD-001 was the example: approved-only System Forecast was implementation, not a settlement of expected liability.

External Master Docs cited below in plain text: Doc 18, Doc 39, Doc 42, Doc 43 / 43A, Doc 45, Doc 47, Doc 48, Doc 67, Design Authority v1.1.

---

## 4. Current commercial backbone

Orientation only. Detail and UAT evidence stay in `CURRENT_STATE.md`.

| Area | Implementation (concise) |
|------|--------------------------|
| Developments / Plot Master | Server-backed developments; plots and sales lifecycle dates on `developments.payload`. Typed `development_programme` exists beside payload dates. |
| Cost Code Master / classification | Server master when `VITE_COST_CODE_SERVER_AUTHORITY` is ON (repo default OFF). **Identity is the client's own code.** Semantic groups (PRELIMS / SELLING / …) are purpose metadata, not a BuildLite numbering chart. Test Site 1 **5231** / **5400** are UAT examples. Commercial Structure catalog still browser-local (HD-011). |
| Purchase Orders | Working Postgres JSON POs; PDF; archive; types include subcontract / materials / plant. |
| Packages / measurement / certificates | Materialised on subcontract PO approval; order matrix; V1 certs with historic freeze. Legacy `payment_certificates` table is **not** the V1 engine. |
| Commercial Events | Server-authoritative variations, recoveries, contra. Pending/draft exist as workflow facts. **HD-001 resolved:** submitted contract-value CEs are potential liability; QS expected-liability treatment (default = full **submitted** value, **derived**) feeds **Final Forecast**, not System Forecast. **HD-038-1:** Draft CEs do **not** contribute Expected Liability. **BL-038B BANKED:** treatment/override/audit model exists on the CE. **BL-038C BANKED:** Expected is live and additive in Final Forecast only. |
| CVR | Draft → Submit → Approve & Lock; immutable snapshots (v2 includes Revenue); QS accrual + commercial adjustment; carry-forward. **System Forecast** = approved commitment / budget / actual hierarchy (close engine). **Live authoritative Final Forecast (BL-038C / HD-038-2):** System Forecast + CE Expected Liability + Commercial Adjustment. Do not use accrual as CE expected liability. **NEXT BL-038E:** explicitly preserve Expected in snapshots and prove Create Next recomposition before Hawthorn. |
| Revenue | Strategy + private plot Secured lifecycle + live/v2 GP. `recognitionPolicy=exchange` stored only (HD-009). HA/package revenue, extras, scenario forecasting not live. |
| Prelims | Templates, site setup, TIME/LUMP_SUM, Review, **Adopt into Draft CVR** (replacement adjustment). Unresolved lines excluded, not £0. Missing Draft lines can be **Added to CVR** via 037A; Adopt still will not create rows. |
| Selling Costs | **BL-034D banked** at `6d11491`. Simple % × live Forecast Revenue; proposal until deliberate Adopt; Test Site 1 destination **5400** classified SELLING / STANDARD_CVR (recommendation, not a mandatory chart); 5405 forbidden as Simple destination. **HD-002 resolved** (target-final / replacement-adjustment). **HD-008 resolved.** Detailed unstarted. Engine Adopt ceremony must **not** be generalised to every CE (HD-001). |
| Ledger | CSV import; COINS/Sage/Xero **column templates**; fingerprint de-dupe; reversal not delete. Not live accounting APIs. |
| Administration | Shell exists. Company/structure/behaviour largely localStorage. Users and Approval Settings are **placeholders** (Doc 47). |
| Assistant | Rule recommendations (certs, CEs); local dispositions; not an LLM product. |
| Auth / tenancy | Mock `localStorage` identity; one global active client; unauthenticated API. Acceptable for controlled internal UAT per Doc 67; not for hosted multi-user SaaS. |

**Test Site 1 guards (do not casually violate):** P04 remains Draft; no P05; do not lock P04; do not switch `5231` to TIME; do not Adopt UAT-CC-001.

**Hawthorn Gardens:** remains commercially valuable and must **not** be discarded or normalised onto Test Site 1. It is an end-to-end known-answer UAT representing a different SME/client structure. Technical artefacts may be stale and require recovery to current BuildLite mechanics; commercial intent remains valuable. Preserve as UAT intentions: client-owned / broader cost-code structure; CCV / approved commitment distinct from pending liability; QS Final Forecast distinct from both; pending variations visible before approval; PO/package and matrix behaviour; certificate/recovery logic; ledger actual distinct from certified value; known-answer month-end CVR; negative/import control tests; eventual multi-period continuation. Do **not** remap Hawthorn cost codes to `5231` / `5400` merely because Test Site 1 uses those codes. Where Hawthorn mechanics conflict with subsequently settled product rules (including HD-001 and HD-002), update future UAT mechanics while preserving the underlying commercial scenario. Pack is in repo and **not imported** (PC-029).

---

## 5. Durable deferred / parked register

Importance: **V1 blocker** (hosted trial) · **V1 important** · **post-pilot** · **future** · **needs human decision**.

| ID | Topic | Original authority | Current status | Importance | Dependency / decision | Target disposition | Notes |
|----|--------|-------------------|----------------|------------|----------------------|--------------------|-------|
| PC-001 | Simple Selling Costs proposal | Doc 42 BL-PB-040 (High); BL-034A/B | **Banked** BL-034B. % × Forecast Revenue. | — | — | Done | Product default 2.00%; Test Site 1 saved 1.75%. Calculated £ is derived, not stored as authority. 5400 on P04 now holds the BL-034D adopted forecast. |
| PC-002 | Selling Costs Review against CVR | CURRENT_STATE: BL-034C | **Banked** at `e06a86c`. Read-only. Human UAT + forensic PASS. | V1 important | HD-002 (resolved), PC-008 | BL-034C | Original High CVR backlog (Doc 42). HD-008 resolved: 034C = Review. 034D writes the adopted forecast. |
| PC-003 | Selling Costs Adopt into Draft CVR | CURRENT_STATE: BL-034D | **Banked.** Human UAT PASS. | V1 important | PC-002, HD-002 (resolved) | BL-034D | Writes replacement adjustment only. Detailed Selling Costs remains unstarted. |
| PC-004 | Detailed / itemised Selling Costs | BL-034B constants `DETAILED`; Master Docs unnamed | **Deferred.** Mode constant only. | future / P3 | HD-002 (resolved), HD-006 | After Simple Review/Adopt | **Not BL-034D.** Later id. Same per-code target-final / replacement-adjustment contract as Simple. |
| PC-005 | Unsaved % live preview | CURRENT_STATE BL-034B UX note | **Not implemented.** | post-pilot | — | UX follow-up | Optional; not commercial maths. |
| PC-006 | Prelims engine + adopt | Doc 42 BL-PB-039 (High); BL-033D.* | **Adopt implemented** (x.4C). Landing UX x.5 done. | — | — | Core done | Remaining: basis-select clip; QUANTITY/MILESTONE/… drivers; Standard v2 must not mutate v1 copies. |
| PC-007 | Conceptual stack `max(system, engine)+QS` | BL-033A | **Not an invariant.** Live Prelims and HD-002 Selling Costs use **replacement adjustment**. | settled (do not use) | HD-002 | Do not revive | HD-002 chose target-final / replacement-adjustment, not this stack. |
| PC-008 | CVR destination membership (add missing cost code to Draft) | Recovery audit; Prelims x.4B/C contract | **BL-037A/B/C banked.** Prelims Adopt still will not create rows. | V1 important | HD-007 | Honest 034C after 037C bank | P04 overlays: 5400 (Manual Add then BL-034D adopted) and `uat-cc-001` (Prelims Add, still empty). Selling Costs Adopt does not create membership. |
| PC-009 | Pending / expected CE liability in Final Forecast | Design Authority Docs 2–3; founding principles 6–9; BL-038A | **HD-001 resolved.** **HD-038-1/2/3 resolved.** Draft expected = 0. Final = System + CE Expected + Adjustment. Expected may exceed submitted value. **BL-038C BANKED** at `b036bc9`; human UAT + forensic PASS. | V1 important | HD-001, HD-038-1/2/3 | BL-038E snapshot/Create Next integrity before Hawthorn | Derived default on Submit. No CE Adopt. No auto overlay membership. Approval drops Expected by formula. BL-038D detail UX deferred pending pilot evidence. |
| PC-010 | Selling Costs adoption formula | Prelims x.4C pattern | **HD-002 resolved:** target-final / replacement-adjustment. | settled | HD-002 | BL-034C shows it; BL-034D writes it | Does not write budget, system forecast, or accrual. Point-in-time. |
| PC-011 | Commercial Journals | Doc 43A; Doc 45 | Cost-centre drawer **Future**. | V1 important | After core commercial completion | Candidate P2 | Explain timing differences **without** rewriting budget/commitment/cert/ledger. Differentiator, not a stub. |
| PC-012 | Executive CVR Summary (command centre) | Doc 45 | Summary KPIs exist; commentary, intelligence panel, sales bridge largely absent. | P1/P2 | — | After 034C or parallel UX | Original: “How is this development performing?” in seconds. |
| PC-013 | CVR navigation UX | CURRENT_STATE / Spine deferred | Functionally working; not intuitive. | post-pilot / V1 important | — | Broader UX pass | Register / Summary / Worksheet / Open Draft / Back. |
| PC-014 | Payment Notice / Pay Less | Doc 18 MVP; Design Authority pillar; Spine chain | **Not built.** Doc 67 §28 forbade adding during persistence. | Original V1, parked | HD-004 | First post-pilot compliance slice **unless** V1 is deliberately shrunk | Do not treat as trivia. |
| PC-015 | Ledger CSV-first; Sage/Xero/COINS **profiles** | Doc 39 | Templates exist; import + reversal work. **No live APIs.** | — | — | CSV remains V1 path | Do not imply Sage/Xero integrations exist. |
| PC-016 | Export approved POs/certs into accounts | Doc 39 §33 | **Not built.** | post-pilot | PC-014 helpful but not required | After pilot | Eliminate duplicate accounts keying. |
| PC-017 | Material / Plant dedicated workspaces | Doc 39 §§21–22; V1 checklist | PO types M/S/P exist; no separate modules. Materials: commitment without certificates. | needs human decision | HD-005 | Decide before building modules | |
| PC-018 | Trial Envelope (thin safety) | Doc 67 §26; recovery audit BL-035 | **Not started.** | **V1 blocker for hosted/multi-user trial.** Not required to continue single-operator internal UAT. | HD-003 | Before hosted trial | Lock tenant switch, CORS, health, backup drill, mock-auth warning. **Not** full RBAC. |
| PC-019 | Authority-flag deploy contract | Doc 67 §23 dual-write ban; `.env.example` defaults OFF | Flags default OFF in repo. | V1 blocker for shared UAT | HD-003 | With PC-018 for hosted trial | Named ON set for claimed source of truth. |
| PC-020 | Persisted Commercial Structure / company admin | Doc 47; Doc 42 “Next = Company Administration” | Structure/company settings **localStorage**. Cost Code Master can be server. Save trap if `reporting_group` missing from local catalog. | V1 important | HD-011 | BL-036 when admin/customer setup is in play | Not required to implement HD-001. Retain as known onboarding issue. Test Site 1 **5400** existing on Master is evidence, not a product chart. |
| PC-021 | Full users / RBAC / auth | Doc 18 MVP **includes**; Doc 47 **placeholders only**; Doc 67 **before SaaS** | Mock identity; no server roles. | Before commercial SaaS. **Not** the next internal commercial slice. | HD-003 | Dedicated programme | Do not delay remaining commercial UAT for JWT/RBAC. |
| PC-022 | Welcome / setup wizard refresh | Doc 43 IDEA-040; V1 checklist | Setup Assistant exists; not a polished customer onboarding. | P2 | After engine completion | Later | |
| PC-023 | Certificate PDF | V1 checklist; Doc 67 §28 parked in persistence | PO PDF exists; V1 cert PDF does not. | P2 / trial expectation | — | After persistence era | |
| PC-024 | Budget revisions; adjustment categories; uncommitted forecast | Doc 43 IDEA-001/002; Doc 17 Release 7 | Adjustment is a single £ + reason. Current vs original budget exist as fields. | future | — | Post-core | |
| PC-025 | Cash flow, ROCE, scenario forecasting, director dashboards | Doc 17 R9; Doc 48 §§15–17; Doc 42 future | Not built. Revenue stores enough for later ROCE/cash (Doc 48). | future | — | P3 | |
| PC-026 | HA / package revenue; extras; recognitionPolicy live | Doc 18 excluded Revenue then Doc 48 built it; BL-032 not-do lists | Private plot revenue live. HA/extras/`exchange` policy not live. | future / HD-009 | HD-006 related | Later | |
| PC-027 | Portfolio / management reporting suite | Doc 17 R9; Doc 45 Phase 4 | CVR Portfolio is **cost-only**. | P2/P3 | PC-012 | Later | |
| PC-028 | Hard refresh lands on New PO | CURRENT_STATE BL-032A deferred UX | `App.jsx` default tab `"form"`. | V1 important | — | Small UX slice | Not a commercial formula. |
| PC-029 | Hawthorn Gardens known-answer UAT | `docs/test-data/README.md`; founding-principles reconciliation | Pack in repo; **not imported**. Commercially valuable; **do not discard** and **do not remap** onto Test Site 1 (`5231` / `5400`). | V1 important (regression) | Flags ON; HD-001 | Later recovery UAT, not the next code slice | Client-owned chart; CCV ≠ pending ≠ FFC; pending visible; PO/matrix; cert/recovery; ledger ≠ certified; known-answer month-end; negative import tests; eventual multi-period. Technical artefacts may be stale; preserve commercial scenarios. |
| PC-030 | Portals, AI/LLM product, benchmarking, risk/opportunity register | Doc 17–18 post-MVP; Doc 43 ideas | Assistant is rules-only. | future | — | Out of V1 core | Do not invent an AI roadmap because development used AI. |

---

## 6. Human decision register

**No implementation of a decided formula or workflow until the named HD is settled in this file by the same banked slice.** Rank A code does not close a parked HD.

### HD-001 — Pending / expected liability in Final Forecast — RESOLVED

**Resolved** by explicit product-owner decision after the founding-principles / Hawthorn reconciliation. Product HEAD remains `6d11491` (BL-034D). This record is **design authority only**. Do **not** implement expected liability in the same slice as this documentation.

**Original (Design Authority Docs 2–3):** Forecast Liability = approved commitment **+ pending variations**. Potential liabilities must be visible before approval.

**Current banked close engine (unchanged until a named implementation slice):** System Forecast uses **approved** subcontract PO net + **approved/closed contract-value** CEs. Draft/submitted CEs do not enter System Forecast. Recovery CEs are excluded from commitment. Final Forecast today = System Forecast + unlinked commercial adjustment. Accrual is incurred/CTC, not CE expected liability.

**Owner settlement:**

**A. Approved / authoritative fact position**  
System Forecast remains based on the approved / authoritative fact hierarchy already established by the CVR close engine. A draft/submitted/pending Commercial Event must **not** be falsely converted into approved commitment merely because it has forecast treatment.

**B. Potential liability**  
Pending/submitted Commercial Events must remain visible as potential commercial liability before approval. BuildLite must not require the QS to maintain a parallel Excel sheet merely to remember likely variation exposure.

**C. Expected liability**  
A pending/submitted Commercial Event may carry an auditable QS expected-liability treatment. That treatment feeds **Final Forecast**, not approved commitment / System Forecast. The underlying CE remains unchanged.

**D. Default treatment — owner decision**  
**DEFAULT EXPECTED LIABILITY FOR A SUBMITTED COMMERCIAL EVENT = FULL SUBMITTED VALUE.**

Example: PO / approved commitment = £100,000; submitted CE = £20,000. System Forecast / approved fact position remains £100,000, subject to the existing close hierarchy. Potential liability exposes the £20,000 CE. Expected liability defaults to £20,000. Final Forecast therefore includes that expected £20,000 liability unless the QS changes its treatment.

**E. QS control**  
The QS must be able to override the default expected treatment. Conceptually this must support: include at full value; reduce to another expected value; hold / forecast £0; exclude from expected liability where commercially appropriate. Do not prematurely prescribe exact UI labels here. The essential rule is that the QS controls the expected amount and the decision is auditable.

Example: submitted CE = £20,000; QS believes likely settlement = £15,000. CE fact remains £20,000 submitted. Potential liability remains £20,000. Expected liability = £15,000. Final Forecast includes £15,000.

**F. Simplicity**  
This should ultimately form part of the normal Commercial Event / CVR workflow. Do **not** design a future process that unnecessarily requires Create CE → separate CVR screen → separate review → separate adopt → confirmation → manual reversal later for every ordinary pending variation. The low-administration default should be commercially safe: a submitted CE naturally carries its full value into expected liability unless the QS deliberately changes the treatment.

**G. Auditability**  
Changes to expected-liability treatment must be attributable and auditable. The QS should be able to understand: CE factual value/status; potential liability; expected-liability treatment; resulting Final Forecast impact; who changed the treatment and when.

**H. Approval / double-count protection**  
When a treated pending CE later becomes approved / included in authoritative commitment, BuildLite must reconcile the expected-liability treatment so the same liability is not counted twice. This is a **mandatory requirement of the future implementation**. Do not implement the mechanism in this documentation slice.

**I. Accrual**  
Do not use manual accrual as the substitute for CE expected liability. Accrual remains its existing incurred-cost / cost-to-complete concept.

**J. Generic commercial adjustment**  
Generic commercial adjustment remains available for genuine QS forecast judgement that is not represented by a more specific commercial fact. A known pending CE should not require an unlinked lump adjustment merely to get expected liability into Final Forecast. That is the gap HD-001 resolves.

**Relationship to HD-002:** HD-002 remains **RESOLVED** exactly as banked (target-final / replacement-adjustment **write**). Do not alter Selling Costs semantics. HD-038-2 settles the **row Final Forecast** identity as additive Expected. Selling Costs / Prelims proposals requiring deliberate adoption are forecast **engines**, not inconsistent with HD-001. A Commercial Event is already an explicit commercial fact entered by the QS; its expected-liability treatment is part of forecasting that fact. Do **not** generalise the Selling Costs Adopt ceremony to every CE.

**Hawthorn:** Preserve CCV / approved commitment as distinct from pending liability, and QS Final Forecast as distinct from both. Hawthorn UAT-02 (3100) already separates approved CCV from pending CE visibility and QS FFC judgement. Future Hawthorn recovery must follow this settlement mechanically without remapping Hawthorn codes to Test Site 1.

**Current programme state:** **BL-038C BANKED** at `b036bc9`. **NEXT: BL-038E — CE Expected Liability snapshot/Create Next integrity**, required before Hawthorn. BL-038D detail/drilldown UX is deferred pending pilot evidence.

### HD-002 — Selling Costs adoption treatment — RESOLVED

**Resolved** (documentation settlement after HD-002 preflight; BL-037C banked `c5f4c73`). Selling Costs CVR adoption uses **target-final / replacement-adjustment** semantics.

Authoritative commercial rule:

- Target final forecast for the selected Selling Costs destination cost code(s) **is** the current Selling Costs proposal.
- Replacement commercial adjustment **= Selling Costs proposal − current CVR system forecast**.
- **Adoption write identity (unchanged):** the replacement adjustment is still computed against **System Forecast only**. Do **not** subtract CE Expected Liability from the engine proposal (HD-038-2).
- **Historic HD-002 sentence** “Final forecast = system forecast + replacement commercial adjustment” describes the **engine-adopted component** (System + that adjustment). **Authoritative CVR Final Forecast** is HD-038-2: System + CE Expected Liability + Commercial Adjustment. An adopted engine proposal may therefore be **supplemented** by CE Expected on the same code. Review “up to date” must not imply overall Final equals the engine proposal.
- Adoption writes **commercial adjustment only**.
- Adoption **must not** write or replace: Original Budget, Current Budget, System Forecast, accrual, commitment, or actual.
- Selling Costs proposal remains separate from the CVR until **deliberate adoption**.
- Adoption is **point-in-time**.
- Later Revenue changes **must not** automatically alter the CVR.
- Later commitments / actuals / budget changes **must not** automatically recalculate the adopted adjustment.
- Those changes may cause the CVR final forecast to **drift** from the previously adopted Selling Costs target. Review must expose that drift and permit deliberate re-adoption.
- If the QS manually changes the adopted adjustment, the previous Selling Costs adoption becomes **superseded**. Re-adoption after supersession requires **explicit acknowledgement**.
- Proposal below current System Forecast is a **warning**, not a hard adoption block, consistent with existing Prelims/CVR principles.
- Selling Costs adoption does **not** alter accrual.
- GP changes naturally through the CVR final forecast. There must be **no** second Selling Costs deduction from GP.
- Simple mode currently targets **5400** on Test Site 1 (recommended destination for that UAT data, **not** a mandatory BuildLite chart — Founding Principle 4). Future Detailed mode uses the same **per-cost-code** target-final / replacement-adjustment contract.

Do **not** write system forecast or budget. Do **not** revive the unused BL-033A stack `max(system, engine)+QS` (PC-007).

Test Site 1 **5400 — Selling Costs — General Allowance** is already classified **SELLING / STANDARD_CVR** (BL-034B UAT prep) and is an empty P04 CVR member (BL-037B). That membership is **not** Selling Costs adoption. No further 5400 classification decision is required before BL-034C.

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

**Settled principles (BL-037A banked; BL-037B banked; BL-037C banked `c5f4c73`):**

Master eligibility, live CVR visibility, and period overlay membership are different facts.

- **Master eligibility:** the code exists and is **active** on the current tenant Cost Code Master. New deliberate membership requires this. Classification (STANDARD_CVR / PRELIMS / SELLING / BUILD / …) does **not** grant membership and does **not** auto-populate sites.
- **Live visibility (facts):** approved PO/CE commitment, certified package value, and ledger actuals appear on the live CVR / close candidate through the existing **fact union**. Booked facts do **not** silently create `cvr_cost_code_inputs` overlays.
- **Period overlay membership (QS CVR line):** a Draft `cvr_cost_code_inputs` row. This is what is editable (budget / adjustment / accrual), adoptable, audited as membership, and copied by next-period carry-forward (BL-031F remains authoritative). A fact must **not** be copied into the overlay when a CVR line is added.
- **Valid budget import** of Master codes **is** a membership-establishing structure decision for the **current Draft** (BL-037B; not all Master codes). Unknown/inactive codes fail closed. Omitted members are not deleted.
- **Manual QS Add** creates membership via the same Master-backed command and searchable picker (BL-037B).
- **Prelims missing-line Add** is an explicit Draft **Add to CVR** action (BL-037C). It does **not** Adopt. Adopt stays fail-closed (`COST_CODE_NOT_ON_CVR`) until an overlay exists.
- **First overlay edit** on a fact-only live row establishes membership via the same 037A command, then PATCHes the intended overlay field. Opening the CVR still creates no overlay.
- **Selling Costs proposals** still never silently create membership. Review is BL-034C (read-only). Adopt is BL-034D (write). HD-002 **resolved** (target-final / replacement-adjustment).
- New membership is **Draft-only**. Locked/submitted periods and snapshots are untouched.

**Structural UI routes proven (BL-037B human UAT PASS, 25 Aug 2026):** Manual Add of 5400 on Test Site 1 P04 (empty overlay; classified SELLING / STANDARD_CVR; proposal remains separate); Budget Import on throwaway P01 (1110/2300/5105 including explicit £0; unknown 9999 blocked with zero writes).

**BL-037C** banked `c5f4c73` (25 Aug 2026): Prelims Add to CVR for a valid missing Master code, and first overlay edit on fact-only auto-rows. Test Site 1 P04 has empty overlay `uat-cc-001` from one Add click. Preview matches overlay identity case-insensitively while keeping the Prelims/Master display key `UAT-CC-001`. Do not Add again. Do not Adopt UAT-CC-001.

### HD-008 — BL-034C / BL-034D numbering — RESOLVED

**Resolved.** Do not rename already banked BL-034A / BL-034B commits.

- **BL-034C** = Selling Costs Review against CVR — **READ ONLY**
- **BL-034D** = Selling Costs Adopt into Draft CVR — **WRITE**
- **Detailed / itemised Selling Costs** is later work and **must not** be implemented as BL-034D.

### HD-009 — `recognitionPolicy=exchange`

Stored; **not** live CVR/accounting behaviour. Secured Revenue is status/`sellingPrice` derived (BL-032B). Two different “exchange” concepts. Leave stored-only until a QS policy is written.

### HD-010 — Jobs vs Developments

Master model is Company → Site. Product still has `jobs` / `JobSelect` on POs **and** Developments. Decide commercial identity before a cleanup.

### HD-011 — Commercial Structure vs server Cost Code `reporting_group`

Do not Save migrated Admin cost-code rows whose server `reporting_group` is absent from the local dropdown catalog (`CURRENT_STATE`). Persist Structure (PC-020) or constrain the picker.

### HD-038-1 — Draft CEs in expected liability — RESOLVED

**Resolved** (documentation settlement after BL-038A preflight). Option **1**. HD-001 is not reopened.

- Draft Commercial Events do **not** contribute Expected Liability to the CVR.
- **Submission is the commercial boundary.**
- On Submit, an eligible **contract-value** CE automatically contributes its **full submitted value** as Expected Liability unless the QS has deliberately changed its expected treatment.
- That default is **derived** from the submitted CE value; it is not physically written as an override on Submit.
- Draft may remain visible in package-level pending information, but it does **not** move CVR Final Forecast.

### HD-038-2 — Expected Liability vs Prelims / Selling Costs target-final — RESOLVED

**Resolved** (documentation settlement after BL-038A preflight). Option **1 — additive Expected Liability**. HD-002 is not reopened.

Authoritative **CVR Final Forecast** identity:

**Final Forecast = System Forecast + CE Expected Liability + Commercial Adjustment.**

- CE Expected Liability is a **distinct** forecast component and must not be hidden inside Commercial Adjustment.
- Existing HD-002 replacement-adjustment **treatment** for Prelims / Selling Costs remains unchanged: replacement adjustment **= proposal − System Forecast**; adoption writes commercial adjustment only.
- Therefore an adopted Prelims/Selling Costs proposal may be **supplemented** by CE Expected Liability on the same cost code.
- Example: System £100k; adopted engine target £120k (adjustment +£20k); CE Expected Liability £20k; **Final Forecast £140k**.
- Review/Adopt UX must make this decomposition clear so an engine proposal being “up to date” does **not** imply that overall Final Forecast must equal the engine proposal.
- A Prelims/Selling Costs adoption must **never** silently consume, offset, or suppress a known CE Expected Liability.

### HD-038-3 — Expected Liability greater than submitted CE value — RESOLVED

**Resolved** (documentation settlement after BL-038A preflight). Option **1**.

- The QS may set Expected Liability **above** the submitted CE value.
- Do **not** cap it at submitted value.
- This is deliberate QS judgement.
- Surface an appropriate warning and **require a reason**.
- Preserve the submitted CE value as the factual **Potential Liability**.
- The override and reason must be fully auditable. Forecast treatment must not rewrite the CE fact.

### BL-038A design principles (agreed)

BL-038B implements the CE model / override / audit. BL-038C implements the close-engine Final Forecast wiring; human UAT and SELECT-only forensic passed.

- Default Expected Liability is **derived** from the submitted CE value, not physically written on Submit.
- A QS override / hold / exclude is stored **separately** from the CE factual value.
- Approval removes that CE from Expected **by formula** as it enters approved commitment / System Forecast; no manual reversal.
- CE fact is never rewritten by forecast treatment.
- No CE Adopt ceremony.
- No automatic CVR overlay membership solely because a CE is submitted.
- Hawthorn remains a client-chart end-to-end UAT and must **not** be remapped to Test Site 1 codes.
- HD-001 and HD-002 remain resolved; do not reopen them.

---

## 7. Near-term sequencing

### Internal / single-operator commercial development (current recommendation)

```
BL-037A  Authoritative Draft CVR membership command  BANKED
  → BL-037B  Budget Import + Master picker consume 037A  BANKED
  → BL-037C  Controlled missing-line CVR integration     BANKED
  → HD-002 / HD-008 Selling Costs adoption treatment    RESOLVED
  → BL-034C Selling Costs Review against CVR            READ ONLY (BANKED e06a86c)
  → BL-034D Selling Costs Adopt into Draft CVR          WRITE (BANKED 6d11491)
  → Founding Product Principles + HD-001                 BANKED (19553dd; docs only)
  → BL-038A CE-linked expected liability design preflight   COMPLETE (docs)
  → HD-038-1 / HD-038-2 / HD-038-3                      RESOLVED (docs only)
  → BL-038B CE expected-liability model / override / audit  BANKED
  → BL-038C wire Expected into Final Forecast              BANKED b036bc9
  → BL-038E snapshot/Create Next integrity                 NEXT / PRE-HAWTHORN GATE
  → Detailed / itemised Selling Costs                   later; not 034D; not the next slice
```

**BL-036** (persisted Commercial Structure / admin setup) is **not** a hard prerequisite of BL-037 or of HD-001 implementation if destination codes already exist on Cost Code Master. Place BL-036 when customer Admin setup or the reporting_group save trap (HD-011) is in the critical path.

**BL-034D is BANKED** at `6d11491`. Last design-authority bank is `b5fe388` (HD-038). **BL-038C BANKED** at `b036bc9`; human UAT + forensic PASS. **NEXT BL-038E** is the pre-Hawthorn snapshot/Create Next integrity gate; BL-038D detail UX is deferred pending pilot evidence. Keep P04 Draft. Do not create P05. Do not Adopt UAT-CC-001. Hawthorn remains protected and unmodified. Detailed Selling Costs remains unstarted. HD-001, HD-002, HD-008, and HD-038-1/2/3 remain **resolved**.

Hawthorn Gardens remains a future client-chart known-answer UAT. Do not import, discard, or remap it in the next slice.

### Before hosted external / multi-user trial

**BL-035 Trial Envelope + BL-035B authority-flag contract are mandatory gates** (HD-003, PC-018, PC-019).

Full RBAC/users/JWT is **not** the immediate next commercial slice (Doc 47; Doc 67 §26).

---

## 8. Maintenance rule

Every future slice that **parks** functionality, **changes product intent**, **creates or resolves a human decision**, **supersedes Master Documentation**, **changes V1 scope**, or **resolves an item in this register** must update **this file in the same banked slice**.

- Do **not** turn this file into a chronological changelog.
- `CURRENT_STATE.md` remains the implementation / UAT status log.
- This file remains the durable intent / decision register.
- Promote important chat/audit findings here if they must survive; otherwise they are rank E.
