# Site Start implementation register

| Slice | Scope | Status |
|---|---|---|
| SS-1 | Land Purchase Appraisal authority; Site Start period identity; forecast-as-at month; ordering | Implemented locally; owner review pending |
| SS-2 | Site Start worksheet/drawer and forecast evidence | Implemented locally; owner review pending |
| SS-3 | Prelims and Selling Costs adoption into Site Start | Implemented locally; owner review pending |
| SS-4A | Site Start submit, approval/lock and immutable Approved Site Start Budget | Implemented locally; owner review pending |
| SS-4B | Clean P01 cutover from Approved Site Start Budget | Implemented locally; owner review pending |
| SS-5 | Movement bridge, cumulative benchmark and pilot hardening | Implemented locally; owner review pending |

## SS-1 authority and evidence

- Migration 067 adds an immutable, tenant/development-scoped Land Purchase Appraisal snapshot with stable Cost Code identity, authenticated membership provenance and canonical evidence hash.
- CVR periods gain explicit `monthly_cvr` / `site_start` identity. `SITE_START` is reserved, unique per Development and has no reporting month or P-number.
- Site Start requires a verified Land Purchase Appraisal and is rejected after monthly CVR history exists.
- `forecast_as_at_month` is explicit and versioned while Draft. Normal monthly reporting-month authority is unchanged.
- Shared ordering places Site Start before P01; next-period generation ignores Site Start and still begins at P01.
- `site_start.manage` is introduced without role grants; creation is unavailable to ordinary pilot users. Submit is also deliberately blocked in SS-1 so CVR close machinery cannot expose a half-functional workflow.

## Risks and deferred decisions

- Site Start forecast rows, submission evidence, module adoption, approval/lock and P01 cutover are intentionally absent until SS-2–SS-4.
- The existing v1 Site Start Budget milestone remains separate and is not reinterpreted.
- Existing Development-Budget-backed CVRs, including Oakfield P01, are not rewritten.

## SS-2 working forecast

- The existing server and client CVR engines consume the immutable appraisal through the established authoritative budget-position contract.
- The normal Worksheet, Summary, Cost Code drawer, Projected Adjustment, reason/history, obligations, CE/VA convergence, economic floor, EFC, CTC and variance calculations are reused.
- Appraisal positions remain immutable; Draft overlays hold QS Projected Adjustments and notes only.
- Site Start is presented distinctly with Land Appraisal Baseline, Working EFC and an explicit versioned Forecast-as-at control.
- At the SS-2 boundary Submit and Site Start role grants remained intentionally deferred; SS-4A now completes that governance boundary.

## SS-3 module adoption

- Prelims and Selling Costs reuse their existing proposal, comparison, transactional replacement-adjustment, membership, provenance and audit paths against a Draft Site Start period.
- One shared period context selects immutable `reporting_month` for monthly CVRs and versioned `forecast_as_at_month` for Site Start; no fake reporting month or P-number is introduced.
- Site Start review intent includes explicit period type, version and effective month. Changing forecast-as-at invalidates the reviewed intent before any write.
- Fact-derived appraisal Cost Code rows may establish only the editable CVR input overlay needed for adoption. Neither Land Appraisal nor Development Budget authority is rewritten.
- Active Prelims and Selling Costs ownership on the same Cost Code fails closed rather than silently combining independent replacement forecasts.
- The reused review screens identify Site Start, Working EFC and Site Start adoption while retaining the monthly-CVR presentation and behavior.
- Focused coverage includes effective-month selection, client Site Start review intent/presentation, and the established guarded Prelims/Selling Costs adoption, idempotence, many-to-one, membership, rollback, tenant and monthly-CVR suites.

## SS-3 risks and deferred work

- Deliberate cross-workflow supersession continues through the existing governed manual/supersession path; SS-3 does not invent an automatic combination rule.
- At the SS-3 boundary Submit/Approve/Lock remained deferred; SS-4A now completes it. Absorbed-exposure frontier, P01 cutover and movement attribution remain SS-4B/SS-5 work.

## SS-4A approval authority

- QS, Commercial Manager and Commercial Director receive `site_start.manage`; normal `cvr.submit` and `cvr.lock` permissions remain independently authoritative.
- Submit validates the immutable appraisal and active tenant Cost Code identities, requires Forecast as at, captures Variation exposure and Commercial Structure evidence, and recomposes the whole close candidate.
- Approve & Lock reuses the existing stale checks, acknowledgements, schema-v3 snapshot and CVR audit transaction.
- Migration 067 extends `development_budget_milestones` additively. Existing rows remain authority version 1; a locked first-class Site Start creates authority version 2 linked to its period, snapshot and Land Appraisal.
- V2 evidence freezes EFC by Cost Code and total, Commercial Head totals, adjustment history/provenance, costs and obligations, CE/VA evidence, Revenue/GP, approver membership/role, approval reference and a canonical SHA-256 hash.
- Snapshot, locked status, audits and v2 milestone commit atomically. Milestone history remains append-only.
- Approval still requires the established `cvr.lock` authority; Site Start does not grant tenant financial authority to the Admin role.

## SS-4A risks and deferred work

- SS-4B now makes Approved Site Start Budget the explicit P01 budget source. Management movement presentation remains SS-5.
- Ordinary Create Next continues to ignore Site Start as a monthly predecessor. Existing monthly CVRs are unchanged.
- Existing v1 Opening-Budget Site Start milestones remain readable and are not rewritten or inferred as v2.

## SS-4B P01 cutover

- `Create P01 from approved Site Start` is a dedicated tenant/development-scoped `cvr.edit` command. It requires the locked Site Start version, immutable snapshot, v2 milestone, no monthly CVR and an explicit closed reporting month.
- P01 records `budget_source=site_start_budget` and a stable FK to the approved snapshot. It creates no copied input overlays: Original and Current Budget start from frozen Site Start EFC, while Projected Adjustment, accrual, module ownership, reasons and movement explanations start empty.
- Site Start approval freezes the Development Budget event sequence. Current Budget then equals Site Start EFC plus only authorised movements after that frontier.
- The v2 milestone freezes absorbed change exposure by stable CE/VA identity. Linked CE/VA convergence runs first; only directional exposure above the absorbed amount contributes after cutover. A reduction does not silently release the approved baseline.
- P01 reuses immutable budget submissions for Submit/Lock stale checks. Prelims and Selling Costs consume the Site-Start-backed budget document and retain their existing replacement-adjustment ownership.
- Generic Create Next is rejected at the Site Start-to-P01 boundary. Ordinary P02/P03 roll-forward, legacy Development-Budget periods and v1 milestones remain unchanged.

## SS-4B risks and SS-5 boundary

- Cutover requires identity evidence frozen by a first-class Site Start snapshot; legacy milestones cannot be inferred into this workflow.
- Commitments, certificates and ledger facts stay live and are not copied. The recognised-obligation floor remains authoritative.
- SS-5 now supplies the explicit Site Start cumulative benchmark/movement bridge and management presentation described below.

## SS-5 movement and reporting

- The existing previous-locked-period selector places locked Site Start immediately before P01. P02 and later retain the established immediately-preceding locked monthly comparison.
- For the Site Start-to-P01 bridge only, the approved Site Start EFC is normalised as P01's opening System Forecast baseline. Absorbed pre-start Projected Adjustments and Change Exposure therefore do not manufacture offsetting component movements.
- The movement report identifies this boundary as `Site Start forecast absorbed into P01 baseline.` Total and Cost Code movement remain Current EFC less approved Site Start EFC.
- Summary Site Start values are sourced from the immutable Site Start snapshot through the verified `site_start_budget` source positions. Legacy v1 milestone presentation remains readable but is not promoted into v2 authority.
- Period movement remains the primary Movement column. Cumulative movement since Site Start is shown as secondary benchmark evidence within the existing Site Start column, avoiding another table column or reporting module.
- Site Start remains ordinal zero, consumes no P-number and is accessible in the existing period navigation. The dedicated cutover remains the only Site Start-to-P01 creation path; ordinary Create Next remains P01-to-P02 onward.

## SS-5 regression evidence and pilot limitations

- Focused client coverage proves zero movement at unchanged cutover, genuine incremental P01 movement, unchanged ordinary P02 component comparison, and separate cumulative Site Start movement.
- Guarded server coverage proves immutable approval/cutover evidence, CE/VA absorption, post-frontier Development Budget movements, module adoption ownership, and monthly/tenant/RBAC compatibility.
- Historic Development-Budget-backed CVRs, including Oakfield-style P01 periods, do not enter the Site Start cutover normalisation path.
- Pilot limitation: cumulative Commercial Head presentation assumes continuing Cost Code membership. A Cost Code removed from all later period membership remains preserved in historic Site Start evidence, but a future dedicated archived-membership reporting treatment may be desirable.
- Signed exposure crossing zero is now explicit: an absorbed +£5,000 followed by -£1,000 contributes only the new -£1,000 exposure, and the reverse direction contributes only the new signed amount. The absorbed baseline is not automatically released and no £6,000 movement is manufactured.
- Guarded coverage now includes late certificate/ledger facts, a Cost Code first introduced after Site Start, concurrent P01 cutover, and exact-once post-frontier Development Budget movement.

## Final release-blocker correction

- Land Appraisal capture now has a database-enforced open/sealed boundary. Lines may be inserted only while the newly-created appraisal is unsealed inside its original transaction; capture seals the parent before commit.
- Sealed appraisal parents and lines reject subsequent insert, update and delete operations.
- Hydration verifies both the canonical parent evidence hash and exact reconciliation of the persisted financial line collection to the hashed `evidence_snapshot.lines` and total. Divergence returns no appraisal authority and blocks Site Start creation/submission/approval.
- A populated disposable frontier-066 rehearsal containing a monthly locked CVR, frozen snapshot/row, Development Budget event/line, v1 Site Start milestone, tenant membership and Cost Code migrated to 067 without changing counts, frozen forecast totals or milestone evidence hash. Existing periods became `monthly_cvr`, v1 milestones remained authority version 1, and no Land Appraisal was backfilled. The isolated rehearsal database was dropped after verification.
- Migration 067 remains additive and contains no historic financial-data update or backfill.

## Remaining hosted pilot checks

- Exercise the signed-exposure reversal examples with normal CE/VA UI evidence.
- Confirm late certificate and ledger facts through the hosted operational workflow.
- Confirm the first post-Site-Start Cost Code and Development Budget movement through the normal governed UI.

## Hosted UAT sequence

1. Create Site Start from a verified Land Purchase Appraisal and leave it Draft across at least one Forecast-as-at change.
2. Enter a governed QS Projected Adjustment; adopt Prelims and Selling Costs; confirm the Working EFC and evidence.
3. Submit, approve and lock Site Start. Record the approved Cost Code EFCs and total.
4. Create P01 only through `Create P01 from approved Site Start`; before new facts, confirm Movement is zero and the baseline absorption explanation is present.
5. Add one genuine post-start fact and confirm only its incremental EFC movement appears; confirm the separate cumulative Site Start comparator.
6. Lock P01, create P02 and confirm P02 compares with P01, not directly with Site Start; repeat P03 against P02.
7. Reopen locked Site Start, P01 and P02 as historical evidence and confirm values remain immutable.
8. Verify an existing Development-Budget-backed CVR still uses its original movement and Site Start presentation rules.

## Next action

Owner-review the complete SS-1 through SS-5 tranche locally, then bank and release only as a single migration-067-compatible boundary.

## SS-UAT-01 onboarding connection

- Development Budget now loads the existing Land Purchase Appraisal authority alongside the legacy Development Budget authority.
- A fresh development can reuse the established CSV/Excel Cost Code mapping and validation experience to review totals and source evidence before permanent Land Appraisal capture. Capture uses stable tenant Cost Code IDs and creates no Development Budget event.
- The captured immutable appraisal remains visible on the Budget page. Authorised users can provide Forecast-as-at month and create the existing `SITE_START` Draft, then move directly to its canonical CVR route.
- Fresh-development readiness now requires Cost Code Master and immutable Land Appraisal, and directs the operator to Budget setup. A separate Development Budget is not a Site Start prerequisite. Existing monthly and legacy Development-Budget-backed CVRs retain their prior readiness model.
- Permissions remain independent: `land_appraisal.capture` controls permanent capture and `site_start.manage` controls Site Start creation; read-only users retain appraisal visibility.
- Minor hosted UX follow-up: the legacy Development Budget setup remains available on the same Budget page for developments that legitimately use that authority. Owner UAT should confirm the two authorities are sufficiently distinct at normal viewport sizes and that duplicate Site Start clicks surface the server's fail-closed response clearly.

## SS-UAT-02 Site Start drawer saves

- Appraisal-backed Site Start periods now omit `originalBudget` and `currentBudget` from ordinary Cost Code input PATCH requests, matching the existing protected handling for Development-Budget- and approved-Site-Start-backed periods.
- The existing guarded Draft membership primitive remains the sole creator of a fact-only editable overlay. It retains stable tenant Cost Code identity, creates at most one overlay and copies no Land Appraisal money.
- Projected Adjustment, commercial reason, Manual Accrual and notes remain governed editable input evidence. Land Appraisal amounts remain immutable and continue to supply the authoritative row budget.
- Explicit attempts to mutate protected budget fields still fail closed with source-neutral wording. Optimistic versions, reason validation, ownership protection and existing monthly-CVR behavior are unchanged.
- Guarded coverage proves an appraisal-backed overlay can save adjustment, accrual and notes; rejects missing reasons, stale versions and explicit budget mutation; preserves the £18,679,000 appraisal; and creates no Development Budget event.

## SS-UAT-03 Prelims effective month and worksheet readability

- Development Prelims collection and setup preview now resolve one effective forecast month from the active period: Site Start uses `forecast_as_at_month`; ordinary monthly CVRs continue to use `reporting_month`; explicit preview overrides and no-period behavior remain supported.
- Site Start presentation identifies `Forecast as at` using a readable calendar-month label. Review and adoption retain the same existing server-authoritative effective-month calculation and stale-intent protection.
- The forecast engine is unchanged. TIME total forecast remains programme-duration based; the effective month resolves elapsed and remaining phasing only.
- The desktop setup worksheet now protects readable Prelim, Cost Code and Assumption widths, using its existing overflow container when needed. The established card layout below 900px remains unchanged.

## PM-1 Compact Prelims estimating matrix

- Development Prelims setup now presents every enabled company-template line as one compact estimating row with Cost Code, item, driver, timing anchors and offsets, calculated months, rate/amount, forecast and state. Descriptions, fixed-date controls, mapping exceptions, resolved timing and phasing remain available in an optional per-line detail expansion.
- Existing development lines hydrate their authoritative saved assumptions and remain read-only in setup; their established Site Prelims edit/version path remains the only amendment authority. New lines remain browser-local until the deliberate transactional Apply command.
- Explicit company monetary defaults now pass through setup preview and are labelled as company defaults. They do not select a line, create a development record or overwrite an existing development assumption.
- Explicit £0 forecasts are distinguished from incomplete assumptions. Unconfigured lines are never represented as authorised zero forecasts.
- Focused coverage protects company-default hydration, complete enabled-line visibility, TIME/LUMP_SUM switching, live recalculation, offsets/fixed dates, many-to-one grouping, duplicate/stale guards, Site Start/monthly month authority, collapsed exception detail, persisted-line read-only handling and responsive/sticky matrix structure.
- Deferred: Cost Code Master completeness remains a company-onboarding prerequisite; PM-1 does not add mixed create/update batch persistence, clipboard paste, fill-down, new drivers or per-cell audit history.
- PM-1 release-gate reconciliation: four Prelims adoption-preview regressions were stale fixtures, not product failures. They created a brand-new Development and attempted an ordinary P01/P04 after establishing a Development Budget; the governed Site Start lifecycle correctly rejected that bypass. The fixtures now establish representative locked legacy CVR history before creating the Development-Budget-backed Draft under test. All original preview, recognised-obligation, fact-only membership, mixed-case identity, read-only and adoption assertions remain active and pass without weakening production readiness.

## PM-1C Compact commercial estimating worksheet

- The primary setup matrix is now a seven-column commercial schedule: Prelim item, Driver, Timing, Months, Rate/Amount, Forecast and Status. Cost Code identity, description, Current Budget context and configured forecast subtotal appear once in the authoritative Cost Code group heading.
- Normal TIME rows show a concise start-to-end timing summary. Anchor selection, signed offsets, fixed dates, resolved dates, phasing, descriptions, validation and mapping exceptions remain available in the optional row detail. LUMP_SUM rows retain neutral Timing and Months presentation.
- The matrix minimum width is reduced from 104rem to 76rem so item, duration, assumption and calculated forecast remain visible together in the full-width commercial workspace at normal desktop widths. The item column and header remain sticky; numeric assumption/forecast columns remain right-aligned; the existing responsive card layout remains below 900px.
- Financial and persistence authority is unchanged: calculation drivers, effective month, company defaults, Development overrides, transactional Apply, version checks, persisted-line edit boundary and CVR/Site Start adoption are untouched.
- Automated structural and interaction coverage passed locally. Direct running-browser inspection was unavailable; 1440px/1920px, 100%-zoom visual acceptance remains owner UAT.

## PM-1D Cost Code group alignment

- Cost Code group headings now use real table cells whose spans align with the seven-column estimating schedule: identity spans the descriptive columns, Current Budget spans Months and Rate/Amount, and Configured forecast spans Forecast and Status.
- The previous independently sized group-summary grid has been removed. Budget and forecast values remain right-aligned and untruncated, while Cost Code descriptions and supporting evidence can wrap naturally.
- The worksheet follows the CVR scroll contract with `width: max-content`, `min-width: 100%` and the existing worksheet wrapper as the sole desktop horizontal scroll owner. The sticky item column no longer paints over group financial content.
- Below 900px, group evidence uses the existing responsive card model. Direct authenticated browser inspection remains unavailable; 1440px and 1920px at 100% zoom remain required owner visual acceptance.

## PO-UAT-01A Supplier classification and order-type flexibility

- Supplier classification remains an initial order-type suggestion only. Professional Consultant continues to suggest Sub-contract, while the operator may deliberately select Materials for Purchase Ledger processing or another established valid type.
- The PO form no longer imposes a client-only equality rule between supplier classification and order type. The established `M`, `S` and `P` order types, all other PO validation, supplier approval and PO approval remain unchanged.
- Downstream authority remains type-led: only an approved Sub-contract PO materialises a subcontract Package. An approved Materials PO creates no Package and continues through the existing Purchase Ledger and commitment paths.
- Focused client and guarded server coverage protects consultant Materials and Sub-contract paths, pending-supplier rejection, valid-type selection, package materialisation and approval authority.

## PO-UAT-01B Save & Send action presentation

- Save & Send for Approval now has a narrowly scoped PO-form action class with an explicitly green normal and hover treatment, visible keyboard focus, distinguishable pressed state and retained disabled/loading treatment.
- No submission logic or global button styling changed. Owner visual UAT remains required at 100% zoom to confirm the action stays green across normal, hover, keyboard-focus, pressed and loading states in the deployed browser.

## SS-UAT-08 Summary and Worksheet lifecycle convergence

- CVR Summary now recognises first-class Site Start identity for every lifecycle action. Draft submission requires an explicit Site Start confirmation, and Submitted approval uses the same governed approval-reference and approval-reason dialogue as the Worksheet.
- Locked Site Start Summary exposes `Create first CVR (P01)` and calls only the existing dedicated Site Start cutover adapter after explicit Reporting Month selection. Ordinary monthly periods retain the established Create Next Period authority.
- Site Start presentation uses the friendly `Site Start` identity and `Forecast as at` date authority. Draft and Submitted periods are labelled `Working Site Start Forecast`; Locked periods are labelled `Approved Site Start Budget`, retain Submitted/Approved/approver evidence, and no longer show active Working-EFC guidance.
- No server endpoint, financial formula, persistence authority, schema, migration or RBAC rule changed. Server optimistic-version, duplicate cutover and canonical milestone/snapshot protections remain authoritative.

## SS-UAT-09 CVR reporting chronology

- P01 remains a dedicated Site Start cutover. Its Reporting Period must be closed and its calendar month must contain or follow the precise persisted Site Start `approved_at` timestamp; Forecast-as-at and the milestone's derived effective date are not chronology substitutes.
- P02 onward must use a Reporting Period strictly later than the preceding locked monthly CVR. Gaps are deliberate and supported: quarterly and irregular reporting do not manufacture intermediate P-numbers, and movement remains anchored to the previous locked snapshot.
- The shared reporting-month dialogue applies the same minimum-month boundary, suggests the earliest eligible month only once it has closed, and explains when no eligible closed month yet exists. Server validation remains final authority.
- Historic legacy CVRs with no persisted reporting month retain their established compatibility path. No snapshot, financial formula, budget authority, absorbed adjustment, commitment, schema, migration or RBAC behavior changed.
- Release-gate note: the explicit established-legacy continuation regression passes. Five other cases in `cvrDevelopmentBudgetIntegration.test.js` remain stale new-development readiness fixtures under the governed Site Start lifecycle; they fail before chronology handling, were not weakened or concealed in SS-UAT-09, and require a separately bounded fixture-debt correction.

## CC-UAT-01 Cost Code completeness

- Draft CVR Worksheets now expose a lightweight Cost Code Completeness review. It compares the active tenant Company Cost Code Master with the authoritative rows currently represented by budget positions, live commercial facts and explicit CVR input overlays.
- The review reports the unrepresented count and provides search plus Commercial Head filtering. Unrepresented is presented as a review prompt, not proof that cost was omitted.
- Adding a Cost Code reuses the existing Draft-only, tenant-Master-backed membership command. It creates one empty audited overlay with a zero authoritative baseline; it does not rewrite Land Appraisal, Approved Site Start Budget or Development Budget authority.
- Draft Site Start submission displays a concise non-blocking reminder while active Master Cost Codes remain unrepresented. Monthly CVRs retain optional access without an acknowledgement state or recurring submission gate.
- The existing membership route now explicitly requires `cvr.edit`. QS, Commercial Manager and Commercial Director roles already hold both `cvr.edit` and the applicable Site Start lifecycle permissions.
- No schema, migration, persisted reviewed/excluded state or automatic financial rows were introduced. Owner UAT should verify the count against an Ashfield-shaped period, exercise Head/search filtering, add one genuine zero-baseline code and confirm the count refreshes before testing its governed Projected Adjustment.

## CVR-UX-01 Cost Code commitment visibility

- The CVR Worksheet now displays the existing server-authoritative `Committed` value between Budget and Current Cost for each Cost Code and in the worksheet total.
- The column defines Committed as total recognised approved net PO and contract value, not an outstanding balance after certification or payment.
- Live Draft rows and immutable locked Site Start/monthly snapshot rows use their existing hydrated `committedLabel`; no client calculation or new commitment authority was introduced.
- Existing horizontal scrolling, sticky Cost Code/Description columns and monetary alignment remain unchanged. Owner visual UAT should confirm heading readability and scrolling at normal desktop widths.
- PO/package recognition, certification, ledger actuals, recognised obligation, Uncommitted, CTC, EFC, movement, workflow-owned adjustments, Commercial Head aggregation and snapshot authority are unchanged.

## SS-UX-10 Site Start Summary comparison presentation

- Commercial Cost Summary no longer presents `Since Site Start £0.00` while viewing the Site Start period itself. Commercial Head and Total rows use one explicit presentation flag.
- The approved Site Start benchmark, current EFC and derived cumulative movement remain calculated and reconciled unchanged; only the redundant self-comparison label is suppressed.
- Monthly CVRs continue to show positive, negative and zero cumulative movement against the immutable approved Site Start benchmark, independently of movement from the previous locked monthly period.

## GP-PILOT-03 dependency-security release closeout

**Owner-only hosted release complete (14 October 2026).** Four bounded dependency-security commits through `7c6d275` were deployed to the Render API. Netlify was unchanged. No database migration accompanied this release; the hosted migration frontier remains `067`.

- Render has Node `22.17.0` configured. The deployment completed successfully, API health reported ready and PostgreSQL readiness reported ready. The exact Node runtime used by the hosted process was not independently observed in deployment logs.
- Production dependencies now resolve Express `4.22.3`, Handlebars `4.7.10`, Sharp `0.35.5` and Puppeteer `25.13.0`. Puppeteer targets Chrome for Testing `155.0.8059.39`; the exact hosted Chrome runtime version was not independently observed in deployment logs.
- Dormant Nodemailer/SMTP workflow code was removed. Clerk invitations remain the established invitation mechanism; BuildLite does not claim SMTP workflow notifications.
- The server and repository-root production npm audits reported zero findings at the released dependency boundary.
- An existing hosted approved PO PDF was generated successfully and visually inspected after deployment, providing an operational smoke test of the hosted PO PDF path.

**Deferred acceptance:** Hosted commercial-document PDF rendering remains unverified. No certificate or payment notice currently exists in the owner-only UAT environment. Complete this check during certificate UAT using an existing commercial document; do not create artificial financial evidence solely for infrastructure testing.

### Outstanding pilot blockers

GP-PILOT-03 closes the bounded dependency-security release only. BuildLite is **not externally pilot-ready**. The outstanding pilot-readiness programme still includes:

1. P0-06 CVR locking/reconciliation correction and regression proof.
2. Tenant-scoped PO and supplier identity migration, including the global-key / tenant-local numbering limitation.
3. Wider Commercial Event and certificate RBAC review.
4. The remaining pilot-readiness, hosted UAT and financial edge-case findings already recorded in this register and the programme continuity record.

## GP-PILOT-04 P0-06 CVR snapshot-reconciliation closeout

**Owner-only hosted release complete (14 October 2026).** The three bounded corrections through `4d9e454` were deployed to the Render API. No migration, seed, Netlify deployment, schema change or historical snapshot rewrite accompanied the release.

- Snapshot verification reuses the shared authoritative forecast functions. The recognised-obligation floor remains a per-Cost-Code commercial invariant; no aggregate development-level substitute or new calculation authority was introduced.
- Monetary reconciliation compares persisted `NUMERIC(14,2)` evidence in integer pence. Cost Code rows reconcile to headers, while Revenue, Gross Profit and Margin retain their established authority.
- Negative integration coverage proves manipulated obligation, commitment, exposure, System Forecast, Final Forecast, aggregation and pence evidence fail closed with complete transactional rollback.
- The governed Site Start regression reaches snapshot verification and proves HTTP 409 `CVR_SNAPSHOT_RECONCILIATION_FAILED`, Submitted status retention, and zero surviving snapshot header/rows/plots, approval/lock audits or Site Start milestone. Stable diagnostics identify invariant category and `site_start` period type without financial values.
- Post-deployment read-only verification confirmed Ashfield's existing locked Site Start figures and Oakfield's existing P01 Draft figures remained unchanged. No hosted CVR was newly approved solely to test the release.

The five stale new-development readiness cases in `cvrDevelopmentBudgetIntegration.test.js` remain separately bounded fixture debt. Hosted commercial-document PDF rendering remains deferred until certificate UAT can use an existing certificate or payment document without manufacturing financial evidence.

P0-06 snapshot reconciliation is closed. This does not close the separate GP-PILOT-05 live-fact transaction-consistency investigation, the tenant-scoped PO/supplier identity migration, or wider Commercial Event and certificate RBAC review, and does not make BuildLite externally pilot-ready.

## GP-PILOT-05 CVR approval transaction-consistency closeout

**Owner-only hosted release complete (14 October 2026).** The bounded correction at `0369d66` was deployed successfully to the Render API. The hosted environment uses PostgreSQL major version 18 and Node.js `22.17.0`. No migration, seed or Netlify deployment accompanied the release.

- CVR approval now uses PostgreSQL `REPEATABLE READ`, with all financial source reads, immutable snapshot persistence, status transition and approval audit sharing the same transaction client.
- The existing CVR period `FOR UPDATE`, optimistic-version checks, submitted-evidence integrity checks and tenant/development scoping remain authoritative.
- `SET LOCAL lock_timeout = '10s'` bounds approval row-lock waits without changing any global database setting.
- PostgreSQL serialization (`40001`), lock-timeout (`55P03`) and deadlock (`40P01`) conflicts propagate through cost and revenue source loaders, roll back completely, and return controlled HTTP 409 refresh/retry guidance. Approval is not retried automatically.
- Immutable snapshot authority, historic evidence and all financial formulas remain unchanged.
- Guarded local PostgreSQL verification on `localhost:5432/buildlite_test` version `18.6` recorded 126 server tests passing with zero failures or skips. Client movement/Summary verification recorded 26 passing tests, and the production Vite build passed. These results are local test evidence.
- Post-deployment checks confirmed the existing Ashfield Rise locked Site Start figures and Oakfield Rise P01 Draft figures remained unchanged. No newly submitted hosted CVR was approved for smoke testing.

### Outstanding external-pilot blockers and deferred acceptance

GP-PILOT-05 closes the live-fact transaction-consistency investigation. BuildLite remains **not externally pilot-ready**. Outstanding items include:

1. Tenant-scoped PO and supplier identity migration, including the legacy global-key / tenant-local numbering limitation.
2. Wider Commercial Event and certificate RBAC review.
3. Five stale Development Budget integration fixtures.
4. Hosted commercial-document PDF acceptance, deferred until certificate UAT can use an existing document without manufacturing financial evidence.
5. Previously recorded UX/UAT issues, pilot-readiness findings and technical debt.
