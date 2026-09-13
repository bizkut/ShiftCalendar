# AWS pilot deployment

Status: M1a local deployment/login readiness passed on 2026-09-13. The broader
pilot implementation and live acceptance checks remain in progress. No AWS
resources have been created by this task. The selected Region is Malaysia
(`ap-southeast-5`).

## Services

| Component | Service |
|---|---|
| Expo web bundle | Private S3 + standard CloudFront distribution |
| Registration, login, recovery | Cognito Essentials managed login, code + PKCE |
| Authenticated requests | API Gateway HTTP API with Cognito JWT and scope checks |
| Calendar/team operations | Node.js 24 Lambda, arm64, 256 MB, 15-second timeout |
| Calendars, shifts, teams, roles, invitations | DynamoDB Standard provisioned table, 25 RCU / 25 WCU |
| Application and API logs | CloudWatch, seven-day retention |
| Deployment | Local SAM CLI + CloudFormation; private S3 artifact bucket |

All Regional resources stay in Malaysia. CloudFront is global. The user has
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

**M1b — active goal, deploy and verify:** after the cost decision and billing/eligibility
checkpoint below, deploy in Malaysia, record the resulting CloudFront URL, and
complete the live acceptance checks. Domain readiness is not a prerequisite.
Keep M2–M4 open until their calendar, team, and recovery checks pass.
Create Git checkpoints after coherent, validated milestones; exclude generated
builds, local deployment reports, credentials, and unrelated agent configuration.

## Cost decision before deployment

The signed-in billing console showed **no active credits and $0.00 remaining**
on 2026-09-13. September's estimated bill was $0.00. The user described a Free
plan, but `aws freetier get-account-plan-state` returned “Missing data”.
The plan type and any time-limited eligibility remain unverified.

The following is a **scenario estimate, not a spending cap**. Prices were read
from the AWS Price List API for Malaysia on 2026-09-13, using numeric
`pricePerUnit.USD` values rather than the descriptive text.

| Item | Monthly assumption | Rate (USD) | Estimate |
|---|---:|---:|---:|
| HTTP API requests | 100,000 | 0.000001125 per request | $0.1125 |
| S3 Standard (builds, artifacts, retained versions combined) | 1 GB-month | 0.0225 per GB-month | $0.0225 |
| S3 PUT/COPY/POST/LIST | 1,000 | 0.0000045 per request | $0.0045 |
| S3 GET/other | 10,000 | 0.00000036 per request | $0.0036 |
| **Subtotal** | | | **$0.1431/month** |

This assumes 50 direct Cognito users, Lambda requests/compute and CloudWatch
usage within their applicable free allowances, DynamoDB capacity/storage within
the shared allowance, and CloudFront delivery/Functions within its allowances.
It excludes taxes, paid backup/PITR, SMS, custom domains, excess traffic, and other
workloads consuming shared free allowances. It is not measured pilot traffic.

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

## Deploy after accepting the cost scenario

```sh
rtk npm run aws:deploy
```

Defaults are CLI profile `shiftcalendar`, stack `shiftcalendar`, and the fixed
Malaysia Region. Optional environment variables:
`SHIFTCALENDAR_AWS_PROFILE` and `SHIFTCALENDAR_STACK`.

The script:
1. Runs local validation again.
2. Creates and validates a change set for the private artifact bucket.
3. Packages the Lambda bundle with SAM.
4. Creates the application change set, reads **describe-events** validation
   results, and stops on failed validation or resource replacements.
5. Executes the validated change sets and waits for completion.
6. Clears Expo's transform cache and builds web assets with the actual public
   configuration, uploads assets before HTML, and invalidates `/index.html`.
   Clearing the cache prevents a previous preview's endpoints from being reused.

Change-set reports, public configuration and outputs are written to ignored
`.deployment/`. Those files contain identifiers/public endpoints, not client
secrets. The public web bundle necessarily includes its client IDs and API URL.
No Cognito app client has a secret.

Application routes rewrite to `index.html`; missing assets keep their error
status. Cognito web callbacks are `https://<distribution>/callback` and logout
returns to `/login`. Opening the web `/callback` route without the OAuth code
and state returns to login after checking the current session. Native URLs are `shiftcalendar://callback` and
`shiftcalendar://login`. API requests require `shiftcalendar/access`.

## Live acceptance checks

Local checks do not establish that AWS creation permissions, Cognito email
delivery, or production OAuth work. Before inviting real teams:

- Verify direct S3 object access is denied and CloudFront serves HTTPS.
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
about keeping user data, deployed assets and artifact versions. There are no
temporary AWS resources from the current local preparation to clean up.

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
