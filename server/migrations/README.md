# BuildLite database migrations

Phase 0 introduces versioned SQL migrations. **Do not edit a migration file after it has been applied to production.**

## Order

| File | Purpose |
|------|---------|
| `001_baseline.sql` | Phase 0 additive baseline (frozen) |
| `002_tenant_keys.sql` | Tenant-scoped unique indexes + `jobs.client_id` — **run only after collision checks** (frozen) |
| `003_reconcile_production.sql` | BL-006: align schema with Render production (additive only) |
| `004_developments.sql` | BL-027A: developments (Doc 67) |
| `005_packages.sql` | BL-027B: packages + package_purchase_orders (Doc 67) |
| `006_commercial_events.sql` | BL-028A: commercial_events + commercial_event_audit (Doc 67) |
| `007_package_order_matrices.sql` | BL-029: package_order_matrices schema/API; client server-authority cutover in BL-029D |
| `008_package_payment_certificates.sql` | BL-030A: V1 package_payment_certificates + audit (does not alter legacy payment_certificates); client server-authority cutover in BL-030C |
| `009_cvr_and_purchase_ledger.sql` | BL-031A: CVR periods + QS cost-code inputs + purchase ledger batches/transactions (server foundation only; no snapshots) |
| `010_cvr_period_snapshots.sql` | BL-031E.1: `cvr_period_snapshots` + `cvr_period_snapshot_rows` (additive; no backfill). BL-031E.3 persists snapshots atomically on Approve & Lock. BL-031E Test Site 1 UAT passed. |
| `011_development_revenue_settings.sql` | BL-032A: `development_revenue_settings` (additive). COMPLETE. Default recognition policy `completion`. Applied on local `buildlite_clone`. Test Site 1 authority-on UAT **PASSED**. |
| `012_cvr_period_snapshot_revenue.sql` | BL-032D: whole-CVR Revenue snapshot columns + `cvr_period_snapshot_plots` (additive; no default £0; no v1 backfill). COMPLETE. Applied on `buildlite_test` and local `buildlite_clone`. Test Site 1 P03 lock/freeze UAT **PASSED**. |
| `013_cost_code_classifications.sql` | BL-033B: tenant-level `cost_code_classifications` (additive; no backfill). COMPLETE. Unmapped = UNCLASSIFIED + STANDARD_CVR (no row). Applied on `buildlite_test` and local `buildlite_clone`. Test Site 1 classification UAT **PASSED** (`5231` → PRELIMS + STANDARD_CVR; CVR money unchanged). |
| `014_development_programme.sql` | BL-033C: typed `development_programme` (additive; no payload backfill). COMPLETE. Applied on `buildlite_test` and local `buildlite_clone`. Test Site 1 programme UAT **PASSED**. Does not alter CVR periods, snapshots, or `013`. **BL-033C.1 COMPLETE** (no new migration): Create Next reporting-month picker; Test Site 1 P04 Draft `reporting_month` **2026-08**. |
| `015_development_prelims_items.sql` | BL-033D.1: `development_prelims_items` TIME / LUMP_SUM proposal lines (additive; no calculated-money columns). COMPLETE. Applied on `buildlite_test` and local `buildlite_clone`. Test Site 1 Prelims UAT **PASSED**. Does not alter CVR, snapshots, programme, or classification. |
| `016_client_prelims_templates.sql` | BL-033D.x.1: tenant-owned company Prelims templates + lines (additive). COMPLETE. Applied on `buildlite_test` and local `buildlite_clone`. Company-template UAT **PASSED**. **BL-033D.x.2 COMPLETE** (no 018): tailoring + canonical cost-code mapping against the shared server master. Mapping UAT **PASSED** (26 lines / 2 mapped to `5231`). Does not alter CVR, snapshots, programme, classification, Cost Code Master hierarchy, or `development_prelims_items`. BuildLite Standard is a product-owned application definition, not tenant rows. Multiple template lines may map to the same customer cost code (no unique on `cost_code_key`). |
| `017_cost_codes_tenant_master.sql` | BL-033D.x.2A.3 COMPLETE: additive Admin-master columns on existing `cost_codes`. Unique `(client_id, lower(btrim(code)))`. Applied on `buildlite_test` by tests and on local `buildlite_clone` by the controlled cutover. Test Site 1: 98 rows / 98 active / 0 collisions. Flag-ON Admin UAT **PASSED**. Repo default remains OFF. |
| `018_development_prelims_item_provenance.sql` | BL-033D.x.3 COMPLETE: nullable template provenance on `development_prelims_items` + partial unique `(development_id, source_template_id, source_template_key)`. No unique on `cost_code_key`. Applied on `buildlite_test` and local `buildlite_clone`. Test Site 1 setup UAT **PASSED**. Existing D.1 manual rows stay NULL; fourth template-instantiated row has provenance. |
| `022_cvr_snapshot_expected_liability.sql` | BL-038E: nullable snapshot-header/row CE Expected Liability plus nullable row provenance. New locks use schema v3; pre-v3 snapshots remain NULL/unavailable rather than receiving fake £0. Applied by automated tests to `buildlite_test`; not applied to `buildlite_clone` pending controlled human UAT. |

| `023_variation_orders.sql` | Variation Order foundation: tenant/package-scoped headers and atomic numbering, signed multi-code lines, explicit Commercial Event provenance/allocation links, corrective relationships, and audit. Additive only; no backfill and no monetary-engine integration. |
| `024_variation_order_normal_source.sql` | One-CE-to-one-normal-VO concurrency guard for the initial user workflow. Nullable normal-source CE identity; corrective/future allocated links remain supported separately. No monetary integration or backfill. |
| `025_variation_order_line_ce_allocations.sql` | Explicit CE-to-VO-line signed allocation provenance. Multi-line Issue requires complete reconciled allocations; unambiguous single-line VO allocation remains compatible. Additive only; no backfill. |
| `026_subcontract_payment_applications.sql` | Revisioned subcontract payment applications linked to Draft certificates; immutable submitted/locked comparison snapshots. |
| `027_subcontract_terms_foundation.sql` | Tenant-owned versioned subcontract terms, defaults, PO overrides, immutable approval-time bindings and append-only audit. Additive only; no backfill. |
| `028_payment_certificate_deadline_snapshots.sql` | Certificate contractual valuation date and immutable submitted/locked payment timetable snapshots. Additive only; no backfill. |
| `029_payment_notice_authority.sql` | Payment Notice / Pay Less identities, immutable Prepared/Issued snapshots, audit and versioned intended-payment decisions. Additive only; no backfill. |

## Before applying to production

1. Take a `pg_dump` backup.
2. Run Doc 20 §8 verification SQL and save results.
3. Apply on **staging** first.
4. For `002_tenant_keys.sql`: confirm queries 8.7 and 8.8 return **zero rows** before applying.
5. Apply `003_reconcile_production.sql` after `001` and `002` (or after `001` if `002` was deferred).

## Commands

From `server/`:

```bash
npm run migrate
npm run seed
```

## Tracking

Applied files are recorded in `schema_migrations`.

## Rollback

There are no automatic down migrations. Restore from backup if needed (see `docs/phase0/migration-run-log.md`).
# 026 — Subcontract payment applications

`026_subcontract_payment_applications.sql` adds tenant/package-scoped subcontractor application source facts and immutable revision/audit provenance. It does not backfill certificates, alter certificate money, calculate notices, or create payment terms.
### 029_payment_notice_authority.sql

Additive Payment Notice / Pay Less authority foundation: stable notice identities, immutable Prepared/Issued snapshots, append-only lifecycle audit, and versioned intended-payment decisions. No backfill and no automatic notice creation or Issue.
### 030 — Commercial documents

`030_commercial_documents.sql` adds the generic tenant-scoped document envelope, frozen render/recipient payloads, PostgreSQL `BYTEA` PDF storage, SHA-256 evidence, generation/issue audit and database immutability protection. It performs no backfill and creates no document rows.
