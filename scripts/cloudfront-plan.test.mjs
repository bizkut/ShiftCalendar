import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveManagedPolicies, verifyFreePlan } from './cloudfront-plan.mjs';

const deployed = {
  CloudFrontSubscriptionArn: 'arn:aws:pricingplanmanager::123456789012:subscription:sub_test',
  DistributionId: 'E123',
  DistributionArn: 'arn:aws:cloudfront::123456789012:distribution/E123',
  WebAclArn: 'arn:aws:wafv2:us-east-1:123456789012:global/webacl/test/id',
};
const active = {
  arn: deployed.CloudFrontSubscriptionArn, planFamily: 'CloudFront', planTier: 'FREE',
  usageLevel: 'DEFAULT', status: 'ACTIVE', resourceArns: [deployed.DistributionArn, deployed.WebAclArn],
};
function fixture(overrides = {}, waf = deployed.WebAclArn) {
  const calls = [];
  const aws = args => {
    calls.push(args);
    if (args[0] === 'pricing-plan-manager' && args[1] === 'get-subscription') return { subscription: { ...active, ...overrides } };
    if (args[0] === 'cloudfront' && args[1] === 'get-distribution') return { Distribution: { ARN: deployed.DistributionArn, DistributionConfig: { WebACLId: waf } } };
    throw new Error('Unexpected AWS operation: ' + args.join(' '));
  };
  return { aws, calls };
}

test('publication gate verifies active Free pricing and the actual WAF association using only reads', async () => {
  const { aws, calls } = fixture();
  assert.deepEqual(await verifyFreePlan(aws, deployed), active);
  assert.deepEqual(calls.map(x => x[1]), ['get-subscription', 'get-distribution']);
});

test('paid, missing, inactive, scheduled, and incorrectly associated plans all fail closed', async () => {
  for (const overrides of [
    { planTier: 'PRO' }, { usageLevel: 'CF_PREMIUM_L2' }, { status: 'PENDING_APPROVAL' },
    { status: 'FAILED' }, { scheduledChange: { changeType: 'CANCEL' } },
    { scheduledChange: { changeType: 'UPGRADE', planTier: 'PRO' } },
    { resourceArns: [deployed.DistributionArn] }, { resourceArns: ['another-distribution', deployed.WebAclArn] },
    { planFamily: 'Other' }, { arn: 'another-subscription' },
  ]) {
    const { aws, calls } = fixture(overrides);
    await assert.rejects(verifyFreePlan(aws, deployed));
    assert.equal(calls.length, 1);
  }
  await assert.rejects(verifyFreePlan(fixture({}, 'another-waf').aws, deployed), /association/);
  const { aws, calls } = fixture();
  await assert.rejects(verifyFreePlan(aws, {}), /Missing/);
  assert.equal(calls.length, 0);
});

test('syncing plans wait for activation, with a bounded timeout and no mutations', async () => {
  const ready = fixture();
  let first = true;
  const waits = [];
  const aws = args => {
    if (first) { first = false; return { subscription: { ...active, status: 'SYNC_IN_PROGRESS' } }; }
    return ready.aws(args);
  };
  await verifyFreePlan(aws, deployed, async ms => waits.push(ms));
  assert.deepEqual(waits, [5000]);
  const stuck = fixture({ status: 'SYNC_IN_PROGRESS' });
  await assert.rejects(verifyFreePlan(stuck.aws, deployed, async () => {}), /still syncing/);
  assert.equal(stuck.calls.length, 60);
});

test('AWS read errors prevent publication without choosing another pricing plan', async () => {
  await assert.rejects(verifyFreePlan(() => { throw new Error('AccessDenied'); }, deployed), /AccessDenied/);
});

test('managed policy lookup keeps HTML uncached and rejects missing or unsafe policies', () => {
  const cache = (Name, Id, MinTTL, MaxTTL) => ({ CachePolicy: { Id, CachePolicyConfig: { Name, MinTTL, MaxTTL } } });
  const caches = [cache('Managed-CachingDisabled', 'html', 0, 0), cache('Managed-CachingOptimized', 'assets', 1, 31536000)];
  const headers = [{ ResponseHeadersPolicy: { Id: 'security', ResponseHeadersPolicyConfig: { Name: 'Managed-SecurityHeadersPolicy' } } }];
  const aws = args => {
    assert.equal(args[0], 'cloudfront');
    assert.deepEqual(args.slice(2), ['--type', 'managed']);
    return args[1] === 'list-cache-policies' ? { CachePolicyList: { Items: caches } } : { ResponseHeadersPolicyList: { Items: headers } };
  };
  assert.deepEqual(resolveManagedPolicies(aws), { HtmlCachePolicyId: 'html', AssetCachePolicyId: 'assets', SecurityHeadersPolicyId: 'security' });
  caches[0].CachePolicy.CachePolicyConfig.MinTTL = 1;
  assert.throws(() => resolveManagedPolicies(aws), /No fallback/);
  assert.throws(() => resolveManagedPolicies(() => ({})), /unavailable/);
});
