import { verifyIdentity, requireSameOrigin } from './auth';
import { ApiError } from './errors';
import { CalendarRepository } from './calendar';
import { SchedulingRepository } from './scheduling';
import { TeamRepository } from './teams';
import { ChangeRequestRepository } from './change-requests';
import { MigrationRepository } from './migration';

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
    const headers: Record<string, string> = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    };
    try {
      requireSameOrigin(request, env);
      const identity = await verifyIdentity(request, env, () => {
        headers['Server-Timing'] = 'jwks;desc="cold"';
      });
      const teams = new TeamRepository(env.DB, identity.sub);
      const session = await teams.provision(identity.username);
      const repository = new CalendarRepository(env.DB, identity.sub);
      const scheduling = new SchedulingRepository(env.DB, identity.sub, repository);
      const changeRequests = new ChangeRequestRepository(env.DB, identity.sub, repository);
      const migration = new MigrationRepository(env.DB, identity.sub, repository);
      const parts = path.split('/').filter(Boolean);
      if (path === '/v1/session' && request.method === 'GET') {
        return Response.json({ data: { sub: session.sub, username: session.username, applicationAdmin: session.applicationAdmin } }, { headers });
      }
      const query = new URL(request.url).searchParams;
      const cursor = query.get('cursor') ?? '';
      const limit = Number(query.get('limit') ?? '100');
      let data: unknown;
      let status = 200;
      if (path === '/v1/bootstrap' && request.method === 'GET') {
        const [page, teamPage] = await Promise.all([repository.list(), teams.listTeams()]);
        data = { profile: { sub: session.sub }, calendars: page.items, teams: teamPage.items,
          capabilities: { teams: true, privateDetails: false, applicationAdmin: session.applicationAdmin } };
      } else if (path === '/v1/calendars' && request.method === 'POST') {
        data = await repository.create(await readBody(request)); status = 201;
      } else if (path === '/v1/calendars' && request.method === 'GET') {
        data = await repository.list(cursor, limit);
      } else if (parts[1] === 'calendars' && parts[3] === 'days' && parts.length === 5 && request.method === 'PATCH') {
        data = await repository.writeDay(parts[2], parts[4], await readBody(request));
      } else if (parts[1] === 'calendars' && parts.length === 3 && request.method === 'GET') {
        data = await repository.get(parts[2]);
      } else if (parts[1] === 'calendars' && parts[3] === 'days' && parts.length === 4 && request.method === 'GET') {
        data = await repository.days(parts[2], query.get('from') ?? '', query.get('to') ?? '');
      } else if (parts[1] === 'calendars' && parts.length === 4 && request.method === 'GET' && parts[3] === 'shift-types') {
        data = await scheduling.listShiftTypes(parts[2]);
      } else if (parts[1] === 'calendars' && parts[3] === 'shift-types' && parts.length === 5 && request.method === 'PUT') {
        data = await scheduling.putShiftType(parts[2], parts[4], await readBody(request));
      } else if (parts[1] === 'calendars' && parts[3] === 'shift-types' && parts.length === 5 && request.method === 'DELETE') {
        data = await scheduling.archiveShiftType(parts[2], parts[4], await readBody(request));
      } else if (parts[1] === 'calendars' && parts.length === 4 && request.method === 'GET' && parts[3] === 'private-details') {
        const selected = await repository.get(parts[2]);
        if (selected.scope !== 'private') throw new ApiError(403, 'forbidden', 'Personal details are private.');
        data = { calendarId: selected.id, days: [], leaveBalances: {}, version: 0, updatedAt: selected.updatedAt };
      } else if (path === '/v1/teams' && request.method === 'GET') {
        data = await teams.listTeams(cursor, limit);
      } else if (path === '/v1/teams' && request.method === 'POST') {
        data = await teams.createTeam(await readBody(request)); status = 201;
      } else if (parts[1] === 'teams' && parts[3] === 'members' && parts.length === 4 && request.method === 'GET') {
        data = await teams.listMembers(parts[2], cursor, limit);
      } else if (parts[1] === 'teams' && parts[3] === 'roster' && parts.length === 4 && request.method === 'GET') {
        data = await repository.roster(parts[2], query.get('from') ?? '', query.get('to') ?? '',
          cursor, limit, query.get('memberSub') ?? '');
      } else if (parts[1] === 'teams' && parts[3] === 'roster' && parts[5] === 'days'
          && parts.length === 7 && request.method === 'PATCH') {
        data = await repository.writeRosterDay(parts[2], parts[4], parts[6], await readBody(request));
      } else if (parts[1] === 'teams' && parts[3] === 'rotation-templates' && parts.length === 4 && request.method === 'GET') {
        data = await scheduling.listTemplates(parts[2]);
      } else if (parts[1] === 'teams' && parts[3] === 'rotation-templates' && parts.length === 5 && request.method === 'PUT') {
        data = await scheduling.putTemplate(parts[2], parts[4], await readBody(request));
      } else if (parts[1] === 'teams' && parts[3] === 'rotation-templates' && parts.length === 5 && request.method === 'DELETE') {
        data = await scheduling.archiveTemplate(parts[2], parts[4], await readBody(request));
      } else if (parts[1] === 'teams' && parts[3] === 'schedule-preview' && parts.length === 4 && request.method === 'POST') {
        data = await scheduling.preview(parts[2], await readBody(request));
      } else if (parts[1] === 'teams' && parts[3] === 'schedule-apply' && parts.length === 4 && request.method === 'POST') {
        data = await scheduling.apply(parts[2], await readBody(request));
      } else if (parts[1] === 'teams' && parts[3] === 'import-preview' && parts.length === 4 && request.method === 'POST') {
        data = await migration.preview(parts[2], await readBody(request));
      } else if (parts[1] === 'teams' && parts[3] === 'import-apply' && parts.length === 4 && request.method === 'POST') {
        data = await migration.apply(parts[2], await readBody(request));
      } else if (parts[1] === 'teams' && parts[3] === 'exports' && parts.length === 5 && request.method === 'GET') {
        if (parts[4] === 'roster') data = await migration.exportRoster(parts[2], query.get('from') ?? '', query.get('to') ?? '', cursor, limit);
        else if (parts[4] === 'requests') data = await migration.exportRequests(parts[2], cursor, limit);
        else if (parts[4] === 'audit') data = await migration.exportAudit(parts[2], cursor, limit);
        else throw new ApiError(404, 'not_found', 'Export view not found.');
      } else if (parts[1] === 'teams' && parts[3] === 'change-requests' && parts.length === 4 && request.method === 'GET') {
        data = await changeRequests.list(parts[2], cursor, limit);
      } else if (parts[1] === 'teams' && parts[3] === 'change-requests' && parts.length === 4 && request.method === 'POST') {
        data = await changeRequests.create(parts[2], await readBody(request)); status = 201;
      } else if (parts[1] === 'change-requests' && parts[3] === 'respond' && parts.length === 4 && request.method === 'PATCH') {
        data = await changeRequests.respond(parts[2], await readBody(request));
      } else if (parts[1] === 'change-requests' && parts[3] === 'cancel' && parts.length === 4 && request.method === 'PATCH') {
        data = await changeRequests.cancel(parts[2], await readBody(request));
      } else if (parts[1] === 'teams' && parts[3] === 'change-requests' && parts[5] === 'resolve'
          && parts.length === 6 && request.method === 'PATCH') {
        data = await changeRequests.resolve(parts[2], parts[4], await readBody(request));
      } else if (parts[1] === 'teams' && parts[3] === 'members' && parts.length === 5 && request.method === 'PATCH') {
        data = await teams.changeMember(parts[2], parts[4], await readBody(request));
      } else if (parts[1] === 'teams' && parts[3] === 'members' && parts.length === 5 && request.method === 'DELETE') {
        data = await teams.removeMember(parts[2], parts[4], await readBody(request));
      } else if (parts[1] === 'teams' && parts[3] === 'transfer-ownership' && parts.length === 4 && request.method === 'POST') {
        data = await teams.transfer(parts[2], await readBody(request));
      } else if (parts[1] === 'teams' && parts[3] === 'invitations' && parts.length === 4 && request.method === 'GET') {
        data = await teams.listInvitations(parts[2], cursor, limit);
      } else if (parts[1] === 'teams' && parts[3] === 'invitations' && parts.length === 4 && request.method === 'POST') {
        data = await teams.createInvitation(parts[2], await readBody(request)); status = 201;
      } else if (parts[1] === 'teams' && parts[3] === 'invitations' && parts.length === 5 && request.method === 'DELETE') {
        data = await teams.revokeInvitation(parts[2], parts[4], await readBody(request));
      } else if (path === '/v1/invitations' && request.method === 'GET') {
        data = await teams.listInvitations(undefined, cursor, limit);
      } else if (parts[1] === 'invitations' && parts.length === 3 && request.method === 'PATCH') {
        data = await teams.respondInvitation(parts[2], await readBody(request));
      } else if (path === '/v1/admin/users' && request.method === 'GET') {
        data = await teams.listUsers(cursor, limit);
      } else if (parts[1] === 'admin' && parts[2] === 'users' && parts.length === 4 && request.method === 'PATCH') {
        data = await teams.updateUser(parts[3], await readBody(request));
      } else {
        throw new ApiError(501, 'not_implemented', 'This feature is not available in the Cloudflare pilot yet.');
      }
      return Response.json({ data }, { status, headers });
    } catch (error) {
      if (error instanceof ApiError) {
        return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status, headers });
      }
      console.error(JSON.stringify({ event: 'api_error', requestId: crypto.randomUUID() }));
      return Response.json({ error: { code: 'internal', message: 'Internal server error.' } }, { status: 500, headers });
    }
  },
} satisfies ExportedHandler<Env>;
