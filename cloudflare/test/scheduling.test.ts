import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import schema from '../migrations/0001_calendar.sql?raw';
import administrators from '../migrations/0002_application_administrators.sql?raw';
import teamAdministration from '../migrations/0003_team_administration.sql?raw';
import expiredInvitations from '../migrations/0004_expired_invitations.sql?raw';
import teamScheduling from '../migrations/0005_team_scheduling.sql?raw';
import { CalendarRepository } from '../src/calendar';
import { SchedulingRepository } from '../src/scheduling';

const ownerSub = 'm5-owner'; const managerSub = 'm5-manager'; const memberSub = 'm5-member'; const outsiderSub = 'm5-outsider';
const teamId = 'm5-team'; const otherTeamId = 'm5-other'; const memberCalendarId = 'm5-member-calendar';
const managerCalendarId = 'm5-manager-calendar';
const owner = new SchedulingRepository(env.DB, ownerSub);
const manager = new SchedulingRepository(env.DB, managerSub);
const member = new SchedulingRepository(env.DB, memberSub);
const outsider = new SchedulingRepository(env.DB, outsiderSub);
const mutation = () => crypto.randomUUID();
const customShift = (expectedVersion = 0) => ({ mutationId: mutation(), expectedVersion,
  value: { label: 'Late', color: '#3344AA', icon: 'moon', startTime: '22:00', endTime: '06:00', position: 4 } });
const rotation = (expectedVersion = 0, pattern = ['L', 'O']) => ({ mutationId: mutation(), expectedVersion,
  value: { name: 'Late / rest', description: 'Two-day pilot', pattern } });

beforeAll(async () => {
  for (const sql of (schema + administrators + teamAdministration + expiredInvitations + teamScheduling)
    .split(';').map(value => value.trim()).filter(Boolean)) await env.DB.prepare(sql).run();
});

beforeEach(async () => {
  for (const table of ['audit', 'mutations', 'calendar_days', 'schedule_runs', 'team_rotation_templates', 'team_shift_types',
    'calendars', 'team_invitations', 'memberships', 'teams', 'application_administrators', 'users', 'transaction_checks'])
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  for (const sub of [ownerSub, managerSub, memberSub, outsiderSub]) await new CalendarRepository(env.DB, sub).ensureUser();
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET display_name='Owner' WHERE sub=?").bind(ownerSub),
    env.DB.prepare("UPDATE users SET display_name='Manager' WHERE sub=?").bind(managerSub),
    env.DB.prepare("UPDATE users SET display_name='Member' WHERE sub=?").bind(memberSub),
    env.DB.prepare('INSERT INTO teams(id,owner_sub,name,updated_at) VALUES(?,?,?,?)').bind(teamId, ownerSub, 'M5 team', now),
    env.DB.prepare('INSERT INTO teams(id,owner_sub,name,updated_at) VALUES(?,?,?,?)').bind(otherTeamId, outsiderSub, 'Other', now),
    env.DB.prepare("INSERT INTO memberships(team_id,user_sub,role) VALUES(?,?,'owner')").bind(teamId, ownerSub),
    env.DB.prepare("INSERT INTO memberships(team_id,user_sub,role) VALUES(?,?,'manager')").bind(teamId, managerSub),
    env.DB.prepare("INSERT INTO memberships(team_id,user_sub,role) VALUES(?,?,'member')").bind(teamId, memberSub),
    env.DB.prepare("INSERT INTO memberships(team_id,user_sub,role) VALUES(?,?,'owner')").bind(otherTeamId, outsiderSub),
    env.DB.prepare(`INSERT INTO calendars(id,owner_sub,team_id,assigned_sub,name,color,timezone,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`).bind(memberCalendarId, ownerSub, teamId, memberSub, 'Member', '#3366FF', 'Asia/Kuala_Lumpur', now),
    env.DB.prepare(`INSERT INTO calendars(id,owner_sub,team_id,assigned_sub,name,color,timezone,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`).bind(managerCalendarId, ownerSub, teamId, managerSub, 'Manager', '#6633FF', 'Asia/Kuala_Lumpur', now),
  ]);
});

describe('team scheduling tools', () => {
  it('supports overnight shifts, year-boundary previews, apply parity, and archived history', async () => {
    const savedShift = await owner.putShiftType(memberCalendarId, 'l', customShift());
    expect(savedShift).toMatchObject({ code: 'L', startTime: '22:00', endTime: '06:00', archived: false, version: 1 });
    const savedTemplate = await owner.putTemplate(teamId, 'late-rest', rotation());
    const preview = await owner.preview(teamId, { templateId: savedTemplate.id, expectedTemplateVersion: 1,
      memberSubs: [memberSub], from: '2026-12-31', to: '2027-01-02' });
    expect(preview.assignments.map(item => [item.date, item.shiftCode])).toEqual([
      ['2026-12-31', 'L'], ['2027-01-01', 'O'], ['2027-01-02', 'L'],
    ]);
    const result = await owner.apply(teamId, { mutationId: mutation(), ...preview });
    expect(result).toMatchObject({ applied: 3, conflicts: 0 });

    await owner.archiveShiftType(memberCalendarId, 'L', { mutationId: mutation(), expectedVersion: 1 });
    expect((await member.listShiftTypes(memberCalendarId)).items).toEqual([
      expect.objectContaining({ code: 'L', archived: true, startTime: '22:00', endTime: '06:00' }),
    ]);
    const history = await new CalendarRepository(env.DB, memberSub).roster(teamId, '2026-12-31', '2027-01-02');
    expect(history.items.map(item => item.shiftCode)).toEqual(['L', 'O', 'L']);
    await expect(owner.preview(teamId, { templateId: savedTemplate.id, expectedTemplateVersion: 1,
      memberSubs: [memberSub], from: '2027-01-03', to: '2027-01-03' })).rejects.toMatchObject({ code: 'shift_unavailable' });
  });

  it('previews and applies the Free-plan maximum across multiple members', async () => {
    const saved = await owner.putTemplate(teamId, 'two-members', rotation(0, ['M', 'A']));
    const preview = await owner.preview(teamId, { templateId: saved.id, expectedTemplateVersion: 1,
      memberSubs: [memberSub, managerSub], from: '2026-10-01', to: '2026-10-02' });
    expect(preview.assignments.map(item => [item.memberSub, item.date, item.shiftCode])).toEqual([
      [memberSub, '2026-10-01', 'M'], [memberSub, '2026-10-02', 'A'],
      [managerSub, '2026-10-01', 'M'], [managerSub, '2026-10-02', 'A'],
    ]);
    const result = await owner.apply(teamId, { mutationId: mutation(), ...preview });
    expect(result).toMatchObject({ applied: 4, conflicts: 0 });
    expect((await env.DB.prepare('SELECT COUNT(*) count FROM calendar_days').first<{ count: number }>())?.count).toBe(4);
  });

  it('returns truthful partial conflicts and makes successful retries idempotent', async () => {
    const saved = await owner.putTemplate(teamId, 'days', rotation(0, ['M', 'A']));
    const preview = await owner.preview(teamId, { templateId: saved.id, expectedTemplateVersion: 1,
      memberSubs: [memberSub], from: '2026-09-14', to: '2026-09-15' });
    await new CalendarRepository(env.DB, ownerSub).writeRosterDay(teamId, memberSub, '2026-09-15', {
      mutationId: mutation(), expectedVersion: 0, value: { shiftCode: 'N' },
    });
    const request = { mutationId: mutation(), ...preview };
    const first = await owner.apply(teamId, request);
    expect(first.results.map(item => item.status)).toEqual(['applied', 'conflict']);
    expect(first).toMatchObject({ applied: 1, conflicts: 1 });
    const retry = await owner.apply(teamId, request);
    expect(retry.results.map(item => item.status)).toEqual(['applied', 'conflict']);
    expect((await env.DB.prepare('SELECT COUNT(*) count FROM calendar_days').first<{ count: number }>())?.count).toBe(2);
    await expect(owner.apply(teamId, { ...request, templateId: 'changed' })).rejects.toMatchObject({ status: 409 });
  });

  it('enforces manager roles, team boundaries, current membership, and bounds', async () => {
    await expect(member.putTemplate(teamId, 'forbidden', rotation())).rejects.toMatchObject({ status: 403 });
    await expect(outsider.listTemplates(teamId)).rejects.toMatchObject({ status: 403 });
    const saved = await manager.putTemplate(teamId, 'manager-template', rotation(0, ['M']));
    const preview = await manager.preview(teamId, { templateId: saved.id, expectedTemplateVersion: 1,
      memberSubs: [memberSub], from: '2026-09-01', to: '2026-09-04' });
    expect(preview.assignments).toHaveLength(4);
    expect(preview.limits.maxAssignments).toBe(4);
    await expect(manager.preview(teamId, { templateId: saved.id, expectedTemplateVersion: 1,
      memberSubs: [memberSub], from: '2026-09-01', to: '2026-09-05' })).rejects.toMatchObject({ status: 413 });
    await env.DB.prepare("UPDATE memberships SET role='member' WHERE team_id=? AND user_sub=?").bind(teamId, managerSub).run();
    await expect(manager.apply(teamId, { mutationId: mutation(), ...preview })).rejects.toMatchObject({ status: 403 });
    await env.DB.prepare('DELETE FROM memberships WHERE team_id=? AND user_sub=?').bind(teamId, memberSub).run();
    await expect(owner.preview(teamId, { templateId: saved.id, expectedTemplateVersion: 1,
      memberSubs: [memberSub], from: '2026-09-01', to: '2026-09-01' })).rejects.toMatchObject({ code: 'member_unavailable' });
  });
});
