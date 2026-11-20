# Slice 2 notice preparation operations

Local implementation; independent review is required before release. No external issue, service or email is implemented.

## Activation

- Apply reviewed migration `072_payment_notice_preparation.sql` before enabling the feature. There is no backfill.
- `BUILDLITE_NOTICE_PREPARATION_ENABLED=true` opts the existing API process into both approval-led instructions and the runner. Unset/false is the default. Startup fails closed if enabled without the new tables.
- No separate worker service, new package or email credentials are required. Existing Chromium/Puppeteer installation is required.
- Test migration compatibility and Chromium memory/response latency on the target API tier before activation. Local response checks are not production capacity evidence.

## Authority

The initial-notice exemption applies only to supported frozen V2 company-notice terms, complete locked financial/deadline evidence, a current deadline, existing preparation/document-generation permissions, and explicit confirmation in Payment Approval. Cash authority and notified sum remain separate. No notice issue permission is acquired.

The server derives the notified sum from locked certificate net and discloses the frozen valuation basis. It records the existing approval decision, actor, source hashes and deadline references in an immutable instruction. Company policy is not implemented here: the recorded authority-rule version is `approval_led_initial_notice_v1`, and company policy version is null.

The approval request carries the server disclosure hash. A changed or missing disclosure on an otherwise supported preparation returns 409 and rolls back the approval. Submitted offers use authoritative preview totals; final authorisation checks the Locked evidence in the approval transaction.

Existing notices and Pay Less requirements retain their controls. Ambiguous/unsupported cases produce owned exceptions where the existing combined financial approval permits approval. Blocked batch approvals remain blocked. Historical approvals are never backfilled, including on replay after activation.

## Execution and recovery

- One preparation at a time per API instance; polling every five seconds.
- PostgreSQL `SKIP LOCKED` claiming, random lease token, 120-second leases and fenced completion.
- Three attempts, with a 30-second delay after failure. Expired leases recover on restart; exhausted jobs become failed. Reasons and the approval owner are retained.
- Review displays status and failures. An authenticated user with `payment_notice.prepare` and `document.generate` can retry a failed instruction; existing failure history is retained.
- Worker rechecks current owner membership/permissions, reversal state, frozen source hashes, deadline and conflicting notice evidence before publishing.
- PDF launch is bounded to ten seconds for this route; rendering has a 45-second cancellation timer after launch. Shutdown cancels the active render and leaves durable work recoverable. Database outages may delay shutdown/recovery.
- Stored PDFs use the existing immutable document store and checksum. Both notice templates label prepared output as unissued/unsent. Application and database guards prevent Slice 2 documents being Issued.
- Definitively failed preparation, or reversal of its approval, permits the existing authorised manual Payment Notice creation route. Manual creation locks the certificate and job, fences any running lease after reversal, and appends recovery audit linked to the original instruction and reversal/failure evidence. Pending/running/completed preparation otherwise blocks competing manual notices.
- Any manual Payment Notice history for the certificate permanently prevents automatic claiming, retry and PDF publication, including after that manual notice is voided or superseded. Original instructions, failures, reversals and generated PDFs are retained.

Disabling the flag stops new work and instruction generation without deleting existing evidence. An in-flight render is prevented from publishing after disable. Persisted jobs remain for reviewed recovery. Revocation, reversal, expired deadlines or conflicting notice evidence can require commercial intervention rather than repeated rendering.

## Release boundary

No hosted migration, environment change or deployment is authorised by this local implementation. `BUILDLITE_NOTICE_PREPARATION_ENABLED` must remain false/unset on every hosted environment until an authorised issue route exists and activation is explicitly approved. Email, contractual service, company dispatch policy and pre-approval exception authority remain outside Slice 2.
