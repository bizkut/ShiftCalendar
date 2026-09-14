import { afterEach, beforeAll, expect, it, vi } from 'vitest';

let client: typeof import('../../utils/cloudClient.web');
beforeAll(async () => {
  vi.stubEnv('EXPO_PUBLIC_CLOUD_PROVIDER', 'cloudflare');
  client = await import('../../utils/cloudClient.web');
});
afterEach(() => vi.unstubAllGlobals());

it('uses same-origin cookies and CSRF headers without copying credentials into storage', async () => {
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ data: { version: 1 } }));
  vi.stubGlobal('fetch', fetcher);
  expect(await client.cloudRequest('/calendars/demo/days/2026-09-13', { method: 'PATCH', body: '{}' })).toEqual({ version: 1 });
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe('/v1/calendars/demo/days/2026-09-13');
  expect(init.credentials).toBe('same-origin');
  expect(init.redirect).toBe('manual');
  const headers = new Headers(init.headers);
  expect(headers.get('X-ShiftCalendar-Request')).toBe('1');
  expect(headers.has('Authorization')).toBe(false);
});

it.each([401, 302, 200])('treats an expired-session response (%s) as reauthentication', async (status) => {
  const dispatchEvent = vi.fn();
  vi.stubGlobal('window', { dispatchEvent });
  vi.stubGlobal('fetch', async () => new Response('Login page', { status, headers: { 'Content-Type': 'text/html' } }));
  await expect(client.cloudRequest('/session')).rejects.toMatchObject({ status: 401 });
  expect(dispatchEvent).toHaveBeenCalledOnce();
});

it('keeps a stale-write conflict distinct from session expiry', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ error: { code: 'conflict', message: 'Refresh first.' } }, { status: 409 }));
  await expect(client.cloudRequest('/calendars/demo')).rejects.toMatchObject({ code: 'conflict', status: 409 });
});

it('rejects malformed responses instead of reporting a successful save', async () => {
  vi.stubGlobal('fetch', async () => Response.json({}));
  await expect(client.cloudRequest('/calendars/demo')).rejects.toThrow('invalid response');
});

it('sends a bounded schedule preview as one same-origin JSON request', async () => {
  const fetcher = vi.fn(async () => Response.json({ data: { assignments: [], previewToken: 'abc' } }));
  vi.stubGlobal('fetch', fetcher);
  const body = JSON.stringify({ templateId: 'rotation', expectedTemplateVersion: 2,
    memberSubs: ['member'], from: '2026-12-31', to: '2027-01-01' });
  await client.cloudRequest('/teams/team/schedule-preview', { method: 'POST', body });
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe('/v1/teams/team/schedule-preview');
  expect(init.body).toBe(body);
  expect(init.cache).toBe('no-store');
  expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
});
