# ShiftCalendar: AWS Hosting, Users, and Teams

Updated: 2026-09-13. Status: serverless implementation in progress; no AWS resources deployed yet.

## Goal and confirmed constraints

Host ShiftCalendar as a browser-accessible calendar with individual logins,
multiple teams, and schedules shared only with authorized team members.
Keep the existing Expo / React Native application and preserve local-only mode.

- Selected Region: **Asia Pacific (Malaysia), `ap-southeast-5`**.
- AWS plan: **Free**, as stated by the user; the billing API could not verify it.
  The billing console shows **$0.00 active credits** (checked 2026-09-13).
- Guidance level: **Medium**.
- Confirmed hosting choice: **standard CloudFront with a private S3 origin**,
  using the generated **`https://<distribution>.cloudfront.net`** address for now.
- Owned domain: **amazonian.my**, **not ready yet**.
  **shifts.amazonian.my** remains the recommended later address; domain readiness
  does not block the pilot. DNS and custom TLS setup have not been performed.
- Provisional pilot: up to 50 users across 5 teams. This is a sizing assumption,
  not a measured capacity limit or a guarantee of zero cost.
- First hosted release: login, personal cloud calendars, team membership,
  team rosters, and server-enforced permissions.
- Later releases: offline cloud writes, automatic synchronization, approved
  shift swaps, and notifications.

## Milestone overview

**First hosted release = M0 through M4.** M5 and M6 are later enhancements.
The optional custom-address milestone MD can follow M1 whenever the domain is ready.
Check off a milestone only when its implementation and exit checks pass.

| Phase / milestone | Dependency | Demonstrable result | Status |
|---|---|---|---|
| 0 — M0: Deployment feasibility | None | Verified constraints and working production web build | Web build passes; billing decision pending |
| 1 — M1: Hosted website and login | M0 | HTTPS URL and working authentication | Infrastructure and login implemented locally; not deployed |
| 2 — M2: Personal cloud calendars | M1 | Persistent calendars across sessions/devices | Implementation and validation in progress |
| 3 — M3: Teams and rosters | M2 | Multiple isolated teams with role-based editing | Implementation and validation in progress |
| 4 — M4: Pilot release | M3 | Tested hosted calendar ready for the first teams | Planned |
| 5 — M5: Offline cloud sync | M4 | Reliable queued edits and reconciliation | Later |
| 6 — M6: Swaps and notifications | M4; M5 if offline swaps are included | Approved atomic swaps and notifications | Later |
| Later — MD: Custom address | M1 and domain readiness | Working `shifts.amazonian.my` with verified login redirects | Deferred; does not block M2–M4 |

## Current goal slice — M1b: Deploy and verify the CloudFront pilot

**Status: blocked on the user's pilot-cost decision; local preparation complete.**

**Outcome:** a live `https://<distribution>.cloudfront.net` address serving the
calendar, with working Cognito login and a protected Malaysia API. Use the
existing prepared S3/CloudFront/Cognito/API Gateway/Lambda/DynamoDB stack.

- [ ] Resolve the nonzero-cost decision and verify project billing eligibility;
  the recorded estimate is not a spending cap or a zero-cost guarantee.
- [ ] Create and review CloudFormation change sets and their validation results,
  then deploy the Malaysia stacks through `rtk npm run aws:deploy`.
- [ ] Record the actual CloudFront URL, stack outputs, and deployment evidence.
- [x] Prepare `rtk npm run aws:smoke` and validate it with six offline fixture
  tests; record live results separately in `.deployment/smoke-results.json`.
- [ ] Verify HTTPS, direct application routes, incomplete-callback recovery,
  missing-asset errors, and denied direct access to the private S3 objects.
- [ ] Verify real registration, email verification, sign-in, password recovery,
  session expiry, and logout using controlled test logins.
- [ ] Verify valid access-token API requests and rejection of missing, invalid,
  expired, and ID tokens; confirm CORS permits the deployed web origin.
- [ ] Save validation evidence and make a Git checkpoint for the completed slice.

**Exit:** the actual URL and passing live evidence are recorded. Local-only tests
do not satisfy this exit. M2–M4 feature/recovery acceptance and MD custom-domain
work remain separate. Do not replace retained user pools or data to fix rollout.

**Git workflow:** commit coherent, validated checkpoints occasionally, as
requested by the user. Keep local credentials, deployment reports, generated
bundles, and unrelated agent configuration out of commits.

**Latest pre-deployment evidence (2026-09-13):** the plan-state API was rechecked
and still returned “Missing data”; Free/Paid status remains unverified. The
read-only smoke checker is prepared and its nine script tests (three existing
pilot tests plus six checker tests) pass. No live smoke checks or provisioning
have run; the nonzero-cost decision remains pending.
The final read-only deployment check found no `shiftcalendar` stack in Malaysia
and no local stack outputs. Resume provisioning after the cost decision; then
verify project billing eligibility and run the prepared deployment/live checks.

## Completed slice — M1a: Pilot readiness on the AWS address

**Status: complete locally on 2026-09-13.** Next: M1b, after the billing checkpoint.

**Outcome:** a validated, reviewable deployment package using CloudFront's
generated HTTPS address and Cognito's generated login domain. This slice prepares
M1; completion does not mean the website is live or that M0–M4 are complete.

| Work | Files / responsibility | Acceptance evidence |
|---|---|---|
| Check the hosting/authentication wiring | `infrastructure/template.yaml`, `scripts/deploy-aws.mjs`, `hooks/AuthContext.tsx`, `utils/cloudClient.ts` | Stack outputs supply a build with its transform cache cleared, so preview settings cannot leak into deployment; callback/logout URLs and API CORS use the same CloudFront origin; no custom domain, DNS record, or ACM certificate is required. |
| Make incomplete login callbacks recover | `app/(auth)/callback.tsx` | Opening `/callback` without an OAuth response returns to login after the session check; protected routes still redirect unauthenticated users. |
| Validate the prepared release | `scripts/pilot.test.mjs`, backend tests, template lint/Guard, Expo web export | `rtk npm run aws:prepare` passes; a configured local browser preview passes the callback and protected-route checks. |
| Record the launch handoff | `PLAN.md`, `DEPLOYMENT.md` | Default-address deployment, live acceptance checks, cost checkpoint, and deferred custom-domain work are explicit. |

**Completion checklist:**

- [x] Default-address deployment and login configuration reviewed together.
- [x] Incomplete callback recovery verified in the configured browser preview.
- [x] Local validation passes and the evidence is recorded below.
- [x] Deployment instructions and the deferred MD milestone are consistent.

**Evidence:** `rtk npm run aws:prepare` passed app/backend type checks, 11 backend
tests, 3 pilot tests, backend bundling, cfn-lint, Guard, and a fresh web export.
In the configured local browser preview, `/callback` without OAuth parameters
and unauthenticated `/teams` both settled on `/login`. Export inspection reproduced
stale preview settings before the build-cache fix; afterward a clean preparation
build excluded them, and a separate configured export contained all five intended
web configuration values with none of the previous preview values. Local preview
identifiers are test values, not deployed endpoints. Live OAuth/email and AWS
creation checks remain unperformed; no AWS resources or DNS records were created.

M1b is now the active slice above. No domain purchase or DNS setup is a
prerequisite. A successful M1b still leaves the M2–M4 release checks to complete.

**Deferred from this slice:** custom DNS/TLS, local-to-cloud import, remaining
team administration, cloud recovery/export, offline sync, and notifications.
They retain their milestone acceptance criteria below.

## AWS checks performed

Read-only checks used the local `shiftcalendar` AWS CLI profile on 2026-09-13.
The profile is configured for Malaysia and authentication succeeded.

| Check | Observed result | Planning consequence |
|---|---|---|
| Free Tier usage | AWS Glue catalog requests: **24 used / 1,000,000 monthly allowance**, reported as Always Free | Only this offer was returned by the usage API. Glue is not needed by the calendar. |
| Plan status | `GetAccountPlanState` returned `ResourceNotFoundException` / “Missing data” | Remaining credits, expiry, and Free/Paid status are unverified. This error does not establish either plan type. |
| Credit activities | `ListAccountActivities` returned an empty list | No activities were returned; this does not prove the credit balance is zero. |
| Billing console credits | Active credits: **0**, total remaining: **$0.00** | Do not use hypothetical promotional credits to fund deployment. |
| Current bill | September estimate: **USD 0.00** | Current usage is zero-cost; this does not predict calendar hosting cost. |
| Cognito, DynamoDB, Lambda | User pool, table, and function lists were empty in Malaysia | No resources of these types were found to reuse. |
| API Gateway | HTTP/WebSocket and REST API lists were empty in Malaysia | The calendar API needs to be created. |
| S3 and CloudFront | No S3 buckets in Malaysia; no CloudFront distributions returned | Hosting needs to be created. |
| Amplify | Malaysia endpoint could not be reached; Malaysia is absent from the published endpoint list | Use S3 + CloudFront in the selected Region. |

The usage API is **not a catalog of every free service available to the project**.
An absent service can simply have no reported usage. Successful resource-list
calls establish read access, not creation permissions or billing eligibility.
This check covered the proposed calendar stack, not every AWS service.

Before deployment, resolve the billing gap in **AWS Settings → Billing** and
confirm the Region under **View all projects → Overview → Additional Info → Region**.
Keep the user-stated Free plan as the working assumption.

**Deployment cost checkpoint:** actual console credits are $0.00. The current
Malaysia price scenario is **US$0.1431/month before tax** for 100,000 HTTP API
calls, 1 GB-month of combined S3 storage, 1,000 S3 writes/list requests and 10,000
S3 reads, assuming other services stay within applicable shared free allowances.
This is not a cap or measured usage. See [DEPLOYMENT.md](DEPLOYMENT.md) for exact
rates, assumptions, Price List evidence and deployment steps. Obtain a decision
on this nonzero cost before executing the prepared deployment.

### Applicable service offers

The new AWS experience lists Cognito, DynamoDB, Lambda, API Gateway, S3, and
CloudFront as supported Free Tier services. Availability and free usage
allowances are separate questions.
[Supported services](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html).

| Service | Purpose | Published allowance / cost consideration |
|---|---|---|
| Cognito User Pools, Essentials | Managed login | 10,000 monthly active users for direct/social sign-in, shared across eligible pools rather than per team. Plus has no MAU free tier. Email/SMS have separate terms. [Pricing](https://aws.amazon.com/cognito/pricing/) |
| DynamoDB Standard, provisioned | Calendars and memberships | 25 GB storage and 25 read / 25 write capacity units. Capacity allowances are shared across eligible tables/indexes; on-demand requests do not use the provisioned allowance. [Pricing](https://aws.amazon.com/dynamodb/pricing/) |
| Lambda, ordinary on-demand functions | Application operations | 1 million requests and 400,000 GB-seconds monthly. Logs and related services are separate. [Pricing](https://aws.amazon.com/lambda/pricing/) |
| API Gateway HTTP API | Authenticated API | Credit-backed usage for new customers; legacy time-limited offers depend on eligibility. Do not assume a permanent free million requests for this project. [Pricing](https://aws.amazon.com/api-gateway/pricing/) |
| CloudFront, standard pay-as-you-go | HTTPS web delivery | Published Always Free allowance: 1 TB outbound data and 10 million HTTP/HTTPS requests monthly. The AWS project's lifetime still applies. [Pricing](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/) |
| S3 | Private web-build bucket | Budget storage, requests, and retained build versions against applicable credits/offers. Do not assume permanent free storage. [Pricing](https://aws.amazon.com/s3/pricing/) |
| CloudWatch | Logs and monitoring | Bound log volume, retention, and alarms; include these in the deployment estimate. [Pricing](https://aws.amazon.com/cloudwatch/pricing/) |

**Free plan lifetime:** AWS's current new-customer Free plan lasts up to six
months or until credits run out, whichever happens first. Continued hosting
requires an eligible active project, usually a Paid upgrade when the Free plan
ends. Paid can still use eligible service allowances, but excess usage is
billable. The current Free plan closes when its credits or duration end;
a zero credit balance alone is not proof that AWS will charge a payment method.
Verify the actual plan before treating the usage estimate as a cash bill, and
do not automatically upgrade it. The console shows no active credits for this
project; its plan end date remains unverified. Do not assume the new-customer
credit offer applies.
[AWS Free Tier](https://aws.amazon.com/free/),
[plan comparison](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html).

**CloudFront naming trap:** the separate flat-rate “Free” subscription is not
available to AWS Free Tier projects. Use the standard distribution with its
usage allowance, not that subscription.
[Eligibility](https://docs.aws.amazon.com/PricingPlanManager/latest/UserGuide/plans.html).

## Recommended architecture

### Component-to-service map

EC2 is excluded. Deploy one small serverless environment first, with all
Regional resources in Malaysia (`ap-southeast-5`). Free allowances are usage
limits, not a guarantee that the whole application will remain free.

| ShiftCalendar component | AWS service / implementation | Milestone | Cost boundary |
|---|---|---|---|
| Browser app: calendar, settings, and teams screens | Expo web build stored in a **private S3 bucket** | M1 | S3 storage and requests use applicable credits/offers; no assumed ongoing free storage. |
| Public HTTPS address and static asset delivery | **CloudFront**, standard pay-as-you-go distribution, default domain and S3 origin access control | M1 | Ongoing request/transfer allowance; use the standard distribution while Free plan eligibility is unresolved. |
| Login page, registration, verification, password recovery, and sessions | **Cognito User Pools — Essentials**, managed login and public app clients | M1 | Ongoing direct/social MAU allowance; default verification email has a quota. |
| Authenticated API entry and token validation | **API Gateway HTTP API**, JWT authorizer, scopes, CORS and throttling | M1 | API requests can cost money after eligible credits/offers; no assumed ongoing request allowance. |
| Calendar edits, membership permissions, invitations, and roster operations | **Lambda**, TypeScript handlers, on-demand execution without a VPC | M1–M3 | Ongoing request/compute allowance; no provisioned concurrency. |
| Personal calendars, dated shifts, private details, shift definitions, teams, roles, and invitations | **DynamoDB Standard**, one provisioned table at 25 RCU / 25 WCU initially; no secondary indexes | M2–M3 | Uses the shared capacity allowance; check other workloads before deployment. Backups are priced separately. |
| Operational errors, request metrics, and short-lived logs | **CloudWatch** logs and service metrics | M1, M4 | Short retention and bounded logging; extra logs, custom metrics and alarms may be billable. |
| Service-to-service permissions | **IAM roles and policies** for Lambda, API invocation, and private S3 delivery | M1 | IAM has no additional charge; calendar users never receive AWS credentials. |
| Repeatable resource deployment and updates | **AWS SAM / CloudFormation**, run locally with the AWS CLI | M1, M4 | No separate charge for managing these AWS resource types; deployment artifacts use S3 storage/requests. |
| Team invitation delivery | Copy/share a link from the app; redemption handled by Lambda + DynamoDB | M3 | No application email/SMS service required for the pilot. |
| Local-only calendars and offline device preferences | Existing **AsyncStorage** on the device; native login secrets in **SecureStore**, web tokens in memory | M1–M2 | Local application storage, not another AWS service. |
| Local CSV/JSON export and recovery copy | Browser download / native file sharing; explicitly allowlisted calendar data | M2, M4 | No additional AWS storage service for local exports. Cloud data recovery is validated in M4. |
| Later offline cloud synchronization | Existing Lambda + DynamoDB with an outbox and ordered change feed | M5 | Reuse the stack; include synchronization traffic in usage measurements. |
| Later approved swaps and in-app notifications | Existing Lambda + DynamoDB; evaluate queued delivery only when needed | M6 | Do not provision push, SMS, email, or scheduling services before their costs and requirements are agreed. |

### Deployment tools

Use the installed AWS CLI and Node/npm. Install missing **AWS SAM CLI**,
**cfn-lint**, and **CloudFormation Guard** with Homebrew; these run locally to
build and validate infrastructure before a change set is executed. Keep package
dependencies in the project's lockfiles. Build locally for the pilot, without
adding a hosted CI/CD service.

Installed and verified through Homebrew on 2026-09-13: SAM CLI **1.166.2**,
cfn-lint **1.56.3**, and CloudFormation Guard **3.2.1**.

### Deferred custom address — MD

Recommend **shifts.amazonian.my** for a short, specific app address. Use
**calendar.amazonian.my** if the product later covers general events as well.
The existing domain is owned by the user; no new domain purchase is needed.
Keep the existing DNS provider unless there is a separate reason to move it.

The domain is not ready yet. Keep the generated CloudFront URL throughout the
first pilot; its default HTTPS certificate needs no user-managed ACM resource.
Custom-domain rollout is the separate **MD** milestone after M1: validate ownership, configure the
CloudFront alias and HTTPS certificate, add the DNS record, and update Cognito
callback/logout URLs, API CORS and the web build's public URL together.
CloudFront requires its ACM viewer certificate in `us-east-1`; check this global
service dependency against the project's Region instructions before requesting
it. No certificate, DNS record, or alternate domain has been created.
[CloudFront custom HTTPS](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-procedures.html),
[AWS managed Region policy](https://docs.aws.amazon.com/accounts/latest/reference/scps-and-rcps-for-projects.html).
The prepared template currently uses the default CloudFront domain.

```text
Browser ──HTTPS──> CloudFront ──origin access control──> private S3 web build
   │
   ├── sign in ──> Cognito User Pool (Malaysia)
   │
   └── access token ──> API Gateway HTTP API (JWT authorizer)
                                  │
                                  v
                         Lambda: permissions + operations
                                  │
                                  v
                              DynamoDB

Expo mobile app ──> same Cognito pool and API
Local-only mode ──> existing device storage
```

All application Regional resources, including S3, Cognito, API Gateway, Lambda,
DynamoDB, and application logs, belong in `ap-southeast-5`. CloudFront is global;
its control plane can use `us-east-1`. No Lambda@Edge, cross-Region replication,
or CloudFormation StackSets. Global billing reads do not deploy Regional resources.

Use **AWS SAM / CloudFormation** for repeatable infrastructure and TypeScript
for the API. Start with one shared Cognito pool and DynamoDB table.
Application teams are database memberships, separate from AWS Settings team
members. Calendar users do not receive AWS console access or AWS credentials.

S3 + CloudFront is the hosting choice because Amplify has no published Malaysia
endpoint. Do not silently move hosting to Singapore. The Amplify **Auth client
library** can still be used without Amplify Hosting.
[Amplify endpoints](https://docs.aws.amazon.com/general/latest/gr/amplify.html).

DynamoDB fits the known queries: a user's teams, a team's schedules, and calendar
entries by date range. Revisit a relational database if complex payroll joins or
arbitrary reporting become central. Consider AppSync subscriptions later only if
live updates justify their added cost and complexity.

## Login and team behavior

### Recommended login experience

Add a simple ShiftCalendar login page with **Sign in** and **Create login**
buttons opening Cognito managed login. Start with email/password, verification,
password recovery, and logout. Custom password forms, social login, and passkeys
can follow if needed.

After login, users create a private calendar, create a team, or accept an
invitation. Team participation requires authentication. Existing mobile users
retain a separate local-only entry path and choose whether to import their data.

- Use authorization code + PKCE, separate public web/mobile app clients with
  no client secrets, and exact registered callback/logout URLs.
- Send access tokens to the API. Configure issuer/client validation and an API
  scope; additionally reject tokens whose `token_use` is not `access`.
  Login alone does not authorize access to a team.
- Native refresh tokens use `expo-secure-store`. Initially use memory-backed
  web token storage and Cognito's login session for reauthentication. Do not put
  tokens in AsyncStorage or backups. Persistent browser sessions need a deliberate
  session design; JavaScript cookies are not HttpOnly cookies.
- Logout clears session data and the user's cache and signs out of managed login.
  Enable supported rotation/revocation, without assuming JWT validation immediately
  invalidates every already-issued access token.

Essentials includes managed login; Lite provides the classic hosted UI.
[Feature plans](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-sign-in-feature-plans.html).
API Gateway provides JWT/scope checks; application code must enforce ownership
and current team membership.
[JWT authorizers](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html).

**Malaysia email constraint:** use Cognito's default sender for the pilot and
validate verification/recovery delivery and its daily quota. The Cognito email
table lists alternate SES Regions for Malaysia. Custom SES sender configuration
is therefore not an assumed same-Region upgrade; do not create SES resources
outside Malaysia. AWS-managed default email may be processed through alternate
Regions internally, so this is not a promise of Malaysia-only email processing.
Review delivery before scaling onboarding. Manually shared invitation links
avoid adding an application email service to the MVP.
[Cognito email settings](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-email.html).

### Teams and permissions

A user can join several teams with different roles. Each team has member
schedules, and its roster combines those schedules. Personal calendars stay
private and never automatically appear in a team roster. Team A and Team B
schedules are separate, even when assigned to the same person.

| Team action | Owner | Manager | Member | Viewer |
|---|---|---|---|---|
| View roster | Yes | Yes | Yes | Yes |
| Edit own team schedule | Yes | Yes | Yes | No |
| Edit another member's schedule | Yes | Yes | No | No |
| Invite/remove participants; assign non-owner roles | Yes | No | No | No |
| Transfer ownership or delete team | Yes | No | No | No |

- One owner per team initially; ownership must transfer atomically before the
  owner leaves. Managers manage schedules rather than membership.
- Personal notes, pay rates, overtime/pay estimates, leave reasons, and balances
  stay private. Team APIs expose explicitly shared shifts and availability only.
- Invitations use high-entropy tokens, stored as hashes, with expiry, revocation,
  and single use. The server controls the assigned role; default to Member.
  Make clear that a copied link grants joining rights to whoever redeems it after
  login. Email-bound invitations are a later option.
- Redemption consumes the invitation and creates membership atomically.
  Rate-limit attempts; reject expired/reused tokens without waiting for TTL deletion.
- Removed members lose subsequent server access, including queued writes.
  Purge their cached team data when removal is observed; already downloaded data
  cannot be remotely erased from an offline device.

## Application and data design

### Existing code boundaries

- `hooks/useShiftData.ts` owns local calendars and dated records.
- `hooks/ShiftContext.tsx` now selects the local or cloud repository;
  `hooks/useCloudShiftData.ts` exposes cloud permissions and save state.
  Cloud identity, scope, and team metadata are defined in `shared/cloudTypes.ts`.
- Cloud shift definitions are calendar-scoped; local-only definitions retain
  their existing device behavior.
- `hooks/useTheme.ts` contains settings and personal pay rates. Separate device
  preferences from user-private cloud data.
- `utils/exportImport.ts` now allowlists local backup/reset data through
  `utils/localDataKeys.ts`, excluding authentication and cloud keys. Cloud import
  and recovery remain separate unfinished work.
- Widgets and file/print helpers have platform-specific modules for web builds.
  Continue native-device and import/export acceptance checks in M0/M4.
- `package.json` now provides type checks, pilot tests, web export, and AWS
  preparation/deployment scripts. The backend has authorization, invitation,
  concurrency, and bounded-write tests; migration tests await that implementation.

### Initial DynamoDB model

One Standard table, initially provisioned at 25 RCU / 25 WCU subject to the verified
remaining allowance. The initial 5-unit proposal was increased within the free
allowance to support bounded transactional writes. No secondary index is
required initially: maintain mirrored
lookup rows in transactions.

| Partition key | Sort key | Purpose |
|---|---|---|
| `USER#<sub>` | `PROFILE` | User-private profile/preferences |
| `USER#<sub>` | `TEAM#<teamId>` | List the user's memberships |
| `USER#<sub>` | `CAL#<calendarId>` | List private calendars |
| `TEAM#<teamId>` | `META` | Owner, name, timezone, status |
| `TEAM#<teamId>` | `MEMBER#<sub>` | Authoritative membership/role |
| `TEAM#<teamId>` | `CAL#<calendarId>` | List member schedules |
| `CAL#<calendarId>` | `META` | Owner scope, team/user, assigned member, timezone |
| `CAL#<calendarId>` | `DAY#<YYYY-MM-DD>` | Day fields, version, updater |
| `CAL#<calendarId>` | `TYPE#<code>` | Scoped shift definitions |
| `USER#<sub>` | `PRIVATE#<calendarId>#<key>` | Private notes, pay/leave details, balances |
| `TEAM#<teamId>` | `INVITE#<tokenHash>` | Invitation role, expiry, redemption state |
| `USER#<sub>` | `MUTATION#<id>` | Bounded retry/idempotency record |

Private calendars may contain personal details; team day records contain shared
schedule fields only. Validate access to calendars referenced by private records.
Keep each item bounded rather than storing the whole history as a single item.

The implementation stores private metadata separately from private dated rows.
A private-detail update writes at most four changed dates, each at most 2 KB;
calendar bulk requests contain at most eight days. Private history is bounded to
3,660 dates / 300 KB in the API response and can require up to 37 paginated
queries. Retried private updates return current authorized state without
reapplying the old edit. Day deletion retains a versioned tombstone to prevent
stale edits from recreating deleted data.

Every request derives identity from Cognito `sub`, then checks stored ownership
and current membership. Use consistent authorization reads and transactional
membership/version conditions on writes to handle revocation races. Never trust
a client-supplied user, team, role, or calendar identifier as authorization.

Query user/team lookup rows and bounded date ranges with pagination.
Load team schedules with bounded concurrency; avoid whole-table scans.
Use calendar-local dates and IANA timezones, defaulting to `Asia/Kuala_Lumpur`,
with UTC audit timestamps and explicit overnight-shift handling.

### Synchronization scope

**MVP:** cloud saves require connectivity. Show pending/saved/failed states and
keep failed input as an unsaved draft. Read bounded month snapshots on open,
refocus, manual refresh, and after writes. Mark cached data with its fetch time.

Use expected versions and mutation IDs. A stale write returns a conflict for the
user to compare/retry; do not silently overwrite another person's schedule with
last-write-wins. Keep caches partitioned by user/calendar, with a separate local
guest namespace. Clear sensitive data on user switching.

Local-only calendars keep their offline behavior. Importing into cloud mode is
an explicit choice with a preview and recovery copy.

**M5:** add a durable outbox, retry/backoff, conflict resolution, deletion
tombstones, and an ordered server change feed with opaque cursors. Commit changes
and feed records transactionally. A bare `updatedAt > lastSync` query and client
timestamps are insufficient. Define cursor retention/full resync and reauthorize
every queued operation after reconnect.

### Initial API capabilities

| Area | Scope |
|---|---|
| User | Read/update private profile; user deletion with team ownership handling |
| Teams | List/create/read/update/delete teams and transfer ownership |
| Membership | List members, change non-owner roles, remove/leave |
| Invitations | Create/revoke an invitation and atomically redeem it |
| Calendars | List/create/read/update/delete private and team calendars |
| Calendar data | Paginated date ranges, versioned day writes/deletes, bounded bulk edits, scoped shift types/private details |
| Team roster | Paginated roster by team and date range |
| Migration | Validated, resumable personal import with stable import ID and ID mapping |

Validate permissions for every resource and every item in a bulk request.
Deletion first marks a team/calendar inaccessible, then removes dependent items
in bounded, retryable batches. Add sync and swap APIs only in their milestones.

## Milestone checklists

Local validation on 2026-09-13: app/backend type checks, **11 backend tests**,
**3 storage/routing tests**, backend bundle import, cfn-lint, project Guard rules,
and web export pass. Native Android export also passed during integration.
Browser checks covered login rendering, protected-team redirection and a local
shift surviving reload. These checks do not replace live Cognito, DynamoDB,
two-user/team, native-device or recovery acceptance tests.

Remaining first-release gaps include personal import, some team administration
screens, cloud pay/export/recovery flows, full roster pagination and live smoke
tests. M0–M4 remain incomplete until their exit checks pass. The deployment
script is prepared; no AWS resources have been created.

### Phase 0 — M0: Confirm deployment feasibility

Deliverables: billing/eligibility verification, web compatibility audit, and a
production web bundle.

- [x] Confirm Malaysia from the user and local AWS profile.
- [x] Query Free Tier usage and inspect existing calendar-stack resources.
- [x] Identify Amplify Malaysia and CloudFront subscription restrictions.
- [ ] Verify plan type, credits, and expiry in AWS Settings → Billing; record a
  deployment estimate using actual Malaysia prices and pilot traffic assumptions.
- [ ] Check relevant quotas/creation permissions without creating billable test
  resources solely to discover eligibility.
- [x] Install dependencies; run `rtk npx tsc --noEmit` and
  `rtk npx expo export --platform web`. Add missing web dependencies,
  including `react-native-web` if required.
- [ ] Fix native-only imports; test calendar, settings, and import/export behavior.
- [ ] Carry Cognito default-email delivery/quota verification into the M1 smoke test.

**Exit:** a production web bundle works locally; the architecture fits Malaysia;
the applicable billing model and limitations are documented before deployment.

### Phase 1 — M1: Hosted website and login

Deliverables: repeatable infrastructure, static hosting, Cognito, and a protected
API skeleton.

Deliver in two slices: **M1a** is local readiness as defined above; **M1b** is
deployment and live login verification after the billing checkpoint. Use the
default CloudFront address in both. MD is optional and is not an M1 exit condition.

- [x] Define SAM / CloudFormation infrastructure and least-privilege service roles.
- [ ] Export with explicit Expo `web.output: "single"`; publish `dist/` to private
  S3 using CloudFront origin access control, Block Public Access, HTTPS, and the
  default `*.cloudfront.net` domain.
- [ ] Route application deep links to `index.html` without hiding missing asset
  errors. Configure versioned assets, short HTML caching, and security headers.
- [ ] Add login/callback/logout routes, auth state, and the separate mobile local-only path.
- [ ] Configure Essentials, PKCE, callbacks, verified email, recovery, session
  expiry, logout, secure token storage, and supported token rotation/revocation.
- [ ] Deploy the HTTP API/Lambda skeleton in Malaysia with JWT authorization,
  restricted CORS, request limits, throttling, and short log retention.

**Exit:** a fresh browser can create a login, verify email, sign in, recover a
password, and sign out. Missing/invalid/expired tokens fail on protected endpoints;
direct page reload and OAuth callbacks work. The S3 bucket is not publicly readable.
[Expo web deployment](https://docs.expo.dev/guides/publishing-websites/).

### Phase 2 — M2: Personal cloud calendars

Deliverables: repository abstraction, DynamoDB persistence, private operations,
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
- [ ] Enforce Owner/Manager/Member/Viewer permissions in Lambda and reflect them in the UI.
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
- [ ] Verify mobile local-only behavior and native login/storage; validate web
  CSV/JSON flows and graceful handling of native-only features.
- [ ] Measure requests, payloads, database capacity, and throttling under the
  pilot workload; improve batching/caching before raising capacity.
- [ ] Establish billing/credit checks, short log retention, and error/throttle
  monitoring. For a Paid upgrade, configure a small budget alert and review
  spend limits in AWS Settings → Billing. Alerts are not hard spending caps.
- [ ] Demonstrate backup/restore. Price database backups/PITR before enabling;
  retain user-data resources during infrastructure rollback/deletion.
- [ ] Document deployment/rollback, session recovery, export/deletion, and the
  decision date for continued hosting before Free plan/credit expiry.
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

Dependency: M1 and control of the authoritative DNS for `amazonian.my`.
This can happen before or after M4 without changing the release dependencies.

- [ ] Confirm `shifts.amazonian.my` and access to the existing DNS provider.
- [ ] Resolve the CloudFront ACM `us-east-1` dependency against the project's
  Region constraints before requesting a certificate; validate ownership.
- [ ] Configure the CloudFront alias, certificate, and DNS record together with
  Cognito callbacks/logout, API CORS, and the web build's canonical URL.
- [ ] Verify HTTPS, direct routes, email verification/recovery, login/logout,
  and authenticated API access on the new origin. Document the old-address
  transition and rollback without replacing user pools or calendar data.

**Exit:** the custom address passes the same M1 login checks, existing users and
data remain available, and the address transition has a tested rollback.

## Cost controls and deferred scope

Start with one deployed pilot environment, local builds, and a default AWS
domain. Bound queries, imports, bulk edits, retries, and log volume. Track
allowances shared with other workloads and throttle instead of silently raising
capacity beyond the agreed cost envelope.

Defer always-running servers, NAT gateways, load balancers, custom-domain setup,
SMS, custom SES delivery, constant polling, and permanent preview environments.
Authenticator-app MFA, social login, richer reporting, public sharing, and
enterprise SSO remain follow-up decisions after the first release.

The recommendation is **S3 + standard CloudFront + Cognito Essentials + HTTP API
+ Lambda + DynamoDB**, with M0–M4 delivering the hosted multi-user, multi-team
calendar. Actual zero-cost eligibility and duration must be verified for this
project; published allowances alone do not establish them.
