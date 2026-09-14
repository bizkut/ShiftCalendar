import { env } from 'cloudflare:workers';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import worker from '../src/index';
import schema from '../migrations/0001_calendar.sql?raw';
import administrators from '../migrations/0002_application_administrators.sql?raw';
import teamAdministration from '../migrations/0003_team_administration.sql?raw';
import expiredInvitations from '../migrations/0004_expired_invitations.sql?raw';
import teamScheduling from '../migrations/0005_team_scheduling.sql?raw';
import changeRequests from '../migrations/0006_shift_change_requests.sql?raw';

const issuer = 'https://api-test.cloudflareaccess.com';
const configured = { ...env, ACCESS_ISSUER: issuer, ACCESS_AUDIENCE: 'api-audience' };
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async () => {
  for (const sql of (schema + administrators + teamAdministration + expiredInvitations + teamScheduling + changeRequests).split(';').map(s => s.trim()).filter(Boolean)) await env.DB.prepare(sql).run();
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

it('runs targeted invitation, team switching, and enforced roles through /v1', async () => {
  await env.DB.prepare("UPDATE users SET disabled=0 WHERE sub='alice'").run();
  await env.DB.prepare('INSERT INTO application_administrators(user_sub,created_at) VALUES(?,?)').bind('alice',new Date().toISOString()).run();
  await call('alice','/session'); await call('bob','/session');
  const createdResponse=await call('alice','/teams','POST',{mutationId:'api-team',value:{name:'Ward API',timezone:'Asia/Kuala_Lumpur'}});
  expect(createdResponse.status).toBe(201);
  const {data:created}=await createdResponse.json() as {data:{id:string}};
  const inviteResponse=await call('alice',`/teams/${created.id}/invitations`,'POST',{mutationId:'api-invite',value:{inviteeUsername:'bob@example.test',role:'member',expiresAt:new Date(Date.now()+86_400_000).toISOString()}});
  expect(inviteResponse.status).toBe(201);
  const {data:invite}=await inviteResponse.json() as {data:{id:string}};
  expect(await (await call('bob','/invitations')).json()).toMatchObject({data:{items:[{id:invite.id,teamName:'Ward API'}]}});
  expect((await call('bob',`/invitations/${invite.id}`,'PATCH',{mutationId:'api-accept',expectedVersion:1,value:{status:'accepted'}})).status).toBe(200);
  const calendarResponse=await call('alice','/calendars','POST',{mutationId:'api-team-calendar',value:{name:'Bob shifts',color:'#3B82F6',timezone:'Asia/Kuala_Lumpur',teamId:created.id,assignedMemberSub:'bob'}});
  expect(calendarResponse.status).toBe(201);
  const {data:calendar}=await calendarResponse.json() as {data:{id:string}};
  const leaderRosterEdit={mutationId:'api-roster-leader',expectedVersion:0,value:{shiftCode:'A'}};
  expect((await call('alice',`/teams/${created.id}/roster/bob/days/2026-09-14`,'PATCH',leaderRosterEdit)).status).toBe(200);
  const memberRoster=await call('bob',`/teams/${created.id}/roster?from=2026-09-01&to=2026-09-30&memberSub=bob`);
  expect(memberRoster.status).toBe(200);
  const memberRosterBody=await memberRoster.json() as {data:{items:Record<string,unknown>[]}};
  expect(memberRosterBody).toMatchObject({data:{items:[{calendarId:calendar.id,memberSub:'bob',date:'2026-09-14',shiftCode:'A'}]}});
  expect(memberRosterBody.data.items[0]).not.toHaveProperty('note');
  const requestResponse=await call('bob',`/teams/${created.id}/change-requests`,'POST',{mutationId:'api-change-request',value:{kind:'direct',requesterCalendarId:calendar.id,
    requesterDate:'2026-09-14',requesterObservedVersion:1,requesterObservedShiftCode:'A',requestedShiftCode:'M',reason:'Private appointment'}});
  expect(requestResponse.status).toBe(201);
  const {data:changeRequest}=await requestResponse.json() as {data:{id:string}};
  expect(await (await call('alice',`/teams/${created.id}/change-requests?limit=100`)).json()).toMatchObject({data:{items:[{id:changeRequest.id,reason:'Private appointment'}]}});
  expect((await call('alice',`/teams/${created.id}/change-requests/${changeRequest.id}/resolve`,'PATCH',{mutationId:'api-change-approve',expectedVersion:1,decision:'approve'})).status).toBe(200);
  expect(await env.DB.prepare('SELECT shift_code,version FROM calendar_days WHERE calendar_id=? AND date=?').bind(calendar.id,'2026-09-14').first()).toMatchObject({shift_code:'M',version:2});
  expect((await call('bob',`/teams/${created.id}/roster/bob/days/2026-09-15`,'PATCH',{
    mutationId:'api-roster-member-denied',expectedVersion:0,value:{shiftCode:'M'},
  })).status).toBe(403);
  const edit={mutationId:'api-member-edit',expectedVersion:0,value:{shiftCode:'M'}};
  expect((await call('bob',`/calendars/${calendar.id}/days/2026-09-16`,'PATCH',edit)).status).toBe(403);
  expect((await call('alice',`/teams/${created.id}/members/bob`,'PATCH',{mutationId:'api-manager',expectedVersion:1,value:{role:'manager'}})).status).toBe(200);
  expect((await call('bob',`/teams/${created.id}/roster/bob/days/2026-09-15`,'PATCH',{
    mutationId:'api-roster-manager',expectedVersion:0,value:{shiftCode:'M'},
  })).status).toBe(200);
  expect((await call('bob',`/calendars/${calendar.id}/days/2026-09-16`,'PATCH',edit)).status).toBe(200);
  expect(await (await call('bob','/bootstrap')).json()).toMatchObject({data:{teams:[{id:created.id,role:'manager'}],calendars:[{id:calendar.id,role:'manager'}]}});
  expect((await call('bob',`/calendars/${calendar.id}/shift-types/L`,'PUT',{mutationId:'api-shift',expectedVersion:0,
    value:{label:'Late',color:'#3344AA',icon:'moon',startTime:'22:00',endTime:'06:00',position:4}})).status).toBe(200);
  expect((await call('bob',`/teams/${created.id}/rotation-templates/api-rotation`,'PUT',{mutationId:'api-template',expectedVersion:0,
    value:{name:'Late rest',description:'',pattern:['L','O']}})).status).toBe(200);
  const previewResponse=await call('bob',`/teams/${created.id}/schedule-preview`,'POST',{templateId:'api-rotation',expectedTemplateVersion:1,
    memberSubs:['bob'],from:'2026-12-31',to:'2027-01-01'});
  expect(previewResponse.status).toBe(200);
  const {data:preview}=await previewResponse.json() as { data: any };
  expect(preview.assignments.map((item:any)=>item.shiftCode)).toEqual(['L','O']);
  const applyResponse=await call('bob',`/teams/${created.id}/schedule-apply`,'POST',{mutationId:'api-apply',...preview});
  expect(applyResponse.status).toBe(200);
  expect(await applyResponse.json()).toMatchObject({data:{applied:2,conflicts:0}});
});
