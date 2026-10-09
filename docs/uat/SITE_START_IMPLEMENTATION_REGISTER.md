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
