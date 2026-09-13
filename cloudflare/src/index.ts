import { verifyIdentity, requireSameOrigin } from './auth';
import { ApiError } from './errors';
import { CalendarRepository } from './calendar';

async function readBody(request: Request): Promise<unknown> {
  if (!request.body) throw new ApiError(400, 'invalid_request', 'Request body is required.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); throw new ApiError(413, 'invalid_request', 'Request is too large.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new ApiError(400, 'invalid_request', 'Invalid JSON.'); }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path !== '/v1' && !path.startsWith('/v1/')) {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return asset;
      if (!['GET', 'HEAD'].includes(request.method) || path.startsWith('/_expo/')
          || path.startsWith('/assets/') || path.split('/').at(-1)?.includes('.')) {
        return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
      }
      return env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
    }
    const headers = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    };
    try {
      requireSameOrigin(request, env);
      const identity = await verifyIdentity(request, env);
      const repository = new CalendarRepository(env.DB, identity.sub);
      const parts = path.split('/').filter(Boolean);
      if (parts[1] === 'calendars' && parts[3] === 'days' && parts.length === 5 && request.method === 'PATCH') {
        // writeDay checks active-user status, permissions and revision together
        // in its atomic D1 batch, including the retry path. No cached admission.
        const data = await repository.writeDay(parts[2], parts[4], await readBody(request));
        return Response.json({ data }, { headers });
      }
      // Other routes enforce disablement before dispatch.
      const user = await env.DB.prepare('SELECT disabled FROM users WHERE sub = ?').bind(identity.sub).first<{ disabled: number }>();
      if (user?.disabled) throw new ApiError(403, 'forbidden', 'This user is disabled.');
      if (path === '/v1/session' && request.method === 'GET') {
        return Response.json({ data: identity }, { headers });
      }
      const query = new URL(request.url).searchParams;
      let data: unknown;
      let status = 200;
      if (path === '/v1/bootstrap' && request.method === 'GET') {
        const page = await repository.list();
        data = { calendars: page.items, teams: [], capabilities: { teams: false, privateDetails: false } };
      } else if (path === '/v1/calendars' && request.method === 'POST') {
        await repository.ensureUser();
        data = await repository.create(await readBody(request)); status = 201;
      } else if (path === '/v1/calendars' && request.method === 'GET') {
        data = await repository.list(query.get('cursor') ?? '', Number(query.get('limit') ?? '100'));
      } else if (parts[1] === 'calendars' && parts.length === 3 && request.method === 'GET') {
        data = await repository.get(parts[2]);
      } else if (parts[1] === 'calendars' && parts[3] === 'days' && parts.length === 4 && request.method === 'GET') {
        data = await repository.days(parts[2], query.get('from') ?? '', query.get('to') ?? '');

      } else if (parts[1] === 'calendars' && parts.length === 4 && request.method === 'GET' && parts[3] === 'shift-types') {
        await repository.get(parts[2]);
        // M1 uses built-in shift definitions. Custom definitions arrive in M2.
        data = { items: [] };
      } else if (parts[1] === 'calendars' && parts.length === 4 && request.method === 'GET' && parts[3] === 'private-details') {
        const selected = await repository.get(parts[2]);
        if (selected.scope !== 'private') throw new ApiError(403, 'forbidden', 'Personal details are private.');
        // No private-detail writes are accepted until M2 adds their storage.
        data = { calendarId: selected.id, days: [], leaveBalances: {}, version: 0, updatedAt: selected.updatedAt };
      } else {
        throw new ApiError(501, 'not_implemented', 'This feature is not available in the Cloudflare pilot yet.');
      }
      return Response.json({ data }, { status, headers });
    } catch (error) {
      if (error instanceof ApiError) {
        return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status, headers });
      }
      // SQL errors can contain data; never send or log their raw text.
      console.error(JSON.stringify({ event: 'api_error', requestId: crypto.randomUUID() }));
      return Response.json({ error: { code: 'internal', message: 'Internal server error.' } }, { status: 500, headers });
    }
  },
} satisfies ExportedHandler<Env>;
