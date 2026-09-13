import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import schema from '../migrations/0001_calendar.sql?raw';
import administrators from '../migrations/0002_application_administrators.sql?raw';
import { CalendarRepository } from '../src/calendar';

const alice = new CalendarRepository(env.DB, 'alice');
const bob = new CalendarRepository(env.DB, 'bob');
const write = (version = 0) => ({ mutationId: crypto.randomUUID(), expectedVersion: version, value: { shiftCode: 'M' } });

beforeAll(async () => {
  for (const sql of (schema + administrators).split(';').map(s => s.trim()).filter(Boolean)) {
    await env.DB.prepare(sql).run();
  }
});
beforeEach(async () => {
  for (const table of ['audit', 'mutations', 'calendar_days', 'calendars', 'memberships', 'teams', 'application_administrators', 'users', 'transaction_checks']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await alice.ensureUser(); await bob.ensureUser();
});

async function team(role: string, assigned = 'bob') {
  const teamId = crypto.randomUUID();
  const calendarId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO teams(id,owner_sub) VALUES(?,?)').bind(teamId, 'alice'),
    env.DB.prepare('INSERT INTO memberships(team_id,user_sub,role) VALUES(?,?,?)').bind(teamId, 'bob', role),
    env.DB.prepare(`INSERT INTO calendars(id,owner_sub,team_id,assigned_sub,name,color,timezone,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`).bind(calendarId, 'alice', teamId, assigned, 'Team calendar', '#008800', 'Asia/Kuala_Lumpur', new Date().toISOString()),
  ]);
  return { teamId, calendarId };
}

it.each(['owner', 'manager'])('allows %s to edit a teammate calendar', async role => {
  const { calendarId } = await team(role, 'alice');
  expect((await bob.writeDay(calendarId, '2026-09-14', write())).version).toBe(1);
});

it.each(['member', 'viewer'])('makes assigned %s calendars read-only', async role => {
  const { calendarId } = await team(role);
  expect((await bob.get(calendarId)).id).toBe(calendarId);
  await expect(bob.get(calendarId, true)).rejects.toMatchObject({ status: 403 });
  await expect(bob.writeDay(calendarId, '2026-09-14', write())).rejects.toMatchObject({ status: 403 });
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM audit').first('n')).toBe(0);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM mutations').first('n')).toBe(0);
});

it('does not turn application administrator status or team creator status into edit permission', async () => {
  const { calendarId } = await team('member');
  await env.DB.prepare('INSERT INTO application_administrators(user_sub,created_at) VALUES(?,?)').bind('bob', new Date().toISOString()).run();
  await expect(bob.writeDay(calendarId, '2026-09-14', write())).rejects.toMatchObject({ status: 403 });
  await expect(alice.writeDay(calendarId, '2026-09-14', write())).rejects.toMatchObject({ status: 403 });
});

it.each(['member', 'viewer', 'removed', 'disabled'])('rejects fresh writes and retries after %s', async change => {
  const { teamId, calendarId } = await team('manager');
  const request = write();
  await bob.writeDay(calendarId, '2026-09-14', request);
  if (change === 'removed') await env.DB.prepare('DELETE FROM memberships WHERE team_id=? AND user_sub=?').bind(teamId, 'bob').run();
  else if (change === 'disabled') await env.DB.prepare('UPDATE users SET disabled=1 WHERE sub=?').bind('bob').run();
  else await env.DB.prepare('UPDATE memberships SET role=? WHERE team_id=? AND user_sub=?').bind(change, teamId, 'bob').run();
  await expect(bob.writeDay(calendarId, '2026-09-14', request)).rejects.toMatchObject({ status: 403 });
  await expect(bob.writeDay(calendarId, '2026-09-14', write(1))).rejects.toMatchObject({ status: 403 });
  expect(await env.DB.prepare('SELECT version FROM calendar_days WHERE calendar_id=?').bind(calendarId).first('version')).toBe(1);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM audit').first('n')).toBe(1);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM mutations').first('n')).toBe(1);
});

it('scopes roles to each team and preserves independent private-calendar ownership', async () => {
  const managed = await team('manager');
  const viewed = await team('viewer');
  await bob.writeDay(managed.calendarId, '2026-09-14', write());
  await expect(bob.writeDay(viewed.calendarId, '2026-09-14', write())).rejects.toMatchObject({ status: 403 });
  const privateCalendar = await bob.create({ mutationId: crypto.randomUUID(), value: { scope: 'private', name: 'Private', color: '#008800', timezone: 'Asia/Kuala_Lumpur' } });
  await bob.writeDay(privateCalendar.id, '2026-09-14', write());
  await expect(alice.get(privateCalendar.id)).rejects.toMatchObject({ status: 403 });
  const privateRow = await env.DB.prepare('SELECT team_id FROM calendars WHERE id=?').bind(privateCalendar.id).first();
  expect(privateRow?.team_id).toBeNull();
});

it('rechecks a demotion at the write transaction boundary', async () => {
  const { teamId, calendarId } = await team('manager');
  expect((await bob.get(calendarId, true)).id).toBe(calendarId);
  const originalBatch = env.DB.batch.bind(env.DB);
  const spy = vi.spyOn(env.DB, 'batch').mockImplementationOnce(async <T>(statements: D1PreparedStatement[]) => {
    await env.DB.prepare("UPDATE memberships SET role='member' WHERE team_id=? AND user_sub='bob'").bind(teamId).run();
    return originalBatch<T>(statements);
  });
  try {
    await expect(bob.writeDay(calendarId, '2026-09-14', write())).rejects.toMatchObject({ status: 403 });
  } finally { spy.mockRestore(); }
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM calendar_days').first('n')).toBe(0);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM audit').first('n')).toBe(0);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM mutations').first('n')).toBe(0);
});
