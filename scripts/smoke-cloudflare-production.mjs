import assert from 'node:assert/strict';

// Deliberately fixed to this pilot. No credentials or redirect tokens are logged.
const origin = 'https://shiftcalendar.bizkut-limau.workers.dev';
const issuer = 'https://bitter-cell-8976.cloudflareaccess.com';
for (const path of ['/', '/login', '/teams', '/_expo/static/missing.js', '/v1/session']) {
  for (const forged of [false, true]) {
    const response = await fetch(`${origin}${path}`, {
      redirect: 'manual',
      headers: forged ? { 'Cf-Access-Jwt-Assertion': 'invalid.invalid.invalid' } : {},
    });
    assert.equal(response.status, 302, `${path}: expected Access login redirect`);
    const target = new URL(response.headers.get('location'));
    assert.equal(target.origin, issuer);
    assert.ok(target.pathname.startsWith('/cdn-cgi/access/login/'));
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    await response.arrayBuffer();
  }
}
console.log('Unsigned and forged-header requests are gated by Access for assets, deep links and API.');
console.log('Authenticated routing, CSRF, privacy and persistence require the separate live acceptance checks.');
