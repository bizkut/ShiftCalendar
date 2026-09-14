import type { CloudCalendarDay, CloudCalendarDayTombstone } from '../../shared/cloudTypes';
import { CalendarRepository } from './calendar';
import { ApiError } from './errors';

const BUILT_INS = new Set(['M', 'A', 'N', 'O']);
const MAX_ASSIGNMENTS = 2;

type ShiftRow = { code: string; label: string; color: string; icon: string; start_time: string;
  end_time: string; position: number; archived: number; version: number; updated_at: string };
type TemplateRow = { id: string; team_id: string; name: string; description: string; pattern_json: string;
  archived: number; version: number; updated_at: string };
type PreviewAssignment = { memberSub: string; memberName: string; calendarId: string; date: string;
  shiftCode: string; expectedVersion: number; currentShiftCode: string | null };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'invalid_request', 'Expected an object.');
  return value as Record<string, unknown>;
}
function identifier(value: unknown, max = 128): string {
  if (typeof value !== 'string' || value.length > max || !/^[A-Za-z0-9_-]+$/.test(value))
    throw new ApiError(400, 'invalid_request', 'Invalid identifier.');
  return value;
}
function shiftCode(value: unknown): string {
  const code = identifier(value, 8).toUpperCase();
  if (!/^[A-Z0-9]{1,8}$/.test(code)) throw new ApiError(400, 'invalid_request', 'Invalid shift code.');
  return code;
}
function string(value: unknown, field: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()))
    throw new ApiError(400, 'invalid_request', `Invalid ${field}.`);
  return value.trim();
}
function version(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) >= Number.MAX_SAFE_INTEGER)
    throw new ApiError(400, 'invalid_request', 'Invalid version.');
  return value as number;
}
function isoDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ApiError(400, 'invalid_request', 'Invalid date.');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value)
    throw new ApiError(400, 'invalid_request', 'Invalid date.');
  return value;
}
function dates(from: string, to: string): string[] {
  const start = new Date(`${from}T00:00:00Z`); const end = new Date(`${to}T00:00:00Z`);
  if (end < start) throw new ApiError(400, 'invalid_request', 'The end date must not precede the start date.');
  const result: string[] = [];
  for (let day = start; day <= end && result.length <= 31; day = new Date(day.valueOf() + 86_400_000))
    result.push(day.toISOString().slice(0, 10));
  if (result.length > 31) throw new ApiError(413, 'batch_too_large', 'A preview may span at most 31 days.');
  return result;
}
async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
function shift(row: ShiftRow) {
  return { code: row.code, label: row.label, color: row.color, icon: row.icon,
    startTime: row.start_time, endTime: row.end_time, position: row.position,
    isDefault: false, archived: row.archived === 1, version: row.version, updatedAt: row.updated_at };
}
function template(row: TemplateRow) {
  return { id: row.id, teamId: row.team_id, name: row.name, description: row.description,
    pattern: JSON.parse(row.pattern_json) as string[], archived: row.archived === 1,
    version: row.version, updatedAt: row.updated_at };
}

export class SchedulingRepository {
  constructor(private readonly db: D1Database, private readonly sub: string,
    private readonly calendars = new CalendarRepository(db, sub)) {}

  private guard(sql: string, args: (string | number)[]) {
    return this.db.prepare(`INSERT INTO transaction_checks(valid) SELECT CASE WHEN (${sql}) THEN 1 ELSE 0 END`).bind(...args);
  }
  private managerGuard(teamId: string) {
    return this.guard(`EXISTS(SELECT 1 FROM teams t JOIN memberships m ON m.team_id=t.id
      JOIN users u ON u.sub=m.user_sub WHERE t.id=? AND t.deleted=0 AND m.user_sub=?
      AND m.role IN ('owner','manager') AND u.disabled=0)`, [teamId, this.sub]);
  }
  private async requireMembership(teamId: string, manager = false) {
    identifier(teamId);
    const row = await this.db.prepare(`SELECT m.role FROM teams t JOIN memberships m ON m.team_id=t.id
      JOIN users u ON u.sub=m.user_sub WHERE t.id=? AND t.deleted=0 AND m.user_sub=? AND u.disabled=0`)
      .bind(teamId, this.sub).first<{ role: string }>();
    if (!row || (manager && row.role !== 'owner' && row.role !== 'manager'))
      throw new ApiError(403, 'forbidden', manager ? 'Team scheduling is limited to owners and managers.' : 'Team access is not allowed.');
    return row.role;
  }
  private async teamForCalendar(calendarId: string, manager = false) {
    identifier(calendarId);
    const row = await this.db.prepare(`SELECT c.team_id FROM calendars c WHERE c.id=? AND c.deleted=0 AND c.team_id IS NOT NULL`)
      .bind(calendarId).first<{ team_id: string }>();
    if (!row) throw new ApiError(404, 'not_found', 'Team calendar not found.');
    await this.requireMembership(row.team_id, manager);
    return row.team_id;
  }
  private async prior<T>(mutationId: string, operation: string, hash: string) {
    const row = await this.db.prepare(`SELECT m.operation,m.fingerprint,m.result FROM mutations m
      JOIN users u ON u.sub=m.user_sub WHERE m.user_sub=? AND m.id=? AND u.disabled=0`)
      .bind(this.sub, mutationId).first<{ operation: string; fingerprint: string; result: string }>();
    if (!row) return undefined;
    if (row.operation !== operation || row.fingerprint !== hash)
      throw new ApiError(409, 'conflict', 'This mutation ID was used for a different operation.');
    return JSON.parse(row.result) as T;
  }
  private record(mutationId: string, operation: string, hash: string, result: unknown, now: string) {
    return [
      this.db.prepare('INSERT INTO mutations(user_sub,id,operation,fingerprint,result) VALUES(?,?,?,?,?)')
        .bind(this.sub, mutationId, operation, hash, JSON.stringify(result)),
      this.db.prepare('INSERT INTO audit(actor_sub,mutation_id,operation,created_at) VALUES(?,?,?,?)')
        .bind(this.sub, mutationId, operation, now),
      this.db.prepare('DELETE FROM transaction_checks'),
    ];
  }
  private parseShift(input: unknown) {
    const body = object(input); const value = object(body.value); const expectedVersion = version(body.expectedVersion);
    if (Object.keys(body).some(k => !['mutationId', 'expectedVersion', 'value'].includes(k))
      || Object.keys(value).some(k => !['label', 'color', 'icon', 'startTime', 'endTime', 'position'].includes(k)))
      throw new ApiError(400, 'invalid_request', 'Unknown shift fields.');
    const label = string(value.label, 'shift label', 40);
    const color = string(value.color, 'shift color', 7);
    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) throw new ApiError(400, 'invalid_request', 'Shift color must be #RRGGBB.');
    const icon = string(value.icon, 'shift icon', 40);
    if (!/^[a-z0-9-]+$/.test(icon)) throw new ApiError(400, 'invalid_request', 'Invalid shift icon.');
    const startTime = string(value.startTime, 'start time', 5); const endTime = string(value.endTime, 'end time', 5);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime) || startTime === endTime)
      throw new ApiError(400, 'invalid_request', 'Use different valid 24-hour start and end times.');
    if (!Number.isInteger(value.position) || (value.position as number) < 0 || (value.position as number) > 99)
      throw new ApiError(400, 'invalid_request', 'Invalid shift position.');
    return { body, expectedVersion, label, color: color.toUpperCase(), icon, startTime, endTime, position: value.position as number };
  }

  async listShiftTypes(calendarId: string) {
    const teamId = await this.teamForCalendar(calendarId);
    const rows = await this.db.prepare(`SELECT code,label,color,icon,start_time,end_time,position,archived,version,updated_at
      FROM team_shift_types WHERE team_id=? ORDER BY archived,position,code LIMIT 100`).bind(teamId).all<ShiftRow>();
    return { items: (rows.results ?? []).map(shift) };
  }
  async putShiftType(calendarId: string, rawCode: string, input: unknown) {
    const teamId = await this.teamForCalendar(calendarId, true); const code = shiftCode(rawCode);
    if (BUILT_INS.has(code)) throw new ApiError(409, 'conflict', 'Built-in shift codes cannot be replaced.');
    const parsed = this.parseShift(input); const mutationId = identifier(parsed.body.mutationId, 96);
    const operation = `shift:${teamId}:${code}`; const hash = await fingerprint({ ...parsed, body: undefined });
    await this.requireMembership(teamId, true); const retried = await this.prior<ReturnType<typeof shift>>(mutationId, operation, hash);
    if (retried) return retried;
    const now = new Date().toISOString(); const result = { code, label: parsed.label, color: parsed.color, icon: parsed.icon,
      startTime: parsed.startTime, endTime: parsed.endTime, position: parsed.position, isDefault: false, archived: false,
      version: parsed.expectedVersion + 1, updatedAt: now };
    try {
      await this.db.batch([
        this.managerGuard(teamId),
        this.guard('COALESCE((SELECT version FROM team_shift_types WHERE team_id=? AND code=?),0)=?', [teamId, code, parsed.expectedVersion]),
        this.guard('COALESCE((SELECT archived FROM team_shift_types WHERE team_id=? AND code=?),0)=0', [teamId, code]),
        this.db.prepare(`INSERT INTO team_shift_types(team_id,code,label,color,icon,start_time,end_time,position,archived,version,updated_at,updated_by)
          VALUES(?,?,?,?,?,?,?,?,0,?,?,?) ON CONFLICT(team_id,code) DO UPDATE SET label=excluded.label,color=excluded.color,
          icon=excluded.icon,start_time=excluded.start_time,end_time=excluded.end_time,position=excluded.position,
          version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
          .bind(teamId, code, parsed.label, parsed.color, parsed.icon, parsed.startTime, parsed.endTime, parsed.position,
            parsed.expectedVersion + 1, now, this.sub),
        ...this.record(mutationId, operation, hash, result, now),
      ]);
    } catch { throw new ApiError(409, 'conflict', 'This shift changed. Refresh before retrying.'); }
    return result;
  }
  async archiveShiftType(calendarId: string, rawCode: string, input: unknown) {
    const teamId = await this.teamForCalendar(calendarId, true); const code = shiftCode(rawCode);
    if (BUILT_INS.has(code)) throw new ApiError(409, 'conflict', 'Built-in shift codes cannot be archived.');
    const body = object(input); const expectedVersion = version(body.expectedVersion); const mutationId = identifier(body.mutationId, 96);
    if (Object.keys(body).some(k => !['mutationId', 'expectedVersion'].includes(k))) throw new ApiError(400, 'invalid_request', 'Unknown archive fields.');
    const operation = `shift-archive:${teamId}:${code}`; const hash = await fingerprint({ expectedVersion });
    await this.requireMembership(teamId, true); const prior = await this.prior<{ code: string; archived: true; version: number }>(mutationId, operation, hash);
    if (prior) return prior;
    const now = new Date().toISOString(); const result = { code, archived: true as const, version: expectedVersion + 1 };
    try { await this.db.batch([
      this.managerGuard(teamId),
      this.guard('EXISTS(SELECT 1 FROM team_shift_types WHERE team_id=? AND code=? AND archived=0 AND version=?)', [teamId, code, expectedVersion]),
      this.db.prepare('UPDATE team_shift_types SET archived=1,version=version+1,updated_at=?,updated_by=? WHERE team_id=? AND code=?')
        .bind(now, this.sub, teamId, code),
      ...this.record(mutationId, operation, hash, result, now),
    ]); } catch { throw new ApiError(409, 'conflict', 'This shift changed. Refresh before retrying.'); }
    return result;
  }

  async listTemplates(teamId: string) {
    await this.requireMembership(teamId);
    const rows = await this.db.prepare(`SELECT id,team_id,name,description,pattern_json,archived,version,updated_at
      FROM team_rotation_templates WHERE team_id=? ORDER BY archived,name,id LIMIT 100`).bind(teamId).all<TemplateRow>();
    return { items: (rows.results ?? []).map(template) };
  }
  private async parseTemplate(teamId: string, input: unknown) {
    const body = object(input); const value = object(body.value); const expectedVersion = version(body.expectedVersion);
    if (Object.keys(body).some(k => !['mutationId', 'expectedVersion', 'value'].includes(k))
      || Object.keys(value).some(k => !['name', 'description', 'pattern'].includes(k)))
      throw new ApiError(400, 'invalid_request', 'Unknown template fields.');
    const name = string(value.name, 'template name', 60); const description = string(value.description ?? '', 'description', 160, true);
    if (!Array.isArray(value.pattern) || value.pattern.length < 1 || value.pattern.length > 28)
      throw new ApiError(400, 'invalid_request', 'A rotation needs 1 to 28 days.');
    const pattern = value.pattern.map(shiftCode);
    await this.requireActiveShifts(teamId, pattern);
    return { body, expectedVersion, name, description, pattern };
  }
  private async requireActiveShifts(teamId: string, pattern: string[]) {
    const custom = pattern.filter(code => !BUILT_INS.has(code));
    if (custom.length) {
      const placeholders = custom.map(() => '?').join(',');
      const rows = await this.db.prepare(`SELECT code FROM team_shift_types WHERE team_id=? AND archived=0 AND code IN (${placeholders})`)
        .bind(teamId, ...custom).all<{ code: string }>();
      const found = new Set((rows.results ?? []).map(row => row.code));
      if (custom.some(code => !found.has(code))) throw new ApiError(409, 'shift_unavailable', 'The rotation contains an archived or unknown shift.');
    }
  }
  async putTemplate(teamId: string, rawId: string, input: unknown) {
    await this.requireMembership(teamId, true); const id = identifier(rawId); const parsed = await this.parseTemplate(teamId, input);
    const mutationId = identifier(parsed.body.mutationId, 96); const operation = `template:${teamId}:${id}`;
    const hash = await fingerprint({ expectedVersion: parsed.expectedVersion, name: parsed.name, description: parsed.description, pattern: parsed.pattern });
    const prior = await this.prior<ReturnType<typeof template>>(mutationId, operation, hash); if (prior) return prior;
    const now = new Date().toISOString(); const result = { id, teamId, name: parsed.name, description: parsed.description,
      pattern: parsed.pattern, archived: false, version: parsed.expectedVersion + 1, updatedAt: now };
    try { await this.db.batch([
      this.managerGuard(teamId),
      this.guard('NOT EXISTS(SELECT 1 FROM team_rotation_templates WHERE id=? AND team_id<>?)', [id, teamId]),
      this.guard('COALESCE((SELECT version FROM team_rotation_templates WHERE id=? AND team_id=?),0)=?', [id, teamId, parsed.expectedVersion]),
      this.guard('COALESCE((SELECT archived FROM team_rotation_templates WHERE id=? AND team_id=?),0)=0', [id, teamId]),
      ...parsed.pattern.filter(code => !BUILT_INS.has(code)).map(code =>
        this.guard('EXISTS(SELECT 1 FROM team_shift_types WHERE team_id=? AND code=? AND archived=0)', [teamId, code])),
      this.db.prepare(`INSERT INTO team_rotation_templates(id,team_id,name,description,pattern_json,archived,version,updated_at,updated_by)
        VALUES(?,?,?,?,?,0,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,
        pattern_json=excluded.pattern_json,version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
        .bind(id, teamId, parsed.name, parsed.description, JSON.stringify(parsed.pattern), parsed.expectedVersion + 1, now, this.sub),
      ...this.record(mutationId, operation, hash, result, now),
    ]); } catch { throw new ApiError(409, 'conflict', 'This template changed. Refresh before retrying.'); }
    return result;
  }
  async archiveTemplate(teamId: string, rawId: string, input: unknown) {
    await this.requireMembership(teamId, true); const id = identifier(rawId); const body = object(input);
    const expectedVersion = version(body.expectedVersion); const mutationId = identifier(body.mutationId, 96);
    if (Object.keys(body).some(k => !['mutationId', 'expectedVersion'].includes(k))) throw new ApiError(400, 'invalid_request', 'Unknown archive fields.');
    const operation = `template-archive:${teamId}:${id}`; const hash = await fingerprint({ expectedVersion });
    const prior = await this.prior<{ id: string; archived: true; version: number }>(mutationId, operation, hash); if (prior) return prior;
    const now = new Date().toISOString(); const result = { id, archived: true as const, version: expectedVersion + 1 };
    try { await this.db.batch([
      this.managerGuard(teamId),
      this.guard('EXISTS(SELECT 1 FROM team_rotation_templates WHERE id=? AND team_id=? AND archived=0 AND version=?)', [id, teamId, expectedVersion]),
      this.db.prepare('UPDATE team_rotation_templates SET archived=1,version=version+1,updated_at=?,updated_by=? WHERE id=? AND team_id=?')
        .bind(now, this.sub, id, teamId),
      ...this.record(mutationId, operation, hash, result, now),
    ]); } catch { throw new ApiError(409, 'conflict', 'This template changed. Refresh before retrying.'); }
    return result;
  }

  private async buildPreview(teamId: string, input: unknown) {
    await this.requireMembership(teamId, true); const body = object(input); const templateId = identifier(body.templateId);
    const expectedTemplateVersion = version(body.expectedTemplateVersion);
    if (!Array.isArray(body.memberSubs) || body.memberSubs.length < 1 || body.memberSubs.length > 10)
      throw new ApiError(400, 'invalid_request', 'Select 1 to 10 members.');
    const memberSubs = [...new Set(body.memberSubs.map(value => identifier(value)))];
    if (memberSubs.length !== body.memberSubs.length) throw new ApiError(400, 'invalid_request', 'Members must be unique.');
    const from = isoDate(body.from); const to = isoDate(body.to); const days = dates(from, to);
    if (memberSubs.length * days.length > MAX_ASSIGNMENTS)
      throw new ApiError(413, 'batch_too_large', `A schedule may contain at most ${MAX_ASSIGNMENTS} assignments.`);
    const row = await this.db.prepare(`SELECT id,team_id,name,description,pattern_json,archived,version,updated_at
      FROM team_rotation_templates WHERE id=? AND team_id=? AND archived=0`).bind(templateId, teamId).first<TemplateRow>();
    if (!row || row.version !== expectedTemplateVersion) throw new ApiError(409, 'template_conflict', 'The rotation changed. Refresh before previewing.');
    const selected = template(row); const placeholders = memberSubs.map(() => '?').join(',');
    await this.requireActiveShifts(teamId, selected.pattern);
    const calendars = await this.db.prepare(`SELECT c.id,c.assigned_sub,COALESCE(NULLIF(u.display_name,''),u.username,u.sub) member_name
      FROM calendars c JOIN memberships m ON m.team_id=c.team_id AND m.user_sub=c.assigned_sub
      JOIN users u ON u.sub=c.assigned_sub AND u.disabled=0 WHERE c.team_id=? AND c.deleted=0
      AND c.assigned_sub IN (${placeholders}) ORDER BY c.assigned_sub`).bind(teamId, ...memberSubs)
      .all<{ id: string; assigned_sub: string; member_name: string }>();
    if ((calendars.results ?? []).length !== memberSubs.length) throw new ApiError(409, 'member_unavailable', 'A selected member is no longer active in this team.');
    const byMember = new Map((calendars.results ?? []).map(item => [item.assigned_sub, item]));
    const targets = memberSubs.flatMap(memberSub => days.map(date => {
      const calendar = byMember.get(memberSub)!;
      return { memberSub, memberName: calendar.member_name, calendarId: calendar.id, date };
    }));
    const predicates = targets.map(() => '(calendar_id=? AND date=?)').join(' OR ');
    const bindings = targets.flatMap(target => [target.calendarId, target.date]);
    const currentRows = await this.db.prepare(`SELECT calendar_id,date,shift_code,version FROM calendar_days
      WHERE ${predicates}`).bind(...bindings)
      .all<{ calendar_id: string; date: string; shift_code: string | null; version: number }>();
    const currentByTarget = new Map((currentRows.results ?? []).map(item => [`${item.calendar_id}:${item.date}`, item]));
    const assignments = targets.map((target, index): PreviewAssignment => {
      const current = currentByTarget.get(`${target.calendarId}:${target.date}`);
      return { ...target, shiftCode: selected.pattern[index % days.length % selected.pattern.length],
        expectedVersion: current?.version ?? 0, currentShiftCode: current?.shift_code ?? null };
    });
    const previewToken = await fingerprint({ teamId, templateId, expectedTemplateVersion, memberSubs, from, to, assignments });
    return { teamId, templateId, templateName: selected.name, expectedTemplateVersion, memberSubs, from, to,
      assignments, previewToken, limits: { maxAssignments: MAX_ASSIGNMENTS, maxDays: 31, maxMembers: 10 } };
  }
  async preview(teamId: string, input: unknown) { return this.buildPreview(teamId, input); }
  async apply(teamId: string, input: unknown) {
    const body = object(input); const mutationId = identifier(body.mutationId, 96);
    if (!Array.isArray(body.assignments) || body.assignments.length < 1 || body.assignments.length > MAX_ASSIGNMENTS)
      throw new ApiError(413, 'batch_too_large', `A schedule may contain at most ${MAX_ASSIGNMENTS} assignments.`);
    const preview = await this.buildPreview(teamId, body);
    const supplied = body.assignments.map(raw => {
      const item = object(raw);
      return { memberSub: identifier(item.memberSub), memberName: string(item.memberName, 'member name', 160),
        calendarId: identifier(item.calendarId), date: isoDate(item.date), shiftCode: shiftCode(item.shiftCode),
        expectedVersion: version(item.expectedVersion), currentShiftCode: item.currentShiftCode === null ? null : shiftCode(item.currentShiftCode) };
    });
    const suppliedToken = string(body.previewToken, 'preview token', 64);
    const token = await fingerprint({ teamId, templateId: preview.templateId, expectedTemplateVersion: preview.expectedTemplateVersion,
      memberSubs: preview.memberSubs, from: preview.from, to: preview.to, assignments: supplied });
    if (token !== suppliedToken) throw new ApiError(409, 'preview_conflict', 'The submitted preview is not intact. Preview again.');
    const staticFields = (items: PreviewAssignment[]) => items.map(({ memberSub, calendarId, date, shiftCode }) => ({ memberSub, calendarId, date, shiftCode }));
    if (JSON.stringify(staticFields(supplied)) !== JSON.stringify(staticFields(preview.assignments)))
      throw new ApiError(409, 'preview_conflict', 'The submitted preview no longer matches the rotation.');
    const requestHash = await fingerprint({ teamId, templateId: preview.templateId,
      expectedTemplateVersion: preview.expectedTemplateVersion, memberSubs: preview.memberSubs,
      from: preview.from, to: preview.to, previewToken: suppliedToken, assignments: supplied });
    const now = new Date().toISOString();
    await this.db.prepare(`INSERT OR IGNORE INTO schedule_runs(actor_sub,mutation_id,team_id,fingerprint,created_at)
      VALUES(?,?,?,?,?)`).bind(this.sub, mutationId, teamId, requestHash, now).run();
    const run = await this.db.prepare(`SELECT team_id,fingerprint,result FROM schedule_runs
      WHERE actor_sub=? AND mutation_id=?`).bind(this.sub, mutationId)
      .first<{ team_id: string; fingerprint: string; result: string | null }>();
    if (!run || run.team_id !== teamId || run.fingerprint !== requestHash)
      throw new ApiError(409, 'conflict', 'This mutation ID was used for a different schedule.');
    if (run.result) return JSON.parse(run.result) as { results: Array<Record<string, unknown>>; applied: number; conflicts: number };
    const results: Array<Record<string, unknown>> = [];
    for (let index = 0; index < supplied.length; index += 1) {
      const assignment = supplied[index];
      try {
        const day = await this.calendars.writeScheduledRosterDay(teamId, assignment.memberSub, assignment.calendarId, assignment.date, {
          mutationId: `${mutationId}_${index}`, expectedVersion: assignment.expectedVersion,
          value: { shiftCode: assignment.shiftCode },
        });
        results.push({ ...assignment, status: 'applied', day });
      } catch (error) {
        if (error instanceof ApiError && (error.status === 409 || error.status === 403)) {
          results.push({ ...assignment, status: error.status === 409 ? 'conflict' : 'forbidden', error: error.message });
          if (error.status === 403) for (let rest = index + 1; rest < supplied.length; rest += 1)
            results.push({ ...supplied[rest], status: 'forbidden', error: 'Scheduling permission was revoked.' });
          if (error.status === 403) break;
        } else throw error;
      }
    }
    const response = { results, applied: results.filter(item => item.status === 'applied').length,
      conflicts: results.filter(item => item.status !== 'applied').length };
    const completedAt = new Date().toISOString();
    await this.db.batch([
      this.db.prepare(`UPDATE schedule_runs SET result=?,completed_at=? WHERE actor_sub=? AND mutation_id=?
        AND fingerprint=? AND result IS NULL`).bind(JSON.stringify(response), completedAt, this.sub, mutationId, requestHash),
      this.db.prepare(`INSERT OR IGNORE INTO audit(actor_sub,mutation_id,operation,created_at)
        VALUES(?,?,?,?)`).bind(this.sub, mutationId, `schedule-apply:${teamId}`, completedAt),
    ]);
    return response;
  }
}
