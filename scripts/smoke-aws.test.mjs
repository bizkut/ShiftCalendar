import assert from 'node:assert/strict';
import test from 'node:test';
import { checkDeployment } from './smoke-aws.mjs';

const outputs = {
  WebUrl: 'https://dexample.cloudfront.net',
  ApiUrl: 'https://example.execute-api.ap-southeast-5.amazonaws.com',
  WebBucketName: 'shiftcalendar-example',
  CognitoDomain: 'example.auth.ap-southeast-5.amazoncognito.com',
  UserPoolId: 'ap-southeast-5_Example', WebClientId: 'exampleclient',
};
const html = '<!doctype html><html><script src="/_expo/static/js/web/index-example.js" defer></script></html>';
const response = (body, status = 200, headers = {}) => new Response(body, { status, headers });

function fixture(options = {}) {
  const calls = [];
  const request = async (value, init) => {
    const url = new URL(value);
    calls.push({ url, init });
    if (options.networkFailure) throw new Error('Simulated network failure');
    if (url.hostname.endsWith('.s3.ap-southeast-5.amazonaws.com')) {
      return options.publicBucket ? response(html) : response('<Error><Code>AccessDenied</Code></Error>', 403);
    }
    if (url.origin === outputs.ApiUrl) {
      if (init.method === 'OPTIONS') {
        const isAllowed = init.headers.Origin === outputs.WebUrl;
        return response(null, 204, isAllowed || options.wildcardCors ? {
          'access-control-allow-origin': options.wildcardCors ? '*' : outputs.WebUrl,
          'access-control-allow-methods': 'GET,POST',
          'access-control-allow-headers': 'authorization,content-type',
        } : {});
      }
      return response('{}', options.openApi ? 200 : 401, { 'content-type': 'application/json' });
    }
    if (url.pathname.endsWith('index-example.js')) {
      return response(options.staleBundle ? 'old preview settings' : JSON.stringify(outputs), 200, { 'content-type': 'application/javascript' });
    }
    if (url.pathname.includes('smoke-missing.js') && !options.assetFallback) return response('<Error/>', 404, { 'content-type': 'application/xml' });
    if (options.redirect) return response('', 302, { location: 'https://unrelated.invalid' });
    return response(html, 200, { 'content-type': 'text/html', 'x-content-type-options': 'nosniff', 'strict-transport-security': 'max-age=31536000' });
  };
  return { request, calls };
}

test('smoke checks use only bounded read requests and leave real login acceptance pending', async () => {
  const { request, calls } = fixture();
  const report = await checkDeployment(outputs, request);
  assert.equal(report.passed, true);
  assert.equal(report.checks.length, 11);
  assert.equal(report.remaining.length, 2);
  assert.ok(calls.every(({ init }) => ['GET', 'OPTIONS'].includes(init.method) && init.redirect === 'manual' && init.signal));
});

test('smoke checks fail for public data, unprotected APIs, and permissive CORS', async () => {
  const { request } = fixture({ publicBucket: true, openApi: true, wildcardCors: true });
  const report = await checkDeployment(outputs, request);
  const failures = report.checks.filter(check => !check.passed).map(check => check.name);
  assert.deepEqual(failures, ['Private S3 object denies anonymous access', 'Missing API token rejected',
    'Invalid API token rejected', 'CORS accepts the CloudFront origin', 'CORS rejects an unrelated origin']);
});

test('smoke checks detect stale bundles and missing assets masked by SPA HTML', async () => {
  const { request } = fixture({ staleBundle: true, assetFallback: true });
  const report = await checkDeployment(outputs, request);
  assert.deepEqual(report.checks.filter(check => !check.passed).map(check => check.name),
    ['Published web configuration', 'Missing assets retain an error']);
});

test('network failures and redirects cannot produce a successful smoke report', async () => {
  for (const options of [{ networkFailure: true }, { redirect: true }]) {
    const { request } = fixture(options);
    const report = await checkDeployment(outputs, request);
    assert.equal(report.passed, false);
    assert.equal(report.checks[0].passed, false);
  }
});

test('unexpected or wrong-Region origins are rejected before any request', async () => {
  for (const invalid of [
    { WebUrl: 'http://dexample.cloudfront.net' },
    { WebUrl: 'https://dexample.cloudfront.net.unrelated.invalid' },
    { ApiUrl: 'https://example.execute-api.us-east-1.amazonaws.com' },
    { WebBucketName: '../unexpected' },
  ]) {
    const { request, calls } = fixture();
    await assert.rejects(checkDeployment({ ...outputs, ...invalid }, request));
    assert.equal(calls.length, 0);
  }
});

test('a server error does not count as proof of unrelated-origin CORS rejection', async () => {
  const { request } = fixture();
  const report = await checkDeployment(outputs, (url, init) => {
    if (init.headers?.Origin === 'https://shiftcalendar-smoke.invalid') return response('', 503);
    return request(url, init);
  });
  assert.deepEqual(report.checks.filter(check => !check.passed).map(check => check.name),
    ['CORS rejects an unrelated origin']);
});
