# Cloudflare Hosting and Multi-Team Calendar Plan

Updated: 13 September 2026. This file is the authoritative deployment plan for this ShiftCalendar repository, copied from the revised ShiftCalendar-aws plan. Its original filename is retained. See [CLOUDFLARE.md](CLOUDFLARE.md) for implementation evidence and deployment records. The previous plan called the local slice M1a and the hosted pilot M1b; these correspond to M2a and M2b below.

## Scope and decisions

Extend the Expo calendar into a responsive, invited-user website for one organization and approximately 2–10 teams. Administrators manage membership, managers maintain assigned team rosters, and members view schedules and submit corrections. Preserve the native app's local storage; mobile cloud synchronization follows later.

- Use **Cloudflare Free services**, with a **US$0 monthly hosting requirement**. Do not enable paid subscriptions or metered add-ons automatically.
- Start with two pilot identities, then one team. Cloudflare Access Free has a 50-user ceiling shared with other Zero Trust usage. The original 100-user ambition remains a future requirement, conditional on an authentication redesign or an explicitly approved budget change; it is not supported by this Free Access design.
- Use `https://shiftcalendar.<account-subdomain>.workers.dev` initially; the exact address must be recorded after deployment. No ready custom domain is required.
- When `amazonian.my` is ready, prefer `shifts.amazonian.my`, subject to DNS ownership and availability. Domain registration/renewal is outside the US$0 hosting scope.
- Use `Asia/Kuala_Lumpur` for schedule dates. Workers operate globally; request an `apac` D1 location hint. This is **not a guarantee of Malaysia data residency**. Update privacy notices accordingly. [D1 data location](https://developers.cloudflare.com/d1/configuration/data-location/)
- Remove the Support / “Buy me a coffee” section before releasing this checkout.

## Service mapping

| App component | Cloudflare service or mechanism | Responsibility and configuration |
|---|---|---|
| Expo website, JavaScript and images | Workers Static Assets | Export a static SPA; serve assets with HTTPS and cache hashed files; support nested-route refreshes |
| Backend API | Workers Free | Same-origin `/v1/*` TypeScript API, request validation, authorization, concurrency checks and audit writes |
| Invited-user login | Cloudflare Access on Zero Trust Free | Protect this application's traffic; email allowlist and managed one-time PIN login; no public registration |
| Application records | D1 on Workers Free | SQL tables for users, teams, memberships, calendars, days, shift types, requests, mutations and audit records |
| Temporary URL and TLS | Workers-provided `workers.dev` hostname | Launch before the custom domain is ready; protect or disable every alternate/preview URL |
| Future custom hostname | Cloudflare DNS + Workers Custom Domain | Attach `shifts.amazonian.my` when ready and repeat Access/session tests |
| Identity enforcement | Access JWT verification in the Worker | Verify signature, issuer, application audience and expiry; D1 supplies current user status and team roles |
| Recovery | D1 Time Travel + protected SQL exports | Short-window recovery plus owner-held backups; no object-storage subscription needed for the pilot |
| Metrics and diagnostics | Workers metrics/logs + D1 metrics + Access logs | Measure CPU, errors, requests, row reads/writes and login decisions; redact credentials and private content |
| Releases | Pinned Wrangler CLI, Git and local Expo build | Separate local/production configuration, reviewed migrations, recorded version IDs and code rollback |

S3/CloudFront become Static Assets; API Gateway/Lambda become Workers; DynamoDB becomes D1; Cognito becomes Access; CloudWatch operational checks become Cloudflare metrics/logs. AWS Glue and EC2 have no role. KV, R2, Durable Objects, Queues, Tunnel and custom outbound email are unnecessary for this initial design. Access sends its own login PINs. [One-time PIN login](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)

## Free-plan envelope and operating policy

Published allowances are ongoing Free-plan limits, not a contractual promise that pricing will stay unchanged forever. Recheck plan eligibility and shared account consumption before each rollout.

| Resource | Current Free-plan allowance | Planning consequence |
|---|---|---|
| Static Assets | Static asset requests are free and unlimited | Requests that execute Worker code still use Worker allowances |
| Workers | 100,000 requests/day; 10 ms CPU per invocation | Measure actual JWT verification and API CPU; avoid frequent polling and large synchronous imports |
| D1 operations | 5 million rows read/day; 100,000 rows written/day | Index membership/date lookups; scans, indexes and audit writes affect consumption |
| D1 storage | 500 MB/database, 5 GB/account, up to 10 databases | Start with one dedicated database; reserve shared capacity and monitor growth |
| D1 request/recovery limits | 50 queries per Worker invocation; 7 days Time Travel | Bound batches and demonstrate recovery before team adoption |
| Access | Up to 50 users on Free | Count other account users; stop expansion before the available seat limit |

Sources: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [Zero Trust plans](https://www.cloudflare.com/plans/). Verify available Access seats in the account dashboard before invitations.

Baseline for measurement: two pilot users, followed by one team; approximately 100,000 API calls/month and less than 100 MB of initial data. These are workload assumptions, not performance evidence. Daily peaks and per-request CPU matter more than the monthly average.

Keep the account on the applicable Free plans. Exhausted quotas can cause failed operations or an unavailable app; US$0 does not imply unlimited service. Use operational review thresholds at 50% and 80% of shared allowances, bound requests, and reduce load or pause onboarding before exhaustion. Dashboard reviews/alerts are not spending caps. No paid upgrade is authorized by this plan.

## Login, permissions and privacy

- Use Access's managed email/PIN page as the initial login page. Add a branded in-app sign-in/retry/session-expired view; an outer Access gate may appear before the app loads. Password setup/reset and Cognito callbacks are no longer applicable.
- Configure a reusable allow policy for the two approved pilot emails, `bizkut.limau@gmail.com` and `hasanuddin.abakar@gmail.com`. Keep operational identity details out of public examples and never record PINs or session tokens.
- Protect all traffic to this specific Worker, including assets and API. Avoid account-wide rules that would affect unrelated apps. Disable unused preview URLs and test all exposed hostnames. [Worker Access protection](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
- Verify forwarded Access JWTs using the configured issuer, JWKS and application audience. Never trust an email header alone; bind application users to verified identity subjects.
- Let Access manage its browser cookie. Do not put authentication tokens in browser local/session storage. Clear protected in-memory data on logout, account change and expiry; return to Access for login.
- Check active user status and current membership in the backend on every protected operation. Access admission does not grant team permissions. Deactivation must block API access even if an Access cookie remains valid.
- Administrators manage teams and roles; managers edit assigned team rosters; members read their teams and manage their own requests. Users can have different roles in multiple teams. Preserve at least one active administrator under concurrent changes.
- Private calendars remain owner-only, including from team administrators unless a separate explicit policy is introduced. Shared responses exclude private notes, pay rates and request reasons.
- Use same-origin requests and CSRF protection for writes. Return private API responses with `Cache-Control: no-store`; do not persist them in a service-worker cache. Keep tokens, PINs and private schedule content out of diagnostic logs.

## Data and application design

Use an asynchronous repository behind the existing calendar context. Keep the native local repository and introduce the browser Cloudflare implementation without silently uploading native data.

D1 stores normalized records with foreign keys and uniqueness constraints: users; teams; memberships; private/team calendars; calendar days; shift types; correction requests; retry/mutation records; audit records. Identify a team roster entry by team, member and calendar date. Add indexes for membership, calendar/date ranges and request status. Use parameterized SQL and explicit response field selection.

Expose authenticated session/bootstrap, calendar, team, membership, shift-type, bounded roster and request routes under `/v1`. Use revision checks to reject stale edits, stable retry identifiers to prevent duplicate changes, and atomic D1 batches with guards for related mutations. Authorization and revision predicates must hold at the time of mutation. Bound body sizes, date windows, bulk entries and SQL statement counts; chunk imports with explicit partial-result reporting rather than an unbounded transaction.

Refresh on navigation, window focus, manual refresh and successful writes. Require connectivity for cloud writes and show actionable conflict/retry guidance. Retain “My shifts,” add “Team roster,” a team switcher and member selection. Keep rotations, repeat patterns and custom shifts as later cloud milestones. Preserve browser upload/download and print-to-PDF adapters; isolate native widgets, notifications and sharing.

## Phases and milestones

Check a task only after implementation and verification in the intended checkout and environment. AWS test/deployment evidence does not establish Cloudflare completion. This repository already contains the locally validated Cloudflare slice. Reuse that implementation and its recorded evidence; continue with hosted acceptance without copying code from the AWS checkout.

| Phase / milestone | Demonstrable outcome | Dependency / status |
|---|---|---|
| Phase 0 — M0: migration readiness | Confirm Free services, inventory and migration boundaries | Next planning/deployment prerequisite |
| Phase 1 — M1: web foundation | Existing calendar works in browsers and keeps native local storage | Historically verified; recheck after porting |
| Phase 1 — M2a: local Cloudflare slice | Authenticated private-calendar API and web integration pass locally | M0, M1; validate reused implementation |
| Phase 1 — M2b: two-user hosted pilot | Real PIN login and persistent private edits with cross-user isolation | Verified two-user pilot; CPU gate before expansion |
| Phase 2 — M3: teams and access | Administrator manages teams and current permissions | M2b |
| Phase 2 — M4: shared roster | Manager edit becomes visible to authorized team members | M3 |
| Phase 3 — M5: scheduling tools | Custom shifts, rotations and bounded bulk changes | M4 |
| Phase 3 — M6: change requests | Members request changes and managers resolve them atomically | M4, M5 |
| Phase 4 — M7: migration and recovery | Safe schedule imports, exports and recovery drill | M6 |
| Phase 4 — M8: team rollout | One team completes a normal scheduling cycle within Free limits | M7 |

### Phase 0 — M0: migration readiness

- [ ] Verify Workers Free, D1 capacity and Zero Trust Free seats; inventory existing Cloudflare resources before creating anything.
- [ ] Review this repository’s existing Cloudflare implementation against this plan; preserve unrelated work and existing applications.
- [ ] Install the repository-supported Node version through Homebrew if needed; pin Wrangler and dependencies in the lockfile. Record build/typecheck/test commands.
- [ ] Separate local and production bindings; authenticate with least-privilege deployment access and exclude credentials from Git.
- [ ] Inventory historical AWS resources and any remaining costs. Archive AWS deployment instructions; do not run SAM as part of Cloudflare deployment. Review cleanup separately before deleting resources or data.

**Exit evidence:** service/seat inventory, configuration design, command list and migration diff. No assumption that the earlier AWS verification blocker applies to Cloudflare; report any actual Cloudflare onboarding restriction if encountered.

### Phase 1 — M1: web foundation

Historical evidence reports Expo web/native bundle exports, TypeScript, browser layouts, calendar persistence, file adapters and PDF checks passed. See [M1 verification](../ShiftCalendar-aws/docs/M1_VERIFICATION.md). Android/iOS device smoke checks were deferred by the user; bundle exports are not device tests.

- [ ] Recheck web export, deep links, responsive layouts and platform boundaries after adopting the Cloudflare changes.
- [ ] Confirm native local reading/editing/backups remain intact; keep device checks deferred until a native release is proposed.
- [ ] Remove the donation section and update privacy/storage descriptions for Cloudflare.

**Exit evidence:** reproducible build, focused compatibility results, and explicitly recorded device-test limitation.

### Phase 1 — M2a: local Cloudflare slice

- [ ] Implement/configure Workers Static Assets and same-origin `/v1/*`; app routes load correctly and missing asset/API paths do not masquerade as successful HTML responses.
- [ ] Add D1 migrations and a private-calendar repository with revisions, retry safety and actor/timestamp audit records.
- [ ] Verify Access JWTs and active users; implement session/bootstrap, private calendar reads and single-date edits.
- [ ] Connect browser cloud persistence, expired-session handling and logout. Hide or clearly disable unsupported cloud operations.
- [ ] Test forged/missing/expired tokens, foreign calendar IDs, CSRF, concurrent edits and duplicate retries using the Workers runtime and local D1.

**Exit evidence:** typechecks, focused API/client tests, Expo export, Wrangler dry run and local routing smoke checks. No authentication bypass in deployable configuration.

### Phase 1 — M2b: two-user hosted pilot

- [x] Create or reuse the dedicated ShiftCalendar D1 database after inventory; apply reviewed migrations without touching unrelated databases.
- [x] Stage the Worker with public routes disabled. Configure Access for this Worker and the two approved identities; set the actual issuer, audience and app origin before enabling `workers.dev`.
- [x] Bootstrap the first application administrator through a controlled command. Do not grant administrator rights to every allowed email.
- [x] Complete real one-time PIN login for both users, denied-email testing, session expiry and logout. Check JWT forwarding in the deployed Static Assets configuration.
- [x] Save a private shift, reopen it from a second browser using the same identity, then prove the second identity cannot read or mutate it by guessing its IDs.
- [x] Verify protected deep links, missing assets, private cache headers and all alternate URLs.
- [x] Measure live CPU, requests, D1 rows and SQL statements for representative reads/writes, including authentication overhead. Record quota headroom and deployment/version identifiers.

**Exit evidence:** actual HTTPS address, two-user privacy evidence, persistence/logout results and live usage metrics. Local tests alone cannot complete this milestone. Pause team expansion if CPU, identity or privacy checks fail.

**Verified 2026-09-13:** two real PIN identities, private persistence/isolation, logout/expiry/SSO renewal and live measurements are recorded in [CLOUDFLARE.md](CLOUDFLARE.md). Independent-browser persistence was user-confirmed. Cold writes reached 11 ms CPU despite succeeding; keep team expansion paused pending improved CPU headroom.

### Phase 2 — M3: teams and access

- [ ] Add administration screens/APIs for invitations, deactivation, team creation and membership roles; keep Access admission and application membership lifecycle consistent.
- [ ] Add team switching and multi-team roles with backend authorization and permission audit records.
- [ ] Preserve the last active administrator under concurrent changes and revoke application access immediately on deactivation or membership removal.

**Exit evidence:** permission-matrix tests for forged IDs, removed users/memberships, different roles across two teams and concurrent administrator removal; administrator demonstrates the complete invite/assign/deactivate flow.

### Phase 2 — M4: shared roster

- [ ] Add bounded monthly roster reads and authorized single-date edits for team/member/date records.
- [ ] Implement My shifts, Team roster and member selection; separate shared fields from owner-only notes/pay data.
- [ ] Apply revisions, retry protection and audit writes; refresh views after edits and reject offline writes safely.
- [ ] Use Kuala Lumpur calendar dates consistently, including overnight shifts and month/year boundaries.

**Exit evidence:** manager edits and member sees the result; members cannot edit team rosters directly. Cover concurrent writes, cross-team attempts, private-field exclusion and native local compatibility.

### Phase 3 — M5: scheduling tools

- [ ] Add authorized custom shift types, rotation templates and repeat patterns backed by D1.
- [ ] Preview affected dates/members, bound each batch within runtime/SQL limits and return per-entry conflict results.
- [ ] Ensure retries do not duplicate changes/audit records or overwrite newer edits.

**Exit evidence:** month/year boundary scenarios, duplicate requests, partial failures, stale revisions and unauthorized targets pass; representative bulk work fits measured Free limits.

### Phase 3 — M6: change requests

- [ ] Add member submission/history and manager review for assigned teams; restrict private reasons to authorized participants.
- [ ] Atomically apply a revision-checked roster correction and close the request, or reject without changing the roster.
- [ ] Make submission/resolution retries safe and refresh affected views.

**Exit evidence:** approval changes a roster exactly once, rejection changes nothing, and simultaneous/stale/foreign-user requests are handled correctly.

### Phase 4 — M7: migration and recovery

- [ ] Preview imports with team/member mapping, date/shift-code validation and conflict reporting. Preserve source backups and exclude private notes/pay settings from team imports.
- [ ] Add bounded, retry-safe imports, authorized exports and audit views.
- [ ] Demonstrate D1 Time Travel on a rehearsal database and export/import recovery; protect exported user data and document the chosen backup frequency and retention.
- [ ] Demonstrate Worker code/assets rollback using a retained version and compatible schema. Code rollback does not restore D1 data; use forward-compatible migrations and a separate data-recovery procedure.

**Exit evidence:** malformed imports and retries cannot corrupt schedules; recovery verifies users, memberships, rosters and requests; rollback and backup handling are documented.

### Phase 4 — M8: one-team rollout and expansion gate

- [ ] Run typechecks, focused Worker/D1/client tests, browser end-to-end checks, Expo export and Wrangler deployment validation.
- [ ] Verify phone/desktop login, session changes, nested routes, roster editing, requests and exports with one real team.
- [ ] Measure a normal scheduling cycle, review shared quotas and logs, and resolve authorization/data-integrity failures before expansion.
- [ ] Expand toward 2–10 teams only within available Access seats and measured capacity. Revisit authentication before exceeding 50 total Access users; do not quietly upgrade or promise 100 users for free.
- [ ] Attach the custom domain only when ready; revalidate Access coverage, origin/CSRF settings, logout and deep links before switching users.

**Exit evidence:** accepted team workflow, recorded performance/usage and recovery results, remaining limitations, and an onboarding ceiling supported by available seats and quotas.

## Release records and historical evidence

For every milestone record commit IDs, commands/results, environment, deployment identifiers where applicable, and unfinished acceptance checks. Commit coherent changes occasionally; never commit login PINs, tokens or private backups.

The previous AWS M2 work is historical: infrastructure and client code were implemented, but CloudFront verification prevented a live release and the stack reached `ROLLBACK_COMPLETE`. See [historical M2 verification](../ShiftCalendar-aws/docs/M2_VERIFICATION.md) and [historical AWS Support draft](../ShiftCalendar-aws/docs/AWS_CLOUDFRONT_VERIFICATION.md). Existing AWS budget or resource state must be inventoried independently; this document neither deletes resources nor declares AWS costs eliminated.

This revision changes the deployment plan only. Cloudflare provisioning, code migration and live acceptance require the milestone evidence above; completed AWS checks are not carried over as completed Cloudflare checks.

## Current repository progress

M2b is verified for the two-user private browser pilot. See [CLOUDFLARE.md](CLOUDFLARE.md) for live identity/persistence/privacy/expiry evidence, resource/version records, commands and measurement limits. Independent-browser persistence is user-confirmed. Cold-write CPU headroom remains insufficient for confident team expansion; optimize and remeasure before M3 rollout. Full personal features, team workflows, recovery drills and native release checks remain later work.
