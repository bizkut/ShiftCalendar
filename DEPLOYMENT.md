# AWS pilot deployment

> **Historical AWS reference — superseded 2026-09-13.** Follow the
> [Cloudflare plan](PLAN.md) for current work. Do not run the AWS deployment
> or resume the verification request as part of the Cloudflare migration.
> The AWS attempt was rolled back; no live calendar deployment remains.
> Support intake was sent, but the case form was not submitted and no case ID exists.
> Use [CLOUDFLARE.md](CLOUDFLARE.md) for local setup and the M1b deployment handoff.

Status: M1a local deployment/login readiness passed on 2026-09-13. The broader
pilot implementation and live acceptance checks remain in progress. Deployment
was attempted on 2026-09-13; AWS requires project verification before creating
CloudFront distributions. No live URL or subscription exists. See the
[support-request draft](infrastructure/cloudfront-verification.md).
The selected Region is Malaysia
(`ap-southeast-5`).

## Services

| Component | Service |
|---|---|
| Expo web bundle | Private S3 + CloudFront flat-rate Free ($0/month) |
| Required edge association | Dedicated CloudFront-scope WAF in `us-east-1`, included in the active Free subscription |
| Registration, login, recovery | Cognito Essentials managed login, code + PKCE |
| Authenticated requests | API Gateway HTTP API with Cognito JWT and scope checks |
| Calendar/team operations | Node.js 24 Lambda, arm64, 256 MB, 15-second timeout |
| Calendars, shifts, teams, roles, invitations | DynamoDB Standard provisioned table, 25 RCU / 25 WCU |
| Application and API logs | CloudWatch, seven-day retention |
| Deployment | Local SAM CLI + CloudFormation; private S3 artifact bucket |

All application resources stay in Malaysia. CloudFront is global; its required
WAF web ACL is the permitted `us-east-1` dependency. The user has
selected the default CloudFront HTTPS address for now, with a private S3 origin
and Cognito's generated login domain.

`amazonian.my` is not ready yet. The first pilot will use
`https://<distribution>.cloudfront.net`, assigned when the stack is created.
No DNS record or user-managed certificate is needed for this address.
`shifts.amazonian.my` is deferred to milestone MD in [PLAN.md](PLAN.md).

## Current slice and launch handoff

**M1a — local readiness:** review the default-address deployment/login wiring,
verify recovery from incomplete callbacks, pass `rtk npm run aws:prepare`, and
check the configured browser preview. This prepares a deployment package and
does not complete the live-login milestone.

Completed locally: 14 tests, app/backend type checks, backend build, template
lint/Guard, and web export. Browser checks verified incomplete-callback recovery
and protected-team redirects. Separate export inspections verified fresh public
configuration after clearing the build cache. Real OAuth/email checks remain pending.

**M1b — active goal, deploy and verify:** deploy the authorized Free flat-rate
design, verify subscription activation, record the resulting CloudFront URL, and
complete the live acceptance checks. Domain readiness is not a prerequisite.
Keep M2–M4 open until their calendar, team, and recovery checks pass.
Create Git checkpoints after coherent, validated milestones; exclude generated
builds, local deployment reports, credentials, and unrelated agent configuration.

## Authorized cost scenario

The signed-in billing console showed **no active credits and $0.00 remaining**
on 2026-09-13. September's estimated bill was $0.00.
`aws account get-account-information` subsequently confirmed the connected
project is ACTIVE and was created on **30 May 2019**. It uses legacy Free Tier
rules: initial first-year offers have expired, while ongoing eligible service
allowances remain. The newer plan-state API's “Missing data” response does not
turn this into a new six-month Free-plan project.
[Legacy rules](https://aws.amazon.com/free/free-tier-faqs/).

The user selected **CloudFront flat-rate plans**, then authorized the recommended
setup on 2026-09-13. Use only the **FREE** tier. Paid CloudFront plans, automatic
upgrades, and a pay-as-you-go fallback are outside this deployment's selection.

The following is a **scenario estimate, not a spending cap**, assuming S3/API
usage is billable rather than covered by a verified offer. It estimates usage
charges for the prepared stack. Rates were read from the AWS Price List API
for Malaysia on 2026-09-13, using numeric
`pricePerUnit.USD` values rather than the descriptive text.

| Item | Monthly assumption | Rate (USD) | Estimate |
|---|---:|---:|---:|
| HTTP API requests | 100,000 | 0.000001125 per request | $0.1125 |
| S3 Standard (builds, artifacts, retained versions combined) | 1 GB-month | 0.0225 per GB-month | $0.0225 |
| CloudFront Free storage credit applied to that storage | Full-month active plan, unused shared credit | Up to 5 GB of S3 Standard | −$0.0225 |
| CloudFront Free + associated WAF | 1M requests / 100 GB delivery allowance | Flat subscription | $0.00 |
| S3 PUT/COPY/POST/LIST | 1,000 | 0.0000045 per request | $0.0045 |
| S3 GET/other | 10,000 | 0.00000036 per request | $0.0036 |
| **Subtotal** | | | **$0.1206/month** |

This assumes 50 direct Cognito users, Lambda requests/compute and CloudWatch
usage within their applicable free allowances, DynamoDB capacity/storage within
the shared allowance, and an active CloudFront Free subscription. Its 5 GB S3
Standard storage credit applies across the project, including artifact storage;
it does not cover S3 requests or API Gateway requests. This is a full-month
scenario; activation timing or other storage consuming the credit can change it.
CloudFront delivery has no overage charges; sustained high usage can reduce
delivery performance. The subscription is not a cap on backend spending.
It excludes taxes, paid backup/PITR, SMS, custom domains, excess backend usage, and other
workloads consuming shared free allowances. It is not measured pilot traffic.
WAF can incur standalone charges between creation and subscription activation,
or if activation fails/cancels. Resolve failed deployments promptly; do not leave
an unassociated ACL running. S3 deployment requests are also separately billed.

API Gateway is limited to five requests/second with a burst of ten, Lambda
concurrency is limited to five, and logs have short retention. These limit load
but do not enforce a dollar cap. Billing alerts and budgets also are not caps.

The Malaysia Lambda concurrent-execution quota was checked: **1,000**. This
permits the five reserved executions in the template. DynamoDB uses the full
shared 25-unit free capacity allowance, so recheck other tables/indexes before
deployment. Bulk and private-detail writes are bounded to avoid relying on
accumulated burst capacity.

Price List evidence:
- HTTP API SKU `JM57J529D8Z5H4SB`, publication `20260911124408`.
- S3 Standard `Q3HX52RQ48CY4VQR`, PUT `A3M8FN2NJ42VS927`,
  GET `SJAUT8RTC7XFQV3B`, publication `20260911124507`.

References: [HTTP API pricing](https://aws.amazon.com/api-gateway/pricing/),
[S3 pricing](https://aws.amazon.com/s3/pricing/),
[CloudFront plan coverage and limits](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html),
[CloudFormation subscription](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-pricingplanmanager-subscription.html),
[Price List API](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/price-changes.html),
[Free Tier](https://aws.amazon.com/free/).

## Local prerequisites and validation

Installed via Homebrew: SAM CLI 1.166.2, cfn-lint 1.56.3, CloudFormation Guard
3.2.1. AWS CLI and Node/npm were already installed. Use a supported modern Node
version (Node 24 LTS recommended); the local checks also run on Node 26.

```sh
rtk brew install aws-sam-cli cfn-lint cloudformation-guard
rtk npm ci --cache /tmp/shiftcalendar-npm-cache
rtk npm --prefix backend ci --cache /tmp/shiftcalendar-npm-cache
rtk npm run aws:prepare
```

The temporary npm cache avoids an existing ownership problem in the global
cache. `aws:prepare` runs local type checks, backend tests/build, template lint,
project Guard rules, and a web export. It creates **no AWS resources**.
The Guard rules check private encrypted buckets, retained provisioned data,
JWT scopes, restricted CORS, public OAuth clients, bounded compute and log retention.
They are project-specific checks, not a claim of comprehensive compliance.

## Deploy

```sh
rtk npm run aws:deploy
```

Defaults are CLI profile `shiftcalendar`, stack `shiftcalendar`, and the fixed
Malaysia Region. Optional environment variables:
`SHIFTCALENDAR_AWS_PROFILE` and `SHIFTCALENDAR_STACK`.

The script:

1. Runs local validation and resolves the AWS managed cache/security policies.
   For an existing deployment, verifies its Free subscription before changing it.
2. Deploys the private artifact bucket in Malaysia and packages Lambda with SAM.
3. Deploys `infrastructure/edge.yaml` as `<stack>-edge` in `us-east-1`, containing
   only the required global WAF. No application services are created there.
4. Deploys the Malaysia application stack with CloudFront initially disabled and
   an `AWS::PricingPlanManager::Subscription` fixed to `CloudFront` / `FREE` /
   `DEFAULT`, referencing exactly this distribution and WAF. Every change set
   receives **describe-events** validation; failures/replacements stop deployment.
5. Verifies the subscription is ACTIVE, has no scheduled change, covers both
   expected resources, and matches the actual distribution's WAF association.
   A paid, missing, failed, or cancelled plan stops publication without a fallback.
6. Clears Expo's transform cache, builds with actual public configuration,
   rechecks the plan, then uploads immutable assets before HTML. This prevents
   preview endpoints from leaking into the deployed bundle.
7. Rechecks the plan, enables the new distribution through a validated stack
   update, and invalidates `/index.html`. Existing active sites stay enabled
   during ordinary updates. Records `.deployment/cloudfront-plan.json`.

Change-set reports, public configuration and outputs are written to ignored
`.deployment/`. Those files contain identifiers/public endpoints, not client
secrets. The public web bundle necessarily includes its client IDs and API URL.
No Cognito app client has a secret.

Application routes rewrite to `index.html`; missing assets keep their error
status. Managed CachingDisabled keeps HTML/routes uncached. Only `/_expo/*` and
`/assets/*` use managed CachingOptimized and immutable object headers. The managed
SecurityHeadersPolicy provides HSTS, nosniff, SAMEORIGIN, and
strict-origin-when-cross-origin. The previous custom policies are removed because
Free does not support them. There is no custom Permissions-Policy or CSP yet.
CloudFront/WAF access logs are unavailable on Free; backend logs remain in Malaysia.

The WAF rate rule initially observes counts at 2,000 requests/IP per five minutes;
it does not block. Review aggregate metrics during the pilot before tuning and
switching to Block. Request sampling is off to avoid capturing OAuth query data.
The WAF covers the website; the HTTP API and Cognito endpoints are accessed
directly and retain their own authentication/throttling controls.

Cognito web callbacks are `https://<distribution>/callback` and logout
returns to `/login`. Opening the web `/callback` route without the OAuth code
and state returns to login after checking the current session. Native URLs are `shiftcalendar://callback` and
`shiftcalendar://login`. API requests require `shiftcalendar/access`.

## Live acceptance checks

After deployment, run the read-only HTTP checks:

```sh
rtk npm run aws:smoke
```

This reads `.deployment/outputs.json`, makes GET/OPTIONS requests to the deployed
AWS endpoints, and writes `.deployment/smoke-results.json`. It needs no AWS
credentials or login tokens and does not create, edit, or delete AWS resources.
Requests still count as normal deployed service usage. It checks HTTPS/security
headers, direct SPA routes, the published client configuration, missing assets,
private S3 access, missing/invalid token rejection, and CORS. It does not execute
browser JavaScript or prove registration, email delivery, token expiry, or logout.
Six local fixture tests exercise success, exposed data/APIs, permissive CORS,
stale assets/configuration, network failures, and invalid endpoint selection;
those fixture results are not live AWS evidence.

Local checks do not establish that AWS creation permissions, Cognito email
delivery, or production OAuth work. Before inviting real teams:

- Verify direct S3 object access is denied and CloudFront serves HTTPS.
- Verify `.deployment/cloudfront-plan.json` reports ACTIVE/FREE, the exact
  distribution/WAF association, and no scheduled change. Track plan usage and
  S3 credits in billing. A successful resource-list call alone is not activation.
- Load `/login` and a deep route directly. Open `/callback` without OAuth
  parameters and confirm recovery to login; separately complete a real OAuth
  callback. Missing assets must not return the app HTML.
- Register controlled test logins, verify email delivery, sign in, refresh,
  recover a password, and sign out. Confirm no tokens appear in local backups.
- Confirm missing/invalid/expired tokens and ID tokens fail on the API.
- Test two teams, a user in both, each role, forged IDs, revoked membership,
  conflicts, invitation reuse/expiry, and a second browser seeing saved edits.
- Test local-only native mode and a native development build's managed login.
- Measure real usage and record billing/credit status before calling M4 complete.

## Data and release limitations

Cloud mode requires connectivity for saves. Offline cloud synchronization,
approved team swaps, push/email notifications, automated user deletion and
physical cleanup of logically deleted team/calendar records remain follow-up
milestones. Do not claim these are complete from a successful web export.

The current cloud pilot does not expose local pay estimates, file import/export,
device backup/reset, or reminders in its settings. Local-only mode retains these
features. Personal import, team rename/delete and invitation-revocation screens
remain incomplete; relevant API operations alone do not complete a milestone.
Cloud reads follow the visible month. The roster labels its first-page limit of
100 entries over 31 days. Full yearly summaries are hidden in cloud mode until
complete yearly reads are implemented.

The backend production dependency audit is clean. Compatible patch updates
removed the initial critical audit finding from the app tree; remaining
transitive Expo/Metro/navigation findings require a separate compatibility
review before M4 is complete. No forced major-version upgrades were applied.

The local JSON backup exports allowlisted device data, not a full DynamoDB
backup. Cloud data recovery and restore are an M4 acceptance requirement. Do not
enable paid DynamoDB backups/PITR without pricing them.

## Rollback and cleanup

S3, the user pool, and DynamoDB use retain policies so deleting the stack does
not erase user data. Retained resources can continue to incur charges.

For a bad web release, republish the preceding build with the same public
configuration and invalidate `/index.html`. Immutable assets are retained so
already-open browser sessions can finish loading. For API rollback, use the
previous source and lockfiles, build, and deploy through a new validated change
set. Do not replace the user pool or table as a rollback shortcut.

Failed updates leave diagnostic reports in `.deployment/`; inspect stack events
and retained resources before retrying. Cleanup requires an explicit decision
about keeping user data, deployed assets and artifact versions.

**Failed attempt cleanup (2026-09-13):** under the user's instruction to proceed
with the recommended approach, the unused resources were removed to avoid
ongoing charges. The user pool and table contained no users/calendar data, and
the web bucket was empty. The single SAM artifact version was removed. All three
stacks are DELETE_COMPLETE, and read-only checks confirmed the buckets, retained
pool/table, IAM role, global WAF, CloudFront Function, and OAC are absent. No
subscription was created. Evidence: `.deployment/failed-attempt.json`,
`.deployment/shiftcalendar-failure.json`, and `.deployment/cleanup-results.json`.
Brief standalone WAF usage and setup requests may still appear on the bill.

For full teardown, disable the distribution first, then remove the application
stack/subscription and finally the dedicated `<stack>-edge` WAF stack in
`us-east-1`. Verify cancellation and inspect any retained buckets/pool/table.
Cancelling the subscription can expose remaining resources to standard charges;
do not leave a serving distribution or standalone WAF after cancellation.

Review combined bucket storage monthly against the 1 GB cost assumption. The
30-day lifecycle removes old versions of an existing key; distinct hashed web
assets and SAM artifact keys remain until deliberately cleaned up. Keep keys
referenced by the active Lambda/template and the last known-good rollback build,
then remove obsolete release artifacts after a 30-day client grace period. Do
not apply a blanket current-object expiration to active deployment artifacts.

If a reviewed update intentionally replaces a resource, the script stops and
saves its change-set ARN in `.deployment/<stack>-changes.json`. After reviewing
the retention/data impact, execute that specific change set manually:

```sh
rtk aws cloudformation execute-change-set --change-set-name <reviewed-change-set-arn> --profile shiftcalendar --region ap-southeast-5
rtk aws cloudformation wait stack-update-complete --stack-name shiftcalendar --profile shiftcalendar --region ap-southeast-5
rtk npm run aws:deploy
```

The final deploy rerun sees the completed infrastructure update and publishes
the web assets. Review failures before retrying; do not delete retained data to
make a deployment pass.
