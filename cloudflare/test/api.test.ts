import { env } from 'cloudflare:workers';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import worker from '../src/index';
import schema from '../migrations/0001_calendar.sql?raw';

const issuer = 'https://api-test.cloudflareaccess.com';
const configured = { ...env, ACCESS_ISSUER: issuer, ACCESS_AUDIENCE: 'api-audience' };
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async () => {
  for (const sql of schema.split(';').map(s => s.trim()).filter(Boolean)) await env.DB.prepare(sql).run();
  keys = await generateKeyPair('RS256', { extractable: true });
  const jwk = await exportJWK(keys.publicKey);
  vi.stubGlobal('fetch', async () => Response.json({ keys: [{ ...jwk, kid: 'api-key', alg: 'RS256' }] }));
});
afterAll(() => vi.unstubAllGlobals());

async function call(sub: string, path: string, method = 'GET', body?: unknown) {
  const jwt = await new SignJWT({ email: `${sub}@example.test` }).setSubject(sub).setIssuer(issuer)
    .setAudience('api-audience').setIssuedAt().setExpirationTime('5m')
    .setProtectedHeader({ alg: 'RS256', kid: 'api-key' }).sign(keys.privateKey);
  return worker.fetch(new Request(`http://localhost:8787/v1${path}`, {
    method, headers: { 'Cf-Access-Jwt-Assertion': jwt, Origin: 'http://localhost:8787',
      'X-ShiftCalendar-Request': '1', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), configured);
}

it('runs session → bootstrap → create → edit → reload through the real handler and D1', async () => {
  const firstSession = await call('alice', '/session');
  expect(firstSession.status).toBe(200);
  expect(firstSession.headers.get('Server-Timing')).toBe('jwks;desc="cold"');
  const warmBootstrap = await call('alice', '/bootstrap');
  expect(warmBootstrap.status).toBe(200);
  expect(warmBootstrap.headers.get('Server-Timing')).toBeNull();
  const created = await call('alice', '/calendars', 'POST', { mutationId: 'create-api', value: {
    scope: 'private', name: 'My Shifts', color: '#123456', timezone: 'Asia/Kuala_Lumpur',
  } });
  expect(created.status).toBe(201);
  const { data: calendar } = await created.json() as { data: { id: string } };
  const saved = await call('alice', `/calendars/${calendar.id}/days/2026-09-13`, 'PATCH', {
    mutationId: 'edit-api', expectedVersion: 0, value: { shiftCode: 'D' },
  });
  expect(saved.status).toBe(200);
  const reloaded = await call('alice', `/calendars/${calendar.id}/days?from=2026-09-01&to=2026-09-30`);
  expect(reloaded.headers.get('Cache-Control')).toBe('no-store');
  expect(reloaded.headers.has('Access-Control-Allow-Origin')).toBe(false);
  expect(await reloaded.json()).toMatchObject({ data: { items: [{ shiftCode: 'D', version: 1 }] } });
  expect((await call('bob', `/calendars/${calendar.id}`)).status).toBe(403);
  expect((await call('alice', '/calendars', 'POST', { padding: 'x'.repeat(9000) })).status).toBe(413);
  expect((await worker.fetch(new Request('http://localhost:8787/v1/session'), configured)).status).toBe(401);
  await env.DB.prepare("UPDATE users SET disabled=1 WHERE sub='alice'").run();
  expect((await call('alice', '/session')).status).toBe(403);
  for (const edit of [
    { mutationId: 'disabled-new', expectedVersion: 1, value: { shiftCode: 'N' } },
    { mutationId: 'edit-api', expectedVersion: 0, value: { shiftCode: 'D' } },
  ]) {
    const denied = await call('alice', `/calendars/${calendar.id}/days/2026-09-13`, 'PATCH', edit);
    expect(denied.status).toBe(403);
    expect(denied.headers.get('Cache-Control')).toBe('no-store');
  }
  expect((await call('missing-user', `/calendars/${calendar.id}/days/2026-09-13`, 'PATCH', {
    mutationId: 'missing-edit', expectedVersion: 1, value: { shiftCode: 'N' },
  })).status).toBe(403);
  expect(await env.DB.prepare('SELECT shift_code, version FROM calendar_days WHERE calendar_id = ?')
    .bind(calendar.id).first()).toMatchObject({ shift_code: 'D', version: 1 });
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM audit WHERE actor_sub = ?').bind('alice').first('n')).toBe(2);
});
