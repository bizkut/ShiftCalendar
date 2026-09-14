import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import schema from '../migrations/0001_calendar.sql?raw';
import administrators from '../migrations/0002_application_administrators.sql?raw';
import teamAdministration from '../migrations/0003_team_administration.sql?raw';
import expiredInvitations from '../migrations/0004_expired_invitations.sql?raw';
import { CalendarRepository } from '../src/calendar';

const ownerSub = '10000000-0000-4000-8000-000000000001';
const memberSub = '10000000-0000-4000-8000-000000000002';
const colleagueSub = '10000000-0000-4000-8000-000000000003';
const outsiderSub = '10000000-0000-4000-8000-000000000004';
const teamId = '20000000-0000-4000-8000-000000000001';
const memberCalendarId = '30000000-0000-4000-8000-000000000001';
const colleagueCalendarId = '30000000-0000-4000-8000-000000000002';

const owner = new CalendarRepository(env.DB, ownerSub);
const member = new CalendarRepository(env.DB, memberSub);
const outsider = new CalendarRepository(env.DB, outsiderSub);
const write = (expectedVersion = 0, shiftCode = 'M', mutationId = crypto.randomUUID()) => ({
  mutationId,
  expectedVersion,
  value: { shiftCode },
});

beforeAll(async () => {
  const migrations = schema + administrators + teamAdministration + expiredInvitations;
  for (const sql of migrations.split(';').map(value => value.trim()).filter(Boolean)) {
    await env.DB.prepare(sql).run();
  }
});

beforeEach(async () => {
  for (const table of [
    'audit', 'mutations', 'calendar_days', 'calendars', 'team_invitations', 'memberships',
    'teams', 'application_administrators', 'users', 'transaction_checks',
  ]) await env.DB.prepare(`DELETE FROM ${table}`).run();

  await Promise.all([
    owner.ensureUser(), member.ensureUser(),
    new CalendarRepository(env.DB, colleagueSub).ensureUser(), outsider.ensureUser(),
  ]);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET username='owner@example.com',display_name='Team Leader' WHERE sub=?").bind(ownerSub),
    env.DB.prepare("UPDATE users SET username='member@example.com',display_name='Member One' WHERE sub=?").bind(memberSub),
    env.DB.prepare("UPDATE users SET username='colleague@example.com',display_name='Member Two' WHERE sub=?").bind(colleagueSub),
    env.DB.prepare('INSERT INTO teams(id,owner_sub,name,updated_at) VALUES(?,?,?,?)')
      .bind(teamId, ownerSub, 'Operations', new Date().toISOString()),
    env.DB.prepare("INSERT INTO memberships(team_id,user_sub,role) VALUES(?,?,'owner')").bind(teamId, ownerSub),
    env.DB.prepare("INSERT INTO memberships(team_id,user_sub,role) VALUES(?,?,'member')").bind(teamId, memberSub),
    env.DB.prepare("INSERT INTO memberships(team_id,user_sub,role) VALUES(?,?,'viewer')").bind(teamId, colleagueSub),
    env.DB.prepare(`INSERT INTO calendars(id,owner_sub,team_id,assigned_sub,name,color,timezone,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`).bind(memberCalendarId, ownerSub, teamId, memberSub, 'Member One', '#3366FF', 'Asia/Kuala_Lumpur', new Date().toISOString()),
    env.DB.prepare(`INSERT INTO calendars(id,owner_sub,team_id,assigned_sub,name,color,timezone,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`).bind(colleagueCalendarId, ownerSub, teamId, colleagueSub, 'Member Two', '#22AA66', 'Asia/Kuala_Lumpur', new Date().toISOString()),
  ]);
});

describe('bounded team roster', () => {
  it('returns shared assignments to members without private detail fields', async () => {
    await owner.writeRosterDay(teamId, memberSub, '2026-09-14', write());
    await owner.writeRosterDay(teamId, colleagueSub, '2026-09-15', write(0, 'A'));

    const roster = await member.roster(teamId, '2026-09-01', '2026-09-30');
    expect(roster.items).toEqual([
      expect.objectContaining({ calendarId: memberCalendarId, memberSub, memberDisplayName: 'Member One', date: '2026-09-14', shiftCode: 'M' }),
      expect.objectContaining({ calendarId: colleagueCalendarId, memberSub: colleagueSub, memberDisplayName: 'Member Two', date: '2026-09-15', shiftCode: 'A' }),
    ]);
    for (const item of roster.items) {
      expect(Object.keys(item)).not.toEqual(expect.arrayContaining([
        'note', 'overtimeHours', 'leaveTypeId', 'leaveReason', 'payRate', 'swap',
      ]));
    }
    expect((await member.roster(teamId, '2026-09-01', '2026-09-30', '', 100, memberSub)).items)
      .toHaveLength(1);
    await expect(outsider.roster(teamId, '2026-09-01', '2026-09-30')).rejects.toMatchObject({ status: 403 });
  });

  it('paginates without duplicates and enforces a 31-day window', async () => {
    await owner.writeRosterDay(teamId, memberSub, '2026-12-15', write());
    await owner.writeRosterDay(teamId, memberSub, '2027-01-14', write(0, 'N'));
    const first = await member.roster(teamId, '2026-12-15', '2027-01-14', '', 1);
    const second = await member.roster(teamId, '2026-12-15', '2027-01-14', first.nextCursor, 1);
    expect(first.nextCursor).toBeTruthy();
    expect([...first.items, ...second.items].map(item => item.date)).toEqual(['2026-12-15', '2027-01-14']);
    await expect(member.roster(teamId, '2026-12-15', '2027-01-15')).rejects.toMatchObject({ status: 400 });
    await expect(member.roster(teamId, '2026-02-30', '2026-03-01')).rejects.toMatchObject({ status: 400 });
    await expect(member.roster(teamId, '2026-09-01', '2026-09-30', 'invalid')).rejects.toMatchObject({ status: 400 });
  });

  it('allows leaders and current managers to write while members remain read-only', async () => {
    expect(await owner.writeRosterDay(teamId, memberSub, '2026-09-14', write()))
      .toMatchObject({ shiftCode: 'M', version: 1 });
    await expect(member.writeRosterDay(teamId, memberSub, '2026-09-15', write()))
      .rejects.toMatchObject({ status: 403 });
    await env.DB.prepare("UPDATE memberships SET role='manager' WHERE team_id=? AND user_sub=?")
      .bind(teamId, memberSub).run();
    expect(await member.writeRosterDay(teamId, colleagueSub, '2026-09-15', write(0, 'A')))
      .toMatchObject({ shiftCode: 'A', version: 1 });
    await expect(member.writeRosterDay(teamId, outsiderSub, '2026-09-16', write()))
      .rejects.toMatchObject({ status: 403 });
  });

  it('rejects retries and fresh writes after manager demotion', async () => {
    await env.DB.prepare("UPDATE memberships SET role='manager' WHERE team_id=? AND user_sub=?")
      .bind(teamId, memberSub).run();
    const request = write();
    await member.writeRosterDay(teamId, memberSub, '2026-09-14', request);
    await env.DB.prepare("UPDATE memberships SET role='member' WHERE team_id=? AND user_sub=?")
      .bind(teamId, memberSub).run();
    await expect(member.writeRosterDay(teamId, memberSub, '2026-09-14', request))
      .rejects.toMatchObject({ status: 403 });
    await expect(member.writeRosterDay(teamId, memberSub, '2026-09-14', write(1, 'N')))
      .rejects.toMatchObject({ status: 403 });
    expect(await env.DB.prepare('SELECT version FROM calendar_days WHERE calendar_id=? AND date=?')
      .bind(memberCalendarId, '2026-09-14').first('version')).toBe(1);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM audit').first('n')).toBe(1);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM transaction_checks').first('n')).toBe(0);
  });

  it('rejects roster writes when the assigned user leaves or is deactivated', async () => {
    const request = write(0, 'A');
    await owner.writeRosterDay(teamId, colleagueSub, '2026-09-14', request);
    await env.DB.prepare('DELETE FROM memberships WHERE team_id=? AND user_sub=?')
      .bind(teamId, colleagueSub).run();
    await expect(owner.writeRosterDay(teamId, colleagueSub, '2026-09-14', request))
      .rejects.toMatchObject({ status: 403 });
    await env.DB.prepare("INSERT INTO memberships(team_id,user_sub,role) VALUES(?,?,'member')")
      .bind(teamId, colleagueSub).run();
    await env.DB.prepare('UPDATE users SET disabled=1 WHERE sub=?').bind(colleagueSub).run();
    await expect(owner.writeRosterDay(teamId, colleagueSub, '2026-09-15', write()))
      .rejects.toMatchObject({ status: 403 });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM audit').first('n')).toBe(1);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM transaction_checks').first('n')).toBe(0);
  });

  it('rechecks the assigned membership inside the write transaction', async () => {
    const originalBatch = env.DB.batch.bind(env.DB);
    const spy = vi.spyOn(env.DB, 'batch').mockImplementationOnce(async <T>(statements: D1PreparedStatement[]) => {
      await env.DB.prepare('DELETE FROM memberships WHERE team_id=? AND user_sub=?')
        .bind(teamId, colleagueSub).run();
      return originalBatch<T>(statements);
    });
    try {
      await expect(owner.writeRosterDay(teamId, colleagueSub, '2026-09-14', write()))
        .rejects.toMatchObject({ status: 403 });
    } finally {
      spy.mockRestore();
    }
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM calendar_days').first('n')).toBe(0);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM audit').first('n')).toBe(0);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM transaction_checks').first('n')).toBe(0);
  });
});
