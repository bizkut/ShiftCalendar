# Cloudflare private browser pilot

Phase 1 M2b verified on 2026-09-13 in this repository. The earlier plan called this milestone M1b. [AWS_HOSTING_PLAN.md](AWS_HOSTING_PLAN.md) is the authoritative phased plan.

**Pilot URL:** https://shifts.amazonian.my

Custom domain deployed on 2026-09-13. Public DNS resolves it and verified HTTPS reaches Access. Local NextDNS returns `0.0.0.0` with reason `nrd~day`, preventing Edge and the normal smoke script from connecting. Authenticated acceptance on the new hostname is pending allowlisting/expiry of that block; the M2b browser evidence below was collected on the former workers.dev address.

This is an Access-protected, two-user private-calendar pilot. Real login, persistence, isolation, logout and expiry checks passed. Full personal features, team administration and broader release readiness remain later milestones. **Keep team expansion paused:** a cold write used 11 ms CPU, above the nominal Free allowance, although it succeeded. No paid plan was enabled.

## Deployed resources

| Item | Verified value |
|---|---|
| Account | `21f5adfe18eb705dbc0fd820ccc88a28` |
| Worker | `shiftcalendar` |
| Production config | `cloudflare/wrangler.production.jsonc` |
| Current version | `f28fefba-c2b9-4e14-90d1-d72932c5dd40` — custom-domain origin |
| Previous protected version | `e19c4acb-2cf0-452f-a6e9-e3475652f75b` — former workers.dev origin |
| Initial protected version | `c1da4442-6cad-4906-b52f-0a21d3cf4070` |
| Initial unpublished version | `4d1eaa46-4f59-42b4-b91d-fc04001ce837` — unconfigured audience; do not use for public rollback |
| D1 database | `shiftcalendar`, `79c5678c-e084-49da-bfca-fbfbb5c41fdf` |
| Applied migrations | `0001_calendar.sql`, `0002_application_administrators.sql` |
| Access application | `7286318b-f239-43e3-a57a-01b5e81034eb`, “ShiftCalendar pilot” |
| Reusable allow policy | `0d65d035-cd9e-4de1-b297-1623fd35d070`, “ShiftCalendar pilot emails” |
| Access issuer | `https://bitter-cell-8976.cloudflareaccess.com` |
| Exact audience | `2144aea2386c954b57eefea72beac6423609bb2d26ad66465d87fe81618ae712` |
| Login provider | Existing one-time PIN provider, `1654ec6c-a8f1-404f-b418-103c0a63a8ee` |
| Policy session | 15 minutes; Access global SSO can renew the application session without another PIN |
| Hostnames | `shifts.amazonian.my`; production workers.dev and previews disabled |
| DNS zone | `amazonian.my`, active Free zone `9d9edd283771814a7af75941869d7715` |
| Custom domain | `9ce1505cfd571c8d6f9bbab1bde3a0b3fe83a07f`; managed certificate `c9813d20-1107-4ec6-ad7d-945bd82d7849` |

The reusable policy permits only `bizkut.limau@gmail.com` and `hasanuddin.abakar@gmail.com`. It protects all production and preview traffic for this Worker. No Bypass policy or account-wide protection was introduced. The app is restricted to the existing OTP provider, rather than accepting future identity providers automatically. The Worker independently verifies JWT signature, issuer, audience and expiry and reads active-user status from D1.

D1 was created with the `apac` location hint. Remote queries reported APAC/HKG. This is not a Malaysia-only residency guarantee. Calendar dates use `Asia/Kuala_Lumpur`. [D1 location guidance](https://developers.cloudflare.com/d1/configuration/data-location/).

## Free-plan and resource inventory

Workers remained Free after deployment (dashboard: Current plan); Zero Trust remained Free. Access lists two active users against the existing 50-user allowance. D1 now has four databases, including the new dedicated ShiftCalendar database; the three unrelated databases and existing Workers/Pages/domains/tunnel were preserved.

An account snapshot before publication showed 2,431/100,000 daily Worker requests and US$0.00 current-period billable usage. Later pilot metrics showed 103 Worker invocations, zero runtime errors and zero exceeded-CPU events. These snapshots are not reservations of capacity. Recheck shared usage before adding users. No paid services, custom-domain registration, R2 or outbound application-email subscription was enabled.

Workers Free includes 100,000 dynamic requests/day and nominally 10 ms CPU/request. D1 Free includes 5 million rows read/day, 100,000 rows written/day, 500 MB/database, 5 GB/account, 10 databases and 50 queries per Worker invocation. Free quota exhaustion can interrupt service; do not upgrade automatically. Static asset requests served without Worker execution do not consume the dynamic request allowance. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

## Live acceptance evidence

| Check | Result and evidence |
|---|---|
| First approved identity | User supplied its real PIN; app displayed the correct email; `/v1/session` returned 200 with verified subject/email and no-store |
| Private save and reload | First user saved Morning on 2026-09-14; full page reload retained it; remote D1 confirmed `M`, version 1 |
| Independent browser | User confirmed the same identity saw September 14 Morning after signing in and refreshing in another browser; user-reported evidence, not an agent-inspected second-browser trace |
| Second real identity | User supplied its real PIN; app displayed the second email and its separate empty calendar, without the first user's shift |
| Foreign-resource reads | Second identity received 403 for the first calendar's metadata and date-range endpoints |
| Foreign-resource write | Valid PATCH with correct body and CSRF header returned 403; first user's shift remained `M`, version 1. An earlier malformed probe returned 400 and was not counted as authorization evidence |
| CSRF | Browser PATCH without `X-ShiftCalendar-Request` returned 403 and no-store |
| Logout | App sign-out reached Access's “You successfully logged out” page and email form |
| Actual expiry | Second user's session still returned 200 at 15:39:43 UTC; after its 15-minute window, refresh at 15:40:41 cleared protected calendar UI and showed “Please sign in again” |
| Reauthentication | Clicking Sign in renewed the app session through still-valid Access global SSO; second user's private shift reloaded. A new PIN was not required for this renewal |
| Disallowed email | Logged-out browser submitted `shiftcalendar-denied@example.invalid`; Access showed the generic PIN message, granted no app session, and a deliberately invalid test PIN produced “That account does not have access” |
| Unsigned/forged header | Production smoke script verified Access login redirects for root, login, teams, missing asset and session paths with no credentials and with a forged assertion header |
| Authenticated deep links | `/login` and `/teams` returned 200 HTML/no-cache; missing JavaScript returned 404 plain text/no-store |
| Alternate URLs | Refreshed dashboard confirmed previews disabled and no custom domains/routes; Worker-scoped Access also covers all its URLs |
| Administrator bootstrap | Only the first verified subject was added through the operator command; admission does not automatically grant administration |

Cloudflare intentionally displays the same “code emailed” message for blocked addresses and sends PINs only to policy-allowed users. The negative check above is a real disallowed-email/invalid-PIN attempt, not proof of a third authenticated identity. No PIN delivery to the reserved invalid domain is claimed. [OTP behavior](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/).

Test data remains visible: first user has Morning on September 14; second user has Morning on September 15 after versioned write measurements. The first calendar ID used for isolation testing is `e4d4edc1-29c4-49ae-a773-25880a6cc59a`; the second is `505e8f60-001c-4c54-9adf-7ad6eb18c75a`. These are identifiers, not access credentials.

## CPU and database measurements

Sanitized live traces: [CPU samples](cloudflare/live-evidence/2026-09-13-cpu.json). Aggregate query statistics: [D1 snapshot](cloudflare/live-evidence/2026-09-13-d1.json).

| Operation | Observed CPU |
|---|---|
| Cold JWKS resolver and session verification | 5–9 ms |
| Warm session verification | 1–2 ms |
| Warm bounded month reads | 1–5 ms |
| Warm single-day writes | 3–5 ms |
| Confirmed cold single-day write | 11 ms, HTTP 200 |

A structured `jwks_resolver_cold` marker distinguishes a new public-key resolver without recording identity or token data. The latest bundle was 51.58 KiB raw / 13.90 KiB gzip; upload reported 4 ms startup. Startup, request CPU and wall/network latency are different measurements.

Across the dashboard's 103-invocation sample, CPU P50 was 2.76 ms, P90 5.45 ms and P99 11.49 ms. The latest version initially had only one request, so its median represented the cold-write sample alone. Cloudflare allows limited flexibility for infrequent overruns, but repeated overruns can terminate execution. This explains success at 11 ms without establishing reliable headroom. Optimize and retest before team expansion; no claim that all future requests fit is made. [CPU enforcement](https://developers.cloudflare.com/workers/platform/limits/#cpu-time).

Query Insights reported 295 executions, 303 rows read and 252 rows written across 25 query shapes in the last hour, including migrations and diagnostics. Indexed membership, calendar and date-range queries were observed. These aggregates can lag and are not per-request billing guarantees. Code bounds are 93 days/read, 100 calendars/page plus one lookahead, and nine SQL statements for a normal successful day write; retry/conflict paths are separately bounded below the 50-query Free limit.

The five-write diagnostic observation timed out while requests continued. Tail subsequently recorded all five successful executions and D1 confirmed version 8; the requests were not repeated on an assumed failure. A later cold-write measurement advanced the second user's test date to version 9.

## Local development and validation

Use Node 24 from `.nvmrc` (Homebrew Node 24 is installed side-by-side) and the isolated `cloudflare/` lockfile. Wrangler 4.131.1, jose 6.2.12, Vitest 4.1.11 and the Workers Vitest plugin 1.1.8 are pinned.

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

With the local server running, `rtk npm run cf:smoke:local` checks deep links, missing assets and unsigned API rejection. The local config retains its fake database UUID, `remote: false`, disabled publication and unconfigured audience. There is no development authentication bypass.

Validation passed: 25 workerd JWT/CSRF/D1 persistence, isolation, concurrent-write, retry and revocation tests; six browser-client tests; app/Worker/test typechecks; clean Expo export; production dry run; live smoke checks. Local SQLite bootstrap checks covered absent/disabled users, idempotency and refusal to replace a different existing administrator. Earlier Android export with the Cloudflare provider passed; it proves bundle compatibility, not physical-device or native cloud-login acceptance. Native local-only behavior remains the selected native path, with device checks deferred until a native release.

## Deployment and bootstrap

Scoped Wrangler OAuth grants account/user read, Workers and Worker scripts write, Workers tail read, D1 write, zone read and Worker routes write. The last two scopes were added for repeatable custom-domain deployment. Credentials stay outside Git. MCP OAuth does not authenticate Wrangler automatically. Inspect `wrangler whoami` and the explicit account/config before mutations.

The database already exists: do not create a duplicate. Review new SQL migrations, then from `cloudflare/` run:

```sh
rtk proxy npm exec -- wrangler d1 migrations apply shiftcalendar --remote --config wrangler.production.jsonc
```

For each release, build from the repository root, then dry-run and deploy from `cloudflare/`:

```sh
rtk npm run cf:build
```

```sh
rtk proxy npm exec -- wrangler deploy --dry-run --config wrangler.production.jsonc
rtk proxy npm exec -- wrangler deploy --config wrangler.production.jsonc
```

`cf:build` clears Metro's cache, disables dotenv loading, sets the Cloudflare browser provider, removes AWS public build settings and writes static security/cache headers. Check the exact issuer/audience/origin and retained Access policy before publication; never remove Access to debug an authentication failure.

Initial administrator command, from the root:

```sh
rtk proxy node scripts/bootstrap-cloudflare-admin.mjs <verified-user-subject-uuid>
```

The first user's subject was taken from its verified `/v1/session` response. Bootstrap only inserts an active existing user when no administrator exists; repeat runs for the same user are safe. This records initial administration for future team APIs; the pilot still grants private calendar access only to its owner.

## Repeatable smoke and acceptance procedure

1. Run `rtk proxy node scripts/smoke-cloudflare-production.mjs` without credentials. Every tested path must redirect to this Access issuer.
2. Complete real PIN login as the first identity, save a shift, reload and verify it in an independent browser.
3. Sign out and log in as the second identity. GET the first calendar's `/v1/calendars/<id>` and `/days?from=YYYY-MM-DD&to=YYYY-MM-DD`; expect 403. PATCH `/v1/calendars/<id>/days/YYYY-MM-DD` with JSON `{ "value": { "shiftCode": "N" }, "expectedVersion": 1, "mutationId": "<fresh UUID>" }`, Content-Type application/json and `X-ShiftCalendar-Request: 1`; expect 403. Verify the owner record is unchanged. Omitting the CSRF header must also fail.
4. Verify authenticated deep links, missing assets and no-store API responses. Wait out the policy session and exercise refresh/relogin; logout alone is not expiry evidence. Repeat the disallowed-email negative test without claiming delivery of a blocked PIN.
5. From `cloudflare/`, use `wrangler tail shiftcalendar --config wrangler.production.jsonc --format json` for live CPU/outcome samples and `wrangler d1 insights shiftcalendar --config wrangler.production.jsonc --time-period 1h --json` for queries. Prefix shell commands with `rtk proxy npm exec --`. Retain only sanitized operation, timing, outcome, version and cold-marker fields; never raw headers/tokens.

## Rollback, recovery and remaining scope

Record the previous protected version before each release. From `cloudflare/`:

```sh
rtk proxy npm exec -- wrangler rollback <previous-protected-version-id> --config wrangler.production.jsonc
```

Choose a version with the actual Access audience, preserve Access, and repeat smoke/login checks. Versions before `f28fefba` use the former workers.dev `APP_ORIGIN`: rolling back only the version would reject custom-domain writes. Prefer redeploying the previous code with the current domain configuration. To restore the old hostname instead, coordinate route/origin changes and reverify Access; version rollback alone does not restore routing. Both current migrations are additive. Code rollback does not restore D1 data or remove the administrator record. Export production D1 to an encrypted, access-controlled recovery copy before destructive changes; demonstrate restoration separately before a broader release. Free Time Travel provides seven days. Do not delete the database to undo a failed Worker release. [Rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/), [D1 recovery](https://developers.cloudflare.com/d1/reference/time-travel/).

Team administration, full private details/notes/pay/leave, imports, custom shift types, calendar rename/delete, bulk patterns and complete pagination remain later milestones. Unsupported writes return errors rather than acknowledging unsaved data. The current UI still exposes some later-feature controls; the pilot is not a general release. The donation section is removed, and privacy text describes Cloudflare without promising Malaysia-only storage.

`shifts.amazonian.my` now uses the existing Worker and D1. The zone had no conflicting DNS record, Worker route or hostname Access application. Ten unsigned/forged-header probes (root, login, teams, missing JavaScript and session) returned Access redirects over verified TLS using the public A record with curl `--resolve`; no CORS allowance was returned. The former workers.dev URL returned 404, and the API confirmed production and preview URLs disabled. Normal DNS/browser checks remain pending the local NextDNS block; repeat authenticated origin/CSRF, save/reload, logout and deep-link checks before calling the domain transition fully accepted. [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/). Existing AWS deployment records are historical; this Cloudflare pilot did not modify AWS resources or claim a new AWS cost inventory.
