# BuildLite Technical Operations & Handover Manual

| Item | Value |
|---|---|
| Version | 1.1 |
| Date | 18 October 2026 |
| Repository | GitHub `David-morris266/buildlite-po` (historic name `dmcc-cvr-system`) |
| Branch | `buildlite-V1-1` |
| Repository state documented | HEAD `f959d6aea53502d316889bdbc09ffcb3d8f70e3e` ("Enforce CVR action authority and authenticated audit attribution"). Pushed: `origin/buildlite-V1-1` = `f959d6a` [V]. Deployed to the JB Homes API; **not** deployed to the Owner-UAT API (§12) [O] |
| Migration frontier in repository | `068_site_start_budget_submission_boundary.sql` |
| Audience | Product Owner; a software engineer taking over BuildLite |
| Owner | Product Owner (David Morris) |

> **Status of this edition.** The source code facts are checked against the repository. Facts about live hosting (service names, dashboard settings, backup policy, deployed commits) were not available from the repository; they appear as **VERIFY** items in §15. Do not treat any VERIFY item as true until someone has confirmed it from the hosting dashboard and recorded it in the maintenance log (§16).

---

## Contents

0. [How to read this manual](#0-how-to-read-this-manual)
1. [System architecture](#1-system-architecture)
2. [Repository structure and development workflow](#2-repository-structure-and-development-workflow)
3. [Hosted infrastructure inventory](#3-hosted-infrastructure-inventory)
4. [Environment separation](#4-environment-separation)
5. [Tenant provisioning and company administration](#5-tenant-provisioning-and-company-administration)
6. [Authentication, RBAC and audit authority](#6-authentication-rbac-and-audit-authority)
7. [Database: migrations, backups, restore and recovery](#7-database-migrations-backups-restore-and-recovery)
8. [Build, test, deployment and rollback](#8-build-test-deployment-and-rollback)
9. [Frontend server-authority configuration](#9-frontend-server-authority-configuration)
10. [Troubleshooting and incident response](#10-troubleshooting-and-incident-response)
11. [Security and operational limitations](#11-security-and-operational-limitations)
12. [Current deployment / release matrix](#12-current-deployment--release-matrix)
13. [Customer onboarding runbook](#13-customer-onboarding-runbook)
14. [Dangerous operations and historical tools](#14-dangerous-operations-and-historical-tools)
15. [Outstanding verification items](#15-outstanding-verification-items)
16. [Maintenance procedure and log](#16-maintenance-procedure-and-log)
17. [Source references](#17-source-references)

---

## 0. How to read this manual

### 0.1 Evidence labels

| Label | Meaning |
|---|---|
| **[V]** | Verified in repository source, migrations, tests or configuration templates at the HEAD above |
| **[O]** | Operational evidence reported by the Product Owner or recorded in `CURRENT_STATE.md`. It was not checked against a hosting dashboard for this edition |
| **[I]** | Inferred from the code. Likely, but not proven |
| **[VERIFY]** | Unknown live configuration. Must be confirmed before anyone relies on it (see §15) |

### 0.2 Authority documents

This manual covers technical operations. It does not replace these documents:

| Document | Authority for |
|---|---|
| `AGENTS.md` | Operating boundaries for any human or AI working in the repo |
| `docs/PRODUCT_CONSTITUTION.md` | Product intent, settled decisions and the deferred register |
| `CURRENT_STATE.md` | Implementation and UAT status log. The newest entries are at the top |
| `docs/DATABASE.md` | Persistence boundary and per-table history |

Where this manual and those documents disagree on an **operational** procedure, this manual is the more recent source. Raise the conflict so the older document can be corrected.

### 0.3 Historical documents with outdated operational instructions

Do **not** follow the operational parts of these documents. They describe earlier implementations [V]:

| Document | Outdated statement | Current behaviour |
|---|---|---|
| `README.md` "Local development", "Render deploy" | Run `npm run seed`; "authentication not included"; `/health` checks tables | Never seed hosted or pilot databases (§14). Clerk + RBAC authentication is live (§6). `/health` checks the migration ledger (§10.2) |
| `docs/DATABASE.md` "Deploy runbook" / "Overview" | Run `migrate` **and** `seed` on Render; migrations `001`–`014` | Migrate only; the frontier is `068` |
| `server/migrations/README.md` | Lists `npm run seed`; its ordering table is out of sequence and leaves out several files | Use the `server/migrations/` directory listing itself |
| `docs/phase0/migration-run-log.md` | Empty template with seed steps | Historical only |
| `docs/PRODUCT_CONSTITUTION.md` §5 auth row | "Mock localStorage identity; one global active client; unauthenticated API" | Clerk identity, membership tenancy, authenticated API |
| `client/README.md` | Vite template boilerplate | Ignore |
| Body of `CURRENT_STATE.md`, `PROJECT_SPINE.md`, `docs/DATABASE.md` header | "NEXT: Bank BL-038E" | Superseded by the GP-PILOT entries at the top of `CURRENT_STATE.md` |

---

## 1. System architecture

### 1.1 Components [V]

```
Browser (React SPA)
  │  Clerk session (sign-in / sign-up / invitations)
  │  fetch → Authorization: Bearer <Clerk JWT>, X-BuildLite-Client-Id: <tenant uuid>
  ▼
Netlify (static hosting of client/dist, SPA fallback)
  │
  ▼  HTTPS, CORS allowlist
Render web service: Node/Express API (server/)
  │  Clerk middleware → BuildLite principal (Postgres membership/RBAC)
  │  Route guard → service guard → repository
  │  Puppeteer/Chrome for PDFs; sharp for logos
  ▼
PostgreSQL 18 (Render-managed)
  • all commercial authority, audit, immutable evidence
  • generated certificates/notices and tenant logos stored as BYTEA
```

| Component | Technology | Location | Notes |
|---|---|---|---|
| Frontend | React 19, Vite 7, `@clerk/react`, axios, exceljs/xlsx | `client/` | Build-time configuration only (`VITE_*`) |
| API | Node (22.17.0 configured on Render [O]), Express 4.22, CommonJS, `pg`, zod, Handlebars, Puppeteer 25, sharp | `server/` | Entry point `server/server.js` |
| Database | PostgreSQL (major version 18 hosted [O]; 18.6 locally [O]) | Render / local | 68 SQL migrations |
| Identity | Clerk (`@clerk/express` on the server) | Clerk SaaS | Clerk proves who the user is; BuildLite decides what they can do |
| Email | None of its own. Clerk sends invitation emails | — | nodemailer/SMTP removed in GP-PILOT-03 [O] |
| Object storage | None | — | `tenant_brand_assets.storage_provider='object'` exists in the schema but is not implemented |

### 1.2 Request lifecycle [V]

1. **Sign-in.** `client/src/auth/BuildLiteAuthProvider.jsx` wraps the app in `ClerkProvider`. If `VITE_CLERK_PUBLISHABLE_KEY` is missing, the app shows "BuildLite authentication is not configured" and does not load. There is no mock login.
2. **API call.** `client/src/auth/authenticatedFetch.js` patches `fetch` for URLs under `VITE_API_URL`. It adds the Clerk bearer token and `X-BuildLite-Client-Id`, taken from `localStorage.buildlite_active_client_id`.
3. **CORS.** `server/app.js` allows only the origins listed in `CORS_ALLOWED_ORIGINS`. Outside production it also allows `localhost:5173` and `127.0.0.1:5173`.
4. **Authentication.** `clerkMiddleware()` runs, then `server/auth/authMiddleware.js`, then `resolveBuildLitePrincipal` in `server/auth/authorization.js`:
   - the Clerk user must map to an **active** `buildlite_users` row;
   - the user must have an **active membership** of the requested tenant;
   - with several memberships and no tenant selected, the API returns 409 `TENANT_SELECTION_REQUIRED`.
5. **Context.** The principal is stored on `req.buildliteAuth` and in AsyncLocalStorage (`server/auth/requestContext.js`). `getActiveClient()` returns the membership tenant (`server/services/activeClient.js`). Outside test mode, the legacy global `clients.is_active` lookup throws.
6. **Authorisation.** Route middleware (`requirePermission`, `requireResolvedPermission`, …) runs, followed by service-layer `assertServicePermission`. Each successful route-level grant is written to `authorization_action_audit`.
7. **Persistence.** Repositories write inside Postgres transactions. Audit and evidence tables are append-only, enforced by triggers (§7.6).

### 1.3 Authority model

- **Postgres is the source of commercial truth** for:
  - developments and packages
  - Commercial Events (CEs) and Variation Orders
  - order matrices, applications, certificates and notices
  - payment authority and payment release
  - CVR periods, inputs and snapshots
  - ledger
  - Cost Code Master, Commercial Structure (server-side), Prelims and Selling Costs
  - Development Budget, Land Appraisal and Site Start
  - tenants, memberships and branding
- **Some browser-local data remains** (`buildlite_*` localStorage keys). This includes certain administration and setup drafts, and legacy data used when an authority flag is OFF (§9). Browser-local data is never shared between users and is lost when browser storage is cleared.
- **Product invariants that affect engineering** (from `AGENTS.md`):
  - Facts are recorded once and never rewritten to express QS judgement.
  - Final Forecast = System Forecast + CE Expected Liability + Commercial Adjustment.
  - Client cost codes belong to the client.
  - Locked CVR snapshots are immutable history.
  - Hawthorn Gardens is protected UAT data.

---

## 2. Repository structure and development workflow

### 2.1 Layout [V]

| Path | Purpose |
|---|---|
| `client/` | React/Vite frontend. `src/` holds domain modules (`cvr/`, `payments/`, `admin/`, `auth/`, `revenue/`, `ledger/`, …); `public/_redirects` is the SPA fallback |
| `server/server.js` | Process entry point: production configuration check → `db.init()` → listen |
| `server/app.js` | Express app factory: CORS, authentication, route mounts, error masking, `/health` |
| `server/auth/` | Clerk adapter, principal resolution, permission keys, route permission manifest |
| `server/routes/` | HTTP routers, one per domain |
| `server/services/` | Domain services and repositories (CVR close engine, snapshots, certificates, etc.) |
| `server/migrations/` | Ordered SQL migrations `001`–`068` |
| `server/scripts/` | Supported scripts (`migrate.js`, `ensure-test-database.js`, `rehearse-*`), legacy scripts (`seed.js`, `reset-dev-data.js`) and many one-off `_*` forensic/UAT scripts (§14) |
| `server/test/` | 141 node:test integration/unit files |
| `server/utils/` | `productionConfig.js`, `env.js`, `testDatabaseGuard.js`, `databaseUrl.js` |
| `docs/` | Governance docs, runbooks, UAT registers, sample/test data |
| `docs/test-data/` | UAT spreadsheets. Some contain client material: do not publish or commit new material without approval |

### 2.2 Local prerequisites

- Node 22.x (Render is configured with 22.17.0 [O]).
- PostgreSQL 18 locally [O].
- Chrome for Puppeteer, installed automatically by `npm install` in `server/` via `postinstall` [V].
- A Clerk **development** instance for local sign-in [I]. Its keys are for local use only.

### 2.3 Local setup runbook

1. Copy `server/.env.example` to `server/.env`. Set:
   - `DATABASE_URL` to your local development database (for example `buildlite_clone`);
   - `DATABASE_SSL=false`;
   - `NODE_ENV=development`;
   - the Clerk development keys.

   Never commit `.env`.
2. Copy `server/.env.test.local.example` to `server/.env.test.local`. Set `TEST_DATABASE_URL` to a **separate** local database named `buildlite_test`.
3. Copy `client/.env.example` to `client/.env.local`. Set:
   - `VITE_API_URL=http://localhost:3001`;
   - `VITE_CLERK_PUBLISHABLE_KEY` (development key);
   - the authority flags you need (§9).
4. In `server/`:
   1. `npm install`
   2. `npm run test:ensure-db` (creates or initialises `buildlite_test` only)
   3. `npm run dev`
5. In `client/`: `npm install`, then `npm run dev` (serves `http://localhost:5173`).

**Rules** (`AGENTS.md`, `docs/DATABASE.md`):
- `buildlite_clone` is **SELECT-only** unless a human explicitly approves a controlled write.
- Automated tests never target `buildlite_clone`.
- Do not run `migrate` against `buildlite_clone` without approval.

### 2.4 Development workflow (current practice) [O]

- All work happens on `buildlite-V1-1`. `main` was last committed in February 2026, is 236 commits behind `f959d6a`, and is **not** the release branch [V].
- Work is organised into named "slices" (for example `GP-PILOT-09A`). Each slice moves through these stages:
  1. read-only preflight
  2. implementation
  3. focused tests
  4. independent review
  5. human UAT where needed
  6. controlled commit ("bank") with explicit approval
  7. push and deploy, each with separate explicit approval
- Never stage unrelated dirty files, UAT material, forensic scripts, build output or env files (`AGENTS.md`).
- There are **no git tags** and **no CI** (`.github/` is absent) [V]. Deployments are tracked only by commit SHAs recorded in `CURRENT_STATE.md`.

---

## 3. Hosted infrastructure inventory

> No hosting-as-code files exist in the repository: no `netlify.toml`, `render.yaml`, Dockerfile or Procfile [V]. **All service settings live in the provider dashboards** and must be recorded in §15 once verified.

| Service | Role | Repository evidence | Live configuration |
|---|---|---|---|
| **GitHub** | Source control. Remote `origin` = `github.com/David-morris266/buildlite-po` | [V] git remote | Branch protection, collaborators, and whether pushes trigger deploys: **VERIFY** |
| **Netlify** | Hosts the built SPA (`client/dist`) with `/* /index.html 200` fallback | [V] `client/public/_redirects`, `docs/HOSTED_PILOT_RUNBOOK.md` | Site names, base dir, build command, branch, `VITE_*` values, custom domains: **VERIFY** for each environment |
| **Render (web service)** | Runs the API: `npm start` in `server/` | [V] `server/package.json`; documented host `buildlite-po-api.onrender.com` (`README.md`, `client/.env.example`) | Service names, build/start commands, root dir, health-check path, env vars, auto-deploy branch: **VERIFY**. The documented host is historical and may or may not be Owner-UAT's current API |
| **Render PostgreSQL** | Commercial database. Major version 18 [O] | Historic name `buildlite_po_db` (`docs/DATABASE.md`, `README.md`) | Instance names, plan, backup/PITR policy, retention, region: **VERIFY**. Not documented anywhere |
| **Clerk** | Identity: sign-in, sign-up, invitations, verified email | [V] `@clerk/express`, `@clerk/react`, `authAdapters.js` | Instances per environment (dev/prod keys), allowed origins/redirects, sign-in methods, administrators: **VERIFY** |
| **Cloudflare** | **Not referenced anywhere in the repository** [V] | — | Role (DNS, proxy/WAF, registrar) and domains covered: **VERIFY** |

### 3.1 Required server environment variables [V `server/utils/productionConfig.js`]

When `NODE_ENV=production`, the API **refuses to start** unless all of the following hold.

**Must be set:**

| Variable | Rule |
|---|---|
| `DATABASE_URL` | Required |
| `CLERK_SECRET_KEY` | Required; server-only |
| `CLERK_PUBLISHABLE_KEY` | Required; same Clerk instance as the frontend key |
| `BUILDLITE_APP_URL` | Required; canonical HTTPS frontend origin (no path). Used for invitation redirects |
| `CORS_ALLOWED_ORIGINS` | Required; comma-separated explicit HTTPS origins, no `*` |

**Must not be set:**

| Variable | Rule |
|---|---|
| `BUILDLITE_SERVER_TEST` | Must not be `1` |
| `TEST_DATABASE_URL` | Must be absent |
| `BUILDLITE_STRICT_SERVICE_AUTH` | Must not be `0` |

**Optional:**

| Variable | Rule |
|---|---|
| `DATABASE_SSL` | `true` or `false` (hosted Render normally `true`) |
| `BUILDLITE_PLATFORM_OPERATOR_IDS` | Comma-separated Clerk user IDs allowed to provision tenants. Without it, provisioning is impossible |
| `COST_CODE_IMPORT_REVIEW_SECRET` | Dedicated signing secret. Set it explicitly; otherwise it falls back to `CLERK_SECRET_KEY`, then to `DATABASE_URL` |
| `PORT` | Usually provided by Render |

`NODE_ENV=production` itself is essential. Several protections only apply when it is exactly `production` (§11).

### 3.2 Required frontend build variables [V]

`VITE_API_URL` and `VITE_CLERK_PUBLISHABLE_KEY` are required. The server-authority flags are listed in §9.

Never put a server secret in any `VITE_*` variable: Vite bakes these into public JavaScript.

---

## 4. Environment separation

### 4.1 Environment register

| Environment | Frontend | API | Database | Identity | Data | Writes allowed |
|---|---|---|---|---|---|---|
| **Local development / owner UAT clone** | Vite `localhost:5173` | `localhost:3001` | `buildlite_clone` (local) | Clerk dev instance [I] | Test Site 1, Hawthorn Gardens (protected), historic UAT evidence | SELECT-only unless a human explicitly approves |
| **Automated test** | — | in-process (supertest) | `buildlite_test` (local) | Test auth adapter | Disposable fixtures | Tests only. Guard requires the name `buildlite_test` and a URL different from `DATABASE_URL` [V] |
| **Blank-pilot rehearsal** | — | local, `NODE_ENV=production` | `buildlite_pilot_rehearsal_*` (local, empty) | — | None | Created and migrated by `npm run rehearse:blank-pilot` [V] |
| **Owner-UAT (hosted, "owner-only")** | Netlify **VERIFY** | Render **VERIFY** | Render Postgres 18 **VERIFY name** | Clerk **VERIFY instance** | Oakfield Rise (P01 Sep-2026 Draft) and Ashfield Rise (locked Site Start) [O] | Real application use by the owner. No scripts or manual SQL |
| **JB Homes demonstration (hosted)** | Dedicated Netlify site [O] | Dedicated Render API [O] | Dedicated Render Postgres [O] | Dedicated Clerk instance [O] | Synthetic JB Homes / mature Oak Meadow demonstration [O] | Demonstration use only. Never mix with customer or Owner-UAT data |
| **JB Homes local build databases** | — | — | `buildlite_demo_jb_homes`, `buildlite_demo_jb_homes_mature_rehearsal` (local) | Synthetic users not in Clerk | Synthetic | Historical build tools only (§14.3) |
| **Future pilot customer** | New Netlify site | New Render service | New Render Postgres | New Clerk production instance | Customer data | Under full release controls (§8). Isolation model is a product-owner decision (§15) |
| **Staging** | — | — | — | — | — | **Does not exist.** It is only mentioned in code comments |

### 4.2 Separation rules

1. **One database per hosted environment.** Each hosted API's `DATABASE_URL` must point only at its own database. Record database names and hosts (never credentials) in §12.
2. **One Clerk instance per hosted environment** where practical. Clerk user IDs are instance-specific, so `BUILDLITE_PLATFORM_OPERATOR_IDS` differs between environments.
3. **Frontend ↔ API pairing.** Each Netlify site's `VITE_API_URL` must name its own API. That API's `CORS_ALLOWED_ORIGINS` and `BUILDLITE_APP_URL` must name that site, and nothing else.
4. **Before any database operation, positively identify the database** using the SQL in §7.3. Never rely on an environment file you have not just inspected.
5. Demo and synthetic data never enter a customer database, and customer data never enters a demo.

---

## 5. Tenant provisioning and company administration

### 5.1 Concepts [V]

| Concept | Implementation |
|---|---|
| Tenant / company | `clients` row (UUID). Almost every table carries `client_id` |
| User | `buildlite_users` row linked to a Clerk user ID (`provider_user_id`) |
| Membership | `client_user_memberships`: user × tenant × role, plus `is_active` |
| Roles | `site`, `buyer`, `qs`, `commercial_manager`, `commercial_director`, `admin`, `finance` |
| Capabilities (per membership) | `company_administration` (grants `users.manage` + `roles.manage`); `finance_operations` (grants `payment_release.execute`) |
| Platform operator | A Clerk user ID listed in `BUILDLITE_PLATFORM_OPERATOR_IDS`. Gets the platform permission `platform.tenant_provision` |

### 5.2 Runbook: create the first platform operator (new environment)

1. In the environment's **Clerk** instance, create (or invite) the operator user. Verify the email address.
2. Copy that user's Clerk user ID. Set it in the Render variable `BUILDLITE_PLATFORM_OPERATOR_IDS` and redeploy the API.
3. The operator signs in. On first authenticated access, BuildLite creates one audited, **platform-only** identity (`platform_identity_bootstrap_audit`). It creates no tenant or membership.
4. The platform-only principal can reach only `/api/auth/me` and `/api/platform/*`. It cannot see any commercial data until a company is provisioned.

### 5.3 Runbook: provision a company

1. Operator: **Administration → Provision Company**. The card appears only for platform operators.
2. Enter:
   - company name;
   - company code: lowercase, starting with a letter, 3–50 characters from `a-z 0-9 _ -`;
   - initial user email: must be an **existing** active BuildLite user (normally the operator's own email);
   - role (default `commercial_director`).
3. Submit. `POST /api/platform/tenants` creates the following in **one transaction**, with an idempotency key:
   - the client (`is_active=false`; the legacy flag is not used);
   - a brand profile and company settings;
   - the membership, with the `company_administration` capability;
   - `tenant_provisioning_audit` and membership-authority audit rows.
4. Select the new company in the company selector.

**Break-glass recovery.** `POST /api/platform/tenants/:clientId/bootstrap-company-administrator` (platform permission plus a reason) restores an administrator to a company that has none. It has **no UI**: use it only under an approved incident.

### 5.4 Runbook: invite and manage users

1. A company administrator (`users.manage` + `roles.manage`) opens **Administration → Users → Invite**.
2. Choose the role and capabilities. Granting Commercial Director together with `finance_operations` requires a high-risk acknowledgement.
3. BuildLite creates:
   - a 7-day invitation (only a SHA-256 of the token is stored);
   - a Clerk invitation that redirects to `${BUILDLITE_APP_URL}/sign-up?membershipInvite=<token>`.

   Clerk sends the email.
4. The invitee signs up. Their **verified Clerk email must match** the invitation. Acceptance creates or reuses the BuildLite user and activates the membership.
5. Cancel an invitation from the same page. This also revokes the Clerk invitation.
6. Membership edits (role, capabilities, active) are audited. Two safeguards apply:
   - **you cannot edit your own membership**;
   - **the last active company administrator cannot be removed**.

**Implication for onboarding** [I]: if the operator provisioned the company with their own membership, the customer's administrator (not the operator) must later deactivate the operator's membership.

### 5.5 Company configuration

After provisioning, configure the company in this order (each screen is under Administration):

1. Company settings and logo (`company_settings.manage`). Logos: PNG/JPEG/WebP, at most 2 MB and 4096 px; stored in Postgres.
2. Commercial Structure: adopt the recommended template or build heads, families and groups.
3. Cost Code import: preview, then apply. Then the hierarchy worksheet and classification.
4. Prelims and Selling Costs company templates (optional).
5. Readiness check: **Administration → Company Readiness** (`GET /api/auth/readiness`). It requires all of the following:
   - settings exist;
   - at least one active head;
   - every active code is allocated or marked not applicable;
   - Preliminaries and Selling Costs discovery heads are present.

The full end-to-end customer procedure is in §13.

---

## 6. Authentication, RBAC and audit authority

### 6.1 Authentication [V]

- Clerk verifies identity. BuildLite Postgres owns membership and permissions.
- In non-test operation, the server adapter is `createClerkAuthAdapter()`. The **test adapter**, which grants an injected principal with no Clerk, is selected when `BUILDLITE_SERVER_TEST=1` or `NODE_ENV=test` (`server/app.js`). The production configuration check blocks `BUILDLITE_SERVER_TEST=1` only when `NODE_ENV=production`. **Hosted environments must therefore always set `NODE_ENV=production`.**
- Public endpoints:
  - `GET /health`;
  - `POST /api/membership-invitations/accept`, which uses its own verified-identity check.

  Everything else under `/api` requires authentication.

### 6.2 Permissions and roles [V `server/auth/permissions.js`, migrations 031–067]

There are about 60 permission keys. The CVR-relevant matrix after `f959d6a`:

| Action | Permission | qs | commercial_manager | commercial_director | site / buyer / admin / finance |
|---|---|---|---|---|---|
| Create, edit, inputs, budget import, add cost code, Prelims setup/items | `cvr.edit` | ✔ | ✔ | ✔ | ✘ |
| Development Budget / Prelims / Selling Costs adoption | `cvr.adopt` (adoption also adds members, which needs `cvr.edit`) | ✔ | ✔ | ✔ | ✘ |
| Submit monthly CVR | `cvr.submit` | ✔ | ✔ | ✔ | ✘ |
| Create / submit Site Start | `site_start.manage` | ✔ | ✔ | ✔ | ✘ |
| Reject CVR | `cvr.reject` | ✘ | ✔ | ✔ | ✘ |
| Approve & Lock; variation-exposure acknowledgement | `cvr.lock` | ✘ | ✔ | ✔ | ✘ |

Other domains (POs, CEs, VOs, certificates, notices, payment authority/release, terms, administration) use their own keys. The authoritative source is the `role_permissions` grants in the migrations.

**Note:** the `f959d6a` CVR guards are pushed and deployed to the JB Homes API [O]. The **Owner-UAT API runs `4382970`** [O], which is older than `f959d6a`. Owner-UAT therefore still has the earlier behaviour, in which several CVR write routes had no route-level guard and some audit actors came from the browser (§12).

### 6.3 Enforcement layers [V]

1. **Route guard.** `requirePermission(...)` returns 403 `Permission required: <key>` before any domain code runs.
2. **Service guard.** `assertServicePermission(auth, ...)` protects direct service calls. It is relaxed only in test mode when `BUILDLITE_STRICT_SERVICE_AUTH !== '1'`.
3. **Database constraints and triggers** protect immutable evidence (§7.6).
4. `server/auth/routePermissionManifest.js` documents the critical routes. It is **advisory**: tests check it for coverage, but nothing enforces it at runtime.

### 6.4 Audit evidence [V]

| Evidence | Table(s) |
|---|---|
| Every successful route-level authorisation | `authorization_action_audit` (user, membership, role, permission, method, path, params) |
| Identity and tenancy | `platform_identity_bootstrap_audit`, `tenant_provisioning_audit`, `tenant_membership_authority_audit`, `tenant_branding_audit` |
| Commercial workflow | `cvr_period_audit`, `commercial_event_audit`, `variation_order_audit`, certificate/notice/application/VA/payment authority/release/terms/ledger/cost-code audits |
| Actor attribution | Since `f959d6a`, CVR and Development Prelims actors come from the authenticated `display_name`; browser-supplied `actor` fields are ignored |

**Gaps:**
- Denied attempts (401/403) and sign-in/sign-out are not recorded in BuildLite. Clerk keeps its own sign-in logs [VERIFY retention].
- `server/routes/developmentRoutes.js` still uses `provisionalActor(body)` for some development writes [V].

---

## 7. Database: migrations, backups, restore and recovery

### 7.1 Schema management [V]

- **Migrations:** `server/migrations/001_…sql` to `068_…sql`, applied in filename order by `npm run migrate` (`server/scripts/migrate.js`).
- **Tracking:** the table `schema_migrations(filename UNIQUE, applied_at)`. Each file runs in its own transaction, with its ledger row inserted in the same transaction. If a file fails, it is rolled back and the run stops; files already applied stay applied.
- **Runner limitations:**
  - no database-name guard;
  - no lock against two concurrent runners;
  - no checksum (an edited file is not detected);
  - no dry-run;
  - no down migrations.

  Never edit a migration that has been applied anywhere.
- **`db.init()`** runs on every API start and creates the earliest tables with `IF NOT EXISTS`. It is a legacy fallback. It is **not** a substitute for `migrate` and does not write `schema_migrations`.
- **`/health` readiness** compares `schema_migrations` with the migration files in the deployed code. If any file is missing from the ledger, it returns 503 `migration_behind`.

### 7.2 Runbook: apply migrations to a hosted database

**Preconditions:**
- **separate, explicit Product Owner approval for the schema change.** Approval to deploy code is not approval to migrate (§8.4);
- a backup taken **today** and verified to at least **assurance level 2** (§7.4.1).

1. Check out the **exact release commit** in a clean working tree. The migration set is defined by that commit, not by the current branch head or your local folder.
2. Set `DATABASE_URL` for this one shell session. Never write production credentials to `server/.env`.
3. **Identify the target** (§7.3) and confirm it is the intended environment.
4. **Compare the release commit's migrations with the target ledger, and stop on anything unexpected:**
   1. Commit migrations: `git ls-tree --name-only <release-sha> server/migrations/ | grep '\.sql$'`.
   2. Database ledger: `SELECT filename FROM schema_migrations ORDER BY filename;`.
   3. Classify every difference:
      - **Missing from the ledger, expected in this release:** these are the migrations this release applies. List them.
      - **Missing from the ledger, not expected:** a file older than the newest applied migration, or one that belongs to an earlier release. **Stop.** The environment has drifted; investigate before going further.
      - **In the ledger but not in the commit:** the database is ahead of this code. **Stop.** You are probably deploying an older commit than the environment last ran (see §8.6).
5. Record the before state: `SELECT count(*), max(filename) FROM schema_migrations;`.
6. Review each migration to be applied for destructive or data-changing statements (`DROP`, `ALTER … DROP`, `UPDATE`, `DELETE`, trigger changes).
7. From `server/`, run `npm run migrate`. Only one operator may run it at a time.
8. Record the after state. The ledger must now contain **exactly** the release commit's migration files, and `max(filename)` must equal the commit's newest file.
9. Unset `DATABASE_URL`.
10. Deploy the matching API (§8.5) and confirm `/health` reports `ready` with the expected `requiredFrontier`.

**If a migration fails part-way:** stop. Do not retry blindly. Earlier files are committed. Decide whether to fix forward or to restore (§7.5).

### 7.3 Database identity check (run before every operation)

```sql
SELECT current_database()                  AS database,
       inet_server_addr()                  AS server_address,
       inet_server_port()                  AS server_port,
       current_setting('server_version')   AS server_version,
       current_setting('TimeZone')         AS session_timezone,
       (SELECT count(*) FROM schema_migrations)     AS migrations_applied,
       (SELECT max(filename) FROM schema_migrations) AS frontier,
       (SELECT count(*) FROM clients)              AS tenants;
```

Compare each value with the environment register (§12). **Stop if any value is unexpected.** Never print or paste the connection string.

### 7.4 Backups

**Live backup configuration is unknown — VERIFY (§15).** The repository has no backup automation, and no restore has been recorded for Owner-UAT. Until this is resolved:

1. **Provider backups.** Confirm in the Render dashboard, for each database, whether automatic backups and point-in-time recovery are enabled, plus their frequency, retention, and how a restore is performed. Record the answers in §12.
2. **Manual logical backup** (before every migration, risky release or data operation):
   ```bash
   pg_dump --format=custom --no-owner --no-acl --file "<env>_<YYYYMMDD-HHMM>_<api-sha>.dump" "$DATABASE_URL"
   ```
   - Use `pg_dump` from PostgreSQL **18 or newer**; an older client cannot dump a newer server.
   - Store the dump **outside the repository**. `.gitignore` excludes `*.dump`, but the dump still contains customer data. Use encrypted storage with restricted access [VERIFY location].
   - Record the file name, size, environment, frontier and SHA-256 of the dump in the release log.
3. **A backup is not valid until it has been restored** (§7.5) and verified. Always record which assurance level (§7.4.1) a backup has reached.

#### 7.4.1 Backup assurance levels

| Level | Name | What has been proven | How | Sufficient for |
|---|---|---|---|---|
| 1 | **Archive integrity / readability** | The file is complete and readable as a PostgreSQL archive. Its checksum is recorded | `pg_restore --list "<file>.dump"` succeeds and lists the expected tables; record the SHA-256 and file size | Nothing on its own. It only shows the file is not corrupt |
| 2 | **Successful isolated restore** | The archive restores without errors into a new, empty, explicitly named database (§7.5 steps 1–3). The migration ledger and row counts match the source | §7.5 steps 1–4: restored, ledger, row counts | Minimum before any **schema change** or risky release |
| 3 | **Full application and financial reconciliation** | An API runs against the restore and reports `ready`. Authenticated read-only checks pass. Timezone-normalised immutable-evidence fingerprints match the source. Key financial totals match the source | §7.5 step 4 in full, plus agreed financial checks (for example locked CVR snapshot totals, approved PO committed value, locked certificate net, ledger actuals for each tenant) | Required before relying on the backup for **recovery**, and for the restore drill before real customer data |

A backup that has reached only level 1 must not be described as "verified".

### 7.5 Runbook: restore and validate

Use this both for drills and for recovery.

1. **Choose the restore destination explicitly.** By default it is a **new, empty** database with a name that cannot be mistaken for a live one (for example `<env>_restore_<YYYYMMDD>`). Never restore over the source database. Never restore into a different environment's database.
2. Create the destination and run the identity check (§7.3) on it. It must be empty: no `schema_migrations` table.
3. Restore:
   ```bash
   pg_restore --no-owner --no-acl --exit-on-error --dbname "$RESTORE_DATABASE_URL" "<file>.dump"
   ```
4. **Validate** the restore against fingerprints taken from the source at backup time:

   **Restored**
   - The identity check shows the destination name, not the source.

   **Migration ledger**
   - Count and frontier match the source.
   - `max(filename)` matches the migration files of the API that will run against it.

   **Row counts** for at least these tables:
   - `clients`, `buildlite_users`, `client_user_memberships`;
   - `developments`, `purchase_orders`, `package_payment_certificates`;
   - `commercial_events`, `ledger_transactions`;
   - `cvr_periods`, `cvr_period_snapshots`, `cvr_period_snapshot_rows`;
   - `commercial_documents`.

   **Immutable evidence fingerprints**, computed with a **normalised session timezone** (§7.7):
   ```sql
   SET TIME ZONE 'UTC';
   SELECT md5(coalesce(string_agg(to_jsonb(s)::text, '' ORDER BY s.id), '')) AS snapshot_headers
   FROM cvr_period_snapshots s WHERE s.client_id = '<tenant uuid>';
   SELECT md5(coalesce(string_agg(to_jsonb(r)::text, '' ORDER BY r.snapshot_id, r.id), '')) AS snapshot_rows
   FROM cvr_period_snapshot_rows r WHERE r.client_id = '<tenant uuid>';
   ```

   **Application read check** (assurance level 3)
   - Point a non-production API at the restored database. Its code must match the restored migration ledger.
   - Confirm `/health` reports `ready`.
   - Sign in and view a locked CVR and a certificate PDF read-only.

   **Financial reconciliation** (assurance level 3)
   - Compare agreed totals with the source, for each tenant. For example: locked CVR snapshot Final Forecast totals, approved PO committed value, locked certificate net, resolved ledger actuals.
   - Any difference blocks the backup from being recorded as level 3.
5. **Recovery only (not drills):** switch the environment's `DATABASE_URL` to the validated restored database, or follow Render's in-place restore procedure [VERIFY]. Redeploy, re-verify, and record the incident.
6. **Drills:** drop the restore database when finished, and record the result and the assurance level reached in §16.

### 7.6 Immutable evidence [V]

- **Protected by UPDATE/DELETE triggers:** audit tables, payment notice and deadline snapshots, commercial documents, payment authority and release, VA histories, Development Budget events and milestones, Land Appraisals, and CVR submission evidence.
- **Not protected by triggers:** `cvr_period_snapshots`, `cvr_period_snapshot_rows` and `cvr_period_snapshot_plots`. They are protected only by application code and by `ON DELETE RESTRICT` from the period. **Never run manual DML on them.**
- Migration 043 deliberately allows deleting evidence on never-submitted Draft certificates.
- Deleting a `clients` row cascades through many tables. There is **no supported tenant deletion or offboarding procedure**.

### 7.7 Operational example 1: lessons from the JB Homes recovery [O]

These lessons come from the operational recovery of the JB Homes demonstration. The details of the event itself are not recorded in the repository [VERIFY]. They now apply to every restore:

1. **Identify the database explicitly.** Every script and operator must confirm `current_database()` (and the host) before writing, and stop on a mismatch. The JB Homes build scripts do this. `migrate.js` does **not**, so the operator must.
2. **Name the restore destination explicitly.** State the target database name in the command or variable that performs the restore. Never rely on a default connection. Restore into a new, empty database first, then cut over.
3. **Normalise the timezone for snapshot verification.** Fingerprints built from `to_jsonb(row)::text` include `timestamptz` values rendered in the **session** timezone. The same data hashes differently on a local session (for example Europe/London) and on a hosted session (UTC). Always `SET TIME ZONE 'UTC'` before computing or comparing evidence hashes. Otherwise an unchanged snapshot looks altered, or an altered one is hard to diagnose.
4. **Validate the backup before trusting it.** A dump file is not proof of recovery. Restore it into a disposable database, then compare the migration ledger, row counts and timezone-normalised fingerprints with the source. Only then record the backup as good.
5. **Use temporary scripts for one purpose only.** The JB Homes scripts (§14.3) are historical build tools. They must not be reused or adapted as a recovery procedure for any environment.

### 7.8 Operational example 2: Owner-UAT migration-068 incident (18 October 2026)

**Facts reported by the Product Owner** [O]:
- The Owner-UAT Render API was rolled back on 18 October 2026.
- It now runs `4382970`, with the database at migration frontier `067`.
- `/health` reported `ready` after the rollback.

**Repository facts** [V]:
- Migration `068_site_start_budget_submission_boundary.sql` was introduced in `b4ed8e3`.
- `4382970` is the commit immediately before `b4ed8e3` on `buildlite-V1-1`. Its newest migration file is `067`.
- Every later commit (`b4ed8e3`, `b4c4209`, `a50ede3`, `f959d6a`) requires `068`.

**Most likely sequence** [I]: an API commit containing `068` was deployed to Owner-UAT without `068` having been applied to the Owner-UAT database. The readiness check (`/health`) then returned 503 `migration_behind`. Rolling back to `4382970`, whose code expects only up to `067`, made the API ready again.

The exact deployed commit, timeline and observed errors are not recorded in the repository [VERIFY V-B5].

**Lessons:**
1. **A successful Render deploy does not prove the API is database-ready.** Render reports a deploy as live once the process starts. BuildLite's database readiness is reported separately by `/health`. Always check `/health` (status **and** `requiredFrontier`) after every deploy (§8.5).
2. **Compare migrations before deploying.** Compare the exact release commit's migration files with the target ledger (§7.2 step 4). This would have shown `068` missing beforehand.
3. **Schema changes need their own approval and a verified backup.** Deploying code that carries a migration is a schema release (§8.3), even if the intended change looked like code only.
4. **A matching frontier does not prove a rollback is safe.** The rollback worked here because `4382970`'s code and the `067` schema were the pair that previously ran together. In general, check compatibility as described in §8.6.
5. **Environments can now differ.** Owner-UAT (`4382970` / `067`) and JB Homes (`f959d6a` / `068`) run different code and schema. Every release must name its target environment and check that environment's own ledger.

---

## 8. Build, test, deployment and rollback

### 8.1 Build [V]

| Part | Command | Output |
|---|---|---|
| Frontend | `cd client && npm ci && npm run build` | `client/dist` (includes `_redirects`). `VITE_*` values are compiled in at build time |
| API | `cd server && npm ci` (`postinstall` downloads Chrome into `server/.cache/puppeteer`) | Run with `npm start` |

### 8.2 Tests [V]

| Suite | Command | Notes |
|---|---|---|
| Server | `cd server && npm test` | node:test with concurrency 1. Requires `server/.env.test.local` with `TEST_DATABASE_URL` pointing at `buildlite_test`. Fails closed if it is missing or equals `DATABASE_URL` |
| Client | `cd client && npm test` | Vitest. Authority flags are forced OFF in tests (`vite.config.js`) |
| Lint | `cd client && npm run lint` | No server lint |
| Blank-database rehearsal | `cd server && npm run rehearse:blank-pilot` | Creates a local `buildlite_pilot_rehearsal_*` database, migrates it, and checks readiness |

**Known test debt:**
- The five stale new-development readiness fixtures in `cvrDevelopmentBudgetIntegration.test.js` remain [O].
- The test schema is built by `db.init()` plus selected migrations, not by `migrate.js`, so passing tests do not prove the migrated production schema [V]. Run the blank-pilot rehearsal for schema releases.

### 8.3 Release types

| Type | Contains | Order |
|---|---|---|
| Frontend-only | `client/` changes, no API contract change | Build and deploy Netlify |
| API-only | `server/` changes, no migration | Deploy Render |
| Schema release | **Any** release commit whose migration files are not all in the target ledger. This includes "code" releases that carry a migration added by an earlier commit | Separate schema approval → verified backup → ledger comparison → migrate → deploy API → `/health` → deploy frontend (if needed) |
| Configuration change | Env var or flag change | Change in the dashboard → redeploy that service (Netlify needs a rebuild for `VITE_*`) |

### 8.4 Pre-release checklist

1. Slice reviewed and committed with explicit approval. `git status` shows only intended changes.
2. Server tests, client tests, lint and the production build all pass locally. Record the counts.
3. For schema releases: the blank-pilot rehearsal passes, and the migrations have been reviewed for destructive statements.
4. Push to `origin/buildlite-V1-1`, with explicit approval.
5. Name the target environment(s) and get explicit approval for each.
6. **Migration comparison** for each target environment: compare the exact release commit's `server/migrations/*.sql` files with that environment's `schema_migrations` ledger (§7.2 step 4).
   - No differences: the release is not a schema release.
   - Expected missing files only: the release **is** a schema release.
   - **Any unexpected missing file, or a ledger entry absent from the commit: stop.** A deliberate rollback to older code is not a forward release; assess it under §8.6 instead.
7. **For schema releases:** obtain **separate, explicit schema-change approval**, and take a backup verified to at least assurance level 2 (§7.4.1).
8. **Compatibility check:** confirm the release's frontend and API are compatible with each other and with the target schema. This matters most when an environment is behind the repository head (§12).
9. The release record (§12) is started: environment, API SHA, frontend SHA (only if known — never estimated), frontier before, backup reference and assurance level.

### 8.5 Deploy runbooks

**Render (API):**
1. Confirm the service is the intended environment: service name and the `DATABASE_URL` database [VERIFY how each is identified].
2. Schema releases: complete §7.2 first.
3. Deploy the approved commit. This may happen automatically from the branch or need a manual deploy [VERIFY].
4. Watch the deploy log for `Production configuration is invalid` or `DB init failed`.
5. **Do not treat "deploy live" in Render as success.** A Render deploy is marked live once the Node process starts. The API can be live and still not database-ready (§7.8).
6. **Verify:**
   - `GET <api>/health` returns 200 with `status: ready` **and** a `requiredFrontier` equal to the release commit's newest migration. On a 503 `migration_behind`, follow §8.6; do not leave the environment in that state;
   - sign in and complete a read-only check of a known record (for example an existing locked CVR, or the Oakfield P01 Draft totals);
   - for PDF-related releases, open an existing PO PDF.

**Netlify (frontend):**
1. Confirm the site's `VITE_API_URL` and the authority flags (§9).
2. Trigger a build of the approved commit [VERIFY build settings].
3. **Verify:**
   - the app loads and sign-in works;
   - the browser network tab shows CVR, CE, matrix and certificate requests going to the API, not missing;
   - no "server authority is not enabled" banner appears.

**Record** the deployed SHAs, frontier, verification results and verifier in §12 and `CURRENT_STATE.md`.

### 8.6 Rollback

| Situation | Action |
|---|---|
| Frontend defect | In Netlify, republish the previous successful deploy [VERIFY procedure], or redeploy the previous commit. First check that the older frontend still works with the **current** API (see below) |
| API deployed, `/health` 503 `migration_behind` (migration not applied) | Either apply the missing migration under §7.2 (separate approval and a verified backup), or roll the API back to the previous known-good commit for that environment. Then re-verify `/health`. Example: §7.8 |
| API defect, no migration in the release | In Render, roll back to the previous deploy or redeploy the previous commit [VERIFY procedure]. Re-verify `/health` |
| API defect after a migration was applied | Prefer fixing forward. Rolling the API back to older code requires the compatibility assessment below. If data or schema is damaged, restore (§7.5) to the pre-release backup, then deploy the API that previously ran on that schema |
| Configuration error | Correct the variable and redeploy |

**Compatibility assessment before any rollback.** Use the actual schema and code. **Comparing migration frontiers alone does not prove compatibility.**
- `/health` checks only that every migration file in the deployed code is in the ledger. Older code against a newer schema reports `ready` even when it is not safe.
- For each migration between the two commits, read the SQL and decide whether the older code would still work. Things that break it:
  - columns made `NOT NULL` or given new CHECK constraints that the old code does not supply;
  - replaced trigger or boundary functions (for example `068` replaces `validate_cvr_budget_submission_boundary()`);
  - renamed or dropped objects;
  - new rows or states the old code does not recognise.
- Check the frontend/API contract. A frontend built from a newer commit may call endpoints, or send fields, that an older API rejects. The reverse is also possible.
- The safest rollback target is the **exact pair** (API commit, schema ledger) that previously ran together in that environment and was verified. Record that pair in §12 for every release.
- If compatibility cannot be shown, do not roll back. Fix forward, or restore.

There are no down migrations. Restoring a database discards all writes made after the backup, so it is a Product Owner decision.

---

## 9. Frontend server-authority configuration

Each flag decides whether a domain reads and writes Postgres (server authority) or legacy browser localStorage. The behaviour below is from the code at `f959d6a` [V]:

| Variable | Code behaviour | Hosted requirement |
|---|---|---|
| `VITE_CVR_SERVER_AUTHORITY` | `true` → server. If unset in a **production build**, the app refuses CVR use ("CVR server authority is not enabled…") | `true` |
| `VITE_REVENUE_SERVER_AUTHORITY` | Ignored outside test mode; always server | Set `true` for clarity |
| `VITE_COST_CODE_SERVER_AUTHORITY` | **No longer read.** Replaced by `VITE_COST_CODE_AUTHORITY_MODE`; production is always server | Not required |
| `VITE_CE_SERVER_AUTHORITY` | **Defaults OFF → localStorage** | **`true` — mandatory** |
| `VITE_MATRIX_SERVER_AUTHORITY` | **Defaults OFF → localStorage** | **`true` — mandatory** |
| `VITE_CERTIFICATE_SERVER_AUTHORITY` | **Defaults OFF → localStorage** | **`true` — mandatory** |
| `VITE_LEDGER_SERVER_AUTHORITY` | **Defaults OFF → localStorage** | **`true` — mandatory** |

**Why this matters:** if any of the four mandatory flags is missing, the hosted app silently stores that domain in each user's browser. That data is invisible to other users and lost when storage is cleared. This is the same failure as the earlier phantom Oakfield P01, which existed only in browser storage until CVR authority was enforced [O].

**Verification after every frontend deploy:**
1. In the Netlify environment settings, confirm all of the flags above are `true`.
2. In the browser, open Commercial Events, an order matrix and a certificate. Confirm network requests go to the API.
3. Optionally confirm that the relevant `buildlite_*_v1` localStorage keys are not being written to [I].

Changing a `VITE_*` value requires a **rebuild**. Editing the variable alone does not change a deployed site.

---

## 10. Troubleshooting and incident response

### 10.1 Where to look

| Source | Contents |
|---|---|
| Render service logs [VERIFY access] | API console output: `[unexpected-error]` with `referenceId`, `[health]`, `[CVR] …`, `[buildlite-timing]`, startup failures |
| Netlify deploy logs | Build failures, missing env variables |
| Browser developer tools | Network status codes, CORS errors, console errors |
| Clerk dashboard | Sign-in attempts, invitation status, user verification |
| Database | `authorization_action_audit` and domain audit tables (read-only queries) |

In production, a 5xx response body says only "An unexpected server error occurred" with a `referenceId`. Search the Render logs for that ID.

### 10.2 Health endpoint [V]

`GET /health` (public):

| Response | Meaning | Action |
|---|---|---|
| 200 `{status:'ready', requiredFrontier:'068'}` | Database reachable and every migration file applied | — |
| 503 `migration_behind` | The deployed code has migrations the database lacks | Run §7.2 (after a backup), or redeploy the code matching the database |
| 503 `migration_ledger_unavailable` | No `schema_migrations` table (a new or wrong database) | Run the identity check (§7.3). If this is a new database, follow the bootstrap in §13 |
| 503 `database_unavailable` | Connection or SSL failure | Check `DATABASE_URL`, `DATABASE_SSL`, and the database status in Render |

### 10.3 Common failures

| Symptom | Likely cause | Resolution |
|---|---|---|
| API will not start: `Production configuration is invalid` | A required variable is missing or invalid (§3.1) | Fix the variable listed in the log and redeploy |
| API exits with `DB init failed` | Database unreachable at boot | Check the database status and `DATABASE_URL`/SSL |
| Every request returns 500 "unexpected error" from the browser; logs show `Origin not allowed by BuildLite CORS policy` | Frontend origin missing from `CORS_ALLOWED_ORIGINS` (CORS rejections appear as 500) | Add the exact HTTPS origin and redeploy the API |
| App shows "BuildLite authentication is not configured" | `VITE_CLERK_PUBLISHABLE_KEY` missing at build time | Set it in Netlify and rebuild |
| 401 "Authentication required" / "Your session has expired" | No or expired Clerk token; frontend and API use different Clerk instances | Sign in again. Confirm both keys come from the same Clerk instance |
| 403 "BuildLite user is inactive or not provisioned" | Clerk user has no active `buildlite_users` row | Invite the user (§5.4), or the platform operator signs in first |
| 403 "You do not have an active membership for this tenant" | Stale `buildlite_active_client_id` in the browser, or the membership is inactive | Choose a company in the selector; check the membership |
| 409 `TENANT_SELECTION_REQUIRED` | User has several memberships and none is selected | Choose a company |
| 403 "Permission required: cvr.submit" (or another key) | The role lacks the permission (§6.2) | Change the role, or have an authorised user perform the action |
| "CVR server authority is not enabled for this BuildLite deployment" | Netlify build missing `VITE_CVR_SERVER_AUTHORITY=true` | Set it and rebuild |
| Data visible in one browser but not another | Missing CE/Matrix/Certificate/Ledger flag (§9) | Set the flags and rebuild. Do not "recover" browser-only data without Product Owner review |
| CVR Approve & Lock returns 409 refresh/retry | Concurrent change, lock timeout (10 s) or serialisation conflict | Refresh and retry. Approval is never retried automatically |
| PDF generation fails | Chrome not installed in the Render build, or missing system libraries | Check the Render build log for the Puppeteer `postinstall` step. Redeploy with a clean build cache [VERIFY option] |
| PO or supplier create quietly fails, or reports a conflict | Global identifier collision with another tenant (§11) | Use a tenant-distinct number. See limitation L1 |

### 10.4 Incident response

1. **Contain.** If data integrity may be at risk, stop writes. Ask users to stop. If necessary, suspend the Render service [VERIFY procedure]. Do not run ad-hoc SQL.
2. **Preserve.** Take a logical backup (§7.4) of the current state before any corrective action, even if that state is wrong.
3. **Identify.** Gather the time window, affected tenant(s), reference IDs, deploy history and audit rows (read-only).
4. **Decide.** Choose between fixing forward, rolling back the app, or restoring the database. The Product Owner approves any restore or data correction.
5. **Recover.** Follow §8.6 or §7.5, then re-verify.
6. **Record.** Add an entry to `CURRENT_STATE.md` and the maintenance log (§16): cause, impact, actions, evidence and follow-ups.
7. **Customer communication.** Owner and process to be defined [VERIFY].

---

## 11. Security and operational limitations

BuildLite is **not externally pilot-ready** (`CURRENT_STATE.md`, GP-PILOT-05) [O]. These are known limitations at `f959d6a`:

| # | Limitation | Impact | Status / mitigation |
|---|---|---|---|
| **L1** | **Global PO and supplier identifiers.** `purchase_orders.po_number` and `suppliers.id` are global primary keys; only a partial per-tenant unique index exists. A PO number or supplier ID already used by **any** tenant cannot be created in another: the insert hits the global key, and supplier creation returns false on conflict without an error. Migration 027 also cascades terms bindings from the global `po_number` | Blocks tenant-local numbering. Risk of confusing failures when onboarding a second real tenant | **Pending** tenant-scoped PO/supplier identity migration (an open pilot blocker). Until then, give each tenant a distinct PO/supplier numbering scheme [VERIFY numbering behaviour in the UI] |
| L2 | Test auth adapter (all permissions) is selected by environment variables. Several protections depend on `NODE_ENV` being exactly `production` | Misconfiguration could open the API | Always set `NODE_ENV=production` on hosted services. Verify it after every configuration change |
| L3 | Developer reset (`POST /api/developer/reset`, `npm run reset-dev-data`) deletes **all tenants'** POs, suppliers, jobs and legacy certificates. The route is mounted whenever `NODE_ENV !== 'production'` | Catastrophic data loss | Never run it on a hosted or clone database (§14) |
| L4 | CE, Matrix, Certificate and Ledger authority flags default to localStorage | Silent browser-only data | §9 checklist after every frontend deploy |
| L5 | CVR snapshot tables have no database-level immutability trigger | Manual SQL could alter history | No manual DML. Fingerprint after restores (§7.5) |
| L6 | Migration runner lacks a database-name guard, lock, checksum and dry-run | Wrong-database migration | §7.2 identity check and one operator at a time |
| L7 | No CI, tags or automated deploy pipeline | Unverified releases; unclear deployed state | §8.4 checklist; release matrix (§12) |
| L8 | Console logging only. No alerting, uptime monitoring or request logging; no `pool.on('error')` handler | Outages noticed only by users | Recommended: external uptime check on `/health` [VERIFY tooling] |
| L9 | No documented or proven backup policy for Owner-UAT | Possible unrecoverable loss | §7.4–7.5 drill; resolve item V-B1 |
| L10 | Database TLS certificate is not verified (`rejectUnauthorized:false`) | Reduced protection against network attacks | Accepted for Render-internal connections [VERIFY whether the internal URL is used] |
| L11 | `COST_CODE_IMPORT_REVIEW_SECRET` falls back to other secrets | Secret reuse | Set a dedicated value per environment |
| L12 | `db.init()` runs DDL on every boot; the test schema is not built by migrations | Schema drift, brief locks at start-up | Blank-pilot rehearsal for schema releases |
| L13 | Some non-CVR development routes still accept a browser-supplied actor (`developmentRoutes.js`) | Weaker audit attribution | Future slice |
| L14 | Denied access attempts are not audited | Limited forensic visibility | Use Clerk logs. Future slice |
| L15 | CVR RBAC corrections (`f959d6a`) are deployed to JB Homes but **not to Owner-UAT**, which runs `4382970` [O] | Owner-UAT still allows broader CVR mutation and some browser-supplied audit actors | Deploy to Owner-UAT under §8 as a **schema release** (it requires `068`), with separate approval and a verified backup |
| L16 | Hosted commercial-document (certificate/notice) PDF rendering has not been accepted on Owner-UAT [O] | Possible PDF failure on first use | Verify during certificate UAT using an existing document |
| L17 | Wider Commercial Event and certificate RBAC review outstanding [O] | — | Programme register |

**Secrets handling:**
- Secrets live only in the Render, Netlify and Clerk dashboards and in local gitignored env files.
- No secrets are tracked in the repository [V].
- Rotate a secret immediately if it is exposed, and record the rotation in §16.
- Rotation procedures for each secret: [VERIFY].

---

## 12. Current deployment / release matrix

Last updated 18 Oct 2026. Every live value not marked [O] or [V] must be verified from the dashboards. **[VERIFY]** marks an unknown. Values reported by the Product Owner are labelled [O]. **Frontend SHAs are not recorded unless verified; none is estimated here.**

| Environment | Frontend host / SHA | API host / SHA | Database (name, version) | Migration frontier | Clerk instance | Authority flags | Status |
|---|---|---|---|---|---|---|---|
| **Repository (GitHub `buildlite-V1-1`)** | — | — | — | `068` (newest file at `f959d6a`) [V] | — | — | `f959d6a` pushed; `origin/buildlite-V1-1` = `f959d6a` [V] |
| **Owner-UAT** | Netlify site [VERIFY]; frontend SHA **unverified**; **Revenue frontend correction pending** [O] | Render API at **`4382970`**, following rollback on 18 Oct 2026 [O]; service name [VERIFY] | Name [VERIFY]; PostgreSQL 18 [O] | **`067`** [O] | [VERIFY] | CVR `true` [O]; CE/Matrix/Certificate/Ledger [VERIFY] | `/health` **ready** after the 18 Oct rollback [O]. Not deployed: `b4ed8e3` (adds `068`), `b4c4209`, `a50ede3`, `f959d6a` [V commit order]. Incident: §7.8 |
| **JB Homes demo** | Dedicated Netlify site [O]; frontend SHA **unverified**; **Revenue frontend correction deployed** [O] | Dedicated Render API at **`f959d6a`** [O]; service name [VERIFY] | Dedicated Render Postgres [O]; name/version [VERIFY] | **`068`** [O] | Dedicated instance [O] | [VERIFY] | Mature Oak Meadow demonstration operational [O] |
| **Future pilot** | — | — | — | — | — | — | Not provisioned |

**Known-good (API, schema) pairs** for rollback assessment (§8.6):

| Environment | API commit | Schema frontier | Evidence |
|---|---|---|---|
| Owner-UAT | `4382970` | `067` | `/health` ready, 18 Oct 2026 [O] |
| JB Homes | `f959d6a` | `068` | Reported deployed and operational [O]; `/health` result to be recorded [VERIFY] |

**Release record template** (copy one per release into §16):

```
Date/time (UTC):
Environment:
Approved by:
Frontend SHA (before → after):
API SHA (before → after):
Migration frontier (before → after):
Migration comparison (release commit files vs target ledger; unexpected differences?):
Schema-change approval (if applicable; by whom):
Backup reference (file / provider snapshot id, SHA-256) and assurance level (1/2/3):
Verification: /health ready? frontier? read-only checks? PDFs?
Verifier:
Notes / follow-ups:
```

---

## 13. Customer onboarding runbook

**Preconditions for real customer data:**
- limitations L1, L2, L4, L9 and L15 resolved or explicitly accepted by the Product Owner;
- a dedicated pilot environment decided (§15, V-E1);
- a successful restore drill recorded.

### 13.1 Environment bootstrap (new, empty pilot database)

From `docs/HOSTED_PILOT_RUNBOOK.md`, updated:

1. Create the Render Postgres database, Render web service, Netlify site and Clerk production instance. Record their names in §12.
2. Configure the Render variables (§3.1) and the Netlify variables (§3.2, §9).
3. Identify the empty target database (§7.3). If it is not empty, **stop**.
4. Run `npm run migrate` from the matching release (§7.2). Confirm the ledger count equals the number of files and the frontier equals the newest file.
5. **Do not run `npm run seed`.**
6. Deploy the API. Confirm `/health` reports `ready`. Deploy the frontend.
7. Take a first backup and restore it as a drill (§7.5).

### 13.2 Tenant and users

1. Create the platform operator (§5.2).
2. Provision the company (§5.3), using the customer's own company code.
3. Invite the customer's company administrator with `company_administration` (§5.4). Confirm they accept and can sign in.
4. Agree whether the operator keeps a membership. If not, the customer administrator deactivates it.
5. Invite the remaining users with **least-privilege** roles (§6.2).

### 13.3 Company configuration

1. Company settings and logo.
2. Commercial Structure.
3. Cost Code import → hierarchy → classification. **Use the client's own cost codes; never impose Test Site 1 numbering.**
4. Company templates for Prelims and Selling Costs (optional).
5. Company Readiness shows ready (§5.5).

### 13.4 First development and first CVR

| Step | Screen | Permission |
|---|---|---|
| 1. Create development | Developments → New | `development.create` |
| 2. Programme (site start, completions, plot count) | Development → Programme | `cvr.edit` |
| 3. Plot Master / plot schedule import / sales register / revenue settings | Development → Plot Master, Revenue | `plot_master.manage`, `revenue.manage` |
| 4. Capture Land Purchase Appraisal (**immutable**; review every line first) | Development → Budget | `land_appraisal.capture` |
| 5. Create Site Start period → submit → approve (creates the Site Start Budget milestone) | CVR Register | `site_start.manage`; approve `cvr.lock` |
| 6. Create P01 from Site Start, choosing the reporting month | CVR Register | `cvr.edit` |
| 7. Optional evidence: suppliers/POs, packages/matrices, certificates, ledger import, Prelims and Selling Costs adoption | Respective modules | Domain permissions; adoption `cvr.adopt` |
| 8. Review readiness and exceptions; submit P01 | CVR | `cvr.submit` |
| 9. Approve & Lock (freezes the immutable snapshot) | CVR | `cvr.lock` |
| 10. Later months: Create Next with an explicit reporting month | CVR Register | `cvr.edit` |

New developments with no history use the Site Start lifecycle (`developmentCommercialReadiness.js`) [V]. The legacy Opening Budget / Development Budget path still exists for established developments such as Oakfield [O].

### 13.5 Onboarding safety rules

- Never import demo data, Test Site 1 data or Hawthorn data into a customer tenant.
- Use the customer's own PO and supplier numbering, distinct from other tenants (L1).
- Before importing appraisal, budget or ledger files, back up (§7.4). Appraisal capture cannot be undone.
- Record the onboarding in `CURRENT_STATE.md`: tenant code, date, operator, first CVR month.

---

## 14. Dangerous operations and historical tools

### 14.1 Never on hosted, pilot or clone databases (without explicit, written, per-operation approval)

| Operation | Why |
|---|---|
| `npm run seed` (`server/scripts/seed.js`) | Legacy single-tenant bootstrap. Activates the oldest client and attaches every PO and supplier with no `client_id` to it |
| `npm run reset-dev-data` / `POST /api/developer/reset` | Deletes POs, suppliers, jobs and legacy certificates for **all tenants**, overwrites brand data, rewrites `server/data/*.json` |
| Ad-hoc `UPDATE`/`DELETE` on evidence, snapshot or audit tables | Breaks immutable history; triggers block some of it but not snapshots |
| `ALTER TABLE … DISABLE TRIGGER` | Bypasses immutability protection |
| `DELETE FROM clients` | Cascades through tenant data |
| Running `migrate` without the identity check | Migrates whichever database the environment points at |
| Editing an applied migration | Not detected by the runner; environments diverge |

### 14.2 Supported scripts

| Script | Purpose |
|---|---|
| `npm run migrate` | Apply migrations (§7.2) |
| `npm run test:ensure-db` | Create/initialise the local `buildlite_test` |
| `npm run rehearse:blank-pilot` | Prove a clean migrate on a local throwaway database |
| `node scripts/rehearse-site-start-migration.js` | Local rehearsal of migration 067 on a temporary test database |

### 14.3 Historical / temporary tools (not approved procedures)

- **JB Homes build scripts:** `server/scripts/prepare-jb-homes-demo.js`, `enrich-jb-homes-mature-demo.js` and `accept-jb-homes-mature-demo.js`. These are **untracked** in git at `f959d6a` [V].
  - They target only local databases named `buildlite_demo_jb_homes` and `buildlite_demo_jb_homes_mature_rehearsal`.
  - They insert synthetic users and tenants directly, bypassing Clerk and provisioning.
  - `enrich` and `accept` drive the app through the **test auth adapter**.
  - `prepare` **disables triggers** to backdate Site Start evidence, and creates then deletes a probe period.

  They are historical demo-construction tools only. **They must not be used, copied or adapted to build, repair or restore any hosted environment.**
  - `enrich-jb-homes-mature-demo.js` calls `applyPrelimsSetup` without an authenticated principal. It is therefore expected to fail on `f959d6a`, where Prelims setup now requires `cvr.edit` [I].
- **`server/scripts/_*.js`:** one-off forensic and UAT scripts, most of them read-only, written for specific slices against `buildlite_clone`. They are untracked historical evidence, not maintained tools. Read a script fully before running it, and never run one against a hosted database.
- **`capture-*-screenshots.js`, `generate-*`, `import-test-site-1-*`, `materialise-test-site-1-packages.js`:** historical UAT and sample tooling.

---

## 15. Outstanding verification items

Each item must be answered from the provider dashboards or by the Product Owner. Record the answer, date and source in §16, then update the relevant section.

**Environments**

| ID | Question |
|---|---|
| V-E1 | Will future pilots get their own Netlify/Render/Postgres/Clerk set (as JB Homes has), or share Owner-UAT? |
| V-E2 | Owner-UAT: Netlify site name, custom domain, Render service name, database name/host, Clerk instance (dev or prod keys). Is `buildlite-po-api.onrender.com` / `buildlite_po_db` still Owner-UAT? |
| V-E3 | JB Homes hosted: Netlify site, Render service, database name and version, Clerk instance, frontend SHA, recorded `/health` result. (API `f959d6a` and frontier `068` reported 18 Oct [O]) |
| V-E4 | Is a staging environment wanted? |

**Deployments**

| ID | Question |
|---|---|
| V-D1 | Which branch, if any, auto-deploys on Render and Netlify for each environment? Manual or automatic? |
| V-D2 | Render build/start commands, root directory, health-check path (`/health`?), and confirmation that `NODE_ENV=production` is set on every hosted API |
| V-D3 | Exact `VITE_*` values on each Netlify site, especially CE/Matrix/Certificate/Ledger = `true` |
| V-D4 | Owner-UAT currently deployed **frontend** SHA. (API `4382970`, frontier `067` and `/health` ready reported 18 Oct [O]) |
| V-D6 | Is the pending Owner-UAT Revenue frontend correction compatible with the Owner-UAT API at `4382970`? The correction commit `a50ede3` also changes `server/services/revenueSettingsValidation.js`, which `4382970` does not contain |
| V-D7 | When and how will Owner-UAT be brought to `068` / `f959d6a`? This needs separate schema approval and a verified backup |
| V-D5 | Rollback procedure in Render and Netlify as used in practice |

**Backups**

| ID | Question |
|---|---|
| V-B1 | Render backup/PITR settings, frequency and retention for each database; how a provider restore is performed |
| V-B2 | Where manual dumps are stored, encryption, retention, and who has access |
| V-B3 | Record of the JB Homes recovery: date, cause, source backup, restore destination, validation evidence |
| V-B4 | Acceptable data loss and downtime targets for Owner-UAT and pilots |
| V-B5 | Record of the Owner-UAT migration-068 incident (18 Oct 2026): the commit that was deployed, `/health` responses observed, duration, whether any writes occurred while it was not ready, and confirmation that `068` was never applied to the Owner-UAT ledger |
| V-B6 | Highest assurance level (§7.4.1) currently reached for an Owner-UAT backup and for a JB Homes backup |

**Services**

| ID | Question |
|---|---|
| V-S1 | Cloudflare: which domains, and in what role (DNS, proxy/WAF, registrar)? |
| V-S2 | Clerk configuration per instance: sign-in methods, allowed origins/redirects, session lifetime, administrators, log retention |
| V-S3 | Account ownership and access for GitHub, Render, Netlify, Clerk, Cloudflare and the domain registrar. Is MFA enabled? Is there a second administrator? |
| V-S4 | Secret rotation procedure and last rotation dates |
| V-S5 | How Render logs are accessed and retained; any uptime monitoring |

**Process**

| ID | Question |
|---|---|
| V-P1 | Customer support and incident ownership, communication, and response expectations |
| V-P2 | Is `buildlite-V1-1` the permanent release branch, or will `main` be brought up to date? Will tags be adopted? |
| V-P3 | Should the JB Homes scripts and `Demo Assets/` be tracked (as historical tools) or archived outside the repository? |
| V-P4 | How PO and supplier numbers are assigned per tenant in practice, pending L1 |

---

## 16. Maintenance procedure and log

### 16.1 When to update this manual

Update the manual **in the same slice** as any change to:
- environment variables or authority flags;
- migrations, the migration runner, or `/health` behaviour;
- roles, permissions or route guards;
- supported or dangerous scripts;
- hosted services, environments or deployment steps;
- backup or restore practice;
- a release to a hosted environment (§12 matrix plus a release record);
- an incident or recovery.

### 16.2 How to update

1. Edit the relevant section and keep the evidence labels. When an item is confirmed, change it from [VERIFY] or [O] to a confirmed statement, citing the source and date.
2. Update §12 if any deployment state changed.
3. Add a row to the log below: date, version, author, summary.
4. Increment the version: minor (1.x) for factual updates, major for restructuring.
5. Never include credentials, connection strings, tokens or customer personal data.
6. Every quarter, check §7.5 (restore drill), §15 (open items) and §11 (limitations) against reality.

### 16.3 Maintenance log

| Date | Version | Author | Change |
|---|---|---|---|
| 2026-10-17 | 1.0 | Claude (Opus) for David Morris | First complete edition. Built from the independent technical operations review, the GP-PILOT-09A review, repository HEAD `f959d6a`, and Product Owner operational evidence on JB Homes hosting and recovery. Live hosting facts left as VERIFY items |
| 2026-10-18 | 1.1 | Claude (Opus) for David Morris | Release matrix updated with PO-verified evidence: `f959d6a` pushed; JB Homes API `f959d6a` / `068`; Owner-UAT API `4382970` / `067` with `/health` ready after the 18 Oct rollback; Revenue frontend correction deployed to JB Homes and pending on Owner-UAT; no frontend SHAs recorded. Removed "not pushed / not deployed" statements. Release procedure strengthened: exact-commit migration comparison, stop rules, separate schema approval, Render-live ≠ database-ready. Added backup assurance levels 1–3 (§7.4.1). Rollback guidance now requires a code/schema compatibility assessment. Added the Owner-UAT migration-068 incident as operational example 2 (§7.8). New verification items V-D6, V-D7, V-B5, V-B6 |

### 16.4 Release and incident records

_(Append release records using the §12 template and incident records using §10.4 step 6.)_

---

## 17. Source references

| Area | Files |
|---|---|
| Startup and configuration | `server/server.js`, `server/app.js`, `server/utils/productionConfig.js`, `server/utils/env.js`, `server/db.js`, `server/.env.example`, `server/.env.test.local.example`, `client/.env.example` |
| Authentication and RBAC | `server/auth/authAdapters.js`, `authMiddleware.js`, `authorization.js`, `permissions.js`, `routePermissionManifest.js`, `requestContext.js`; `server/services/activeClient.js`; migrations `031`, `059`, `060`, `063`–`065` |
| Tenancy | `server/routes/platformProvisioningRoutes.js`, `tenantMembershipRoutes.js`, `membershipInvitationRoutes.js`; `server/services/tenantProvisioning.js`, `tenantMembershipService.js`, `tenantReadiness.js`; `client/src/components/admin/AdminPlatformProvisioningPage.jsx`, `AdminUsersPage.jsx` |
| CVR authority | `server/routes/cvrRoutes.js`, `server/services/cvrPeriodRepository.js`, `cvrMembershipService.js`, `cvrBudgetImportService.js`, `prelimsAdoptionApplyService.js`, `sellingCostsAdoptionApplyService.js`, `developmentCommercialReadiness.js` |
| Database | `server/migrations/001`–`068`, `server/scripts/migrate.js`, `server/services/migrationReadiness.js`, `server/scripts/rehearse-blank-pilot-database.js` |
| Frontend authority | `client/src/cvr/cvrPeriodAuthority.js`, `commercialEvents/commercialEventAuthority.js`, `payments/orderMatrixAuthority.js`, `payments/paymentCertificateAuthority.js`, `ledger/ledgerAuthority.js`, `revenue/revenueAuthority.js`, `admin/costCodeAuthority.js`, `auth/BuildLiteAuthProvider.jsx`, `auth/authenticatedFetch.js` |
| PDFs and branding | `server/puppeteer.config.cjs`, `server/services/commercialDocumentRenderer.js`, `commercialDocumentStorage.js`, `tenantBranding.js`; migrations `030`, `066` |
| Dangerous and historical tools | `server/scripts/seed.js`, `reset-dev-data.js`, `server/services/devReset.js`, `server/routes/developerRoutes.js`, `server/scripts/prepare-/enrich-/accept-jb-homes-*.js` |
| Tests | `server/test/` (incl. `rbacIdentityFoundation.test.js`, `siteStartPeriodFoundation.test.js`, `testDatabaseGuard.test.js`, `hostedReadiness.test.js`), `server/utils/testDatabaseGuard.js`, `client/vite.config.js` |
| Governance and status | `AGENTS.md`, `CURRENT_STATE.md` (GP-PILOT-03/04/05), `PROJECT_SPINE.md`, `docs/PRODUCT_CONSTITUTION.md`, `docs/DATABASE.md`, `docs/HOSTED_PILOT_RUNBOOK.md`, `docs/BuildLite_Continuity_Handover_07_Oct_2026.md` |
