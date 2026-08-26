# BuildLite Agent Rules

Before investigating, planning, or changing BuildLite, read and obey:

- `docs/PRODUCT_CONSTITUTION.md`
- `CURRENT_STATE.md`
- `PROJECT_SPINE.md`
- `docs/DATABASE.md`

## Product invariants

- SME first: one capable QS should run BuildLite faster than Excel.
- Client cost codes are client-owned. Never impose Test Site 1 numbering on another client.
- Facts flow once. Never rewrite a PO, CE, certificate, ledger transaction, budget, or other fact to express QS judgement.
- System Forecast is fact-based. Final Forecast = System Forecast + CE Expected Liability + Commercial Adjustment.
- An eligible submitted contract-value CE defaults to full submitted value as Expected. QS override, hold, and exclude are first-class, auditable judgement.
- Preserve settled Prelims and Selling Costs replacement-adjustment rules.
- Hawthorn Gardens is a protected client-chart known-answer end-to-end UAT. Do not discard, normalise, or remap it.

## Operating boundaries

- `buildlite_clone` is SELECT-only unless a human explicitly approves a controlled write.
- Never commit/bank or push without explicit instruction. Never silently start the next slice.
- Stop for genuine product-owner decisions, human UAT, clone writes, commit/bank, push, or deployment.
- Within an approved slice, proceed autonomously through safe investigation, implementation, focused tests, and test-failure fixes.
- Preserve unrelated worktree changes. Never stage unrelated dirty files, UAT material, forensic scripts, build output, or local environment files.
