# Cloudflare Hosting and Multi-Team Calendar Plan

Updated: 14 September 2026. This file is the authoritative deployment plan for this ShiftCalendar repository, copied from the revised ShiftCalendar-aws plan. Its original filename is retained. See [CLOUDFLARE.md](CLOUDFLARE.md) for implementation evidence and deployment records. The previous plan called the local slice M1a and the hosted pilot M1b; these correspond to M2a and M2b below.

## Scope and decisions

Extend the Expo calendar into a responsive, invited-user website for one organization and approximately 2–10 teams. Administrators manage membership, managers maintain assigned team rosters, and members view schedules and submit corrections. Preserve the native app's local storage; mobile cloud synchronization follows later.

- Use **Cloudflare Free services**, with a **US$0 monthly hosting requirement**. Do not enable paid subscriptions or metered add-ons automatically.
- Start with two pilot identities, then one team. Cloudflare Access Free has a 50-user ceiling shared with other Zero Trust usage. The original 100-user ambition remains a future requirement, conditional on an authentication redesign or an explicitly approved budget change; it is not supported by this Free Access design.
- Use **https://shifts.amazonian.my** as the canonical pilot address, selected by the user and attached to the existing Worker. Production `workers.dev` and preview URLs are disabled.
- `amazonian.my` is active on Cloudflare Free. Domain registration/renewal is outside the US$0 hosting scope. The initial local NextDNS block has cleared. First-user authenticated domain checks passed; second-user real-PIN login and reverse privacy/persistence checks also passed.
- Use `Asia/Kuala_Lumpur` for schedule dates. Workers operate globally; request an `apac` D1 location hint. This is **not a guarantee of Malaysia data residency**. Update privacy notices accordingly. [D1 data location](https://developers.cloudflare.com/d1/configuration/data-location/)
- Remove the Support / “Buy me a coffee” section before releasing this checkout.

## Service mapping

| App component | Cloudflare service or mechanism | Responsibility and configuration |
|---|---|---|
| Expo website, JavaScript and images | Workers Static Assets | Export a static SPA; serve assets with HTTPS and cache hashed files; support nested-route refreshes |
| Backend API | Workers Free | Same-origin `/v1/*` TypeScript API, request validation, authorization, concurrency checks and audit writes |
| Invited-user login | Cloudflare Access on Zero Trust Free | Protect this application's traffic; email allowlist and managed one-time PIN login; no public registration |
| Application records | D1 on Workers Free | SQL tables for users, teams, memberships, calendars, days, shift types, requests, mutations and audit records |
| Former temporary URL | Workers-provided `workers.dev` hostname | Disabled after attaching the canonical custom domain; previews also disabled |
| Canonical hostname and TLS | Cloudflare DNS + Workers Custom Domain | `shifts.amazonian.my` routes to the existing Worker, with managed HTTPS and Worker-scoped Access |
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

Current production baseline: two active pilot users in one team; approximately 100,000 API calls/month and less than 100 MB of initial data. The team leader owns the team and the second user is a standard member with a read-only assigned team calendar. Both users also retain separate private calendars. These are workload assumptions, not performance evidence. Daily peaks and per-request CPU matter more than the monthly average.

Keep the account on the applicable Free plans. Exhausted quotas can cause failed operations or an unavailable app; US$0 does not imply unlimited service. Use operational review thresholds at 50% and 80% of shared allowances, bound requests, and reduce load or pause onboarding before exhaustion. Dashboard reviews/alerts are not spending caps. No paid upgrade is authorized by this plan.

## Login, permissions and privacy

- Use Access's managed email/PIN page as the initial login page. Add a branded in-app sign-in/retry/session-expired view; an outer Access gate may appear before the app loads. Password setup/reset and Cognito callbacks are no longer applicable.
- Keep the reusable production allow policy restricted to the two approved pilot addresses, `bizkut.limau@gmail.com` and `hasanuddin.abakar@gmail.com`. Add or remove identities deliberately through an Access-policy review. Keep operational identity details out of public examples and never record PINs or session tokens.
- Protect all traffic to this specific Worker, including assets and API. Avoid account-wide rules that would affect unrelated apps. Disable unused preview URLs and test all exposed hostnames. [Worker Access protection](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
- Verify forwarded Access JWTs using the configured issuer, JWKS and application audience. Never trust an email header alone; bind application users to verified identity subjects.
- Let Access manage its browser cookie. Do not put authentication tokens in browser local/session storage. Clear protected in-memory data on logout, account change and expiry; return to Access for login.
- Check active user status and current membership in the backend on every protected operation. Access admission does not grant team permissions. Deactivation must block API access even if an Access cookie remains valid.
- Administrators manage teams and roles. **Only a team's manager or team leader can edit that team's calendars**, including calendars assigned to individual members. Members and viewers are read-only, even for their own assigned schedule; members submit change requests instead of editing shifts directly. Application administrator status alone does not grant calendar editing. Users can have different roles in multiple teams. Preserve at least one active administrator under concurrent changes.
- Apply the manager/team-leader restriction in backend mutation and retry checks as well as the UI: single-day edits, deletion, bulk patterns, imports and approved-request application must enforce the current role for the calendar's team. Map the existing internal team `owner` role explicitly to team leader during M3; do not confuse it with ownership of a private calendar.
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
| Phase 1 — M2c: CPU headroom | Cold private writes fit the Free CPU allowance with measured headroom | Complete — CPU and two-user correctness checks passed |
| Phase 2 — M3: teams and access | Administrator manages teams and current permissions | Complete — two-user role, revocation and CPU acceptance passed |
| Phase 2 — M4: shared roster | Manager edit becomes visible to authorized team members | Complete — hosted leader/member acceptance passed |
| Phase 3 — M5: scheduling tools | Custom shifts, rotations and bounded bulk changes | Complete — hosted scheduling, retry, conflict, privacy and Free-tier acceptance passed |
| Phase 3 — M6: change requests | Members request changes and managers resolve them atomically | Complete — hosted direct-request approval, persistence and privacy acceptance passed |
| Phase 4 — M7: migration and recovery | Safe schedule imports, exports and recovery drill | Complete — hosted import/export, Time Travel, SQL copy and Worker rollback passed |
| Phase 4 — M8: team rollout | One team completes a normal scheduling cycle within Free limits | Complete — one-team cycle passed; second-team admission waits for seven stable days |

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

### Phase 1 — M2c: CPU headroom

**Domain change alongside M2c:** `shifts.amazonian.my` is deployed with the exact matching `APP_ORIGIN`; all ten unsigned/forged-header probes reached Access over verified TLS using public DNS. First-user login, save/reload, CSRF, foreign-resource denial, logout and deep-link checks now pass on this hostname. Second-user real-PIN login and reverse privacy/persistence checks also passed. Earlier M2b browser evidence applies to the former hostname.

**Earlier candidates, retained evidence:** removed two preliminary D1 reads from normal writes while retaining atomic authorization/revision/mutation guards. All 32 tests and typechecks pass. The full candidate sample contains eight cold writes at 6–13 ms and twenty warm writes at 1–6 ms, all HTTP 200. The CPU gate failed; further profiling/optimization is required. Further minification and transaction-only authorization were tested: the latest sample has six cold writes at 7–12 ms and twenty warm writes at 1–2 ms. Earlier experimental version: `dc7fbb10-7251-43c9-9f7a-e1b60c8eb16a`, replacing console cold markers with response markers. Renewed login enabled the full sample: six cold writes at 7–22 ms and twenty warm writes at 1–3 ms; all 26 saves succeeded. CF-Ray correlation, reload, private-access denial and CSRF checks passed. Removing console instrumentation did not establish cold headroom. All samples are retained; those candidates failed the cold gate. A repeatable local workerd profiler and regression coverage are in the runbook. See the runbook for rollback and measurement protocol.

**Latest result:** the RS256-specific public-key resolver retains `jose` signature/claim verification and all existing API/D1 controls. Fifty tests, typechecks and the production dry run pass. Version `fac6525b-82ae-45be-ae9b-9e9eb3e5438e` passed the complete live CPU sample: six cold writes at 6–8 ms and twenty warm writes at 1–2 ms, all successful, with every sample retained. Second-user reload, session/month reads, foreign-resource denial, CSRF and logout pass. First-user real login, save/retry/reload and reverse privacy also pass on this exact version. Remote D1 confirms Morning shifts at versions 30 and 113 with matching audit/mutation counts. **M2c is complete.** This sample establishes observed headroom, not guaranteed future performance; earlier failed samples remain historical evidence.

- [x] Profile cold authentication and the D1 write path against the M2b baseline; preserve all security, revision, retry and audit guarantees.
- [x] Implement and regression-test a focused optimization; deploy with scoped credentials, existing Access protection and a rollback record.
- [x] Record at least five confirmed cold-resolver writes and twenty warm writes, plus session/date-range reads. Retain all samples and measure CPU separately from wall time and D1 usage.
- [x] Recheck real-user persistence and cross-user denial; preserve existing calendars and native local-only behavior.

**Exit evidence:** aim for cold writes at or below 8 ms; every write in the defined live acceptance sample must stay below 10 ms, with no lost/duplicate updates or privacy regression. Record variance without claiming guaranteed future performance. Keep US$0 Free services and pause team expansion until the gate passes.

### Phase 2 — M3: teams and access

**Completed 2026-09-14:** M3 Worker version `841deab6-458a-4735-b4cc-6826318980b5` is deployed with data-preserving migrations `0003_team_administration.sql` and `0004_expired_invitations.sql`. It includes targeted invitations for existing Access-admitted users, truthful pending/accepted/declined/revoked/expired status, application deactivation/admin controls, team creation, memberships, role changes, leadership transfer, team switching and team-calendar provisioning. Access admission remains external to the application. Internal `owner` is displayed as team leader. Team leaders/managers can edit team calendars; assigned members/viewers remain read-only. Atomic permission/version checks, idempotent mutation/audit records, bounded cursor pages and the concurrent last-active-admin guard are covered by repository and real-handler tests. Local type checks, 69 tests, web and Android local-only exports, and Wrangler dry run pass.

Live acceptance used both approved identities. The second user accepted a targeted invitation, saw the assigned team calendar, and could not edit it as a member. Temporary manager promotion allowed an edit; demotion blocked both a fresh edit and an identical retry of the previously successful manager mutation. Membership removal removed team/calendar access while preserving the private calendar, and a new invitation restored the final member role. Application deactivation blocked a newly authenticated Access session with “This user is disabled,” then reactivation restored the identity. Final D1 state has two active users, one application administrator/team leader, one standard member, two accepted invitation records, no pending invitations, preserved private Morning records, an assigned Afternoon team shift, and zero failed transaction guards. A new operation-specific tail sample covered four reads and five administration/team writes at 3–7 ms CPU; every request was below the 10 ms Free-plan limit. The earlier 13 ms cold deactivation sample remains retained as historical variance.

- [x] Add administration screens/APIs for invitations, deactivation, team creation and membership roles; keep Access admission and application membership lifecycle consistent.
- [x] Add team switching and multi-team roles with backend authorization and permission audit records.
- [x] Enforce manager/team-leader-only team calendar editing. Remove the existing repository helper's allowance for a member to edit their assigned team calendar before enabling team APIs. Joining a team does not make a private calendar shared; keep the separate owner-only private-calendar policy above.
- [x] Preserve the last active administrator under concurrent changes and revoke application access immediately on deactivation or membership removal.

**Exit evidence:** complete. Live invite/accept, assignment, member denial, manager edit, demotion/retry denial, removal, reinvitation, application deactivation/reactivation and final D1 checks passed. The final operation-specific CPU sample stayed within 3–7 ms. See [CLOUDFLARE.md](CLOUDFLARE.md) and [the M3 evidence record](cloudflare/live-evidence/2026-09-14-m3-candidate.json).

### Phase 2 — M4: shared roster

- [x] Add bounded monthly roster reads and authorized single-date edits for team/member/date records.
- [x] Implement My shifts, Team roster and member selection; separate shared fields from owner-only notes/pay data.
- [x] Apply revisions, retry protection and audit writes; refresh views after edits and reject offline writes safely.
- [x] Use Kuala Lumpur calendar dates consistently, including overnight shifts and month/year boundaries.

**Completed 2026-09-14:** Worker version `84062431-643f-4014-9ea8-9d2ddbf772e7` adds a bounded, cursor-paged team roster over the existing team-calendar rows. No schema migration was needed. Reads accept at most 31 inclusive dates and 100 rows per page. Responses contain only member identity, calendar/date, shift, revision and update fields. Team leaders and current managers can edit one assigned date; members/viewers remain read-only, including their own assignment. The same active-user, current-role, assigned-membership, revision, retry and audit predicates are rechecked inside the D1 write transaction.

Local validation passed 69 Worker/D1 tests, six browser-client tests, all app/Worker/test typechecks, Expo web and Android exports, and the production Wrangler dry run. Coverage includes real `/v1` routing, page cursors, cross-year 31-day windows, invalid dates/cursors, forged and cross-team targets, private-field exclusion, leader/manager permission, application-admin non-bypass through the existing role matrix, stale/concurrent writes, demotion retry denial, target removal/deactivation and mutation-boundary membership revocation.

Hosted acceptance used one existing first-user session and one final second-user PIN. The team leader assigned the overnight Night shift (23:00–07:00) for 17 September 2026; the member saw it after refresh. The member API write returned 403 and the member day sheet displayed the read-only notice without shift, clear, note, overtime, leave, pay or swap controls. Final roster rows exposed no private fields. Live bounded reads used 1–3 ms CPU and the denied member write path used 5 ms; all sampled M4 requests stayed below the 10 ms Free-plan gate. Both original private Morning records remain unchanged, the two users end active as owner/member, no invitations are pending and no transaction guard residue remains. See [the M4 evidence record](cloudflare/live-evidence/2026-09-14-m4-roster.json).

Rollback to version `841deab6-458a-4735-b4cc-6826318980b5` restores completed M3 code. Since M4 added no tables or columns, code rollback needs no database reversal; retain the new roster day as ordinary schedule data. Member change requests remain M6, while custom shifts, rotations and bounded bulk scheduling remain M5.

### Phase 3 — M5: scheduling tools

- [x] Add authorized custom shift types, rotation templates and repeat patterns backed by D1.
- [x] Preview affected dates/members, bound each batch within runtime/SQL limits and return per-entry conflict results.
- [x] Ensure retries do not duplicate changes/audit records or overwrite newer edits.

**Deployment history:** additive migration `0005_team_scheduling.sql` and Worker version `d0ff73c7-8c88-4468-84d4-c40aecd7d981` provide active/archived custom shifts, ordered rotation templates, preview and partial bulk apply. The browser exposes these controls only to a current team leader/manager. A hosted manager created the overnight `L` shift and `M5 Late / Rest` rotation, applied `L/O/L` on 18–20 September, and the restored member saw it with no scheduling controls. A two-tab stale preview applied one entry and returned one truthful conflict while preserving the concurrent edit. Remote D1 retains both results and the member role.

**Completed 2026-09-14:** Worker version `43ab8a40-bc72-4fd1-92c7-2b60b780b42e` caps each preview at two assignments, which supports two dates for one member or one date across two members. Authorization, template, target membership and calendars are resolved with bounded reads; stale revisions are classified before writes. Current entries and the final run result are committed in one atomic D1 batch, with a per-entry fallback if a race invalidates that batch. The browser retains a stable mutation ID for an exact retry, keeps every outcome visible, and refreshes only after the leader taps Done. Final hosted measurements were 4 ms for preview, 6 ms for a two-success apply, 4 ms for a partial conflict and 4 ms for its exact retry. Earlier 12, 16, 11 and 18 ms candidates remain documented as failed samples. Local validation passes 73 Worker/D1 tests, seven browser-client tests, all typechecks, the 78-asset Cloudflare web build, Android local-only export and the production dry run.

**Exit evidence:** month/year boundary scenarios, duplicate requests, partial failures, stale revisions and unauthorized targets pass; representative bulk work fits measured Free limits.

### Phase 3 — M6: change requests

- [x] Add member submission/history and manager review for assigned teams; restrict private reasons to authorized participants.
- [x] Atomically apply a revision-checked roster correction and close the request, or reject without changing the roster.
- [x] Make submission/resolution retries safe and refresh affected views.
- [x] Apply migration `0006_shift_change_requests.sql`, deploy the protected candidate, and complete one grouped two-user acceptance run without unnecessary identity switches.

**Local candidate 2026-09-14:** additive migration `0006_shift_change_requests.sql` stores direct-change and two-member swap requests with observed roster revisions, private reasons, explicit waiting/final states and audit metadata. Direct requests wait for a current team leader or manager. Swaps first require the selected counterpart to accept, then require manager approval. Approval rechecks the current actor role, active users/memberships/calendars, request revision, roster revisions and active shift codes in one D1 batch before changing one or two roster dates and closing the request. Decline, cancellation and rejection close the request without roster writes. Stable mutation IDs make exact retries return the recorded result and reject changed payloads; current permissions are checked before replay.

The browser exposes submission only from the signed-in member/viewer's own assigned shift, previews the counterpart's saved date before a swap request, retains mutation IDs until confirmed actions, and lists only requests relevant to the signed-in participant or current manager. Reasons are omitted from roster/team cards and opened separately for authorized participants. Local validation passes 80 Worker/D1 tests and eight browser-client tests, app/Worker/test typechecks, the Cloudflare web export, local migrations and the production dry run.

**Completed 2026-09-14:** migration `0006_shift_change_requests.sql` is applied and protected Worker version `1b19b8cb-e57d-4502-81d7-68e38b68cac9` is live. The member submitted a direct Night-to-Morning request for September 17 from the assigned read-only team calendar. The team leader saw the manager queue and approved it; the calendar and request history still showed Morning and approved after refresh. A second hosted run exercised the complete two-party swap: the member offered September 18 Late for the leader's September 21 Morning, the leader explicitly accepted as counterpart, then approved as current manager. The saved roster now has Morning on the member's September 18 and Late on the leader's September 21, with both rows at version 2 and the request approved at version 3. Live CPU was 10 ms for submit, 3 ms for list, 5 ms for counterpart response and 7 ms for manager resolution. D1 records exactly two creates, one counterpart response and two resolutions, with no pending request, unresolved mutation, transaction-check residue or incomplete schedule run. The two private Morning baselines remain unchanged at versions 30 and 113. See [sanitized M6 evidence](cloudflare/live-evidence/2026-09-14-m6-change-requests.json). Roll back code to version `43ab8a40-bc72-4fd1-92c7-2b60b780b42e` if needed and retain the additive D1 table and documented M6 roster fixtures.

**Exit evidence:** approval changes a roster exactly once, rejection changes nothing, and simultaneous/stale/foreign-user requests are handled correctly.

### Phase 4 — M7: migration and recovery

- [x] Preview imports with team/member mapping, date/shift-code validation and conflict reporting. Preserve source backups and exclude private notes/pay settings from team imports.
- [x] Add bounded, retry-safe imports, authorized exports and audit views.
- [x] Demonstrate D1 Time Travel on a rehearsal database and export/import recovery; protect exported user data and document the chosen backup frequency and retention.
- [x] Demonstrate Worker code/assets rollback using a retained version and compatible schema. Code rollback does not restore D1 data; use forward-compatible migrations and a separate data-recovery procedure.

**Completed 2026-09-14:** additive migration `0007_team_import_runs.sql` and Worker version `e0dc8e5d-35bb-459a-b662-b8d12d59a46a` are live. A current team leader or manager can load or paste strict CSV/JSON, preview up to two explicitly mapped assignments, and apply with stable retry IDs. Server checks cover current role, member/calendar assignment, active shifts, valid Malaysia dates, duplicate targets, stale revisions, changed payloads and revoked access. Exact retries return the recorded result. Roster, request and audit exports are manager-only, paginated and available as stable JSON or formula-neutralized CSV; request reasons and all private-calendar details are omitted.

Hosted acceptance imported the leader's 22 September Morning shift, then the member saw it after refresh with no scheduling/import/export control and an explicitly read-only day sheet. Roster, request and audit downloads completed in the leader session. The private Morning baselines remain unchanged at versions 30 and 113. Candidate reads used 3–10 ms CPU in the retained live sample.

Recovery was rehearsed only on disposable APAC databases with sanitized `.invalid` identities. Time Travel restored a changed roster row from Night/version 2 to Morning/version 1. A separate SQL export/import copy reproduced two users, one team, two memberships, one roster row, one approved request, one mutation, one audit event and one completed import record. All rehearsal databases and the temporary local SQL file were deleted after verification. For the pilot, export roster/request/audit JSON before every structural import and weekly while the team is active; store it in encrypted operator storage, retain 30 days, and delete expired copies. D1 Free Time Travel supplies a separate rolling seven-day recovery window. Follow [the recovery runbook](cloudflare/RECOVERY.md).

The Worker rollback drill routed 100% to retained version `1b19b8cb-e57d-4502-81d7-68e38b68cac9`, verified that the custom domain, Access protection, application route, API route and asset route remained protected, then restored hosted candidate version `52e09446-df05-4a89-91cc-dab4658089b9` at 100%. Final version `e0dc8e5d-35bb-459a-b662-b8d12d59a46a` adds the locally verified strict CSV column-count check. The additive table remains during code rollback. Data recovery requires the independent Time Travel/export procedure.

**Exit evidence:** malformed imports and retries cannot corrupt schedules; recovery verifies users, memberships, rosters and requests; rollback and backup handling are documented.

### Phase 4 — M8: one-team rollout and expansion gate

- [x] Run typechecks, focused Worker/D1/client tests, browser end-to-end checks, Expo export and Wrangler deployment validation.
- [x] Verify phone/desktop login, session changes, nested routes, roster editing, requests and exports with one real team.
- [x] Measure a normal scheduling cycle, review shared quotas and logs, and resolve authorization/data-integrity failures before expansion.
- [x] Decide the expansion gate: keep the current team for a seven-day observation window, then admit at most one additional team if every stop condition remains clear. Revisit authentication before exceeding 50 total Access users; do not quietly upgrade or promise 100 users for free.
- [x] Attach the custom domain only when ready; revalidate Access coverage, origin/CSRF settings, logout and deep links before switching users.

**Completed 2026-09-14:** final-version local validation passes 83 Worker/D1 tests, 11 browser-client tests, 14 pilot checks, all typechecks, the 78-file Cloudflare web build, an Android local-only export, local migrations through `0007`, and the production deployment dry run. The Android bundle contains no production hostname, Access-cookie name or cloud-session marker. Desktop and phone-sized member checks pass direct/reloaded routes with no horizontal overflow, a read-only assigned team calendar, no manager migration/export controls, and 403 denial for import, export and a foreign private calendar.

Worker `ea4a78a5-0157-4326-af76-5de7ac9843c4` is deployed through the production config with 10% log and 1% trace sampling. App, nested route, API and asset requests redirect to Access without a session; the disabled `workers.dev` address returns 404. Production has no pending migration, a current Time Travel bookmark, two Access seats in use, four of ten account-wide D1 databases, a 417,792-byte ShiftCalendar database and 49 retained Worker versions. A rollback rehearsal sent 100% traffic to M7 version `e0dc8e5d-35bb-459a-b662-b8d12d59a46a`, confirmed Access coverage, restored the candidate and then deployed the final configured version without rewinding D1.

The one-team cycle passed strict CSV and versioned JSON import, exact-retry, changed-payload and stale-preview checks; member refresh; one direct request and one leader approval; and privacy-safe roster, request and audit exports. Final D1 state is Night/version 3 on September 23 and Afternoon/version 2 on September 24, with the request approved at version 2, five completed import runs and no pending request, incomplete import/schedule run or transaction-check residue. Exact import and resolution retries each used 9 ms CPU on the final version. The pre-cycle aggregate had zero Worker errors and low quota use, although CPU P99 was 13.592 ms while P90 was 8.023 ms. Keep the current one-team deployment for seven stable days before admitting one additional team, then reassess one team at a time. See [the sanitized M8 evidence](cloudflare/live-evidence/2026-09-14-m8-rollout.json).

**Exit evidence:** accepted team workflow, recorded performance/usage and recovery results, remaining limitations, and an onboarding ceiling supported by available seats and quotas.

## Release records and historical evidence

For every milestone record commit IDs, commands/results, environment, deployment identifiers where applicable, and unfinished acceptance checks. Commit coherent changes occasionally; never commit login PINs, tokens or private backups.

The previous AWS M2 work is historical: infrastructure and client code were implemented, but CloudFront verification prevented a live release and the stack reached `ROLLBACK_COMPLETE`. See [historical M2 verification](../ShiftCalendar-aws/docs/M2_VERIFICATION.md) and [historical AWS Support draft](../ShiftCalendar-aws/docs/AWS_CLOUDFRONT_VERIFICATION.md). Existing AWS budget or resource state must be inventoried independently; this document neither deletes resources nor declares AWS costs eliminated.

This revision changes the deployment plan only. Cloudflare provisioning, code migration and live acceptance require the milestone evidence above; completed AWS checks are not carried over as completed Cloudflare checks.

## Current repository progress

M2c through M8 are complete for the two-user, one-team browser pilot. The one-team rollout is accepted; admission of a second team waits for a stable seven-day observation window and must proceed one team at a time under the documented stop conditions. See [CLOUDFLARE.md](CLOUDFLARE.md) for identity, persistence, privacy, permissions, CPU, D1, resource/version, migration and recovery evidence. Production has two active approved identities, one team leader and one standard member.
