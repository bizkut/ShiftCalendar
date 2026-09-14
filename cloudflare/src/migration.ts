import type {
  CloudImportApplyResult, CloudImportPreview, CloudImportRow, CloudTeamAuditEvent,
  CloudTeamRequestExport, Page, TeamRosterDay,
} from '../../shared/cloudTypes';
import { ApiError } from './errors';
import { CalendarRepository } from './calendar';

const MAX_IMPORT_ROWS = 2;
const MAX_IMPORT_SPAN_DAYS = 366;
const BUILT_INS = new Set(['M', 'A', 'N', 'O']);

type MappingRow = {
  calendar_id: string;
  member_sub: string;
  member_name: string;
  current_shift_code: string | null;
  current_version: number | null;
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'invalid_request', 'Expected an object.');
  return value as Record<string, unknown>;
}

function identifier(value: unknown, max = 128): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.@+-]+$/.test(value) || value.length > max)
    throw new ApiError(400, 'invalid_request', 'Invalid identifier.');
  return value;
}

function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ApiError(400, 'invalid_request', 'Invalid date.');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value)
    throw new ApiError(400, 'invalid_request', 'Invalid date.');
  return value;
}

function shift(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(value))
    throw new ApiError(400, 'invalid_request', 'Invalid shift code.');
  return value;
}

function page(cursor: string, limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400, 'invalid_request', 'Invalid page size.');
  if (cursor && !/^\d+$/.test(cursor)) throw new ApiError(400, 'invalid_request', 'Invalid cursor.');
  return { cursor: cursor ? Number(cursor) : 0, limit };
}

async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}

export class MigrationRepository {
  constructor(private readonly db: D1Database, private readonly sub: string, private readonly calendars: CalendarRepository) {}

  private guard(sql: string, args: unknown[] = []) {
    return this.db.prepare(`INSERT INTO transaction_checks(valid) SELECT CASE WHEN (${sql}) THEN 1 ELSE 0 END`).bind(...args);
  }

  private managerGuard(teamId: string) {
    return this.guard(`EXISTS(SELECT 1 FROM users u JOIN memberships m ON m.user_sub=u.sub
      JOIN teams t ON t.id=m.team_id WHERE u.sub=? AND u.disabled=0 AND m.team_id=?
      AND m.role IN ('owner','manager') AND t.deleted=0)`, [this.sub, teamId]);
  }

  private async manager(teamId: string) {
    identifier(teamId);
    const row = await this.db.prepare(`SELECT 1 FROM users u JOIN memberships m ON m.user_sub=u.sub
      JOIN teams t ON t.id=m.team_id WHERE u.sub=? AND u.disabled=0 AND m.team_id=?
      AND m.role IN ('owner','manager') AND t.deleted=0`).bind(this.sub, teamId).first();
    if (!row) throw new ApiError(403, 'forbidden', 'Only a current team leader or manager can migrate schedules.');
  }

  private parseRows(input: unknown): CloudImportRow[] {
    const body = object(input);
    if (Object.keys(body).some(key => key !== 'rows') || !Array.isArray(body.rows)
        || body.rows.length < 1 || body.rows.length > MAX_IMPORT_ROWS)
      throw new ApiError(413, 'batch_too_large', `An import may contain at most ${MAX_IMPORT_ROWS} rows.`);
    const rows = body.rows.map(raw => {
      const row = object(raw);
      if (Object.keys(row).some(key => !['memberSub', 'calendarId', 'date', 'shiftCode'].includes(key)))
        throw new ApiError(400, 'invalid_request', 'Unknown import fields.');
      return { memberSub: identifier(row.memberSub), calendarId: identifier(row.calendarId),
        date: date(row.date), shiftCode: shift(row.shiftCode) };
    });
    const keys = rows.map(row => `${row.calendarId}:${row.date}`);
    if (new Set(keys).size !== keys.length) throw new ApiError(409, 'duplicate_row', 'An import cannot target the same calendar date twice.');
    const times = rows.map(row => Date.parse(`${row.date}T00:00:00Z`));
    if (Math.max(...times) - Math.min(...times) > MAX_IMPORT_SPAN_DAYS * 86400000)
      throw new ApiError(400, 'invalid_request', `Import dates must fit within ${MAX_IMPORT_SPAN_DAYS + 1} days.`);
    return rows;
  }

  private async resolveRow(teamId: string, row: CloudImportRow) {
    const mapping = await this.db.prepare(`SELECT c.id calendar_id,c.assigned_sub member_sub,
      COALESCE(NULLIF(u.display_name,''),u.username,u.sub) member_name,d.shift_code current_shift_code,d.version current_version
      FROM calendars c JOIN memberships m ON m.team_id=c.team_id AND m.user_sub=c.assigned_sub
      JOIN users u ON u.sub=m.user_sub AND u.disabled=0
      LEFT JOIN calendar_days d ON d.calendar_id=c.id AND d.date=?
      WHERE c.id=? AND c.team_id=? AND c.assigned_sub=? AND c.deleted=0`)
      .bind(row.date, row.calendarId, teamId, row.memberSub).first<MappingRow>();
    if (!mapping) throw new ApiError(409, 'target_conflict', 'A member or assigned team calendar changed.');
    if (!BUILT_INS.has(row.shiftCode)) {
      const active = await this.db.prepare(`SELECT 1 FROM team_shift_types
        WHERE team_id=? AND code=? AND archived=0`).bind(teamId, row.shiftCode).first();
      if (!active) throw new ApiError(409, 'shift_unavailable', 'An imported shift is not active.');
    }
    return { ...row, memberName: mapping.member_name, currentShiftCode: mapping.current_shift_code,
      expectedVersion: mapping.current_version ?? 0 };
  }

  async preview(teamId: string, input: unknown): Promise<CloudImportPreview> {
    await this.manager(teamId);
    const rows = this.parseRows(input);
    const resolved = await Promise.all(rows.map(row => this.resolveRow(teamId, row)));
    const previewToken = await fingerprint({ teamId, rows: resolved });
    return { teamId, rows: resolved, previewToken,
      limits: { maxRows: MAX_IMPORT_ROWS, maxSpanDays: MAX_IMPORT_SPAN_DAYS + 1, maxRequestBytes: 8192 } };
  }

  async apply(teamId: string, input: unknown): Promise<CloudImportApplyResult> {
    await this.manager(teamId);
    const body = object(input);
    if (Object.keys(body).some(key => !['mutationId', 'previewToken', 'rows'].includes(key)))
      throw new ApiError(400, 'invalid_request', 'Unknown import apply fields.');
    const mutationId = identifier(body.mutationId, 96);
    const previewToken = identifier(body.previewToken, 64);
    if (!Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > MAX_IMPORT_ROWS)
      throw new ApiError(413, 'batch_too_large', `An import may contain at most ${MAX_IMPORT_ROWS} rows.`);
    const rows = body.rows.map(raw => {
      const row = object(raw);
      if (Object.keys(row).some(key => !['memberSub','memberName','calendarId','date','shiftCode','currentShiftCode','expectedVersion'].includes(key)))
        throw new ApiError(400, 'invalid_request', 'Unknown import apply fields.');
      const expectedVersion = row.expectedVersion;
      if (!Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 0)
        throw new ApiError(400, 'invalid_request', 'Invalid version.');
      if (typeof row.memberName !== 'string' || row.memberName.length > 160)
        throw new ApiError(400, 'invalid_request', 'Invalid member name.');
      return { memberSub: identifier(row.memberSub), calendarId: identifier(row.calendarId),
        date: date(row.date), shiftCode: shift(row.shiftCode), memberName: row.memberName,
        currentShiftCode: row.currentShiftCode === null ? null : shift(row.currentShiftCode),
        expectedVersion: expectedVersion as number };
    });
    const duplicateKeys = rows.map(row => `${row.calendarId}:${row.date}`);
    if (new Set(duplicateKeys).size !== duplicateKeys.length) throw new ApiError(409, 'duplicate_row', 'An import cannot target the same date twice.');
    const token = await fingerprint({ teamId, rows });
    if (token !== previewToken) throw new ApiError(409, 'preview_conflict', 'The import preview is not intact. Preview again.');
    const runFingerprint = await fingerprint({ teamId, previewToken, rows });
    const prior = await this.db.prepare(`SELECT team_id,fingerprint,result FROM team_import_runs
      WHERE actor_sub=? AND mutation_id=?`).bind(this.sub, mutationId)
      .first<{ team_id: string; fingerprint: string; result: string }>();
    if (prior) {
      if (prior.team_id !== teamId || prior.fingerprint !== runFingerprint)
        throw new ApiError(409, 'conflict', 'This mutation ID was used for another import.');
      return JSON.parse(prior.result) as CloudImportApplyResult;
    }
    const resolved = await Promise.all(rows.map(row => this.resolveRow(teamId, row)));
    const canonicalRows = rows.map((row, index) => ({ ...row, memberName: resolved[index].memberName }));
    const predicates = canonicalRows.map(() => '(calendar_id=? AND date=?)').join(' OR ');
    const current = await this.db.prepare(`SELECT calendar_id,date,version FROM calendar_days WHERE ${predicates}`)
      .bind(...canonicalRows.flatMap(row => [row.calendarId, row.date])).all<{calendar_id:string;date:string;version:number}>();
    const versions = new Map(current.results.map(row => [`${row.calendar_id}:${row.date}`, row.version]));
    const results: CloudImportApplyResult['results'] = canonicalRows.map(row =>
      (versions.get(`${row.calendarId}:${row.date}`) ?? 0) === row.expectedVersion
        ? { ...row, status: 'applied' as const }
        : { ...row, status: 'conflict' as const, error: 'This day changed. Preview again.' });
    const writable = results.map((result, index) => ({ result, index })).filter(item => item.result.status === 'applied');
    const prepared = await Promise.all(writable.map(({ result, index }) => this.calendars.prepareScheduledRosterDay(teamId, {
      memberSub: result.memberSub, calendarId: result.calendarId, date: result.date,
      shiftCode: result.shiftCode, expectedVersion: result.expectedVersion, mutationId: `${mutationId}_${index}`,
    })));
    prepared.forEach((item, index) => { writable[index].result.day = item.result; });
    const response: CloudImportApplyResult = { results, applied: writable.length, conflicts: results.length - writable.length };
    const now = new Date().toISOString();
    try {
      await this.db.batch([
        this.managerGuard(teamId),
        ...prepared.flatMap(item => item.statements),
        this.db.prepare(`INSERT INTO team_import_runs(actor_sub,mutation_id,team_id,fingerprint,result,created_at,completed_at)
          VALUES(?,?,?,?,?,?,?)`).bind(this.sub, mutationId, teamId, runFingerprint, JSON.stringify(response), now, now),
        this.db.prepare(`INSERT INTO audit(actor_sub,mutation_id,operation,created_at) VALUES(?,?,?,?)`)
          .bind(this.sub, mutationId, `import-apply:${teamId}`, now),
        this.db.prepare('DELETE FROM transaction_checks'),
      ]);
    } catch {
      const retried = await this.db.prepare(`SELECT team_id,fingerprint,result FROM team_import_runs
        WHERE actor_sub=? AND mutation_id=?`).bind(this.sub, mutationId)
        .first<{ team_id: string; fingerprint: string; result: string }>();
      if (retried && retried.team_id === teamId && retried.fingerprint === runFingerprint)
        return JSON.parse(retried.result) as CloudImportApplyResult;
      throw new ApiError(409, 'conflict', 'The roster or your permission changed. Preview again.');
    }
    return response;
  }

  async exportRoster(teamId: string, from: string, to: string, cursor: string, limit: number) {
    await this.manager(teamId);
    const result = await this.calendars.roster(teamId, from, to, cursor, limit);
    return { schema: 'shiftcalendar.team-roster.v1', teamId, timezone: 'Asia/Kuala_Lumpur',
      generatedAt: new Date().toISOString(), items: result.items.map((item: TeamRosterDay) => ({
        memberSub: item.memberSub, memberName: item.memberDisplayName, calendarId: item.calendarId,
        date: item.date, shiftCode: item.shiftCode ?? null, version: item.version,
      })), ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}) };
  }

  async exportRequests(teamId: string, cursor: string, limit: number): Promise<Page<CloudTeamRequestExport>> {
    await this.manager(teamId); identifier(teamId); const p = page(cursor, limit);
    const rows = await this.db.prepare(`SELECT rowid cursor_id,id,kind,requester_sub,requester_calendar_id,requester_date,
      requester_observed_shift_code,requested_shift_code,counterpart_sub,counterpart_calendar_id,counterpart_date,
      counterpart_observed_shift_code,status,version,created_at,updated_at,resolved_at,resolved_by
      FROM team_change_requests WHERE team_id=? AND rowid>? ORDER BY rowid LIMIT ?`)
      .bind(teamId, p.cursor, p.limit + 1).all<Record<string, unknown>>();
    const visible = rows.results.slice(0, p.limit);
    const items = visible.map(row => ({
      id: String(row.id), kind: row.kind as 'direct'|'swap', requesterSub: String(row.requester_sub),
      requesterCalendarId: String(row.requester_calendar_id), requesterDate: String(row.requester_date),
      requesterObservedShiftCode: row.requester_observed_shift_code ? String(row.requester_observed_shift_code) : undefined,
      requestedShiftCode: row.requested_shift_code ? String(row.requested_shift_code) : undefined,
      counterpartSub: row.counterpart_sub ? String(row.counterpart_sub) : undefined,
      counterpartCalendarId: row.counterpart_calendar_id ? String(row.counterpart_calendar_id) : undefined,
      counterpartDate: row.counterpart_date ? String(row.counterpart_date) : undefined,
      counterpartObservedShiftCode: row.counterpart_observed_shift_code ? String(row.counterpart_observed_shift_code) : undefined,
      status: String(row.status), version: Number(row.version), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      resolvedAt: row.resolved_at ? String(row.resolved_at) : undefined, resolvedBy: row.resolved_by ? String(row.resolved_by) : undefined,
      _cursor: Number(row.cursor_id),
    }));
    return { items: items.map(({ _cursor, ...item }) => item),
      ...(rows.results.length > p.limit ? { nextCursor: String(items.at(-1)!._cursor) } : {}) };
  }

  async exportAudit(teamId: string, cursor: string, limit: number): Promise<Page<CloudTeamAuditEvent>> {
    await this.manager(teamId); identifier(teamId); const p = page(cursor, limit);
    const rows = await this.db.prepare(`SELECT a.id,a.actor_sub,a.operation,a.created_at
      FROM audit a WHERE a.id>? AND (
        a.operation IN (?,?,?) OR
        a.operation IN (SELECT 'change-request-resolve:'||id FROM team_change_requests WHERE team_id=?) OR
        a.operation IN (SELECT 'change-request-respond:'||id FROM team_change_requests WHERE team_id=?))
      ORDER BY a.id LIMIT ?`).bind(p.cursor, `schedule-apply:${teamId}`, `import-apply:${teamId}`,
        `change-request-create:${teamId}`, teamId, teamId, p.limit + 1)
      .all<{id:number;actor_sub:string;operation:string;created_at:string}>();
    const visible = rows.results.slice(0, p.limit);
    return { items: visible.map(row => ({ id: row.id, actorSub: row.actor_sub, operation: row.operation, createdAt: row.created_at })),
      ...(rows.results.length > p.limit ? { nextCursor: String(visible.at(-1)!.id) } : {}) };
  }
}
