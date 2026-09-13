# CloudFront project verification required

> **Historical AWS reference — superseded 2026-09-13.** Follow the
> [Cloudflare plan](../PLAN.md) for current work. Do not run the AWS deployment
> or resume the verification request as part of the Cloudflare migration.
> The AWS attempt was rolled back; no live calendar deployment remains.
> Support intake was sent, but the case form was not submitted and no case ID exists.
> Cloudflare deployment instructions will be added with M1; this is not its runbook.

Deployment attempt: 2026-09-13. AWS rejected distribution creation with HTTP 403
and `HandlerErrorCode: AccessDenied`. No distribution or flat-rate subscription
was created. This failure occurred before subscription activation; it does not
establish that the Free flat-rate tier itself is unavailable.

Open [AWS Support Center](https://console.aws.amazon.com/support/home#/)
for the connected project and submit this request. This file is a draft;
no support case has been submitted by the deployment tooling.

**Suggested subject:** Verify project for CloudFront distribution creation

**Request text:**

I am deploying ShiftCalendar, a small authenticated shift-calendar application
for an initial pilot of approximately 50 users across 5 teams. The website uses
a private S3 origin in Asia Pacific (Malaysia), ap-southeast-5, with CloudFront
Origin Access Control. I intend to use the CloudFront FREE flat-rate plan and
the default cloudfront.net HTTPS address. The application backend stays in
Malaysia; a CloudFront-scope WAF web ACL is its required global dependency in
us-east-1.

My project is active and was created on 30 May 2019. CloudFormation failed to
create the CloudFront distribution on 13 September 2026 with this error:

> Your account must be verified before you can add new CloudFront resources.
> To verify your account, please contact AWS Support
> (https://console.aws.amazon.com/support/home#/) and include this error message.

CloudFront request ID: `bf9d31c3-4d51-40da-811b-7dc0a489552d`.
CloudFormation logical resource: `WebDistribution`, stack: `shiftcalendar`.

Please complete or explain the verification required to create a CloudFront
distribution in this project. Please also identify any additional requirements
for the CloudFront FREE flat-rate subscription. I am not requesting a paid plan
upgrade.

## Resume after AWS confirms verification

1. Check the CLI profile still points to the intended project and Malaysia.
2. Run `rtk npm run aws:deploy` from the repository. The Free subscription and
   managed policy checks remain mandatory; do not switch pricing to bypass errors.
3. Run `rtk npm run aws:smoke`, then complete browser login and email-delivery
   acceptance checks in [DEPLOYMENT.md](../DEPLOYMENT.md).
4. Record the actual URL and active subscription evidence in [PLAN.md](../PLAN.md).

The failed attempt's diagnostic records are in ignored `.deployment/` files.
The temporary resources were removed and cleanup verified on 2026-09-13 at
12:32 UTC; all three stacks are DELETE_COMPLETE. See the cleanup record in the
deployment guide. No live URL is available yet.
