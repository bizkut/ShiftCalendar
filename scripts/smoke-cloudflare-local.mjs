import assert from 'node:assert/strict';

// Fixed loopback target: this check cannot accidentally probe a production app.
for (const [path, status, contentType] of [
  ['/login', 200, 'text/html'],
  ['/teams', 200, 'text/html'],
  ['/_expo/static/missing.js', 404, 'text/plain'],
  ['/v1/session', 401, 'application/json'],
]) {
  const response = await fetch(`http://localhost:8787${path}`, { redirect: 'manual' });
  assert.equal(response.status, status, `${path}: unexpected status or redirect`);
  assert.ok(response.headers.get('content-type')?.includes(contentType), `${path}: wrong content type`);
  assert.equal(response.headers.get('cache-control'), status === 200 ? 'no-cache' : 'no-store');
  if (path === '/v1/session') assert.equal(response.headers.get('access-control-allow-origin'), null);
  await response.arrayBuffer();
}
console.log('Local deep links, missing assets and unsigned API checks passed without redirects.');
