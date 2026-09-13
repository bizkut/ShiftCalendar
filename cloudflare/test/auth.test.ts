import { env } from 'cloudflare:workers';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { verifyIdentity, requireSameOrigin } from '../src/auth';

const issuer = 'https://shiftcalendar-test.cloudflareaccess.com';
const configured = { ...env, ACCESS_ISSUER: issuer, ACCESS_AUDIENCE: 'test-audience' };
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async () => {
  keys = await generateKeyPair('RS256', { extractable: true });
  const jwk = await exportJWK(keys.publicKey);
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== `${issuer}/cdn-cgi/access/certs`) throw new Error('Unexpected outbound request');
    return Response.json({ keys: [{ ...jwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] });
  });
});
afterAll(() => vi.unstubAllGlobals());

async function request(claims: Record<string, unknown> = {}, key = keys.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { email: 'alice@example.test', sub: 'alice', iat: now,
    iss: issuer, aud: 'test-audience', exp: now + 300, ...claims };
  const signed = await new SignJWT(payload).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(key);
  return new Request('http://localhost:8787/v1/session', { headers: { 'Cf-Access-Jwt-Assertion': signed } });
}

describe('Access identity verification in workerd', () => {
  it('verifies the signature and returns separate stable identities', async () => {
    expect(await verifyIdentity(await request(), configured)).toEqual({ sub: 'alice', username: 'alice@example.test' });
    expect((await verifyIdentity(await request({ sub: 'bob', email: 'bob@example.test' }), configured)).sub).toBe('bob');
  });
  it.each([
    { exp: 1 }, { exp: undefined }, { aud: 'another-app' }, { iss: 'https://attacker.example' },
    { sub: '' }, { email: null }, { nbf: Math.floor(Date.now() / 1000) + 3600 },
  ])('rejects invalid claims %j', async (claims) => {
    await expect(verifyIdentity(await request(claims), configured)).rejects.toMatchObject({ status: 401 });
  });
  it('rejects forged signatures and spoofed email headers', async () => {
    const other = await generateKeyPair('RS256');
    await expect(verifyIdentity(await request({}, other.privateKey), configured)).rejects.toMatchObject({ status: 401 });
    await expect(verifyIdentity(new Request('http://localhost/v1/session', {
      headers: { 'Cf-Access-Authenticated-User-Email': 'alice@example.test' },
    }), configured)).rejects.toMatchObject({ status: 401 });
  });
  it('fails closed before account configuration', async () => {
    await expect(verifyIdentity(await request(), env)).rejects.toMatchObject({ status: 503 });
  });
});

describe('CSRF boundaries', () => {
  function mutation(headers: Record<string, string>) {
    return new Request('http://localhost:8787/v1/calendars', { method: 'POST', headers });
  }
  const valid = { Origin: 'http://localhost:8787', 'X-ShiftCalendar-Request': '1', 'Content-Type': 'application/json' };
  it('allows a same-origin JSON request with the custom header', () => {
    expect(() => requireSameOrigin(mutation(valid), configured)).not.toThrow();
  });
  it.each([
    { ...valid, Origin: 'https://attacker.example' },
    { ...valid, Origin: 'null' },
    { ...valid, 'X-ShiftCalendar-Request': '' },
    { ...valid, 'Content-Type': 'text/plain' },
  ])('rejects cross-site or simple requests', (headers) => {
    expect(() => requireSameOrigin(mutation(headers), configured)).toThrow();
  });
});
