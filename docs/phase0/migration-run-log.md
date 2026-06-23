# Phase 0 Migration Run Log

Record each migration apply event. Do not store credentials or full DATABASE_URL here.

---

## Pre-flight (P0-0)

| Item | Date | Operator | Location / notes |
|------|------|----------|------------------|
| pg_dump backup | | | |
| Doc 20 §8 verification saved | | | `docs/phase0/pre-migration-counts.txt` |
| Git tag `pre-phase0-baseline` | | | |

---

## Staging

| Step | Date | Operator | Result |
|------|------|----------|--------|
| Apply `001_baseline.sql` | | | |
| Apply `002_tenant_keys.sql` (or DEFER — reason) | | | |
| Run `npm run seed` | | | |
| Post-migration counts | | | `docs/phase0/post-migration-counts.txt` |
| API tests T8–T19 | | | Pass / Fail |
| Frontend tests T20–T24 | | | Pass / Fail |
| Fresh DB bootstrap T25–T27 | | | Pass / Fail |

---

## Production

| Step | Date | Operator | Result |
|------|------|----------|--------|
| Maintenance window start | | | |
| Apply `001_baseline.sql` | | | |
| Apply `002_tenant_keys.sql` (or DEFER) | | | |
| Run `npm run seed` | | | |
| Post-migration counts | | | |
| API smoke T28–T30 | | | |
| Frontend smoke T31 | | | |
| Sign-off (Phase 0 complete) | | | |

---

## Incidents / rollback

| Date | Issue | Action taken |
|------|-------|--------------|
| | | |

---

## 002 deferral (if applicable)

If Doc 20 §8.7 or §8.8 returned rows:

- **Reason:**
- **Remediation plan:**
- **Target date to re-check:**
