import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import schema from '../migrations/0001_calendar.sql?raw';
import administrators from '../migrations/0002_application_administrators.sql?raw';
import teamAdministration from '../migrations/0003_team_administration.sql?raw';
import expiredInvitations from '../migrations/0004_expired_invitations.sql?raw';
import teamScheduling from '../migrations/0005_team_scheduling.sql?raw';
import changeRequests from '../migrations/0006_shift_change_requests.sql?raw';
import { CalendarRepository } from '../src/calendar';
import { ChangeRequestRepository } from '../src/change-requests';

const ownerSub = 'm6-owner'; const managerSub = 'm6-manager'; const firstSub = 'm6-first';
const secondSub = 'm6-second'; const outsiderSub = 'm6-outsider'; const teamId = 'm6-team';
const otherTeamId = 'm6-other'; const firstCalendar = 'm6-first-calendar'; const secondCalendar = 'm6-second-calendar';
const mutation = () => crypto.randomUUID();
const repo = (sub: string) => new ChangeRequestRepository(env.DB, sub);
const direct = (mutationId = mutation()) => ({ mutationId, value: { kind: 'direct', requesterCalendarId: firstCalendar,
  requesterDate: '2026-10-01', requesterObservedVersion: 1, requesterObservedShiftCode: 'M',
  requestedShiftCode: 'A', reason: 'Medical appointment' } });
const swap = (mutationId = mutation()) => ({ mutationId, value: { kind: 'swap', requesterCalendarId: firstCalendar,
  requesterDate: '2026-10-01', requesterObservedVersion: 1, requesterObservedShiftCode: 'M',
  counterpartSub: secondSub, counterpartCalendarId: secondCalendar, counterpartDate: '2026-10-02',
  counterpartObservedVersion: 1, counterpartObservedShiftCode: 'N', reason: 'Family commitment' } });

beforeAll(async () => {
  for (const sql of (schema + administrators + teamAdministration + expiredInvitations + teamScheduling + changeRequests)
    .split(';').map(value => value.trim()).filter(Boolean)) await env.DB.prepare(sql).run();
});

beforeEach(async () => {
  for (const table of ['team_change_requests', 'audit', 'mutations', 'calendar_days', 'schedule_runs',
    'team_rotation_templates', 'team_shift_types', 'calendars', 'team_invitations', 'memberships', 'teams',
    'application_administrators', 'users', 'transaction_checks']) await env.DB.prepare(`DELETE FROM ${table}`).run();
  for (const sub of [ownerSub, managerSub, firstSub, secondSub, outsiderSub]) await new CalendarRepository(env.DB, sub).ensureUser();
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET display_name='Owner' WHERE sub=?").bind(ownerSub),
    env.DB.prepare("UPDATE users SET display_name='Manager' WHERE sub=?").bind(managerSub),
    env.DB.prepare("UPDATE users SET display_name='First' WHERE sub=?").bind(firstSub),
    env.DB.prepare("UPDATE users SET display_name='Second' WHERE sub=?").bind(secondSub),
    env.DB.prepare('INSERT INTO teams(id,owner_sub,name,updated_at) VALUES(?,?,?,?)').bind(teamId, ownerSub, 'M6 team', now),
    env.DB.prepare('INSERT INTO teams(id,owner_sub,name,updated_at) VALUES(?,?,?,?)').bind(otherTeamId, outsiderSub, 'Other', now),
    env.DB.prepare("INSERT INTO memberships(team_id,user_sub,role) VALUES(?,?,'owner')").bind(teamId, ownerSub),
    env.DB.prepare("INSERT INTO memberships(team_id,user_sub,role) VALUES(?,?,'manager')").bind(teamId, managerSub),
    env.DB.prepare("INSERT INTO memberships(team_id,user_sub,role) VALUES(?,?,'member')").bind(teamId, firstSub),
    env.DB.prepare("INSERT INTO memberships(team_id,user_sub,role) VALUES(?,?,'viewer')").bind(teamId, secondSub),
    env.DB.prepare("INSERT INTO memberships(team_id,user_sub,role) VALUES(?,?,'owner')").bind(otherTeamId, outsiderSub),
    env.DB.prepare(`INSERT INTO calendars(id,owner_sub,team_id,assigned_sub,name,color,timezone,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`).bind(firstCalendar, ownerSub, teamId, firstSub, 'First', '#3366FF', 'Asia/Kuala_Lumpur', now),
    env.DB.prepare(`INSERT INTO calendars(id,owner_sub,team_id,assigned_sub,name,color,timezone,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`).bind(secondCalendar, ownerSub, teamId, secondSub, 'Second', '#6633FF', 'Asia/Kuala_Lumpur', now),
    env.DB.prepare(`INSERT INTO calendar_days(calendar_id,date,shift_code,version,deleted,updated_at,updated_by)
      VALUES(?,?,?,?,0,?,?)`).bind(firstCalendar, '2026-10-01', 'M', 1, now, ownerSub),
    env.DB.prepare(`INSERT INTO calendar_days(calendar_id,date,shift_code,version,deleted,updated_at,updated_by)
      VALUES(?,?,?,?,0,?,?)`).bind(secondCalendar, '2026-10-02', 'N', 1, now, ownerSub),
  ]);
});

describe('team shift change requests', () => {
  it('approves a direct request atomically and preserves exact retry identity', async () => {
    const createMutation = mutation(); const created = await repo(firstSub).create(teamId, direct(createMutation));
    expect(created).toMatchObject({ kind: 'direct', status: 'pending_manager', reason: 'Medical appointment', version: 1 });
    expect((await repo(firstSub).create(teamId, direct(createMutation))).id).toBe(created.id);
    await expect(repo(firstSub).create(teamId, { ...direct(createMutation), value: { ...direct().value, reason: 'Changed' } }))
      .rejects.toMatchObject({ status: 409 });
    const approval = { mutationId: mutation(), expectedVersion: 1, decision: 'approve' };
    expect(await repo(ownerSub).resolve(teamId, created.id, approval)).toMatchObject({ status: 'approved', version: 2 });
    expect(await repo(ownerSub).resolve(teamId, created.id, approval)).toMatchObject({ status: 'approved', version: 2 });
    expect(await env.DB.prepare('SELECT shift_code,version FROM calendar_days WHERE calendar_id=? AND date=?')
      .bind(firstCalendar, '2026-10-01').first()).toMatchObject({ shift_code: 'A', version: 2 });
  });

  it('requires counterpart acceptance before atomically swapping both shifts', async () => {
    const created = await repo(firstSub).create(teamId, swap());
    await expect(repo(ownerSub).resolve(teamId, created.id, { mutationId: mutation(), expectedVersion: 1, decision: 'approve' }))
      .rejects.toMatchObject({ status: 409 });
    const accepted = await repo(secondSub).respond(created.id, { mutationId: mutation(), expectedVersion: 1, decision: 'accept' });
    expect(accepted).toMatchObject({ status: 'pending_manager', version: 2 });
    await repo(managerSub).resolve(teamId, created.id, { mutationId: mutation(), expectedVersion: 2, decision: 'approve' });
    const days = await env.DB.prepare('SELECT calendar_id,shift_code,version FROM calendar_days ORDER BY calendar_id').all();
    expect(days.results).toEqual([
      expect.objectContaining({ calendar_id: firstCalendar, shift_code: 'N', version: 2 }),
      expect.objectContaining({ calendar_id: secondCalendar, shift_code: 'M', version: 2 }),
    ]);
  });

  it('supports decline, rejection, and cancellation without roster writes', async () => {
    const declined = await repo(firstSub).create(teamId, swap());
    expect(await repo(secondSub).respond(declined.id, { mutationId: mutation(), expectedVersion: 1, decision: 'decline' }))
      .toMatchObject({ status: 'declined' });
    const rejected = await repo(firstSub).create(teamId, direct());
    expect(await repo(ownerSub).resolve(teamId, rejected.id, { mutationId: mutation(), expectedVersion: 1, decision: 'reject' }))
      .toMatchObject({ status: 'rejected' });
    const cancelled = await repo(firstSub).create(teamId, direct());
    expect(await repo(firstSub).cancel(cancelled.id, { mutationId: mutation(), expectedVersion: 1 }))
      .toMatchObject({ status: 'cancelled' });
    expect(await env.DB.prepare("SELECT COUNT(*) count FROM calendar_days WHERE version>1").first()).toMatchObject({ count: 0 });
  });

  it('limits private reasons to involved members and current managers', async () => {
    const created = await repo(firstSub).create(teamId, swap());
    expect((await repo(firstSub).list(teamId)).items[0].reason).toBe('Family commitment');
    expect((await repo(secondSub).list(teamId)).items[0].reason).toBe('Family commitment');
    expect((await repo(managerSub).list(teamId)).items[0].reason).toBe('Family commitment');
    await expect(repo(outsiderSub).list(teamId)).rejects.toMatchObject({ status: 403 });
    await env.DB.prepare("INSERT INTO users(sub,display_name) VALUES('unrelated','Unrelated')").run();
    await env.DB.prepare("INSERT INTO memberships(team_id,user_sub,role) VALUES(?,'unrelated','member')").bind(teamId).run();
    expect((await repo('unrelated').list(teamId)).items).toEqual([]);
  });

  it('rejects stale approvals, inactive shifts, cross-team targets, and revoked actors', async () => {
    const stale = await repo(firstSub).create(teamId, direct());
    await env.DB.prepare("UPDATE calendar_days SET shift_code='N',version=2 WHERE calendar_id=? AND date=?")
      .bind(firstCalendar, '2026-10-01').run();
    await expect(repo(ownerSub).resolve(teamId, stale.id, { mutationId: mutation(), expectedVersion: 1, decision: 'approve' }))
      .rejects.toMatchObject({ status: 409 });
    await repo(ownerSub).resolve(teamId, stale.id, { mutationId: mutation(), expectedVersion: 1, decision: 'reject' });
    await env.DB.prepare("UPDATE calendar_days SET shift_code='M',version=1 WHERE calendar_id=? AND date=?")
      .bind(firstCalendar, '2026-10-01').run();
    await expect(repo(firstSub).create(teamId, { ...direct(), value: { ...direct().value, requestedShiftCode: 'ARCHIVED' } }))
      .rejects.toMatchObject({ code: 'shift_unavailable' });
    await expect(repo(firstSub).create(otherTeamId, direct())).rejects.toMatchObject({ status: 403 });
    const pending = await repo(firstSub).create(teamId, direct());
    await env.DB.prepare('DELETE FROM memberships WHERE team_id=? AND user_sub=?').bind(teamId, firstSub).run();
    await expect(repo(ownerSub).resolve(teamId, pending.id, { mutationId: mutation(), expectedVersion: 1, decision: 'approve' }))
      .rejects.toMatchObject({ status: 409 });
  });

  it('allows only one of two simultaneous manager approvals to change the roster', async () => {
    const created = await repo(firstSub).create(teamId, direct());
    const attempts = await Promise.allSettled([
      repo(ownerSub).resolve(teamId, created.id, { mutationId: mutation(), expectedVersion: 1, decision: 'approve' }),
      repo(managerSub).resolve(teamId, created.id, { mutationId: mutation(), expectedVersion: 1, decision: 'approve' }),
    ]);
    expect(attempts.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(item => item.status === 'rejected')).toHaveLength(1);
    expect(await env.DB.prepare('SELECT shift_code,version FROM calendar_days WHERE calendar_id=? AND date=?')
      .bind(firstCalendar, '2026-10-01').first()).toMatchObject({ shift_code: 'A', version: 2 });
    expect(await env.DB.prepare("SELECT COUNT(*) count FROM team_change_requests WHERE id=? AND status='approved'")
      .bind(created.id).first()).toMatchObject({ count: 1 });
  });

  it('bounds request input and prevents overlapping pending targets', async () => {
    await expect(repo(firstSub).create(teamId, { ...direct(), value: { ...direct().value, reason: 'x'.repeat(501) } }))
      .rejects.toMatchObject({ status: 400 });
    await expect(repo(firstSub).create(teamId, { ...direct(), value: { ...direct().value, requesterDate: '2026-02-30' } }))
      .rejects.toMatchObject({ status: 400 });
    await expect(repo(firstSub).create(teamId, { ...swap(), value: { ...swap().value, counterpartSub: firstSub } }))
      .rejects.toMatchObject({ status: 400 });
    await expect(repo(firstSub).list(teamId, '', 101)).rejects.toMatchObject({ status: 400 });
    await repo(firstSub).create(teamId, direct());
    await expect(repo(firstSub).create(teamId, direct())).rejects.toMatchObject({ status: 409 });
  });
});
