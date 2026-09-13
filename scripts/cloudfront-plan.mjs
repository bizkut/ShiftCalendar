import { setTimeout as delay } from 'node:timers/promises';

// Resolve AWS managed policies by name; never substitute custom or paid-tier policies.
export function resolveManagedPolicies(aws) {
  const caches = aws(['cloudfront', 'list-cache-policies', '--type', 'managed']).CachePolicyList?.Items || [];
  const headers = aws(['cloudfront', 'list-response-headers-policies', '--type', 'managed']).ResponseHeadersPolicyList?.Items || [];
  const html = caches.find(x => x.CachePolicy.CachePolicyConfig.Name === 'Managed-CachingDisabled')?.CachePolicy;
  const assets = caches.find(x => x.CachePolicy.CachePolicyConfig.Name === 'Managed-CachingOptimized')?.CachePolicy;
  const security = headers.find(x => x.ResponseHeadersPolicy.ResponseHeadersPolicyConfig.Name === 'Managed-SecurityHeadersPolicy')?.ResponseHeadersPolicy;
  if (!html?.Id || html.CachePolicyConfig.MinTTL !== 0 || html.CachePolicyConfig.MaxTTL !== 0 || !assets?.Id || !security?.Id) {
    throw new Error('Required AWS managed cache/security policies are unavailable. No fallback is permitted.');
  }
  return { HtmlCachePolicyId: html.Id, AssetCachePolicyId: assets.Id, SecurityHeadersPolicyId: security.Id };
}

// Read-only gate for both initial enablement and every subsequent publication.
export async function verifyFreePlan(aws, deployed, pause = delay) {
  if (!deployed.CloudFrontSubscriptionArn || !deployed.DistributionArn || !deployed.WebAclArn || !deployed.DistributionId) {
    throw new Error('Missing CloudFront FREE subscription outputs. Refusing to publish.');
  }
  for (let attempt = 0; attempt < 60; attempt++) {
    const { subscription } = aws(['pricing-plan-manager', 'get-subscription', '--arn', deployed.CloudFrontSubscriptionArn]);
    if (subscription?.arn !== deployed.CloudFrontSubscriptionArn || subscription.planFamily !== 'CloudFront' ||
        subscription.planTier !== 'FREE' || subscription.usageLevel !== 'DEFAULT' || subscription.scheduledChange ||
        subscription.resourceArns?.length !== 2 || !subscription.resourceArns.includes(deployed.DistributionArn) ||
        !subscription.resourceArns.includes(deployed.WebAclArn)) {
      throw new Error('Expected the unchanged FREE CloudFront plan covering this distribution and WAF. Refusing to publish.');
    }
    if (subscription.status === 'ACTIVE') {
      const { Distribution } = aws(['cloudfront', 'get-distribution', '--id', deployed.DistributionId]);
      if (Distribution?.ARN !== deployed.DistributionArn || Distribution.DistributionConfig?.WebACLId !== deployed.WebAclArn) {
        throw new Error('CloudFront WAF association differs from the FREE subscription. Refusing to publish.');
      }
      return subscription;
    }
    if (subscription.status !== 'SYNC_IN_PROGRESS') {
      throw new Error('CloudFront FREE subscription is not active: ' + subscription.status);
    }
    await pause(5000);
  }
  throw new Error('CloudFront subscription is still syncing. Inspect its status before retrying; no assets were published.');
}
