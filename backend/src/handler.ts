import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import type { ApiResponse } from '../../shared/cloudTypes.js';
import { HttpError } from './errors.js';
import { CalendarService } from './service.js';
import { DynamoStorage } from './storage.js';

type Event = APIGatewayProxyEventV2WithJWTAuthorizer;
type Result = APIGatewayProxyResultV2<ApiResponse<unknown>>;

const json = (statusCode: number, value: ApiResponse<unknown>): Result => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(value),
});

const body = <T>(event: Event): T => {
  if (!event.body) throw new HttpError(400, 'bad_request', 'JSON request body is required');
  try { return JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body) as T; }
  catch { throw new HttpError(400, 'bad_request', 'Request body must be valid JSON'); }
};

const numeric = (value?: string) => value === undefined ? undefined : Number(value);

export function createHandler(service: CalendarService) {
  return async (event: Event): Promise<Result> => {
    try {
      const claims = event.requestContext.authorizer?.jwt?.claims;
      const sub = typeof claims?.sub === 'string' ? claims.sub : '';
      if (!sub || claims?.token_use !== 'access') return json(401, { error: { code: 'unauthorized', message: 'A Cognito access token is required' } });

      const method = event.requestContext.http.method.toUpperCase();
      const path = event.rawPath.replace(/\/$/, '') || '/';
      const query = event.queryStringParameters ?? {};
      const segments = path.split('/').filter(Boolean);
      if (segments.shift() !== 'v1') throw new HttpError(404, 'not_found', 'Route not found');

      let data: unknown;
      let status = 200;

      if (method === 'GET' && segments.length === 1 && segments[0] === 'bootstrap') data = await service.bootstrap(sub);
      else if (segments.length === 1 && segments[0] === 'profile' && method === 'GET') data = await service.getProfile(sub);
      else if (segments.length === 1 && segments[0] === 'profile' && method === 'PATCH') data = await service.updateProfile(sub, body(event));
      else if (segments.length === 1 && segments[0] === 'calendars' && method === 'GET') data = await service.listCalendars(sub, numeric(query.limit), query.cursor, query.teamId);
      else if (segments.length === 1 && segments[0] === 'calendars' && method === 'POST') { const request = body<{ mutationId: string; value: Parameters<CalendarService['createCalendar']>[1] }>(event); data = await service.createCalendar(sub, { ...request.value, mutationId: request.mutationId }); status = 201; }
      else if (segments[0] === 'calendars' && segments.length === 2 && method === 'GET') data = await service.getCalendar(sub, segments[1]);
      else if (segments[0] === 'calendars' && segments.length === 2 && method === 'PATCH') data = await service.updateCalendar(sub, segments[1], body(event));
      else if (segments[0] === 'calendars' && segments.length === 2 && method === 'DELETE') data = await service.deleteCalendar(sub, segments[1], body(event));
      else if (segments[0] === 'calendars' && segments[2] === 'days' && segments.length === 3 && method === 'GET') data = await service.listDays(sub, segments[1], query.from ?? '', query.to ?? '', numeric(query.limit), query.cursor);
      else if (segments[0] === 'calendars' && segments[2] === 'days' && segments[3] === 'bulk' && segments.length === 4 && method === 'POST') data = await service.writeDaysBulk(sub, segments[1], body(event));
      else if (segments[0] === 'calendars' && segments[2] === 'days' && segments.length === 4 && method === 'PATCH') data = await service.writeDay(sub, segments[1], segments[3], body(event));
      else if (segments[0] === 'calendars' && segments[2] === 'private-details' && segments.length === 3 && method === 'GET') data = await service.getPrivateDetails(sub, segments[1]);
      else if (segments[0] === 'calendars' && segments[2] === 'private-details' && segments.length === 3 && method === 'PATCH') data = await service.updatePrivateDetails(sub, segments[1], body(event));
      else if (segments[0] === 'calendars' && segments[2] === 'shift-types' && segments.length === 3 && method === 'GET') data = await service.listShiftTypes(sub, segments[1], numeric(query.limit), query.cursor);
      else if (segments[0] === 'calendars' && segments[2] === 'shift-types' && segments.length === 4 && method === 'PUT') data = await service.putShiftType(sub, segments[1], segments[3], body(event));
      else if (segments[0] === 'calendars' && segments[2] === 'shift-types' && segments.length === 4 && method === 'DELETE') data = await service.deleteShiftType(sub, segments[1], segments[3], body(event));
      else if (segments.length === 1 && segments[0] === 'teams' && method === 'GET') data = await service.listTeams(sub, numeric(query.limit), query.cursor);
      else if (segments.length === 1 && segments[0] === 'teams' && method === 'POST') { const request = body<{ mutationId: string; value: Parameters<CalendarService['createTeam']>[1] }>(event); data = await service.createTeam(sub, { ...request.value, mutationId: request.mutationId }); status = 201; }
      else if (segments[0] === 'teams' && segments.length === 2 && method === 'GET') data = await service.getTeam(sub, segments[1]);
      else if (segments[0] === 'teams' && segments.length === 2 && method === 'PATCH') data = await service.updateTeam(sub, segments[1], body(event));
      else if (segments[0] === 'teams' && segments.length === 2 && method === 'DELETE') data = await service.deleteTeam(sub, segments[1], body(event));
      else if (segments[0] === 'teams' && segments[2] === 'members' && segments.length === 3 && method === 'GET') data = await service.listMembers(sub, segments[1], numeric(query.limit), query.cursor);
      else if (segments[0] === 'teams' && segments[2] === 'members' && segments.length === 4 && method === 'PATCH') { const request = body<{ mutationId: string; value: { role: 'manager' | 'member' | 'viewer' } }>(event); data = await service.changeMemberRole(sub, segments[1], segments[3], request.mutationId, request.value.role); }
      else if (segments[0] === 'teams' && segments[2] === 'members' && segments.length === 4 && method === 'DELETE') data = await service.removeMember(sub, segments[1], segments[3], body<{ mutationId: string }>(event).mutationId);
      else if (segments[0] === 'teams' && segments[2] === 'transfer-ownership' && segments.length === 3 && method === 'POST') { const request = body<{ mutationId: string; expectedVersion: number; value: { newOwnerSub: string } }>(event); data = await service.transferOwnership(sub, segments[1], request.mutationId, request.expectedVersion, request.value.newOwnerSub); }
      else if (segments[0] === 'teams' && segments[2] === 'invites' && segments.length === 3 && method === 'POST') { const request = body<{ mutationId: string; value: { role?: 'manager' | 'member' | 'viewer'; expiresAt?: string } }>(event); data = await service.createInvite(sub, segments[1], { mutationId: request.mutationId, ...request.value }); status = 201; }
      else if (segments[0] === 'teams' && segments[2] === 'invites' && segments.length === 4 && method === 'DELETE') data = await service.revokeInvite(sub, segments[1], segments[3], body<{ mutationId: string }>(event).mutationId);
      else if (segments[0] === 'teams' && segments[2] === 'roster' && segments.length === 3 && method === 'GET') data = await service.roster(sub, segments[1], query.from ?? '', query.to ?? '', numeric(query.limit), query.cursor);
      else if (segments[0] === 'invites' && segments[1] === 'redeem' && segments.length === 2 && method === 'POST') {
        const request = body<{ mutationId: string; value: { token: string; displayName?: string } }>(event);
        data = await service.redeemInvite(sub, request.mutationId, request.value.token, request.value.displayName);
      } else throw new HttpError(404, 'not_found', 'Route not found');

      return json(status, { data });
    } catch (error) {
      if (error instanceof HttpError) return json(error.status, { error: { code: error.code, message: error.message, details: error.details } });
      console.error('Unhandled API error', error instanceof Error ? { name: error.name, message: error.message } : { type: typeof error });
      return json(500, { error: { code: 'internal', message: 'Internal server error' } });
    }
  };
}

const tableName = process.env.TABLE_NAME;
if (!tableName) throw new Error('TABLE_NAME is required');
export const handler = createHandler(new CalendarService(new DynamoStorage(tableName)));
