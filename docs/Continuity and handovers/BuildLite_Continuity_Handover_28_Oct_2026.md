# BuildLite Continuity Handover — 28 October 2026

## Authoritative checkpoint

This is the canonical repository handover for 28 October 2026. It is additive to the 24 October handover and preserves its earlier decisions, evidence and unresolved investigations. It does not replace `CURRENT_STATE.md`, the Product Constitution, Project Spine, Technical Operations Manual or immutable commercial evidence.

**Wave C3 Action Safety remains PAUSED. Its discovery prompt has not been sent.** C4 and C5 remain queued. Do not silently begin another product slice.

## Commercial authority retained

- Immutable Land Purchase Appraisal → fixed approved Site Start Budget → P01 → P02 → later monthly CVRs. There is no P00 or rolling Current Budget.
- P01 movement is from Site Start; later movements compare with the preceding Locked monthly CVR, including across skipped months.
- System Forecast is fact-based. Final Forecast = System Forecast + CE Expected Liability + Commercial Adjustment. QS judgement is explicit and auditable; it never rewrites the fact.
- Client Cost Codes and Commercial Heads remain client-owned. Plot Master GIA and Revenue NIA remain distinct. Locked snapshots remain immutable.
- Draft and Submitted reports are provisional. A trial CVR, PDF or workbook is not approved evidence and does not establish a profit or loss.

## Git, deployment and database evidence

| Scope | Confirmed state | Evidence limit |
|---|---|---|
| Git `buildlite-V1-1` | `02d985615381977b20e73ca8927b7e2b9676d93a` pushed; 0 ahead / 0 behind at checkpoint | Reverify before future Git operations |
| Main database | `buildlite_pilot`, PostgreSQL 18.6, migration frontier `070` | Recorded migration/health evidence; no hosted access during this sync |
| Main authority configuration | CVR server authority enabled; ledger server authority added after the missing-flag incident | Reverify effective production variables before deployment |
| Main application tiers | Hosted Poplar Road workflow and Worksheet download used successfully | Exact Render and Netlify live SHAs were not separately captured; a download alone is not release-pair proof |
| JB Homes | Prior matched `de3331a` evidence retained | PO204 and membership investigations remain open |

Main remains `app.buildlite.co.uk` / Netlify `buildlite-pilot` / Render `buildlite-pilot-api` / database `buildlite_pilot`. Render Auto-Deploy was confirmed OFF and Netlify automatic publishing LOCKED for the `02d9856` push. Push is not deployment; verify both controls before every release.

## Levison Rose — Poplar Road milestone delivered

Levison Rose Homes Ltd, Poplar Road Brownhills `DEV-002`, completed the retrospective onboarding and reporting trial. Governed Sage actuals were imported, an October P01 Draft forecast was adopted, the directors' CVR Summary PDF and full Excel Worksheet were generated and reconciled against Matt's source CVR, and the results were sent to Matt for review.

This monthly CVR is **Draft and provisional**. It is not Locked or approved and does not prove a commercial loss.

### P01 commercial checkpoint

- Four plots; 3,027 ft² governed GIA.
- September Locked Site Start: **£715,437.88**; Revenue: **£985,000**.
- PostgreSQL-authoritative Sage actuals: **374 transactions / £405,569.54**. Two offsetting Cost Code 4000 rows (+£40 / −£40) were subsequently resolved in the governed ledger to unblock the close.
- Pre-adoption server EFC: **£803,236.69**.
- Adopted QS Projected Adjustments: **−£35,524.67**.
- Draft P01 EFC: **£767,712.02**; Cost to Complete: **£362,142.48**; Gross Profit: **£217,287.98**; Gross Margin: **22.1%**.
- Adverse movement from fixed Site Start: **£52,274.14**.
- Matt's historic Excel EFC was approximately **£706,823.39**. The trial workbook target was **£707,466.39** after separately recording the negative £643 Landscaping 5122 trial adjustment as zero. Fifteen governed forecast-floor exceptions added **£60,245.63**, producing the adopted **£767,712.02**. This is a governed retrospective difference, not evidence of a £60,889 loss.
- Codes without Site Start allowance include 5006 Bank/Finance £10,241.28, 5224 Plaster/Render Material £30.56 and 5403 Agents Commission £4,540.00. Finance presentation and the £25,000 supplier-less CD at 5136 Abnormals require client interpretation, not automatic correction.

The source Sage report total of £404,920.84 differs from the imported £405,569.54 by **£648.70**. Earlier work attributed this to prepared-file treatment (+£1,300 and −£651.30), but that explanation was not independently reverified here. No ledger correction is authorised.

Movement attribution shows £35,524.86 favourable and £87,799.00 adverse, net £52,274.14 adverse. The £0.19 difference from the Projected Adjustment total remains unexplained. PDF commentary also printed literal Markdown asterisks. Both are recorded follow-ups, not authority to change the Draft figures.

### Historical appraisal recovery decision

The 24 October record preserves the headerless Land Appraisal omission and artificial Site Start adjustment as a historical incident. The successful DEV-002 trial conflicts with the earlier proposal to recreate the development. **Do not delete, reset or recreate this now-successful development without new explicit Product Owner authority.** The general governed retirement/supersession requirement remains open.

## Completed capabilities, 25–28 October

- `ea7470b`: migration 070 and safe split-invoice / supplier-less journal import; Main frontier 070 recorded healthy.
- `f28cdad`: current-calendar-month monthly CVR Draft creation, with Submit and Approve & Lock still blocked until month end.
- `ca361a9` plus `e10045d`: Draft Forecast Onboarding with worksheet mapping, underlying Excel values, explicit exclusions/fingerprint, governed preview, forecast floors, missing active Cost Code membership, audited atomic Projected Adjustments and exact reconciliation.
- `02d9856`: governed full CVR Worksheet `.xlsx` export using provisional close evidence or immutable Locked snapshots, A3 landscape, repeated authority/header rows, numeric cells and Excel-only exact-pence reconciliation isolated from the Summary PDF path.

## Critical hosted-authority incident

Main had CVR server authority enabled while `VITE_LEDGER_SERVER_AUTHORITY` was absent. The first 374 Sage rows therefore went to browser localStorage while the server close saw no PostgreSQL actuals. A tenant-scoped read-only check recorded zero server rows/batches. Ledger server authority was then enabled, the frontend rebuilt/published and the Sage evidence imported to PostgreSQL; Worksheet and forecast preview subsequently agreed at £405,569.54.

This remains a **P0 product-safety requirement**: hosted financial authority flags must never silently mix browser-local ledger facts with server-authoritative CVRs. Deployment validation must fail visibly or the application must fail closed.

## Outstanding product improvements

- Surface Forecast Import server `blockers`, including unresolved ledger counts and sources, rather than only a generic readiness error.
- Provide a standard two-column Cost Code / Target EFC template and visibly reconcile original target, governed floor, uplift and adopted target.
- Verify Actual Cost to Date is prominent on the on-screen CVR Summary.
- Render/sanitise CVR PDF commentary so Markdown markers do not print literally.
- Clarify movement attribution and the £0.19 difference; remove lingering “Current Budget” terminology.
- Optionally suppress zero-value Cost Code clutter without deleting governed membership or evidence.
- Continue common multi-sheet/header-aware Excel importer standardisation without replacing module-specific authority.
- Replace fragile bespoke migration/audit scripts with a maintained, locally end-to-end-tested procedure without weakening safeguards.

## Immediate next phase — Valhalla independent trial

Resume the existing Valhalla Homes Ltd / Welford Road development; do not rebuild it. The 75-plot update matched 75/75 and corrected 65 while preserving IDs and governed fields; total ft² reconciled. Selling prices and Revenue totals remain outstanding.

Inspect existing Plot Master, Revenue, Site Start, Package matrices, POs, CEs/variations, certificates and approvals before changing anything. Then exercise a realistic Package → PO → CE/VO → application/certificate → approval → ledger → CVR chain. Prioritise speed against Excel, clear QS ownership, authenticated actors, site-user read-only limits and the Commercial Director approval matrix.

## Retained investigations and governance

- **JB PO204:** not proven saved. Search all company formats and Archived before separately authorised tenant evidence. PO provenance, archived visibility, tombstones and non-reusable numbering remain open.
- **John Burke membership:** currently Active. Audit found invitation acceptance/activation only and no deactivation/reactivation event. Cause unresolved.
- **Optional Light/Dark mode:** requested as a per-user preference; dark remains default. Discovery only.
- Certificate financial columns need clear VAT, recovery, retention, Locked/Approved and payment-release semantics.
- Governed development retirement/archive remains absent. Do not direct-delete or falsely mark Complete.
- Audit obsolete hosted projects before deletion.
- **Wave C3 remains PAUSED.** C4/C5 remain queued.

## Conflicts and evidence limits

1. The 24 October Levison replacement proposal is superseded for immediate action by the successful DEV-002 milestone, but remains historical evidence and a general retirement requirement.
2. Exact live Render and Netlify SHAs were not captured after the latest hosted activity. Git push and successful download do not prove matched deployment.
3. The £648.70 Sage source/import difference and £0.19 movement-attribution difference remain unresolved. Neither authorises a ledger or forecast rewrite.
4. The supplied update says the two zero-net Cost Code 4000 rows were resolved. This sync records that evidence but performed no hosted verification.

## Restart instruction

Use this 28 October handover with its 24 October predecessor. Levison Poplar Road retrospective onboarding/reporting is delivered to Matt, but P01 remains Draft and provisional. Resume Valhalla Welford Road Revenue reconciliation and end-to-end commercial UAT. Keep JB PO204 and membership investigations open. Wave C3 remains paused. Verify existing functionality first, keep the Improvement Register current and prioritise a capable QS being faster than Excel.
