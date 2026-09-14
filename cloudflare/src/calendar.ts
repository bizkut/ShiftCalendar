import type { CloudCalendar, CloudCalendarDay, CloudCalendarDayTombstone, Page, TeamRosterDay } from '../../shared/cloudTypes';
import { ApiError } from './errors';

type CalendarRow = {
  id: string; owner_sub: string; team_id: string | null; assigned_sub: string | null;
  name: string; color: string; timezone: string; version: number; updated_at: string;
  assigned_display_name?: string | null;
  role?: 'owner' | 'manager' | 'member' | 'viewer' | null;
};
type DayRow = {
  date: string; shift_code: string | null; version: number; deleted: number;
  updated_at: string; updated_by: string;
};
type RosterRow = DayRow & {
  calendar_id: string;
  member_sub: string;
  member_display_name: string;
};
type RosterWriteContext = { teamId: string; memberSub: string };

const access = `c.deleted = 0 AND EXISTS (SELECT 1 FROM users u WHERE u.sub = ? AND u.disabled = 0)
  AND ((c.team_id IS NULL AND c.owner_sub = ?) OR
    (c.team_id IS NOT NULL AND EXISTS (SELECT 1 FROM teams t JOIN memberships m ON m.team_id = t.id
      WHERE t.id = c.team_id AND t.deleted = 0 AND m.user_sub = ?)))`;
const edit = `${access} AND (c.team_id IS NULL OR EXISTS (SELECT 1 FROM memberships m
  WHERE m.team_id = c.team_id AND m.user_sub = ? AND m.role IN ('owner', 'manager')))`;

function calendar(row: CalendarRow): CloudCalendar {
  return { id: row.id, name: row.name, color: row.color, timezone: row.timezone,
    scope: row.team_id ? 'team' : 'private', ...(row.team_id ? { teamId: row.team_id } : {}),
    ...(row.assigned_sub ? { assignedMemberSub: row.assigned_sub } : {}),
    ...(row.assigned_display_name ? { assignedMemberDisplayName: row.assigned_display_name } : {}),
    ...(row.role ? { role: row.role } : {}),
    version: row.version, updatedAt: row.updated_at };
}
function day(row: DayRow): CloudCalendarDay | CloudCalendarDayTombstone {
  const base = { date: row.date, version: row.version, updatedAt: row.updated_at, updatedBy: row.updated_by };
  return row.deleted ? { ...base, deleted: true } : { ...base, ...(row.shift_code ? { shiftCode: row.shift_code } : {}) };
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'invalid_request', 'An object is required.');
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new ApiError(400, 'invalid_request', 'Invalid identifier.');
  return value;
}
function date(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString().slice(0, 10) !== value) throw new ApiError(400, 'invalid_request', 'Invalid calendar date.');
}
async function fingerprint(value: unknown) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
}
function rosterCursor(value: string) {
  if (!value) return { calendarId: '', date: '' };
  if (value.length > 512) throw new ApiError(400, 'invalid_request', 'Invalid roster cursor.');
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
    const parsed = object(JSON.parse(atob(padded)));
    const calendarId = id(parsed.calendarId);
    if (typeof parsed.date !== 'string') throw new Error();
    date(parsed.date);
    return { calendarId, date: parsed.date };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'invalid_request', 'Invalid roster cursor.');
  }
}
function encodeRosterCursor(row: RosterRow) {
  return btoa(JSON.stringify({ calendarId: row.calendar_id, date: row.date }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export class CalendarRepository {
  constructor(private readonly db: D1Database, private readonly sub: string) {}

  private guard(sql: string, args: (string | number)[]) {
    return this.db.prepare(`INSERT INTO transaction_checks(valid) SELECT CASE WHEN (${sql}) THEN 1 ELSE 0 END`).bind(...args);
  }
  private enabled() {
    return this.guard('EXISTS (SELECT 1 FROM users WHERE sub = ? AND disabled = 0)', [this.sub]);
  }
  private permission(calendarId: string, writing: boolean) {
    const args = [calendarId, this.sub, this.sub, this.sub];
    if (writing) args.push(this.sub);
    return this.guard(`EXISTS (SELECT 1 FROM calendars c WHERE c.id = ? AND ${writing ? edit : access})`, args);
  }
  private rosterWritePermission(calendarId: string, context: RosterWriteContext) {
    return this.guard(`EXISTS (SELECT 1 FROM calendars c
      JOIN teams t ON t.id=c.team_id AND t.deleted=0
      JOIN memberships actor ON actor.team_id=t.id AND actor.user_sub=? AND actor.role IN ('owner','manager')
      JOIN users actor_user ON actor_user.sub=actor.user_sub AND actor_user.disabled=0
      JOIN memberships target ON target.team_id=t.id AND target.user_sub=c.assigned_sub
      JOIN users target_user ON target_user.sub=target.user_sub AND target_user.disabled=0
      WHERE c.id=? AND t.id=? AND c.assigned_sub=? AND c.deleted=0)`,
    [this.sub, calendarId, context.teamId, context.memberSub]);
  }
  private record(mutationId: string, operation: string, hash: string, result: unknown) {
    return [
      this.db.prepare('INSERT INTO mutations(user_sub,id,operation,fingerprint,result) VALUES(?,?,?,?,?)')
        .bind(this.sub, mutationId, operation, hash, JSON.stringify(result)),
      this.db.prepare('INSERT INTO audit(actor_sub,mutation_id,operation,created_at) VALUES(?,?,?,?)')
        .bind(this.sub, mutationId, operation, new Date().toISOString()),
      this.db.prepare('DELETE FROM transaction_checks'),
    ];
  }
  private async previous<T>(mutationId: string, operation: string, hash: string): Promise<T | undefined> {
    const row = await this.db.prepare(`SELECT m.operation, m.fingerprint, m.result FROM mutations m
      JOIN users u ON u.sub = m.user_sub WHERE m.user_sub = ? AND m.id = ? AND u.disabled = 0`)
      .bind(this.sub, mutationId).first<{ operation: string; fingerprint: string; result: string }>();
    if (!row) return;
    if (row.operation !== operation || row.fingerprint !== hash) throw new ApiError(409, 'conflict', 'This mutation ID was used for a different edit.');
    return JSON.parse(row.result) as T;
  }

  async ensureUser() {
    await this.db.prepare('INSERT INTO users(sub) VALUES(?) ON CONFLICT(sub) DO NOTHING').bind(this.sub).run();
    const row = await this.db.prepare('SELECT disabled FROM users WHERE sub = ?').bind(this.sub).first<{ disabled: number }>();
    if (!row || row.disabled) throw new ApiError(403, 'forbidden', 'This user is disabled.');
  }

  async get(calendarId: string, writing = false) {
    id(calendarId);
    const args = [this.sub, calendarId, this.sub, this.sub, this.sub];
    if (writing) args.push(this.sub);
    const row = await this.db.prepare(`SELECT c.*,
      (SELECT m.role FROM memberships m WHERE m.team_id=c.team_id AND m.user_sub=?) role
      FROM calendars c WHERE c.id = ? AND ${writing ? edit : access}`)
      .bind(...args).first<CalendarRow>();
    if (!row) throw new ApiError(403, 'forbidden', 'Calendar access is not allowed.');
    return calendar(row);
  }

  async list(cursor = '', limit = 100) {
    if (cursor) id(cursor);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400, 'invalid_request', 'Invalid page size.');
    const rows = await this.db.prepare(`SELECT c.*,
      (SELECT m.role FROM memberships m WHERE m.team_id=c.team_id AND m.user_sub=?) role
      FROM calendars c WHERE c.id > ? AND ${access} ORDER BY c.id LIMIT ?`)
      .bind(this.sub, cursor, this.sub, this.sub, this.sub, limit + 1).all<CalendarRow>();
    const items = rows.results.slice(0, limit).map(calendar);
    return { items, ...(rows.results.length > limit ? { nextCursor: items.at(-1)!.id } : {}) };
  }

  async create(input: unknown) {
    const body = object(input); const mutationId = id(body.mutationId); const value = object(body.value);
    const teamId = value.teamId === undefined ? undefined : id(value.teamId);
    const assignedMemberSub = value.assignedMemberSub === undefined ? undefined : id(value.assignedMemberSub);
    const scope: CloudCalendar['scope'] = teamId ? 'team' : 'private';
    if ((scope === 'team' && !assignedMemberSub) || (scope === 'private' && (value.teamId || value.assignedMemberSub))
        || (value.scope !== undefined && value.scope !== scope)) throw new ApiError(400, 'invalid_request', 'Invalid calendar scope.');
    if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80
        || typeof value.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value.color)
        || typeof value.timezone !== 'string' || value.timezone.length > 64) throw new ApiError(400, 'invalid_request', 'Invalid calendar settings.');
    try { new Intl.DateTimeFormat('en', { timeZone: value.timezone }); } catch { throw new ApiError(400, 'invalid_request', 'Invalid timezone.'); }
    const canonical = { name: value.name.trim(), color: value.color, timezone: value.timezone, scope, ...(teamId ? { teamId, assignedMemberSub } : {}) };
    const hash = await fingerprint(canonical);
    if (teamId) {
      const permitted = await this.db.prepare(`SELECT 1 FROM teams t JOIN memberships actor ON actor.team_id=t.id
        JOIN memberships target ON target.team_id=t.id JOIN users u ON u.sub=actor.user_sub
        WHERE t.id=? AND t.deleted=0 AND actor.user_sub=? AND actor.role IN ('owner','manager')
        AND target.user_sub=? AND u.disabled=0`).bind(teamId, this.sub, assignedMemberSub!).first();
      if (!permitted) throw new ApiError(403, 'forbidden', 'Only a team leader or manager can create team calendars.');
    }
    const prior = await this.previous<CloudCalendar>(mutationId, 'create-calendar', hash);
    if (prior) return this.get(prior.id);
    const result: CloudCalendar = { ...canonical, id: crypto.randomUUID(), ...(teamId ? { role: 'manager' } : {}), version: 1, updatedAt: new Date().toISOString() };
    try {
      const checks = [this.enabled()];
      if (teamId) checks.push(
        this.guard(`EXISTS(SELECT 1 FROM teams t JOIN memberships actor ON actor.team_id=t.id
          JOIN memberships target ON target.team_id=t.id WHERE t.id=? AND t.deleted=0
          AND actor.user_sub=? AND actor.role IN ('owner','manager') AND target.user_sub=?)`,
          [teamId, this.sub, assignedMemberSub!]),
      );
      await this.db.batch([
        ...checks,
        this.db.prepare(`INSERT INTO calendars(id,owner_sub,team_id,assigned_sub,name,color,timezone,updated_at)
          VALUES(?,?,?,?,?,?,?,?)`).bind(result.id, this.sub, teamId ?? null, assignedMemberSub ?? null, result.name, result.color, result.timezone, result.updatedAt),
        ...this.record(mutationId, 'create-calendar', hash, result),
      ]);
    } catch {
      const retried = await this.previous<CloudCalendar>(mutationId, 'create-calendar', hash);
      if (retried) return this.get(retried.id);
      throw new ApiError(409, 'conflict', 'Calendar creation conflicted. Please refresh and retry.');
    }
    return this.get(result.id);
  }

  async days(calendarId: string, from: string, to: string) {
    id(calendarId); date(from); date(to);
    if (to < from || Date.parse(to) - Date.parse(from) > 92 * 86400000) throw new ApiError(400, 'invalid_request', 'Request at most 93 days.');
    // Permission and data are evaluated in one SQL snapshot on the primary.
    const result = await this.db.batch([
      this.permission(calendarId, false),
      this.db.prepare('SELECT * FROM calendar_days WHERE calendar_id = ? AND date BETWEEN ? AND ? ORDER BY date LIMIT 93')
        .bind(calendarId, from, to),
      this.db.prepare('DELETE FROM transaction_checks'),
    ]).catch(async () => { await this.get(calendarId); throw new ApiError(503, 'unavailable', 'Could not load calendar.'); });
    return { items: (result[1].results as DayRow[]).map(day) };
  }

  async roster(teamId: string, from: string, to: string, cursor = '', limit = 100, memberSub = ''): Promise<Page<TeamRosterDay>> {
    id(teamId); date(from); date(to);
    if (memberSub) id(memberSub);
    const fromTime = Date.parse(`${from}T00:00:00Z`);
    const toTime = Date.parse(`${to}T00:00:00Z`);
    if (to < from || toTime - fromTime > 30 * 86400000) throw new ApiError(400, 'invalid_request', 'Request at most 31 roster days.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400, 'invalid_request', 'Invalid page size.');
    const start = rosterCursor(cursor);
    const result = await this.db.batch([
      this.guard(`EXISTS (SELECT 1 FROM users u JOIN memberships actor ON actor.user_sub=u.sub
        JOIN teams t ON t.id=actor.team_id WHERE u.sub=? AND u.disabled=0 AND t.id=?
        AND t.deleted=0)`, [this.sub, teamId]),
      this.db.prepare(`SELECT c.id calendar_id,c.assigned_sub member_sub,
        COALESCE(NULLIF(u.display_name,''),u.username,u.sub) member_display_name,
        d.date,d.shift_code,d.version,d.deleted,d.updated_at,d.updated_by
        FROM calendars c
        JOIN memberships target ON target.team_id=c.team_id AND target.user_sub=c.assigned_sub
        JOIN users u ON u.sub=target.user_sub AND u.disabled=0
        JOIN calendar_days d ON d.calendar_id=c.id AND d.deleted=0
        WHERE c.team_id=? AND c.deleted=0
        AND (c.id>? OR (c.id=? AND d.date>?))
        AND d.date BETWEEN ? AND ?
        AND (?='' OR c.assigned_sub=?)
        ORDER BY c.id,d.date LIMIT ?`)
        .bind(teamId, start.calendarId, start.calendarId, start.date, from, to, memberSub, memberSub, limit + 1),
      this.db.prepare('DELETE FROM transaction_checks'),
    ]).catch(() => { throw new ApiError(403, 'forbidden', 'Team roster access is not allowed.'); });
    const rows = result[1].results as RosterRow[];
    const visible = rows.slice(0, limit);
    const items = visible.map(row => ({
      ...day(row),
      calendarId: row.calendar_id,
      memberSub: row.member_sub,
      memberDisplayName: row.member_display_name,
    } as TeamRosterDay));
    return { items, ...(rows.length > limit ? { nextCursor: encodeRosterCursor(visible.at(-1)!) } : {}) };
  }

  async writeRosterDay(teamId: string, memberSub: string, dayDate: string, input: unknown) {
    id(teamId); id(memberSub); date(dayDate);
    const row = await this.db.prepare(`SELECT c.id FROM calendars c
      JOIN teams t ON t.id=c.team_id AND t.deleted=0
      JOIN memberships actor ON actor.team_id=t.id AND actor.user_sub=?
      JOIN users actor_user ON actor_user.sub=actor.user_sub AND actor_user.disabled=0
      JOIN memberships target ON target.team_id=t.id AND target.user_sub=c.assigned_sub
      JOIN users target_user ON target_user.sub=target.user_sub AND target_user.disabled=0
      WHERE t.id=? AND c.assigned_sub=? AND c.deleted=0
      AND actor.role IN ('owner','manager')`).bind(this.sub, teamId, memberSub).first<{ id: string }>();
    if (!row) throw new ApiError(403, 'forbidden', 'Team roster editing is not allowed.');
    return this.writeDay(row.id, dayDate, input, { teamId, memberSub });
  }

  async writeDay(calendarId: string, dayDate: string, input: unknown, rosterContext?: RosterWriteContext) {
    id(calendarId); date(dayDate);
    const body = object(input); const mutationId = id(body.mutationId);
    const version = body.expectedVersion;
    if (!Number.isSafeInteger(version) || (version as number) < 0 || (version as number) >= Number.MAX_SAFE_INTEGER) throw new ApiError(400, 'invalid_request', 'Invalid version.');
    const value = body.value === null ? null : object(body.value);
    if (value && (Object.keys(value).some(k => k !== 'shiftCode') || typeof value.shiftCode !== 'string'
      || !/^[A-Za-z0-9_-]{1,32}$/.test(value.shiftCode))) throw new ApiError(400, 'invalid_request', 'Invalid shift.');
    const operation = `day:${calendarId}:${dayDate}`;
    const hash = await fingerprint({ version, shiftCode: value?.shiftCode ?? null });
    // The batch checks current permissions and revision atomically. Its unique
    // mutation insert also rolls back duplicate IDs. Read retry state only after
    // a failed batch, avoiding two D1 round trips on a successful new edit.
    const now = new Date().toISOString();
    const nextVersion = (version as number) + 1;
    const result = day({ date: dayDate, shift_code: value?.shiftCode as string ?? null,
      version: nextVersion, deleted: value ? 0 : 1, updated_at: now, updated_by: this.sub });
    try {
      await this.db.batch([
        this.permission(calendarId, true),
        ...(rosterContext ? [this.rosterWritePermission(calendarId, rosterContext)] : []),
        this.guard('COALESCE((SELECT version FROM calendar_days WHERE calendar_id = ? AND date = ?), 0) = ?', [calendarId, dayDate, version as number]),
        this.db.prepare(`INSERT INTO calendar_days(calendar_id,date,shift_code,version,deleted,updated_at,updated_by)
          VALUES(?,?,?,?,?,?,?) ON CONFLICT(calendar_id,date) DO UPDATE SET shift_code=excluded.shift_code,
          version=excluded.version,deleted=excluded.deleted,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
          .bind(calendarId, dayDate, value?.shiftCode ?? null, nextVersion, value ? 0 : 1, now, this.sub),
        ...this.record(mutationId, operation, hash, result),
      ]);
    } catch {
      await this.get(calendarId, true);
      if (rosterContext) {
        await this.db.batch([
          this.rosterWritePermission(calendarId, rosterContext),
          this.db.prepare('DELETE FROM transaction_checks'),
        ]).catch(() => { throw new ApiError(403, 'forbidden', 'Team roster editing is not allowed.'); });
      }
      const retried = await this.previous<CloudCalendarDay | CloudCalendarDayTombstone>(mutationId, operation, hash);
      if (retried) return this.currentDay(calendarId, dayDate, true, rosterContext);
      throw new ApiError(409, 'conflict', 'This day changed. Refresh before retrying.');
    }
    return result;
  }

  private async currentDay(calendarId: string, dayDate: string, writing: boolean, rosterContext?: RosterWriteContext) {
    const results = await this.db.batch([
      this.permission(calendarId, writing),
      ...(rosterContext ? [this.rosterWritePermission(calendarId, rosterContext)] : []),
      this.db.prepare('SELECT * FROM calendar_days WHERE calendar_id = ? AND date = ?').bind(calendarId, dayDate),
      this.db.prepare('DELETE FROM transaction_checks'),
    ]).catch(() => { throw new ApiError(403, 'forbidden', 'Calendar access is not allowed.'); });
    const row = results[1].results[0] as DayRow | undefined;
    if (!row) throw new ApiError(409, 'conflict', 'The day is no longer available.');
    return day(row);
  }
}
