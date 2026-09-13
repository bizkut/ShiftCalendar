# Cloudflare local readiness and deployment handoff

M0 + M1a, checked 2026-09-13. The private-calendar vertical slice runs locally.
M2b deployment is in progress (the earlier plan called it M1b). The dedicated
D1 database and protected Worker are deployed. The first real OTP login and
private edit/reload are verified; second-identity and independent-browser checks
remain in progress. See the progress record below.

## Verified account state

Read-only inspection of the signed-in Cloudflare dashboard established:

| Item | Observed state |
|---|---|
| Account | `21f5adfe18eb705dbc0fd820ccc88a28` |
| Workers plan | Free, shown as Current plan |
| Existing workloads | Other Workers already run in this account; quotas are shared |
| D1 | 3 of 10 databases; total storage 18.22 MB; no ShiftCalendar database |
| D1 period display | September 13: 0 rows read/written shown, $0.00 billable usage; a dashboard snapshot, not a reservation of quota |
| Zero Trust | Free; team domain `bitter-cell-8976.cloudflareaccess.com` |
| Seats | 0 users out of 50; 50 seats available at inspection |
| Access applications | 0 |
| Identity providers | One-time PIN already configured |
| Agent setup | Five MCP registrations; four OAuth logins verified; docs needs no login |

The Zero Trust organization already exists, so no new payment onboarding was
needed for these checks. No payment method was inspected or changed. General
Free onboarding requirements still apply if the organization must be recreated.
The MCP connections require an agent restart to become callable in an existing
session; these account checks used the signed-in dashboard.

Workers/D1 Free eligibility is confirmed by the current plan and inventory, but
creation permissions and live Access protection still need M1b verification.
D1 has seven database slots remaining at inspection, not a dedicated reservation.
Recheck usage and seats immediately before deployment. Do not modify the existing
applications, databases, domains or inactive tunnel during this migration.

Use an `apac` D1 location hint when provisioning later. This is best-effort, not a
Malaysia-only storage guarantee. Calendar timezone defaults to `Asia/Kuala_Lumpur`.
[Data location](https://developers.cloudflare.com/d1/configuration/data-location/).

## Local development

The repository has an isolated `cloudflare/` npm project and lockfile. Wrangler
4.131.1, jose 6.2.12, Vitest 4.1.11 and Cloudflare's Vitest plugin 1.1.8 are pinned.
Node 24 is recorded in `.nvmrc`. Homebrew Node 24 LTS was installed side-by-side;
the system default was not relinked. Select Node 24 with your version manager or
use its `/opt/homebrew/opt/node@24/bin` directory first in the command's PATH.

From the repository root:

```sh
rtk npm ci
rtk npm --prefix cloudflare ci
rtk npm --prefix cloudflare run types
rtk npm --prefix cloudflare run migrate:local
rtk npm run cf:test
rtk npm run cf:typecheck
rtk npm run typecheck
rtk npm run cf:prepare
rtk npm run cf:dev
```

`cf:prepare` exports Expo with a cleared Metro cache, disables dotenv loading,
sets the Cloudflare browser provider, clears AWS public build settings and adds
static response headers. It then runs a Wrangler dry-run, which does not deploy.
The committed config is explicitly local: fake database UUID, `remote: false`,
no `workers.dev`/preview publication and an unconfigured Access audience.
`cf:dev` uses local D1 and static assets at `http://localhost:8787`.
With that server running, `rtk npm run cf:smoke:local` checks deep links without
following redirects, missing assets and unsigned API rejection.
Do not turn the local placeholder configuration into a production deployment.

The local web page renders the approved-email login screen and rejects unsigned
API requests. There is deliberately no development authentication bypass. Tests
generate temporary signing keys and substitute only the JWKS HTTP response; real
JWT verification, Worker handlers, SQL migrations and D1 transactions execute in
workerd. They are separate from the local browser's unsigned requests.

To test real hosted Access later, supply the actual issuer and exact application
audience in the deployment-specific configuration. Never commit JWTs, API tokens,
private signing keys or local `.dev.vars` files. The browser stores no Access token
in application storage; Access owns its session cookie. Native builds select the
existing local-only path when the Cloudflare provider is enabled. Native cloud
login remains disabled until its separate integration gate passes.

## What this slice implements

- Verified Access JWT identity and a same-origin browser client, with session
  expiry/sign-out handling, exact-Origin checks, a CSRF request header and no
  credentialed cross-origin API access.
- Personal calendar creation/list/read; bounded date-range reads and versioned
  shift assignment/deletion. Deleted days retain versioned tombstones.
- D1 transaction checks for disabled users, current membership, schedule ownership,
  roles, expected versions, idempotency records and audit records. Failed checks
  roll back the entire write. Replayed edits return current authorized day state.
- Real handler tests for session → bootstrap → create → write → reload with two
  identities, plus forged IDs, concurrent writes and revocation races.
- Static files served directly when present. Missing assets return 404 with
  `no-store`; application page paths fall back to `index.html` with short caching.

Team administration, import, custom shifts, notes/pay/leave details, calendar
rename/delete, bulk editing and full pagination remain their M2/M3 work. The API
rejects unsupported operations rather than acknowledging unsaved data. M1's
private-detail/custom-shift reads are empty because their writes are unavailable;
the UI retains the built-in shifts. The full app is not release-ready at M1a.
The AWS backend remains historical reference and is not used by this Worker.

## Validation and Free-plan limits

Validation performed locally:

- 25 workerd tests: JWT signature/claims, CSRF, D1 persistence/isolation, stale
  writes, concurrent retries, tombstones, user disablement, role restrictions,
  revocation between preliminary read and transaction, bounded dates and real API flow.
- Six browser-client unit tests: same-origin cookies/headers, HTML/redirect/401
  session expiry, conflict errors and invalid-response rejection.
- App and Worker/test type checks, local migration, clean Expo web export and
  Wrangler packaging. Existing 14 script tests and 11 AWS-backend tests also pass;
  those legacy checks do not prove Cloudflare functionality.
- Android export with the Cloudflare provider enabled succeeds; this is bundle
  compatibility evidence, not a physical-device or native cloud-login acceptance test.
- Local browser login screen and direct route reload; HTTP probes verified
  `/login` and `/teams` return HTML, missing JavaScript returns 404, and unsigned
  `/v1/session` returns 401 JSON with `no-store`.

The initial Worker dry-run measured approximately 14 KiB compressed, far below
the Free Worker code limit of 3 MB; the final packaging output is authoritative.
The Expo JavaScript asset is approximately 3.6 MB uncompressed and is a static
asset, separate from Worker code. Both figures will change with later features.

Date reads accept at most 93 days and return at most 93 rows. Calendar lists use
an indexed cursor with at most 100 results plus one lookahead row. A successful
single-day API mutation uses nine SQL statements (including authentication and
transaction checks), below D1 Free's 50-query invocation limit; conflict/retry
paths add bounded lookups. These are code bounds, not measured production usage.
The test suite executes actual local D1 queries, but its wall time does not
establish production CPU consumption or network latency.

Workers Free allows 100,000 dynamic requests/day and 10 ms CPU/request. D1 Free
allows 5 million rows read/day, 100,000 rows written/day, 500 MB per database and
5 GB total account storage. Index maintenance and authorization queries count.
Free allowances are shared and exhaustion may interrupt service. Live warm/cold
JWT verification, JWKS rollover, CPU, D1 row usage and burst behavior must be
measured in M1b before declaring this workload fits. Do not silently upgrade plans.
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

## Deployment procedure — see progress record for executed steps

1. Recheck the exact account ID, Workers Free plan, D1 quota and Zero Trust seats.
   Use scoped Wrangler OAuth or a scoped token; MCP OAuth does not automatically
   authenticate Wrangler. Inspect `wrangler whoami` before resource operations.
2. Create one dedicated ShiftCalendar D1 database with the `apac` location hint.
   Record its actual UUID in a separate reviewed production config. Retain the
   local config with its local-only binding. Never reuse another app's database.
3. Prepare production `name`, D1 UUID, exact HTTPS `APP_ORIGIN`, Access issuer and
   application audience. Enable the selected Worker's generated `workers.dev`
   address only after scoped Access protection is in place. Use reusable Access
   policies admitting specific pilot emails, attached only to this application.
   No API Bypass policy. Protect or disable previews and alternative hostnames.
4. Apply the versioned migration to the new empty remote database explicitly;
   confirm the target and review SQL first. Export the web build with `cf:build`,
   then dry-run the production config and inspect its bindings and assets.
5. Deploy the reviewed Worker/assets and verify Access protection before admitting
   users. With Static Assets, do not rely on `ctx.access`; verify forwarding of
   `Cf-Access-Jwt-Assertion` against the real application JWKS and audience.
6. Run fresh-browser approved/disallowed-email OTP tests, sign-out, expiry,
   refresh, direct routes, private read/write on two browsers, wrong identities,
   CSRF and all alternative URLs. Record actual URL, versions and usage metrics.
7. Keep the domain milestone deferred. `shifts.amazonian.my` requires a separate
   DNS/custom-domain/Access-origin transition once the domain is ready.

Consult the pinned CLI's `--help` for resource-specific commands before execution.
[Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/),
[Workers Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/).

## Rollback and recovery

Record the previously deployed Worker version before each future release. Roll
back code with the pinned Wrangler rollback command after checking its help and
target config. Worker rollback does not restore D1 data or undo migrations.
Keep schema changes additive/backward-compatible until the old version is retired.

Before destructive migrations, export the correct D1 database to an encrypted,
access-controlled recovery copy. Test restoration into a separate database before
rebinding production. Free Time Travel provides seven days of recovery; verify
its restore point and downstream effects before using it. Do not delete the
calendar database to undo a failed Worker deployment. Local test databases can be
recreated by applying migrations to a fresh local persistence directory.
[Rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/),
[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

## M2b deployment progress — 2026-09-13

- Dedicated D1: `shiftcalendar`, UUID `79c5678c-e084-49da-bfca-fbfbb5c41fdf`, created with the APAC hint. Migration `0001_calendar.sql` applied remotely successfully (13 commands). Other databases were preserved.
- Production config: `cloudflare/wrangler.production.jsonc`; separate from local configuration. `workers_dev` and `preview_urls` are false; the audience remains unconfigured pending Access attachment.
- Staged Worker version: `4d1eaa46-4f59-42b4-b91d-fc04001ce837`; upload succeeded with **no public targets**. Intended address: `https://shiftcalendar.bizkut-limau.workers.dev`. This is not yet an accessible pilot URL.
- Reusable Access allow policy: `0d65d035-cd9e-4de1-b297-1623fd35d070`, “ShiftCalendar pilot emails”; exactly the two approved identities, 15-minute session for acceptance testing. Created but not yet attached to an application.
- Refreshed scoped Wrangler OAuth: account/user read, Workers and Worker scripts write, Workers tail read, D1 write; no credentials recorded here.
- Dashboard recheck: Zero Trust Free; Workers daily requests 2,431/100,000, current-period billable usage US$0.00. The earlier inventory table is historical; D1 now has four databases including ShiftCalendar.
- Clean Expo export, root typecheck and production dry run passed. Worker bundle: 51.51 KiB raw / 13.87 KiB gzip; upload reports 5 ms startup. Startup is not representative request/JWT CPU evidence.
- Donation section remains removed; privacy text now describes Cloudflare and avoids a Malaysia-only residency claim.
- Still required: scoped Access attachment, actual audience, protected publication, administrator bootstrap, live two-identity login/persistence/privacy/expiry tests, metrics and final release/rollback records.

### Protected publication

Version `c1da4442-6cad-4906-b52f-0a21d3cf4070` is published at
https://shiftcalendar.bizkut-limau.workers.dev with previews disabled and no
custom routes/domains. Access application `7286318b-f239-43e3-a57a-01b5e81034eb`
protects all production and preview traffic for this Worker, using the reusable
pilot policy above. Login is restricted to the existing one-time PIN provider.
The exact application audience is recorded in the production config.

Run `rtk proxy node scripts/smoke-cloudflare-production.mjs` for unauthenticated
edge-protection checks. These do not prove authenticated API behavior. The first real-user PIN login passed; the goal remains incomplete pending all
acceptance checks below.

To reproduce a release: run `rtk npm run cf:build`, then from `cloudflare/` run
`rtk proxy npm exec -- wrangler deploy --dry-run --config wrangler.production.jsonc`
and `rtk proxy npm exec -- wrangler deploy --config wrangler.production.jsonc`.
Recheck the existing Access policy and bindings before publication. Do not
remove Access to troubleshoot JWT failures. Record the previous version before
every deployment; code rollback and D1 recovery are separate operations.

### Live acceptance evidence so far

- First identity completed a real PIN login and `/v1/session` returned HTTP 200 with `Cache-Control: no-store` and the verified subject/email.
- Browser saved Morning on 2026-09-14 in calendar `e4d4edc1-29c4-49ae-a773-25880a6cc59a`; full reload retained the shift. Direct D1 read confirmed `shift_code=M`, version 1.
- D1 diagnostic read reported APAC/HKG, 2 rows read and 0 written; this diagnostic query does not establish API request totals.
- A browser PATCH without the CSRF request header returned 403 with no-store.
- App sign-out reached Access's “You successfully logged out” page and the email login form. Second identity PIN challenge is pending.
- Production unsigned/forged-header smoke checks passed for root, login, teams, missing asset and session paths. All redirected to Access; authenticated missing-asset status still requires its own check.
- All 31 Worker/D1 and browser-client tests passed again.
- Outstanding: second identity forged-ID reads/writes; separate-browser same-user persistence; disallowed-email flow; actual expiry/reauthentication; authenticated deep links and missing assets; first-admin bootstrap; live CPU and API D1 metrics. No PINs/session tokens are retained in these records.
