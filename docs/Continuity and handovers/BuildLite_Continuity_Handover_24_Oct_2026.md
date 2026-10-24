# BuildLite Continuity Handover — 24 October 2026

## Authoritative checkpoint

This is the canonical repository handover for the 24 October checkpoint. It reconciles the continuity backup with repository history and documented Product Owner deployment evidence. It does not replace earlier handovers, rollback records, `CURRENT_STATE.md`, the Product Constitution or the Technical Operations Manual.

**Wave C3 Action Safety is PAUSED. Its discovery prompt has not been sent.** Do not silently begin C3, C4, C5 or another product slice.

## Commercial authority retained

- Immutable Land Purchase Appraisal → fixed approved Site Start Budget → P01 → P02 → P03 and later monthly CVRs. There is no rolling Current Budget and no P00.
- P01 movement is from Site Start; later movements compare with the preceding Locked monthly CVR, including across skipped calendar months.
- System Forecast is fact-based. Final Forecast = System Forecast + CE Expected Liability + Commercial Adjustment.
- An eligible Submitted contract-value CE defaults to its full submitted value as Expected. Override, Hold and Exclude are auditable QS judgements. Never rewrite the CE fact.
- Plot Master GIA and Revenue NIA are distinct. Locked £/ft² uses frozen GIA evidence where migration-069 evidence exists; legacy Locked periods remain unavailable rather than falling back to live Plot Master.
- Client Cost Code Masters and Commercial Heads are client-owned authorities. Never impose Test Site 1 codes on another tenant. Hawthorn Gardens remains protected known-answer UAT evidence.
- Locked snapshots, settled Prelims/Selling Costs replacement adjustments and other immutable commercial evidence are not rewritten for convenience.

## Current Git and deployment evidence

| Scope | Confirmed state | Evidence limit |
|---|---|---|
| Git `buildlite-V1-1` | `de3331a92d2f0895fcb71444512cf4f02b913469` pushed on 23 October 2026 | Reverify before any operation |
| Main frontend/API | Last confirmed matched release `a1a947c` | Do **not** infer `de3331a` is deployed |
| Main database | `buildlite_pilot`, PostgreSQL 18, migration frontier `069` | Last confirmed operational evidence |
| JB Homes frontend/API | Confirmed matched release `de3331a` | Certificate Register observed working with 10 records |
| JB Homes database | `buildlite_demo_jb_homes`, PostgreSQL 18, migration frontier `069` | Last confirmed operational evidence |

Main is `app.buildlite.co.uk` / Netlify `buildlite-pilot` / Render `buildlite-pilot-api`. JB Homes is `demo.buildlite.co.uk` / Netlify `buildlite-demo-jb` / Render `buildlite-demo-jb-api`.

The JB deployment mismatch is resolved. An unintended Git-triggered JB frontend publication moved the frontend ahead of the API at `71c103f`, causing `GET /api/certificates` 404. Deploying the matching API at `de3331a` restored parity. JB Netlify builds were then manually stopped. Main Netlify auto-publishing is locked; Main Render auto-deploy was confirmed off at the checkpoint. Verify controls in provider dashboards before every future release.

## Completed release content

- Wave C1 Commercial Readiness (`464b321`): Site Start-backed chains show factual budget authority and readiness without the misleading separate Development Budget warning.
- Wave C2 company-wide Certificate Register (`635b1b8`): tenant-scoped register, filtering, pagination and canonical certificate navigation.
- Safe Plot Master bulk update (`a1a947c`): identity-matched structural correction with Submitted-period server guard and preservation of governed commercial fields.
- Land Appraisal import/capture (`de3331a`): headerless first-row retention, worksheet/header choice, offset-range coordinates, Cost Code display identity, raw Excel money precision, ambiguity/excluded-row warnings, explicit reconciliation and mandatory server-side reviewed-v2 fingerprint/count/total evidence. Existing v1 appraisals remain readable. No migration.

## Immediate pilot queue

### JB Homes PO204 — outstanding

John Burke believes he created PO204; persistence has not been proved. Search the company-wide PO register with filters cleared, include Archived, and try the likely displayed forms (`PO204`, `PO-0204`, `M0204`, `S0204`, `P0204`). A successful create allocates a type-prefixed number; unsuccessful attempts normally do not. A never-submitted Draft can be deleted without a tombstone and its number can later be reused under the present `MAX+1` pattern. Persisted records carry `createdBy`, `createdAt` and history, but the register does not expose enough provenance and the Archive path may omit archived records. Hosted database inspection requires separate authorisation.

### John Burke membership discrepancy — unresolved

The Product Owner restored John through Administration → Users → Inactive → Active. This establishes a BuildLite tenant-membership symptom, not a Clerk lock. The completed guarded read-only audit found only invitation acceptance and membership activation at 2026-10-21 09:09:35 UTC, attributed to John via `invitation.accept`; it found no `membership_deactivated`, `membership_reactivated`, surrounding admin event or nearby migration. John is currently Active with Commercial Director access. Normal code has no inactivity-based automatic deactivation. The cause remains unresolved because the audit contains no event explaining the UI state.

### Optional per-user light/dark theme

John found the dark background and green text retro; the Product Owner wishes to retain the dark identity. The agreed product question is an optional per-user Dark/Light preference. Discovery must cover CSS variables, remaining hard-coded colours, contrast, charts, tables, printable content and preference persistence. No implementation has begun.

### Levison Rose appraisal recovery

A headerless appraisal omitted the first financial line (approximately £60k land cost). A Site Start Projected Adjustment temporarily compensated for it, but that is not genuine movement evidence. The appraisal is immutable. Before recovery, verify whether Site Start is Draft, Submitted or Locked and inspect all monthly CVRs, POs, certificates, CEs, ledger, Plot Master and Revenue dependencies. Retain the original development as clearly superseded; do not direct-delete it or falsely mark it Complete. After matched `de3331a` application tiers are available, create a replacement development from the fully reconciled source and omit the artificial adjustment. No monthly Locked CVRs were reported, but Site Start status remains unverified.

### Valhalla Homes — Welford Road

The 75-plot update matched 75/75 plots and corrected 65. Stable IDs, tenure and commercial fields were preserved. Product Owner checks confirmed total ft² reconciles to Excel and House Type areas look correct. Selling values and Revenue total still require entry and reconciliation. Repeated compatibility-derived NIA warnings are valid but should be consolidated without weakening the GIA/NIA distinction.

### Excel importer standardisation

The long-term QS experience is one multi-sheet workbook with explicit worksheet choice for each import. Land Appraisal, Plot Master, Sales Register and Order Matrix already discover sheets. Cost Code Master and CVR Budget remain first-sheet only; Plot Master and Sales Register lack explicit headerless operation. Standardise worksheet/header choice, mapping, preview, row counts, financial totals, exclusions and safe validation while retaining module permissions, immutable capture rules and client-owned Cost Codes.

## Other recorded follow-up

- Certificate Register values require clearer VAT/recovery semantics; Locked/Approved must not be presented as Paid or Accounts Released.
- Administration should distinguish Clerk identity, invitation state and tenant membership, and expose actor/reason/time where audit evidence exists.
- A governed development retirement/archive workflow is absent; direct SQL deletion and false Complete status are not acceptable substitutes.
- Obsolete Netlify/Render services must be audited for domains, billing, dependencies and rollback value before deletion.
- Replace fragile one-off hosted-audit scripts with a maintained guarded procedure tested end-to-end against disposable PostgreSQL 18/TLS fixtures.

## Restart instruction

Use this 24 October handover as the latest continuity checkpoint. Keep Wave C3 paused. Continue the PO204 investigation, retain the unresolved membership discrepancy, optional light theme, Levison recovery, Valhalla Revenue work and importer standardisation. Never assume `de3331a` is live on Main without deployment evidence.
