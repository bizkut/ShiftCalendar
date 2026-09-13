import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import schema from '../migrations/0001_calendar.sql?raw';
import { CalendarRepository } from '../src/calendar';

const alice = new CalendarRepository(env.DB, 'alice');
const bob = new CalendarRepository(env.DB, 'bob');
const create = () => alice.create({ mutationId: crypto.randomUUID(), value: {
  name: 'My Shifts', color: '#6366F1', timezone: 'Asia/Kuala_Lumpur', scope: 'private',
} });
const edit = (expectedVersion = 0, shiftCode: string | null = 'D', mutationId = crypto.randomUUID()) => ({
  mutationId, expectedVersion, value: shiftCode === null ? null : { shiftCode },
});

beforeAll(async () => {
  for (const sql of schema.split(';').map(s => s.trim()).filter(Boolean)) await env.DB.prepare(sql).run();
});
beforeEach(async () => {
  for (const table of ['audit', 'mutations', 'calendar_days', 'calendars', 'memberships', 'teams', 'users', 'transaction_checks']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await alice.ensureUser(); await bob.ensureUser();
});

describe('D1 calendar persistence and isolation', () => {
  it('saves and reads a private day across repository instances', async () => {
    const c = await create();
    await alice.writeDay(c.id, '2026-09-13', edit());
    const secondDevice = new CalendarRepository(env.DB, 'alice');
    expect((await secondDevice.days(c.id, '2026-09-01', '2026-09-30')).items[0]).toMatchObject({ shiftCode: 'D', version: 1 });
    await expect(bob.get(c.id)).rejects.toMatchObject({ status: 403 });
    await expect(bob.days(c.id, '2026-09-01', '2026-09-30')).rejects.toMatchObject({ status: 403 });
    await expect(bob.writeDay(c.id, '2026-09-13', edit())).rejects.toMatchObject({ status: 403 });
    expect((await bob.list()).items).toEqual([]);
  });
  it('commits only one concurrent version and no failed audit/mutation records', async () => {
    const c = await create();
    const results = await Promise.allSettled([
      alice.writeDay(c.id, '2026-09-13', edit(0, 'D')),
      alice.writeDay(c.id, '2026-09-13', edit(0, 'N')),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM mutations').first('n')).toBe(2);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM audit').first('n')).toBe(2);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM transaction_checks').first('n')).toBe(0);
  });
  it('deduplicates simultaneous retries and rejects changed mutation payloads', async () => {
    const c = await create(); const request = edit();
    const results = await Promise.all([alice.writeDay(c.id, '2026-09-13', request), alice.writeDay(c.id, '2026-09-13', request)]);
    expect(results.map(r => r.version)).toEqual([1, 1]);
    await expect(alice.writeDay(c.id, '2026-09-13', { ...request, value: { shiftCode: 'N' } })).rejects.toMatchObject({ status: 409 });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM audit').first('n')).toBe(2);
  });
  it('retains deletion versions and retries return current state', async () => {
    const c = await create(); const first = edit();
    await alice.writeDay(c.id, '2026-09-13', first);
    await alice.writeDay(c.id, '2026-09-13', edit(1, null));
    await expect(alice.writeDay(c.id, '2026-09-13', edit(0))).rejects.toMatchObject({ status: 409 });
    expect(await alice.writeDay(c.id, '2026-09-13', first)).toMatchObject({ deleted: true, version: 2 });
  });
  it('rejects disabled users even on mutation retries', async () => {
    const c = await create(); const request = edit();
    await alice.writeDay(c.id, '2026-09-13', request);
    await env.DB.prepare('UPDATE users SET disabled = 1 WHERE sub = ?').bind('alice').run();
    await expect(alice.writeDay(c.id, '2026-09-13', request)).rejects.toMatchObject({ status: 403 });
    await expect(alice.get(c.id)).rejects.toMatchObject({ status: 403 });
  });
  it('checks revocation inside the write transaction after a successful preliminary read', async () => {
    const c = await create();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO teams(id,owner_sub) VALUES('team-a','alice')"),
      env.DB.prepare("INSERT INTO memberships(team_id,user_sub,role) VALUES('team-a','bob','manager')"),
      env.DB.prepare("UPDATE calendars SET team_id='team-a',assigned_sub='bob' WHERE id=?").bind(c.id),
    ]);
    const originalGet = bob.get.bind(bob);
    const spy = vi.spyOn(bob, 'get').mockImplementationOnce(async (...args) => {
      const result = await originalGet(...args);
      await env.DB.prepare("DELETE FROM memberships WHERE user_sub='bob'").run();
      return result;
    });
    await expect(bob.writeDay(c.id, '2026-09-13', edit())).rejects.toMatchObject({ status: 403 });
    spy.mockRestore();
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM calendar_days').first('n')).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM audit WHERE actor_sub='bob'").first('n')).toBe(0);
  });
  it.each(['viewer', 'member'])('denies %s edits to another member schedule', async (role) => {
    const c = await create();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO teams(id,owner_sub) VALUES('team-a','alice')"),
      env.DB.prepare("INSERT INTO memberships(team_id,user_sub,role) VALUES('team-a','bob',?)").bind(role),
      env.DB.prepare("UPDATE calendars SET team_id='team-a',assigned_sub='alice' WHERE id=?").bind(c.id),
    ]);
    expect((await bob.get(c.id)).id).toBe(c.id);
    await expect(bob.writeDay(c.id, '2026-09-13', edit())).rejects.toMatchObject({ status: 403 });
  });
  it('bounds date ranges and rejects invalid dates', async () => {
    const c = await create();
    await expect(alice.days(c.id, '2026-01-01', '2026-12-31')).rejects.toMatchObject({ status: 400 });
    await expect(alice.writeDay(c.id, '2026-02-30', edit())).rejects.toMatchObject({ status: 400 });
  });
});
