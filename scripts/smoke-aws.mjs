import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const region = 'ap-southeast-5';
const requireCheck = (condition, message) => { if (!condition) throw new Error(message); };

function origin(value, hostnamePattern, label) {
  const url = new URL(value);
  requireCheck(url.protocol === 'https:' && !url.username && !url.password && !url.port &&
    url.pathname === '/' && !url.search && !url.hash && hostnamePattern.test(url.hostname),
  label + ' must be an expected AWS HTTPS origin from the deployed stack.');
  return url.origin;
}

// No AWS credentials or login tokens are needed. Inject fetch only for local tests.
export async function checkDeployment(outputs, request = fetch) {
  const web = origin(outputs.WebUrl, /^[a-z0-9]+\.cloudfront\.net$/, 'WebUrl');
  const api = origin(outputs.ApiUrl, /^[a-z0-9]+\.execute-api\.ap-southeast-5\.amazonaws\.com$/, 'ApiUrl');
  requireCheck(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(outputs.WebBucketName ?? ''), 'Invalid web bucket name.');
  for (const key of ['CognitoDomain', 'UserPoolId', 'WebClientId']) {
    requireCheck(typeof outputs[key] === 'string' && outputs[key].length > 0, 'Missing stack output: ' + key);
  }
  const results = [];
  const get = (url, init = {}) => request(url, { method: 'GET', ...init, redirect: 'manual', signal: AbortSignal.timeout(15000) });
  const check = async (name, action) => {
    try { await action(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, reason: error instanceof Error ? error.message : 'Request failed.' }); }
  };
  let index;
  await check('CloudFront HTTPS and application HTML', async () => {
    const response = await get(web + '/');
    requireCheck(response.status === 200, 'Expected HTTP 200; received ' + response.status);
    requireCheck(response.headers.get('content-type')?.includes('text/html'), 'Expected application HTML.');
    requireCheck(response.headers.get('x-content-type-options') === 'nosniff', 'Missing nosniff header.');
    requireCheck(response.headers.get('strict-transport-security')?.includes('max-age='), 'Missing HSTS header.');
    index = await response.text();
    requireCheck(/<script\b/i.test(index), 'Application script is missing.');
  });
  for (const path of ['/login', '/callback', '/teams']) {
    await check('Direct route ' + path, async () => {
      requireCheck(index !== undefined, 'Root HTML was not available for comparison.');
      const response = await get(web + path);
      requireCheck(response.status === 200 && response.headers.get('content-type')?.includes('text/html'), 'Route did not serve application HTML.');
      requireCheck(await response.text() === index, 'Route returned different HTML from the root application.');
    });
  }
  await check('Published web configuration', async () => {
    requireCheck(index !== undefined, 'Root HTML was not available.');
    const sources = [...index.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)].map(match => new URL(match[1], web));
    const bundle = sources.find(url => url.origin === web && url.pathname.startsWith('/_expo/static/js/web/') && url.pathname.endsWith('.js'));
    requireCheck(bundle, 'No same-origin Expo web bundle found.');
    const response = await get(bundle.href);
    requireCheck(response.status === 200 && /javascript/.test(response.headers.get('content-type') ?? ''), 'Web bundle did not load as JavaScript.');
    const body = await response.text();
    for (const key of ['WebUrl', 'ApiUrl', 'CognitoDomain', 'UserPoolId', 'WebClientId']) {
      requireCheck(body.includes(outputs[key]), 'Published bundle is missing the current ' + key + '.');
    }
  });
  await check('Missing assets retain an error', async () => {
    const response = await get(web + '/_expo/static/js/web/shiftcalendar-smoke-missing.js');
    requireCheck([403, 404].includes(response.status), 'Missing asset returned HTTP ' + response.status);
    requireCheck(!response.headers.get('content-type')?.includes('text/html'), 'Missing asset was replaced with HTML.');
    requireCheck(!/<(?:html|script)\b/i.test(await response.text()), 'Missing asset returned application HTML.');
  });
  await check('Private S3 object denies anonymous access', async () => {
    const response = await get(`https://${outputs.WebBucketName}.s3.${region}.amazonaws.com/index.html`);
    requireCheck(response.status === 403 && /<Code>AccessDenied<\/Code>/.test(await response.text()), 'Expected S3 AccessDenied for the deployed index object.');
  });
  for (const [name, headers] of [
    ['Missing API token rejected', {}],
    ['Invalid API token rejected', { Authorization: 'Bearer invalid-smoke-token' }],
  ]) {
    await check(name, async () => {
      const response = await get(api + '/v1/calendars', { headers });
      requireCheck([401, 403].includes(response.status), 'Expected token rejection; received HTTP ' + response.status);
      requireCheck(response.headers.get('content-type')?.includes('application/json'), 'Expected an API JSON rejection.');
    });
  }
  await check('CORS accepts the CloudFront origin', async () => {
    const response = await get(api + '/v1/calendars', { method: 'OPTIONS', headers: {
      Origin: web, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization,content-type',
    } });
    requireCheck(response.ok, 'Preflight failed with HTTP ' + response.status);
    requireCheck(response.headers.get('access-control-allow-origin') === web, 'Expected the exact CloudFront origin.');
    requireCheck(response.headers.get('access-control-allow-methods')?.split(/\s*,\s*/).includes('GET'), 'GET is missing from allowed methods.');
    const headers = response.headers.get('access-control-allow-headers')?.toLowerCase().split(/\s*,\s*/) ?? [];
    requireCheck(headers.includes('authorization') && headers.includes('content-type'), 'Required API headers are missing.');
  });
  await check('CORS rejects an unrelated origin', async () => {
    const response = await get(api + '/v1/calendars', { method: 'OPTIONS', headers: {
      Origin: 'https://shiftcalendar-smoke.invalid', 'Access-Control-Request-Method': 'GET',
    } });
    requireCheck(response.ok || [400, 401, 403, 404, 405].includes(response.status),
      'Unrelated-origin preflight returned an unexpected HTTP ' + response.status);
    const allowed = response.headers.get('access-control-allow-origin');
    requireCheck(allowed !== '*' && allowed !== 'https://shiftcalendar-smoke.invalid', 'An unrelated origin was permitted.');
  });
  return {
    checkedAt: new Date().toISOString(), webUrl: web, apiUrl: api,
    passed: results.every(result => result.passed), checks: results,
    remaining: ['Browser OAuth, registration/email verification, recovery, expiry and logout',
      'Successful authenticated API access and rejection of real expired access tokens and ID tokens'],
  };
}

async function main() {
  const outputsPath = resolve(process.argv[2] || resolve(root, '.deployment/outputs.json'));
  const outputs = JSON.parse(readFileSync(outputsPath, 'utf8'));
  const report = await checkDeployment(outputs);
  const reportPath = resolve(dirname(outputsPath), 'smoke-results.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  for (const check of report.checks) console.log(`${check.passed ? 'PASS' : 'FAIL'} ${check.name}${check.reason ? ': ' + check.reason : ''}`);
  console.log('Report: ' + reportPath);
  console.log('Real login/email, authenticated access, and expiry checks still require live acceptance.');
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
