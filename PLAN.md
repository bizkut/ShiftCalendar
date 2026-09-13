# ShiftCalendar: Cloudflare Hosting, Users, and Teams

Updated 2026-09-13. This plan supersedes the AWS hosting plan. The Cloudflare
private-calendar slice is implemented and locally tested; live deployment and
full application milestones remain pending. See [the runbook](CLOUDFLARE.md).

## Goal and confirmed constraints

Deploy a private, multi-user, multi-team shift calendar using Cloudflare Free
services, retaining the existing Expo application and native local-only mode.
Use a generated `https://shiftcalendar.<subdomain>.workers.dev` address first;
`amazonian.my` is not ready. Reserve `shifts.amazonian.my` for the later domain
milestone. The generated address is a placeholder until Cloudflare assigns it.

Target recurring hosting cost: **US$0 within the selected Free plans' quotas**.
Free allowances are shared with other workloads, can change, and are not a
promise of free hosting forever. Do not enable paid plans or optional billed
services automatically when a limit is reached.

The first release is an invite-only browser pilot, not unlimited public signup.
Cloudflare Access Free supports up to 50 users across the Zero Trust organization,
including administrators and users of other protected applications. Its onboarding
requires payment details even on Free. Confirm actual account eligibility and
available seats before provisioning. [Plans](https://www.cloudflare.com/plans/),
[Zero Trust setup](https://developers.cloudflare.com/cloudflare-one/setup/).

Cloudflare is a global platform. D1's `apac` location hint is best-effort and does
not guarantee Malaysian residency. Keep `Asia/Kuala_Lumpur` as the calendar's
default timezone. If Malaysia-only storage becomes a requirement, revisit this
architecture before storing personal data.
[Data location](https://developers.cloudflare.com/d1/configuration/data-location/).

## Component-to-service map

| Component | Selected service | Purpose and migration work |
|---|---|---|
| Expo web export, HTTPS and static delivery | Workers Static Assets | Publish `dist/`, SPA deep links, hashed assets and security headers; replaces S3/CloudFront |
| Application API, `/v1/*` | Cloudflare Worker, Free | Same-origin Fetch API handlers; replaces API Gateway/Lambda |
| Users, private calendars, teams, memberships, invitations and versioned records | D1, Free | Relational SQLite schema and indexed bounded queries; replaces DynamoDB |
| Pilot login and application admission | Cloudflare Access / Zero Trust Free | Approved-email one-time PIN login; replaces Cognito for the browser pilot |
| Team and calendar permissions | Worker + D1 | Authoritative per-request authorization; Access does not provide application team roles |
| Runtime configuration/secrets | Wrangler configuration and Worker secrets | Public identifiers in configuration; credentials outside Git and browser bundles |
| Local development and deployment | Pinned project Wrangler + Workers runtime tests | Local D1 migrations, local builds, dry-run, versioned releases |
| Operational visibility | Workers built-in metrics and logs within Free limits | Redacted errors, CPU/request/SQL quota monitoring; verify retention and ingestion limits |
| Recovery | D1 Time Travel + manual encrypted exports | Restore drills and independent recovery copies; no automatic R2 dependency |
| Later custom address | Cloudflare DNS and Worker custom domain | `shifts.amazonian.my`, managed HTTPS, Access policy/origin updates after DNS is ready |

Use one Worker with Static Assets and a D1 binding. Static requests should be
served directly; execute the Worker for API routes rather than every asset.
Cloudflare recommends Workers Static Assets for new applications.
[Static Assets](https://developers.cloudflare.com/workers/static-assets/).

No EC2, AWS Glue, Cognito, Lambda, DynamoDB, S3 or CloudFront is required by this
target. R2, KV, Durable Objects, Queues, Cron, AI and paid email are deferred until
a concrete feature requires them. KV is not an authoritative membership store.

## Free-plan budget and feasibility gates

| Service | Published Free allowance | Pilot guardrail |
|---|---|---|
| Workers Static Assets | Static asset requests free and unlimited | Avoid routing all assets through Worker execution |
| Workers | 100,000 dynamic requests/day; 10 ms CPU per invocation; 3 MB compressed Worker size | Measure JWT verification, handlers and imports; budget requests and bundle size |
| D1 | 5 million rows read/day, 100,000 rows written/day, 5 GB total storage | Track indexed reads and writes; avoid scans and constant polling |
| D1 per database / invocation | 500 MB per database; 10 databases on Free; 50 queries per Worker invocation | One pilot database must fit 500 MB; paginate long histories below query limits |
| D1 recovery | 7 days of Time Travel on Free | Exercise restoration and maintain independent exports |
| Access / Zero Trust | Up to 50 users on Free | Check shared seat usage and approved-email admission before invitations |

Sources checked 2026-09-13: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

These are published allowances, not confirmation of this Cloudflare account's
remaining entitlement. Exhausting Free limits can interrupt service. Start with
one deployed pilot, local builds, bounded retries and no persistent preview
resources. Set operational warnings before limits; warnings are not spending caps.
The prior AWS cost estimate does not apply to this architecture.

## Milestones and current goal slice

| Phase | Milestone | Exit evidence | Status |
|---|---|---|---|
| 0 | M0: Cloudflare feasibility and tools | Account/Free/Access eligibility recorded; runtime/auth spike fits limits | Account/Free/Access inventory verified; live fit remains M1b |
| 1a | M1a: Local Cloudflare vertical slice | Worker + D1 + Access identity adapter pass runtime tests and web export | Local implementation and validation complete |
| 1b | M1b: Hosted browser pilot | Protected `workers.dev` login and private save/reload round trip | Planned |
| 2 | M2: Personal cloud calendars | CRUD, privacy, conflict handling and resumable personal import | Planned; reusable AWS-era application code exists |
| 3 | M3: Teams and rosters | Two teams, all roles, safe invitations and paginated rosters | Planned; reusable UI/domain code exists |
| 4 | M4: Pilot release | Isolation, recovery, quota, browser/mobile and security checks pass | Planned |
| 5 | M5: Offline cloud sync | Durable replay, conflicts, tombstones and full resync work | Deferred until M4 |
| 6 | M6: Approved swaps | Atomic approval and in-app notification workflow | Deferred until M4 |
| Later | MD: Custom domain | New address passes the same authentication checks | Waiting for domain |

**Current slice: M0 + M1a, locally implemented.** Evidence and outstanding live
checks are in [CLOUDFLARE.md](CLOUDFLARE.md). The next slice is M1b, hosted
Access and persistence verification. Original acceptance scope: establish Cloudflare Free
eligibility, then port one authenticated private-calendar read/write path to a
local Worker and D1. Test two identities, forbidden IDs, stale writes, retries,
JWT validation and bounded SQL before publishing. Deliver a pinned Wrangler
configuration, versioned SQL migration, auth adapter, focused tests, clean web
export and Cloudflare deployment runbook. Do not mark this complete from AWS tests.

## Login and authorization

Use Access's hosted email one-time PIN screen for approved pilot emails, with an
application login/expired-session/sign-out experience. Explicitly enable the OTP
identity provider; do not assume it is enabled by default. A new PIN replaces
password recovery. Manually shared team invitations still require approved Access
admission; receiving an invitation must not automatically admit arbitrary users.
[OTP login](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/).

Protect the selected Worker's production and preview addresses and all API routes.
Scope configuration to ShiftCalendar rather than changing every Worker in the
account. Create reusable Access policies and attach them to the application.
Do not use an Access Bypass policy for authenticated calendar APIs.

**Static Assets caveat:** `ctx.access` is currently unavailable for Workers with
Static Assets. The API must cryptographically verify the forwarded Access JWT
(signature, issuer, exact application audience and expiry), using a compatible
JWT library and cached JWKS. Do not trust decoded JWTs or email headers alone.
Prove this flow on the chosen `workers.dev` setup in M1 before relying on it.
[Workers Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/),
[Static Assets routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/).

Map verified identity to an internal user; check disabled-user state and current
D1 ownership/membership on every request, including retries. Check exact Origin
and CSRF protection on cookie-authenticated mutations, use no GET mutations,
return private API responses with `Cache-Control: no-store`, and avoid permissive
credentialed CORS. Handle expired Access sessions as reauthentication rather than
trying to parse a redirected login page as JSON. Clear private caches on logout
and user changes; never persist sessions in local backups.

Native cloud login is a separate integration gate: the browser Access flow is not
a drop-in replacement for Cognito's native PKCE client. Preserve native local-only
mode and clearly disable unsupported cloud login until tested secure session
handling is available. Browser pilot delivery does not imply native cloud readiness.

| Action | Owner | Manager | Member | Viewer |
|---|---|---|---|---|
| Read team roster | Yes | Yes | Yes | Yes |
| Edit own assigned schedule | Yes | Yes | Yes | No |
| Edit other team schedules | Yes | Yes | No | No |
| Invite/remove members and assign non-owner roles | Yes | No | No | No |
| Transfer ownership/delete team | Yes | No | No | No |

A user may belong to multiple teams with different roles. Keep exactly one owner;
ownership transfer must be atomic before that owner leaves. Private calendars,
notes, pay/rates, overtime estimates, leave reasons and balances remain private,
including team exports and logs. Team records contain shared schedule fields only.

## Migration boundaries and data design

Retain Expo/React Native and the local/cloud repository boundary in
`hooks/ShiftContext.tsx`, `hooks/useShiftData.ts`, `hooks/useCloudShiftData.ts` and
`shared/cloudTypes.ts`. Replace Cognito/Amplify in `hooks/AuthContext.tsx` and adapt
`utils/cloudClient.ts` to same-origin authenticated requests. Preserve allowlisted
local backup/reset behavior in `utils/exportImport.ts` and `utils/localDataKeys.ts`.

Port `backend/src` HTTP handling from Lambda events to Workers Fetch API and
replace the AWS SDK DynamoDB repository with D1. Reuse domain validation and
contracts where appropriate; port tests to the Workers runtime. Existing AWS
infrastructure and scripts are historical reference until the Cloudflare release
is validated. Do not use `aws:deploy` for this plan.

D1 tables: users, teams, memberships, calendars, shift_types, calendar_days,
private_details, invitations, mutations and audit records. Use foreign keys,
unique membership/invitation constraints, tenant-scoped indexes, bounded row
sizes and paginated calendar/date-range queries. Avoid whole-database scans.
Use calendar-local dates and IANA timezones, with UTC audit times and explicit
overnight-shift handling.

Preserve expected versions, mutation IDs and deletion tombstones to prevent
stale edits recreating deleted data. Atomically validate current membership,
versions and invitation state with the affected writes. D1 batches roll back on
SQL errors, but a conditional UPDATE affecting zero rows is not itself an error:
transaction design must prevent partial effects in that case. Validate owner
transfer, single-use invitation redemption and audit/idempotency writes under
concurrency. Hash high-entropy invitation tokens; enforce expiry and revocation.

Bound bulk edits to eight days and private writes to four dates / 2 KB per date
unless measurements justify a revised bound. Replace the old potentially 37-query
private-history response with explicit pagination to leave headroom under D1's
50-query invocation limit. Authorize every referenced record in bulk operations.
Mark deleted teams/calendars inaccessible first, then clean dependencies in bounded
retryable batches.

MVP cloud edits require connectivity. Preserve unsaved drafts and show pending,
saved, failed, cached and conflict states. Load bounded snapshots on open/refocus,
manual refresh and after writes; avoid constant polling. Partition caches by user
and calendar. Local-only calendars remain offline-capable. M5 adds transactional
ordered change feeds, opaque cursors, durable outboxes and full-resync recovery;
client timestamps alone are insufficient.

## Milestone checklists

### Phase 0 — M0: Confirm Cloudflare feasibility

- [x] Select the Cloudflare component map and phased migration strategy.
- [x] Install official Cloudflare agent skills and register the five documented MCP servers.
- [x] Complete OAuth for the four authenticated MCP connections; the docs server is public.
- [x] Inspect the intended account, existing resources, Free plan status, Zero Trust
  setup/payment requirements and available user seats.
- [x] Record the global/APAC location constraint and the account's available 50 seats.
  Capacity assumption: invite-only browser pilot below that shared limit; live
  traffic and CPU fit must be measured in M1b.
- [x] Pin project Wrangler on Node 24 LTS; use project-local tooling, not unnecessary
  global/Homebrew installations. Keep authentication/config secrets out of Git.
- [x] Test local JWT verification, bounded D1 queries and Worker packaging;
  verify web/native exports. Live Access forwarding and production JWT CPU
  measurement remain explicit M1b gates; local tests cannot prove those limits.

**Exit:** the account and selected services can support the bounded browser pilot,
and the current limitations are recorded without claiming guaranteed free operation.

### Phase 1 — M1: Hosted website and login

**M1a — local readiness**

- [x] Add Worker configuration, D1 binding and versioned SQL migrations.
- [x] Implement one private-calendar read/write path with JWT verification,
  current ownership checks, version conflicts and retry-safe mutations.
- [x] Adapt login/client state and maintain the local-only native path.
- [x] Test actual Workers/D1 runtime behavior, invalid/expired/wrong-audience tokens,
  identity spoofing, CSRF, revoked membership and conditional-write races.
- [x] Export Expo with `web.output: "single"` and `--clear` to prevent stale build
  environment values; check SPA reloads and missing asset behavior.

**M1b — hosted verification**

- [ ] Provision one Free Worker/D1 pilot and scoped Access policies; record actual
  identifiers and the assigned `workers.dev` URL without committing credentials.
- [ ] Deploy assets/API together; validate routing, HTTPS and response headers.
- [ ] Test fresh-browser approved-email PIN login, disallowed email, sign-out,
  expiry and reauthentication on direct routes and preview addresses.
- [ ] Verify a private edit survives reload and appears in a second browser for
  the same user; a second user cannot read it by changing IDs.
- [ ] Record deployment/rollback instructions and measured CPU/SQL/request usage.

**Exit:** a working protected browser URL with verified authentication and one
private persistence round trip. Full teams and production readiness remain M2–M4.

### Phase 2 — M2: Personal cloud calendars

Deliverables: repository abstraction, D1 persistence, private operations,
versioned writes, and opt-in migration.

- [ ] Implement local/cloud repositories behind the existing data context.
- [ ] Add calendar CRUD, month reads, day edits, shift types, notes, overtime,
  leave, and user-private pay/preferences storage.
- [ ] Enforce ownership, validation, expected versions, and mutation IDs.
- [ ] Show loading, unsaved, error, conflict, and cached-data states.
- [ ] Preview imports and map local calendar/type IDs to new cloud IDs.
  Make interrupted/repeated imports resumable without duplicates.
- [ ] Import into personal scope only. Preserve the original local recovery copy
  until the user verifies the result. Allowlist backup data and exclude tokens.

**Exit:** an edit appears after refresh on a second signed-in device/browser.
Another user cannot access it by changing IDs. Stale edits conflict, retries do
not duplicate records, and interrupted imports resume safely.

### Phase 3 — M3: Teams and shared rosters

Deliverables: team administration, invitation links, grouped navigation, member
schedules, and the permissions matrix above.

- [ ] Add create/rename/delete team, ownership transfer, and member removal/leave.
- [ ] Implement invitation creation, expiry, revocation, and atomic acceptance.
- [ ] Group `CalendarSwitcher` by Personal / Team A / Team B and add team settings.
- [ ] Create team-owned schedules for scheduled participants and a combined roster
  with member/date filters.
- [ ] Enforce Owner/Manager/Member/Viewer permissions in the Worker and reflect them in the UI.
- [ ] Exclude private notes, leave reasons/balances, and pay from team responses and exports.

**Exit:** one user belongs to two teams with different roles. Team members see
their roster while outsiders cannot. Members edit their own schedules, managers
edit team schedules, and viewers cannot edit. Expired/reused invitations and
removed members are rejected. The owner cannot leave without transferring ownership.

### Phase 4 — M4: Pilot release

Deliverables: validation evidence, recovery procedures, cost monitoring, and a
usable hosted release for the first teams.

- [ ] Test two isolated teams, a user in both, all roles, forged resource IDs,
  revoked membership, concurrent edits, bulk failures, and import retries.
- [ ] Implement user deletion with ownership transfer and retained-team-data rules.
- [ ] Test user switching/logout, deep links, refresh, token expiry, overnight
  shifts, deletion, and absence of personal details in team payloads/logs.
- [ ] Verify mobile local-only behavior and native cloud login/storage (a separate integration gate); validate web
  CSV/JSON flows and graceful handling of native-only features.
- [ ] Measure requests, payloads, database capacity, and throttling under the
  pilot workload; improve batching/caching before raising capacity.
- [ ] Monitor Workers CPU/requests and D1 rows/storage against shared Free quotas;
  redact logs and use bounded retention. Exercise quota exhaustion and recovery.
- [ ] Demonstrate D1 export and restore into a separate database, plus Time Travel
  recovery. Keep encrypted recovery copies outside the live database.
- [ ] Document code rollback separately from database recovery; use compatible,
  versioned SQL migrations and retain user data during rollback.
- [ ] Test Access JWT validation, CSRF protection, session expiry, logout, all
  production/preview routes, and rejection of spoofed identity headers.
- [ ] Review existing Expo/transitive dependency audit findings before release.
- [ ] Document deployment, session recovery, export/deletion, and quota reviews.
- [ ] Update README for local-only versus cloud storage and supported web features.
- [ ] Review whether to keep or clean up temporary implementation resources.

**Exit:** desktop and mobile browsers pass login → team → roster → edit;
permission tests pass, recovery has been demonstrated, and observed pilot
usage and hosting lifetime are understood.

### Phase 5 — M5: Offline cloud synchronization

Deliverables: durable outbox, ordered change feed, replay-safe writes,
tombstones, conflict handling, and migration from snapshot-only cloud mode.

- [ ] Add per-user persistent queues, retry/backoff, and idempotency.
- [ ] Implement server cursors, transactional change records, deletion
  propagation, cursor expiry, and full-resync recovery.
- [ ] Display pending changes and conflicts with deliberate resolution.
- [ ] Reauthorize replayed edits and reject removed/downgraded members.

**Exit:** offline edits survive restart and reconnect without duplicates.
Two devices reconcile; conflicts surface; deleted records do not reappear;
old cursors recover; one user's queue never replays under another identity.

### Phase 6 — M6: Approved swaps and notifications

Deliverables: a real team swap workflow replacing the current message-only offer.

- [ ] Add offer, accept, reject/cancel, expiry, and manager approval states.
  Default to approval before changing published schedules.
- [ ] Verify participants, membership, current entries, and versions; update both
  shifts and swap state in one transaction.
- [ ] Commit audit and durable notification work with the swap. Retry delivery
  independently so notification failure does not undo a valid schedule change.
- [ ] Start with in-app notifications. Evaluate mobile push, permissions, delivery
  providers, and costs separately; web push, email, and SMS are not assumed free.

**Exit:** concurrent acceptance cannot apply a swap twice, stale/ineligible swaps
fail clearly, approval is enforced, and notification delivery retries safely.

### Later — MD: Custom address when the domain is ready

Dependency: M1 plus authoritative DNS control for `amazonian.my`.

- [ ] Confirm `shifts.amazonian.my`, Cloudflare zone ownership and DNS setup.
- [ ] Attach a Worker custom domain with HTTPS and update scoped Access policies,
  application origins, links, session behavior and any native callbacks.
- [ ] Verify login/logout, expiry, direct routes, private APIs and CSRF on the new
  origin. Keep the old address protected or disable it; document rollback.

**Exit:** the custom hostname passes M1 authentication checks without replacing
users or calendar data. Domain readiness does not block the initial pilot.

## Historical AWS work and release status

The AWS implementation passed local checks, but the deployment attempt failed at
CloudFront project verification. Temporary resources were cleaned up and verified
on 2026-09-13; there is no live AWS calendar URL or user data to migrate. Brief
setup charges may still appear. The Support intake interaction was sent, but the
case form was not submitted before the provider switch; there is no case ID.

The prior plan is preserved in Git history at `a7cc9d4`. [DEPLOYMENT.md](DEPLOYMENT.md)
and [the verification draft](infrastructure/cloudfront-verification.md) are legacy
AWS references. Existing tests and AWS validation are useful migration inputs,
not evidence that Cloudflare is implemented. Personal import, team administration,
full roster pagination, recovery and live acceptance still require their phase
checks. No Cloudflare application resources have been deployed. The local M1a
implementation and account findings are recorded in [CLOUDFLARE.md](CLOUDFLARE.md).
