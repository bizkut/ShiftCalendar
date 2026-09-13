# Cloudflare ShiftCalendar pilot

Phase 1 M2b verified on 2026-09-13 in this repository. The earlier plan called this milestone M1b. [AWS_HOSTING_PLAN.md](AWS_HOSTING_PLAN.md) is the authoritative phased plan.

**Pilot URL:** https://shifts.amazonian.my

Custom domain deployed on 2026-09-13. Public DNS resolves it and verified HTTPS reaches Access. The initial NextDNS block cleared on 2026-09-14. Normal DNS/HTTPS smoke, first-user login, persistence, CSRF, foreign-resource denial, deep links and logout now pass. Second-user real-PIN login and reverse privacy checks also passed; the earlier M2b browser evidence below was collected on the former workers.dev address.

This is an Access-protected two-user pilot. **M2c is complete.** The M3 team-administration candidate is deployed and its first-user team-creation flow passed; two-user invitation, role-revocation, team-edit and M3-specific CPU acceptance are still in progress. Earlier M2c candidates exceeded the CPU gate before the final resolver passed. No paid plan was enabled.

## Deployed resources

| Item | Verified value |
|---|---|
| Account | `21f5adfe18eb705dbc0fd820ccc88a28` |
| Worker | `shiftcalendar` |
| Production config | `cloudflare/wrangler.production.jsonc` |
| Current version | `256d1577-b915-4930-9fed-5a9b469df760` — M3 candidate with bounded administration pages and read-only steady-state identity admission |
| Previous protected version | `e1242228-97df-48fa-ab32-425c8d8c6ebf` — M3 invitation-status candidate using the same schema and origin |
| Initial protected version | `c1da4442-6cad-4906-b52f-0a21d3cf4070` |
| Initial unpublished version | `4d1eaa46-4f59-42b4-b91d-fc04001ce837` — unconfigured audience; do not use for public rollback |
| D1 database | `shiftcalendar`, `79c5678c-e084-49da-bfca-fbfbb5c41fdf` |
| Applied migrations | `0001_calendar.sql`, `0002_application_administrators.sql`, `0003_team_administration.sql` |
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

## M2c candidate — 2026-09-14

The successful write path now relies on its existing atomic permission/revision guards and unique mutation insert, avoiding the preliminary calendar and mutation reads. This reduces normal writes from nine to seven SQL statements (including the handler's active-user read) and removes two D1 binding calls. Failed batches still recheck current authorization and mutation fingerprints before returning current retry state or a conflict. JWT verification, CSRF, schema, audit writes and revision/tombstone semantics are unchanged. D1 rolls back the complete batch if any statement fails. [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

This is a performance hypothesis supported by source-path inspection, not a measured CPU improvement. Retries now attempt a guarded batch first and may cost more than before. All 26 Worker/D1 tests and six browser-client tests passed, including the adjusted revocation-at-batch-boundary test and new duplicate-ID rollback cases with an otherwise valid revision or a different date. Worker/test/client typechecks and production dry run passed. The deployed package is 51.41 KiB / 13.88 KiB gzip; 5 ms startup is not request CPU.

[Candidate evidence](cloudflare/live-evidence/2026-09-14-m2c-candidate.json) records the deployment and preflight snapshot. The dashboard showed Workers Free as current, 2,559/100,000 requests today and US$0.00 current-period billable usage. D1 still has four databases totaling approximately 18.3 MB; ShiftCalendar reports 326 rows read and 194 written in 24 hours. Other databases show zero queries in the dashboard snapshot; these are lagging observations, not quota reservations.

The DNS block cleared and the normal smoke script passed. Browser Access/SSO supplied a verified first-user session without a new PIN. Five deployments of identical candidate code yielded **eight confirmed cold writes (6–13 ms) and twenty warm writes (1–6 ms)**; some cycles used two cold resolvers. All 28 writes returned HTTP 200 and advanced the first user's September 14 Morning shift from version 1 to 29 without changing its shift code. Every attempt is retained in [CPU evidence](cloudflare/live-evidence/2026-09-14-m2c-cpu.json), including the cold overruns. **The CPU gate failed.** No cold-headroom improvement is established; source inspection alone did not identify the dominant cold cost. Next step: collect a local workerd CPU profile of the actual authenticated write path to identify expensive initialization, then test a focused candidate and repeat the entire live acceptance gate. Local profiling is diagnostic, not substitute acceptance evidence. [Profiling guidance](https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/).

The first user's verified session and bounded month read used 1–2 ms; reload retained Morning. GET of the second calendar and its days returned 403; a valid foreign PATCH returned 403; a same-origin PATCH without the CSRF header returned 403. `/login` and `/teams` returned 200 HTML and missing JavaScript 404. Logout reached Access's success message. The second user subsequently completed a real PIN login: its own September 15 Morning shift survived reload and the first calendar was absent; foreign calendar/day GETs and a valid PATCH returned 403. Tail capture was stopped after saving all samples. [D1 query snapshot](cloudflare/live-evidence/2026-09-14-m2c-d1.json) reports 247 executions, 166 rows read and 275 written across ten query shapes in the last hour; it is lagging aggregate evidence, not per-sample billing.
Candidate rollback: deploy version `f28fefba-c2b9-4e14-90d1-d72932c5dd40` with `wrangler rollback` from `cloudflare/` using the production config. It has the same domain origin and schema; preserve Access and repeat smoke/login checks.

## M2c profiling and follow-up candidates

A repeatable local workerd profiler is available at `scripts/profile-cloudflare-local.mjs`. It builds the actual handler, generates a disposable RSA-signed fixture JWT/JWKS, uses ephemeral D1, verifies three writes, and disposes its runtime. It uses the pinned Miniflare compatibility adapter. Run `rtk proxy node scripts/profile-cloudflare-local.mjs /tmp/shiftcalendar-profile.json --minify` (omit `--minify` for an unminified diagnostic). No production tokens or records are used. [Sanitized profile summary](cloudflare/live-evidence/2026-09-14-local-profile-summary.json) shows substantial cold JWT setup/claim-validation and D1 initialization work. Sampling, native/program frames, fixture differences and run-to-run variance prevent interpreting local totals as production CPU.

Minification reduced the bundle from 51.41 KiB to 30.65 KiB. The [minified live sample](cloudflare/live-evidence/2026-09-14-m2c-minified-cpu.json) contained six cold writes at 5–15 ms and twenty warm writes at 2–5 ms. All 26 succeeded, but the gate failed. Three deployments supplied six actual cold resolvers; the final cycle was extended to meet twenty observed warm samples. No outliers were removed.

The next candidate routes day PATCH requests directly to the repository after the unchanged JWT and CSRF checks. Its D1 batch checks active-user status, current calendar permissions and revisions atomically; failed-batch retry reads also recheck current authorization. Other routes retain the preliminary active-user lookup. Normal day writes now use one D1 call containing six statements. The API regression covers disabled-user new writes/retries and missing-user writes, asserting no day/audit changes. All 26 Worker/D1 and six browser-client tests, typechecks, minified local diagnostic writes and production dry run passed.

The [transaction-only authorization sample](cloudflare/live-evidence/2026-09-14-m2c-atomic-cpu.json) contains six cold writes at 7–12 ms and twenty warm writes at 1–2 ms. All 26 returned 200, advancing the second user's unchanged September 15 Morning shift from version 35 to 61 (the preceding minified sample advanced version 9 to 35). The first user's September 14 Morning remains version 29. A subsequent second-user session/read/reload and foreign write denial passed. [D1 aggregate](cloudflare/live-evidence/2026-09-14-m2c-atomic-d1.json): 573 query executions, 540 rows read, 596 written across 13 shapes in a lagging one-hour window including earlier candidates. Preflight dashboard showed 2,638/100,000 daily requests and US$0 billable usage. No services or paid subscriptions were added. Tail sessions were stopped after capture.

**M2c remains incomplete:** warm work has decreased, but cold CPU has not passed the strict below-10-ms gate. Investigate remaining cold initialization before further changes; retain JWT cryptographic verification. Cloudflare's native `ctx.access` cannot directly replace it in this layout because the Static Assets router does not forward that context. [Access limitation](https://developers.cloudflare.com/workers/configuration/cloudflare-access/#ctxaccess-limitations). The current bundle is 30.69 KiB / 11.15 KiB gzip. Rollback to `5260138e-d23e-46ca-b28b-974291f1f30f` restores the minified candidate's preliminary active-user read; `f28fefba-c2b9-4e14-90d1-d72932c5dd40` restores the original domain-enabled code. Both use the same issuer, audience, origin and database. Re-run smoke/login checks after rollback.

## Cold-marker overhead experiment

Version `b04cf729-0ab9-44d1-9c63-e26d7ab98fb7` replaces the cold resolver console log with `Server-Timing: jwks;desc="cold"` on the response that creates the resolver. The caller supplies a request-local callback; identity output, JWT verification and D1 authorization are unchanged. The hypothesis is that first-use console formatting may add diagnostic overhead. Local profiling is inconclusive because of variance; no production improvement is claimed. Tests verify cold versus warm response markers; all 32 tests and typechecks passed, and normal public Access smoke passed after deployment.

For this candidate, obtain cold/warm classification from the response header and correlate each browser request with its Cloudflare CPU trace (prefer the CF-Ray identifier). Absence of the old console marker is not evidence that a request is warm. Keep the earlier log-based samples separate. The first attempted authenticated measurement encountered an expired session; no matching Worker trace was captured, and a remote read confirmed the second user's shift remained Morning, version 61. Reauthentication subsequently succeeded; no CPU sample from the expired-session attempt counts toward the gate. Tail capture was stopped. Roll back to `3090433c-8a80-44f3-856b-3c4041c30f63` to restore the previous instrumentation; domain, Access and schema match.

**Response-marker live result:** three identical deployments from source commit `006a472` produced six confirmed cold writes at **8, 8, 7, 22, 11 and 13 ms**, and twenty warm writes at **1–3 ms**. All 26 returned HTTP 200; three cold samples exceeded the gate. Each browser response CF-Ray prefix matched its Worker trace; response `Server-Timing` supplied cold classification. The full sample, including every overrun, is in [response-marker CPU evidence](cloudflare/live-evidence/2026-09-14-m2c-header-cpu.json). The third cycle was extended to reach twenty warm writes; no measured write was discarded. This does not establish a cold-CPU improvement, and M2c remains incomplete.

The verified session used 2 ms CPU and the bounded September read 3 ms. Foreign calendar/day reads and a valid foreign write returned 403; a write without the CSRF header also returned 403. Reload displayed the second user's saved Morning shift. Remote D1 confirmed first-day version 29 unchanged, second-day version 87 (previously 61), matching day audit counts, 118 total mutations including two calendar creations, zero leftover transaction checks and a 192,512-byte database. [D1 query snapshot](cloudflare/live-evidence/2026-09-14-m2c-header-d1.json) is a lagging one-hour aggregate across candidates, not per-request billing. Tail capture is stopped. The experiment did not change authentication, authorization, schema or service plans. Next work should investigate remaining cold JWT initialization and runtime variance before another candidate; repeating unchanged deployments is not an optimization.

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

`shifts.amazonian.my` now uses the existing Worker and D1. The zone had no conflicting DNS record, Worker route or hostname Access application. Ten unsigned/forged-header probes (root, login, teams, missing JavaScript and session) returned Access redirects over verified TLS using the public A record with curl `--resolve`; no CORS allowance was returned. The former workers.dev URL returned 404, and the API confirmed production and preview URLs disabled. Normal DNS and first-user browser checks subsequently passed, as recorded under M2c; second-user revalidation also passed. [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/). Existing AWS deployment records are historical; this Cloudflare pilot did not modify AWS resources or claim a new AWS cost inventory.


## RS256 resolver candidate

A focused resolver now selects and imports only the Cloudflare Access RS256 public key; `jose.jwtVerify` still verifies the signature, key strength, issuer, audience, expiry, not-before and required claims. Key retrieval uses the exact validated issuer, a five-second timeout, manual redirects with non-200 rejection, a 64-KiB response bound, at most 16 keys, a ten-minute cache and a thirty-second unknown-key refresh cooldown. Ambiguous IDs, private keys and incompatible key metadata fail closed. Only completed public-key data is cached across requests; pending response streams and user identities are not shared. [Cloudflare JWT verification](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), [Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/).

All 44 Worker/D1 tests and six browser-client tests pass, as do typechecks and the production dry run (28.14 KiB raw / 10.14 KiB gzip). Tests cover rotation/cooldown/expiry, failed fetches, oversized responses, redirects, duplicate IDs, bad key metadata, weak RSA keys, forged signatures and concurrent first requests, alongside existing authorization, revision and CSRF tests. The standalone profiler caught unsupported `redirect: error`; manual redirect handling fixed this before deployment. [Local samples](cloudflare/live-evidence/2026-09-14-rs256-local-profile.json) are inconclusive and do not establish live CPU improvement.

Preflight: scoped OAuth credentials still target the existing project; dashboard showed 2,811/100,000 daily Worker requests and US$0.00 billable usage; D1 still has four databases with ShiftCalendar at 192,512 bytes. No new resources, schema changes or paid services are required. The previous response-marker version `dc7fbb10-7251-43c9-9f7a-e1b60c8eb16a` is the rollback target with identical origin, audience, Access policy and D1. Source commit `28bc7ca` was deployed as `af6e915c-bd1b-4f52-9b1e-7de9eeb094e5`; public Access smoke passed. The full cold/warm CPU sample and final first-user recheck now pass.


**RS256 live result:** three identical deployments produced cold writes at **8, 6, 8, 7, 7 and 6 ms** and twenty warm writes at **1–2 ms**, all HTTP 200. The final version is `fac6525b-82ae-45be-ae9b-9e9eb3e5438e`. Every response matched its CF-Ray trace, with response markers identifying new resolvers; no measured write was excluded. [Full CPU evidence](cloudflare/live-evidence/2026-09-14-m2c-rs256-cpu.json), [D1 aggregate](cloudflare/live-evidence/2026-09-14-m2c-rs256-d1.json). The D1 aggregate was collected during the sample, is delayed, and includes earlier candidates; it is not an exact count for this window. Observed cold headroom improves on the 11-ms M2b sample and failed intermediate candidates, but this small sample cannot guarantee future CPU usage.

Second-user session and bounded month reads each used 2 ms CPU. Reload retained Morning, version 113 (previously 87). Foreign calendar/day reads and a valid foreign write returned 403; omitting CSRF also returned 403. Remote D1 confirmed the first user's Morning/version 29 remained unchanged, with matching day audit counts, 144 mutation records including two calendar creations, zero transaction-check residue and a 208,896-byte database. Logout succeeded. Tail capture is stopped. The first-user check subsequently passed as recorded below.


## M2c completion — 2026-09-14

The first user completed a new real PIN login on the final version. Its September 14 Morning shift loaded correctly; a same-value save advanced version 29 to 30, and an identical retry returned version 30 without another mutation. Reload retained Morning and showed none of the second user's shift. Foreign calendar/day reads and a valid foreign write returned 403. Session/month reads used 1–2 ms CPU; the save and retry used 3 and 5 ms. Every follow-up trace is retained in [final identity evidence](cloudflare/live-evidence/2026-09-14-m2c-final-identity.json), separately from the full 26-write CPU sample. Remote D1 confirmed day audit counts 30 and 113, two calendar creations, 145 mutations, zero transaction-check residue and 208,896 bytes. Tail capture stopped.

All four M2c plan checks are complete: profiling and focused optimization; security/concurrency regression validation (44 Worker/D1 plus six client tests, typechecks, dry run and public smoke); six confirmed cold writes at 6–8 ms plus twenty warm writes at 1–2 ms; and real persistence/privacy checks for both identities on the final candidate. Signature, issuer/audience/expiry verification remain in `jose`; active-user/ownership checks, CSRF, atomic revision/idempotency/audit behavior and native local-only behavior are preserved. Source commit `28bc7ca` and prior evidence commit `cb4c62f` identify the candidate. The documented rollback is `dc7fbb10-7251-43c9-9f7a-e1b60c8eb16a` with the same origin, audience and D1. No service plan or unrelated resource changed. The sample demonstrates observed headroom, not a guarantee against future runtime variance. M3 team access remains a separate milestone, including the manager/team-leader-only edit policy.


## M3 candidate — team administration and permissions

Migration `0003_team_administration.sql` adds user identity/status revisions, team metadata, membership revisions, targeted invitation status and an active team-calendar-per-assignee index. It is additive: rolling back Worker code leaves the new columns/table unused and preserves calendars. Do not reverse it by dropping columns in production. Use D1 Time Travel for data recovery; use Worker version rollback for code recovery.

Access admission, application activation and team membership are separate. A verified Access JWT provisions only its own subject/email. Invitations target an existing verified subject through its normalized email and do not send email or modify the Access allow policy. Application administrators create teams and activate/deactivate users. A team's internal `owner` is displayed as team leader; the leader manages invitations/memberships and can transfer leadership. Team leaders and managers create/edit team calendars. Members and viewers remain read-only even for a calendar assigned to them, while private calendars stay owner-only. Every administration mutation has an atomic current-permission/version guard, stable mutation ID and audit record. Concurrent application-admin changes must preserve at least one active administrator.

Local validation passes: 62 Worker/D1 tests plus six browser-client tests, all app/Worker/test/client type checks, Expo web export and Wrangler production dry run. Coverage includes real `/v1` routing, targeted invitation/acceptance, two-team roles, assigned member/viewer denial, administrator non-bypass, removal/deactivation/demotion with retry denial, stale revisions, forged identifiers, idempotency, invitation revocation, bounded cursor pages and concurrent last-admin removal.

Deployment preflight reconfirmed scoped Wrangler access, Workers **Free** as the current plan, 423 Worker invocations, zero runtime errors and September billable/projected cost of **US$0.00**. The 24-hour aggregate CPU view was P50 3.03 ms, P90 6.52 ms and P99 11.7 ms across several M2c/M3 versions; it is not the required M3-specific sample. Remote migration execution took 5.13 ms. D1 remained APAC/HKG and 245,760 bytes after migration; both original private Morning records remained intact at versions 30 and 113. The hosted first administrator created `ShiftCalendar Pilot` successfully. Two-user acceptance and operation-specific tail sampling remain pending.

M3 rollback target after final acceptance is the immediately preceding protected version recorded for that release. Version `fac6525b-82ae-45be-ae9b-9e9eb3e5438e` restores completed M2c behavior with the same issuer, audience, domain and D1; the additive M3 schema can remain. A rollback hides team APIs, so retain team rows and redeploy the M3 candidate to restore them. Never delete team/private data as part of a Worker rollback.
