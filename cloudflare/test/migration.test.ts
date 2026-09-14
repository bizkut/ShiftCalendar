import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import schema from '../migrations/0001_calendar.sql?raw';
import administrators from '../migrations/0002_application_administrators.sql?raw';
import teamAdministration from '../migrations/0003_team_administration.sql?raw';
import expiredInvitations from '../migrations/0004_expired_invitations.sql?raw';
import teamScheduling from '../migrations/0005_team_scheduling.sql?raw';
import changeRequests from '../migrations/0006_shift_change_requests.sql?raw';
import teamImports from '../migrations/0007_team_import_runs.sql?raw';
import { CalendarRepository } from '../src/calendar';
import { MigrationRepository } from '../src/migration';

const ownerSub = 'm7-owner';
const managerSub = 'm7-manager';
const memberSub = 'm7-member';
const outsiderSub = 'm7-outsider';
const teamId = 'm7-team';
const memberCalendarId = 'm7-member-calendar';
const managerCalendarId = 'm7-manager-calendar';
const mutation = () => crypto.randomUUID();
const repo = (sub: string) => new MigrationRepository(env.DB, sub, new CalendarRepository(env.DB, sub));

beforeAll(async () => {
  for (const sql of (schema + administrators + teamAdministration + expiredInvitations + teamScheduling + changeRequests + teamImports)
    .split(';').map(value => value.trim()).filter(Boolean)) await env.DB.prepare(sql).run();
});

beforeEach(async () => {
  for (const table of ['team_import_runs', 'team_change_requests', 'audit', 'mutations', 'calendar_days', 'schedule_runs',
    'team_rotation_templates', 'team_shift_types', 'calendars', 'team_invitations', 'memberships', 'teams',
    'application_administrators', 'users', 'transaction_checks']) await env.DB.prepare(`DELETE FROM ${table}`).run();
  for (const sub of [ownerSub, managerSub, memberSub, outsiderSub]) await new CalendarRepository(env.DB, sub).ensureUser();
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET display_name='Owner' WHERE sub=?").bind(ownerSub),
    env.DB.prepare("UPDATE users SET display_name='Manager' WHERE sub=?").bind(managerSub),
    env.DB.prepare("UPDATE users SET display_name='=Formula risk' WHERE sub=?").bind(memberSub),
    env.DB.prepare('INSERT INTO teams(id,owner_sub,name,updated_at) VALUES(?,?,?,?)').bind(teamId, ownerSub, 'M7 team', now),
    env.DB.prepare("INSERT INTO memberships(team_id,user_sub,role) VALUES(?,?,'owner')").bind(teamId, ownerSub),
    env.DB.prepare("INSERT INTO memberships(team_id,user_sub,role) VALUES(?,?,'manager')").bind(teamId, managerSub),
    env.DB.prepare("INSERT INTO memberships(team_id,user_sub,role) VALUES(?,?,'member')").bind(teamId, memberSub),
    env.DB.prepare(`INSERT INTO calendars(id,owner_sub,team_id,assigned_sub,name,color,timezone,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`).bind(memberCalendarId, ownerSub, teamId, memberSub, 'Member', '#3366FF', 'Asia/Kuala_Lumpur', now),
    env.DB.prepare(`INSERT INTO calendars(id,owner_sub,team_id,assigned_sub,name,color,timezone,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`).bind(managerCalendarId, ownerSub, teamId, managerSub, 'Manager', '#6633FF', 'Asia/Kuala_Lumpur', now),
  ]);
});

describe('team migration and exports', () => {
  it('limits imports to managers and validates mappings, rows, dates, and shifts', async () => {
    const rows = [{ memberSub, calendarId: memberCalendarId, date: '2026-09-17', shiftCode: 'M' }];
    await expect(repo(memberSub).preview(teamId, { rows })).rejects.toMatchObject({ status: 403 });
    await expect(repo(outsiderSub).preview(teamId, { rows })).rejects.toMatchObject({ status: 403 });
    await expect(repo(managerSub).preview(teamId, { rows: [...rows, ...rows] })).rejects.toMatchObject({ code: 'duplicate_row' });
    await expect(repo(managerSub).preview(teamId, { rows: [{ ...rows[0], date: '2026-02-30' }] })).rejects.toMatchObject({ status: 400 });
    await expect(repo(managerSub).preview(teamId, { rows: [{ ...rows[0], calendarId: managerCalendarId }] })).rejects.toMatchObject({ code: 'target_conflict' });
    await expect(repo(managerSub).preview(teamId, { rows: [{ ...rows[0], shiftCode: 'Z' }] })).rejects.toMatchObject({ code: 'shift_unavailable' });
    await expect(repo(managerSub).preview(teamId, { rows: [...rows, { ...rows[0], date: '2026-09-18' }, { ...rows[0], date: '2026-09-19' }] }))
      .rejects.toMatchObject({ status: 413 });
  });

  it('previews, applies, reports stale rows, and makes exact retries idempotent', async () => {
    const preview = await repo(managerSub).preview(teamId, { rows: [
      { memberSub, calendarId: memberCalendarId, date: '2026-09-17', shiftCode: 'M' },
      { memberSub: managerSub, calendarId: managerCalendarId, date: '2026-09-18', shiftCode: 'A' },
    ] });
    expect(preview.rows[0]).toMatchObject({ memberName: '=Formula risk', currentShiftCode: null, expectedVersion: 0 });
    await new CalendarRepository(env.DB, ownerSub).writeRosterDay(teamId, managerSub, '2026-09-18', {
      mutationId: mutation(), expectedVersion: 0, value: { shiftCode: 'N' },
    });
    const request = { mutationId: mutation(), previewToken: preview.previewToken, rows: preview.rows };
    const first = await repo(managerSub).apply(teamId, request);
    expect(first).toMatchObject({ applied: 1, conflicts: 1 });
    expect(first.results.map(item => item.status)).toEqual(['applied', 'conflict']);
    expect(await repo(managerSub).apply(teamId, request)).toEqual(first);
    expect((await env.DB.prepare('SELECT COUNT(*) count FROM team_import_runs').first<{count:number}>())?.count).toBe(1);
    await expect(repo(managerSub).apply(teamId, { ...request, rows: [{ ...preview.rows[0], shiftCode: 'N' }] }))
      .rejects.toMatchObject({ code: 'preview_conflict' });
  });

  it('rejects apply after role revocation and exports authorized data without request reasons', async () => {
    const preview = await repo(managerSub).preview(teamId, { rows: [
      { memberSub, calendarId: memberCalendarId, date: '2026-09-17', shiftCode: 'M' },
    ] });
    await env.DB.prepare("UPDATE memberships SET role='member' WHERE team_id=? AND user_sub=?").bind(teamId, managerSub).run();
    await expect(repo(managerSub).apply(teamId, { mutationId: mutation(), previewToken: preview.previewToken, rows: preview.rows }))
      .rejects.toMatchObject({ status: 403 });
    await expect(repo(managerSub).exportRoster(teamId, '2026-09-01', '2026-09-30', '', 50)).rejects.toMatchObject({ status: 403 });

    const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO team_change_requests(id,team_id,kind,requester_sub,requester_calendar_id,requester_date,
      requester_observed_version,requester_observed_shift_code,requested_shift_code,status,reason,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind('request-1', teamId, 'direct', memberSub, memberCalendarId, '2026-09-17',
      0, null, 'M', 'pending_manager', 'private medical detail', now, now).run();
    const exported = await repo(ownerSub).exportRequests(teamId, '', 50);
    expect(exported.items).toHaveLength(1);
    expect(JSON.stringify(exported)).not.toContain('private medical detail');
    expect(exported.items[0]).not.toHaveProperty('reason');
  });
});
