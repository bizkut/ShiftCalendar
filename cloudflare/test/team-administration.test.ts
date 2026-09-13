import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import schema from '../migrations/0001_calendar.sql?raw';
import administrators from '../migrations/0002_application_administrators.sql?raw';
import teamAdministration from '../migrations/0003_team_administration.sql?raw';
import expiredInvitations from '../migrations/0004_expired_invitations.sql?raw';
import { CalendarRepository } from '../src/calendar';
import { TeamRepository } from '../src/teams';

const alice = new TeamRepository(env.DB, 'alice');
const bob = new TeamRepository(env.DB, 'bob');
const mutation = (value: Record<string, unknown> = {}) => ({ mutationId: crypto.randomUUID(), value });

beforeAll(async () => {
  for (const sql of (schema + administrators + teamAdministration + expiredInvitations).split(';').map(value => value.trim()).filter(Boolean)) await env.DB.prepare(sql).run();
});
beforeEach(async () => {
  for (const table of ['team_invitations','audit','mutations','calendar_days','calendars','memberships','teams','application_administrators','users','transaction_checks']) await env.DB.prepare(`DELETE FROM ${table}`).run();
  await alice.provision('alice@example.com'); await bob.provision('bob@example.com');
  await env.DB.prepare('INSERT INTO application_administrators(user_sub,created_at) VALUES(?,?)').bind('alice',new Date().toISOString()).run();
});

it('keeps Access admission separate while an administrator creates a team', async () => {
  const users = await alice.listUsers();
  expect(users.items.map(value => [value.username,value.accessAdmission])).toEqual([
    ['alice@example.com','external'],['bob@example.com','external'],
  ]);
  const firstPage=await alice.listUsers('',1);
  expect(firstPage.items).toHaveLength(1); expect(firstPage.nextCursor).toBe(firstPage.items[0].sub);
  expect((await alice.listUsers(firstPage.nextCursor!,1)).items).toHaveLength(1);
  await expect(alice.listUsers('',101)).rejects.toMatchObject({status:400});
  const created = await alice.createTeam(mutation({ name:'Ward A', timezone:'Asia/Kuala_Lumpur' }));
  expect(created.role).toBe('owner');
  await expect(bob.createTeam(mutation({ name:'Forged', timezone:'Asia/Kuala_Lumpur' }))).rejects.toMatchObject({ status:403 });
});

it('targets an existing admitted user and grants membership only after acceptance', async () => {
  const created = await alice.createTeam(mutation({ name:'Ward A', timezone:'Asia/Kuala_Lumpur' }));
  const inviteRequest = mutation({ inviteeUsername:'bob@example.com', role:'member', expiresAt:new Date(Date.now()+86_400_000).toISOString() });
  const invite = await alice.createInvitation(created.id, inviteRequest);
  expect((await bob.listTeams()).items).toHaveLength(0);
  const response = { mutationId:crypto.randomUUID(), value:{ status:'accepted' } };
  await bob.respondInvitation(invite.id,response);
  await bob.respondInvitation(invite.id,response);
  expect((await bob.listTeams()).items[0]).toMatchObject({ id:created.id, role:'member' });
  expect((await alice.listMembers(created.id)).items).toHaveLength(2);
});

it('records and idempotently revokes a pending targeted invitation', async () => {
  const created = await alice.createTeam(mutation({ name:'Ward A', timezone:'Asia/Kuala_Lumpur' }));
  const invite = await alice.createInvitation(created.id,mutation({ inviteeUsername:'bob@example.com',role:'viewer',expiresAt:new Date(Date.now()+86_400_000).toISOString() }));
  const request={mutationId:crypto.randomUUID()};
  expect(await alice.revokeInvitation(created.id,invite.id,request)).toMatchObject({status:'revoked',version:2});
  expect(await alice.revokeInvitation(created.id,invite.id,request)).toMatchObject({status:'revoked',version:2});
  expect((await bob.listInvitations()).items[0]).toMatchObject({status:'revoked'});
  await expect(bob.respondInvitation(invite.id,mutation({status:'accepted'}))).rejects.toMatchObject({status:409});
});

it('reports expired status truthfully and allows a replacement invitation', async () => {
  const created=await alice.createTeam(mutation({name:'Ward A',timezone:'Asia/Kuala_Lumpur'}));
  await env.DB.prepare(`INSERT INTO team_invitations(id,team_id,invitee_sub,role,status,expires_at,created_by,created_at)
    VALUES(?,?,?,'member','pending',?,?,?)`).bind('expired-invite',created.id,'bob',new Date(Date.now()-1000).toISOString(),'alice',new Date(Date.now()-86_400_000).toISOString()).run();
  expect((await bob.listInvitations()).items[0].status).toBe('expired');
  const replacement=await alice.createInvitation(created.id,mutation({inviteeUsername:'bob@example.com',role:'member',expiresAt:new Date(Date.now()+86_400_000).toISOString()}));
  expect(replacement.status).toBe('pending');
});

it('lets leaders and managers provision calendars while assigned members remain read-only', async () => {
  const created = await alice.createTeam(mutation({ name:'Ward A', timezone:'Asia/Kuala_Lumpur' }));
  await env.DB.prepare(`INSERT INTO memberships(team_id,user_sub,role,joined_at) VALUES(?,?,'member',?)`).bind(created.id,'bob',new Date().toISOString()).run();
  const calendar = await new CalendarRepository(env.DB,'alice').create(mutation({ name:'Bob shifts',color:'#3B82F6',timezone:'Asia/Kuala_Lumpur',teamId:created.id,assignedMemberSub:'bob' }));
  expect(calendar.role).toBe('owner');
  await expect(new CalendarRepository(env.DB,'bob').writeDay(calendar.id,'2026-09-14',{mutationId:crypto.randomUUID(),expectedVersion:0,value:{shiftCode:'M'}})).rejects.toMatchObject({ status:403 });
  await alice.changeMember(created.id,'bob',mutation({role:'manager'}));
  const saved = await new CalendarRepository(env.DB,'bob').writeDay(calendar.id,'2026-09-14',{mutationId:crypto.randomUUID(),expectedVersion:0,value:{shiftCode:'M'}});
  expect(saved).toMatchObject({shiftCode:'M',version:1});
});

it('preserves one active application administrator under concurrent demotions', async () => {
  await env.DB.prepare('INSERT INTO application_administrators(user_sub,created_at) VALUES(?,?)').bind('bob',new Date().toISOString()).run();
  const attempts = await Promise.allSettled([
    alice.updateUser('bob',{mutationId:crypto.randomUUID(),expectedVersion:1,value:{disabled:false,applicationAdmin:false}}),
    bob.updateUser('alice',{mutationId:crypto.randomUUID(),expectedVersion:1,value:{disabled:false,applicationAdmin:false}}),
  ]);
  expect(attempts.filter(value=>value.status==='fulfilled')).toHaveLength(1);
  const count=await env.DB.prepare(`SELECT COUNT(*) count FROM application_administrators a JOIN users u ON u.sub=a.user_sub WHERE u.disabled=0`).first<{count:number}>();
  expect(count?.count).toBe(1);
});

it('rejects forged user and team identifiers without leaking membership', async () => {
  await expect(bob.listMembers('missing-team')).rejects.toMatchObject({status:403});
  await expect(alice.createInvitation('missing-team',mutation({inviteeUsername:'nobody@example.com',role:'member',expiresAt:new Date(Date.now()+86_400_000).toISOString()}))).rejects.toMatchObject({status:403});
  await expect(alice.updateUser('../bob',mutation({disabled:true,applicationAdmin:false}))).rejects.toMatchObject({status:400});
});
