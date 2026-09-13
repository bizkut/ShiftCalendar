import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, jwtVerify, SignJWT } from 'jose';
import { createAccessKeyResolver } from '../src/access-keys';

const issuer = 'https://resolver-test.cloudflareaccess.com';
let pair: Awaited<ReturnType<typeof generateKeyPair>>;
let publicJwk: Awaited<ReturnType<typeof exportJWK>>;
beforeAll(async () => {
  pair = await generateKeyPair('RS256', { extractable: true });
  publicJwk = await exportJWK(pair.publicKey);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function endpoint(keys: unknown[] = [{ ...publicJwk, kid: 'one' }]) {
  const mock = vi.fn(async () => Response.json({ keys }));
  vi.stubGlobal('fetch', mock);
  return mock;
}

it('imports a public verification key once and retains JWT signature and claim checks', async () => {
  const mock = endpoint();
  const resolver = createAccessKeyResolver(issuer);
  const header = { alg: 'RS256', kid: 'one' };
  const key = await resolver(header);
  expect(await resolver(header)).toBe(key);
  expect(mock).toHaveBeenCalledTimes(1);
  expect(mock.mock.calls[0]).toMatchObject([`${issuer}/cdn-cgi/access/certs`, { redirect: 'manual' }]);
  expect(key.type).toBe('public');
  expect(key.extractable).toBe(false);
  const sign = (claims: Record<string, unknown> = {}, signingKey = pair.privateKey) =>
    new SignJWT({ sub: 'alice', email: 'alice@example.test', ...claims })
      .setProtectedHeader(header).setIssuer(issuer).setAudience('pilot').setIssuedAt()
      .setExpirationTime('5m').sign(signingKey);
  const options = { algorithms: ['RS256'], issuer, audience: 'pilot', requiredClaims: ['sub', 'email', 'iat', 'exp'] };
  expect((await jwtVerify(await sign(), resolver, options)).payload.sub).toBe('alice');
  await expect(jwtVerify(await sign(), resolver, { ...options, audience: 'other' })).rejects.toThrow();
  await expect(jwtVerify(await sign(), resolver, { ...options, issuer: 'other' })).rejects.toThrow();
  await expect(jwtVerify(await sign({ nbf: Math.floor(Date.now() / 1000) + 3600 }), resolver, options)).rejects.toThrow();
  const forged = await generateKeyPair('RS256');
  await expect(jwtVerify(await sign({}, forged.privateKey), resolver, options)).rejects.toThrow();
});

it('refreshes rotated keys after cooldown and expires cached keys after ten minutes', async () => {
  let now = 1000000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const mock = endpoint();
  const resolver = createAccessKeyResolver(issuer);
  await resolver({ alg: 'RS256', kid: 'one' });
  mock.mockImplementation(async () => Response.json({ keys: [{ ...publicJwk, kid: 'two' }] }));
  await expect(resolver({ alg: 'RS256', kid: 'two' })).rejects.toThrow();
  expect(mock).toHaveBeenCalledTimes(1);
  now += 30000;
  await resolver({ alg: 'RS256', kid: 'two' });
  expect(mock).toHaveBeenCalledTimes(2);
  await expect(resolver({ alg: 'RS256', kid: 'one' })).rejects.toThrow();
  now += 600000;
  mock.mockImplementation(async () => { throw new Error('offline'); });
  await expect(resolver({ alg: 'RS256', kid: 'two' })).rejects.toThrow('offline');
});

it.each([
  { alg: 'HS256', kid: 'one' }, { alg: 'RS256' }, { alg: 'RS256', kid: '' },
])('rejects unsupported selectors before fetching %j', async header => {
  const mock = endpoint();
  await expect(createAccessKeyResolver(issuer)(header)).rejects.toThrow();
  expect(mock).not.toHaveBeenCalled();
});

it.each([
  { alg: 'HS256' }, { use: 'enc' }, { key_ops: ['sign'] },
  { key_ops: ['verify', 'verify'] }, { ext: 'yes' }, { d: 'private' }, { kty: 'oct' },
])('rejects unsuitable key metadata %j', async changes => {
  endpoint([{ ...publicJwk, kid: 'one', ...changes }]);
  await expect(createAccessKeyResolver(issuer)({ alg: 'RS256', kid: 'one' })).rejects.toThrow();
});

it('rejects ambiguous IDs rather than selecting a key arbitrarily', async () => {
  endpoint([{ ...publicJwk, kid: 'one' }, { ...publicJwk, kid: 'one' }]);
  await expect(createAccessKeyResolver(issuer)({ alg: 'RS256', kid: 'one' })).rejects.toThrow('ambiguous');
});

it('does not retain failed or oversized responses', async () => {
  const mock = endpoint();
  const resolver = createAccessKeyResolver(issuer);
  mock.mockImplementationOnce(async () => new Response('failure', { status: 503 }));
  await expect(resolver({ alg: 'RS256', kid: 'one' })).rejects.toThrow();
  mock.mockImplementationOnce(async () => new Response(' '.repeat(65537)));
  await expect(resolver({ alg: 'RS256', kid: 'one' })).rejects.toThrow('too large');
  await expect(resolver({ alg: 'RS256', kid: 'one' })).resolves.toBeInstanceOf(CryptoKey);
});

it('rejects untrusted issuer URLs before any outbound request', () => {
  const mock = endpoint();
  expect(() => createAccessKeyResolver('https://attacker.example')).toThrow();
  expect(mock).not.toHaveBeenCalled();
});

it('rejects redirect responses instead of fetching another origin', async () => {
  const mock = endpoint();
  mock.mockImplementation(async () => new Response(null, { status: 302, headers: { Location: 'https://attacker.example' } }));
  await expect(createAccessKeyResolver(issuer)({ alg: 'RS256', kid: 'one' })).rejects.toThrow();
  expect(mock).toHaveBeenCalledTimes(1);
});

it('retains the library minimum RSA key-strength check', async () => {
  const weak = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 1024, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  if (!('privateKey' in weak)) throw new Error('Expected an RSA key pair');
  endpoint([{ ...await crypto.subtle.exportKey('jwk', weak.publicKey), kid: 'one' }]);
  const encoder = new TextEncoder();
  const part = (value: object) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const input = part({ alg: 'RS256', kid: 'one' }) + '.' + part({ sub: 'alice' });
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', weak.privateKey, encoder.encode(input)));
  const token = input + '.' + btoa(String.fromCharCode(...signature)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  await expect(jwtVerify(token, createAccessKeyResolver(issuer), { algorithms: ['RS256'] })).rejects.toThrow();
});

it('allows concurrent first requests without sharing a pending response stream', async () => {
  const mock = endpoint();
  const resolver = createAccessKeyResolver(issuer);
  const keys = await Promise.all([resolver({ alg: 'RS256', kid: 'one' }), resolver({ alg: 'RS256', kid: 'one' })]);
  expect(keys.every(key => key.type === 'public')).toBe(true);
  expect(mock).toHaveBeenCalledTimes(2);
  await resolver({ alg: 'RS256', kid: 'one' });
  expect(mock).toHaveBeenCalledTimes(2);
});
