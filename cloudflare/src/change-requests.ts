import type { CloudChangeRequest, CloudChangeRequestStatus, Page } from '../../shared/cloudTypes';
import { CalendarRepository, object } from './calendar';
import { ApiError } from './errors';

type RequestRow = {
  id: string; team_id: string; kind: 'direct' | 'swap'; requester_sub: string;
  requester_name: string; requester_calendar_id: string; requester_date: string;
  requester_observed_version: number; requester_observed_shift_code: string | null;
  requested_shift_code: string | null; counterpart_sub: string | null;
  counterpart_name: string | null; counterpart_calendar_id: string | null;
  counterpart_date: string | null; counterpart_observed_version: number | null;
  counterpart_observed_shift_code: string | null; status: CloudChangeRequestStatus;
  reason: string; version: number; created_at: string; updated_at: string;
  resolved_at: string | null; resolved_by: string | null;
};

const rowFields = `r.id,r.team_id,r.kind,r.requester_sub,
  COALESCE(NULLIF(requester.display_name,''),requester.username,requester.sub) requester_name,
  r.requester_calendar_id,r.requester_date,r.requester_observed_version,r.requester_observed_shift_code,
  r.requested_shift_code,r.counterpart_sub,
  CASE WHEN counterpart.sub IS NULL THEN NULL ELSE COALESCE(NULLIF(counterpart.display_name,''),counterpart.username,counterpart.sub) END counterpart_name,
  r.counterpart_calendar_id,r.counterpart_date,r.counterpart_observed_version,r.counterpart_observed_shift_code,
  r.status,r.reason,r.version,r.created_at,r.updated_at,r.resolved_at,r.resolved_by`;

function identifier(value: unknown, max = 128) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || !/^[A-Za-z0-9_-]+$/.test(value))
    throw new ApiError(400, 'invalid_request', 'Invalid identifier.');
  return value;
}
function calendarDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
      || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)
    throw new ApiError(400, 'invalid_request', 'Invalid calendar date.');
  return value;
}
function revision(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) >= Number.MAX_SAFE_INTEGER)
    throw new ApiError(400, 'invalid_request', 'Invalid version.');
  return value as number;
}
function shift(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(value))
    throw new ApiError(400, 'invalid_request', 'Invalid shift.');
  return value;
}
async function fingerprint(value: unknown) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
function request(row: RequestRow): CloudChangeRequest {
  return {
    id: row.id, teamId: row.team_id, kind: row.kind, requesterSub: row.requester_sub,
    requesterDisplayName: row.requester_name, requesterCalendarId: row.requester_calendar_id,
    requesterDate: row.requester_date, requesterObservedVersion: row.requester_observed_version,
    ...(row.requester_observed_shift_code ? { requesterObservedShiftCode: row.requester_observed_shift_code } : {}),
    ...(row.requested_shift_code ? { requestedShiftCode: row.requested_shift_code } : {}),
    ...(row.counterpart_sub ? { counterpartSub: row.counterpart_sub } : {}),
    ...(row.counterpart_name ? { counterpartDisplayName: row.counterpart_name } : {}),
    ...(row.counterpart_calendar_id ? { counterpartCalendarId: row.counterpart_calendar_id } : {}),
    ...(row.counterpart_date ? { counterpartDate: row.counterpart_date } : {}),
    ...(row.counterpart_observed_version !== null ? { counterpartObservedVersion: row.counterpart_observed_version } : {}),
    ...(row.counterpart_observed_shift_code ? { counterpartObservedShiftCode: row.counterpart_observed_shift_code } : {}),
    status: row.status, reason: row.reason, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
    ...(row.resolved_at ? { resolvedAt: row.resolved_at } : {}), ...(row.resolved_by ? { resolvedBy: row.resolved_by } : {}),
  };
}

export class ChangeRequestRepository {
  constructor(private readonly db: D1Database, private readonly sub: string,
    private readonly calendars = new CalendarRepository(db, sub)) {}

  private guard(sql: string, args: (string | number)[]) {
    return this.db.prepare(`INSERT INTO transaction_checks(valid) SELECT CASE WHEN (${sql}) THEN 1 ELSE 0 END`).bind(...args);
  }
  private async role(teamId: string, allowed?: Array<'owner' | 'manager' | 'member' | 'viewer'>) {
    identifier(teamId);
    const row = await this.db.prepare(`SELECT m.role FROM memberships m JOIN teams t ON t.id=m.team_id AND t.deleted=0
      JOIN users u ON u.sub=m.user_sub AND u.disabled=0 WHERE m.team_id=? AND m.user_sub=?`)
      .bind(teamId, this.sub).first<{ role: 'owner' | 'manager' | 'member' | 'viewer' }>();
    if (!row || (allowed && !allowed.includes(row.role))) throw new ApiError(403, 'forbidden', 'Change request access is not allowed.');
    return row.role;
  }
  private managerGuard(teamId: string) {
    return this.guard(`EXISTS(SELECT 1 FROM memberships m JOIN teams t ON t.id=m.team_id AND t.deleted=0
      JOIN users u ON u.sub=m.user_sub AND u.disabled=0 WHERE m.team_id=? AND m.user_sub=? AND m.role IN ('owner','manager'))`,
    [teamId, this.sub]);
  }
  private memberGuard(teamId: string, userSub = this.sub) {
    return this.guard(`EXISTS(SELECT 1 FROM memberships m JOIN teams t ON t.id=m.team_id AND t.deleted=0
      JOIN users u ON u.sub=m.user_sub AND u.disabled=0 WHERE m.team_id=? AND m.user_sub=?)`, [teamId, userSub]);
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
  private async prior<T>(mutationId: string, operation: string, hash: string) {
    const row = await this.db.prepare('SELECT operation,fingerprint,result FROM mutations WHERE user_sub=? AND id=?')
      .bind(this.sub, mutationId).first<{ operation: string; fingerprint: string; result: string }>();
    if (!row) return undefined;
    if (row.operation !== operation || row.fingerprint !== hash)
      throw new ApiError(409, 'conflict', 'This mutation ID was used for a different request.');
    return JSON.parse(row.result) as T;
  }
  private async getRow(requestId: string) {
    identifier(requestId);
    return this.db.prepare(`SELECT ${rowFields} FROM team_change_requests r
      JOIN users requester ON requester.sub=r.requester_sub LEFT JOIN users counterpart ON counterpart.sub=r.counterpart_sub
      WHERE r.id=?`).bind(requestId).first<RequestRow>();
  }
  private async visible(requestId: string) {
    const row = await this.db.prepare(`SELECT ${rowFields} FROM team_change_requests r
      JOIN users requester ON requester.sub=r.requester_sub LEFT JOIN users counterpart ON counterpart.sub=r.counterpart_sub
      JOIN memberships actor ON actor.team_id=r.team_id AND actor.user_sub=?
      JOIN users actor_user ON actor_user.sub=actor.user_sub AND actor_user.disabled=0
      JOIN teams t ON t.id=r.team_id AND t.deleted=0
      WHERE r.id=? AND (actor.role IN ('owner','manager') OR r.requester_sub=? OR r.counterpart_sub=?)`)
      .bind(this.sub, requestId, this.sub, this.sub).first<RequestRow>();
    if (!row) throw new ApiError(403, 'forbidden', 'Change request access is not allowed.');
    return request(row);
  }

  async list(teamId: string, cursor = '', limit = 50): Promise<Page<CloudChangeRequest>> {
    await this.role(teamId);
    if (cursor) identifier(cursor);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400, 'invalid_request', 'Invalid page size.');
    const rows = await this.db.prepare(`SELECT ${rowFields} FROM team_change_requests r
      JOIN users requester ON requester.sub=r.requester_sub LEFT JOIN users counterpart ON counterpart.sub=r.counterpart_sub
      JOIN memberships actor ON actor.team_id=r.team_id AND actor.user_sub=?
      WHERE r.team_id=? AND r.id>? AND (actor.role IN ('owner','manager') OR r.requester_sub=? OR r.counterpart_sub=?)
      ORDER BY r.id LIMIT ?`).bind(this.sub, teamId, cursor, this.sub, this.sub, limit + 1).all<RequestRow>();
    const items = rows.results.slice(0, limit).map(request);
    return { items, ...(rows.results.length > limit ? { nextCursor: items.at(-1)!.id } : {}) };
  }

  async create(teamId: string, input: unknown) {
    await this.role(teamId, ['member', 'viewer']);
    const body = object(input); const mutationId = identifier(body.mutationId, 96); const value = object(body.value);
    if (Object.keys(body).some(key => !['mutationId', 'value'].includes(key)) || Object.keys(value).some(key => ![
      'kind', 'requesterCalendarId', 'requesterDate', 'requesterObservedVersion', 'requesterObservedShiftCode',
      'requestedShiftCode', 'counterpartSub', 'counterpartCalendarId', 'counterpartDate',
      'counterpartObservedVersion', 'counterpartObservedShiftCode', 'reason',
    ].includes(key))) throw new ApiError(400, 'invalid_request', 'Unknown change request fields.');
    const kind = value.kind;
    if (kind !== 'direct' && kind !== 'swap') throw new ApiError(400, 'invalid_request', 'Invalid request type.');
    const requesterCalendarId = identifier(value.requesterCalendarId);
    const requesterDate = calendarDate(value.requesterDate);
    const requesterObservedVersion = revision(value.requesterObservedVersion);
    const requesterObservedShiftCode = shift(value.requesterObservedShiftCode);
    if (typeof value.reason !== 'string' || !value.reason.trim() || value.reason.trim().length > 500)
      throw new ApiError(400, 'invalid_request', 'Enter a reason of at most 500 characters.');
    const requestedShiftCode = kind === 'direct' ? shift(value.requestedShiftCode) : null;
    const counterpartSub = kind === 'swap' ? identifier(value.counterpartSub) : null;
    const counterpartCalendarId = kind === 'swap' ? identifier(value.counterpartCalendarId) : null;
    const counterpartDate = kind === 'swap' ? calendarDate(value.counterpartDate) : null;
    const counterpartObservedVersion = kind === 'swap' ? revision(value.counterpartObservedVersion) : null;
    const counterpartObservedShiftCode = kind === 'swap' ? shift(value.counterpartObservedShiftCode) : null;
    if (counterpartSub === this.sub || (kind === 'direct' && requestedShiftCode === requesterObservedShiftCode))
      throw new ApiError(400, 'invalid_request', 'The request must change an assigned shift.');
    const canonical = { kind, requesterCalendarId, requesterDate, requesterObservedVersion, requesterObservedShiftCode,
      requestedShiftCode, counterpartSub, counterpartCalendarId, counterpartDate, counterpartObservedVersion,
      counterpartObservedShiftCode, reason: value.reason.trim() };
    const hash = await fingerprint(canonical); const operation = `change-request-create:${teamId}`;
    const prior = await this.prior<CloudChangeRequest>(mutationId, operation, hash);
    if (prior) return this.visible(prior.id);
    const requesterMatch = await this.db.prepare(`SELECT 1 FROM calendars c LEFT JOIN calendar_days d ON d.calendar_id=c.id AND d.date=?
      JOIN memberships m ON m.team_id=c.team_id AND m.user_sub=? JOIN users u ON u.sub=m.user_sub AND u.disabled=0
      WHERE c.id=? AND c.team_id=? AND c.assigned_sub=? AND c.deleted=0
      AND d.deleted=0 AND d.version=? AND d.shift_code=?`)
      .bind(requesterDate, this.sub, requesterCalendarId, teamId, this.sub, requesterObservedVersion, requesterObservedShiftCode).first();
    if (!requesterMatch) throw new ApiError(409, 'conflict', 'Your assigned shift changed. Refresh before requesting.');
    if (kind === 'direct') {
      const active = await this.db.prepare(`SELECT 1 WHERE ? IN ('M','A','N','O') OR EXISTS(
        SELECT 1 FROM team_shift_types WHERE team_id=? AND code=? AND archived=0)`)
        .bind(requestedShiftCode, teamId, requestedShiftCode).first();
      if (!active) throw new ApiError(409, 'shift_unavailable', 'The requested shift is no longer active.');
    } else {
      const counterpartMatch = await this.db.prepare(`SELECT 1 FROM calendars c JOIN calendar_days d ON d.calendar_id=c.id AND d.date=?
        JOIN memberships m ON m.team_id=c.team_id AND m.user_sub=? JOIN users u ON u.sub=m.user_sub AND u.disabled=0
        WHERE c.id=? AND c.team_id=? AND c.assigned_sub=? AND c.deleted=0 AND d.deleted=0
        AND d.version=? AND d.shift_code=?`).bind(counterpartDate, counterpartSub, counterpartCalendarId, teamId,
        counterpartSub, counterpartObservedVersion, counterpartObservedShiftCode).first();
      if (!counterpartMatch) throw new ApiError(409, 'conflict', 'A selected shift changed. Refresh before requesting.');
    }
    const now = new Date().toISOString(); const id = crypto.randomUUID();
    const result: CloudChangeRequest = { id, teamId, kind, requesterSub: this.sub, requesterDisplayName: '',
      requesterCalendarId, requesterDate, requesterObservedVersion,
      ...(requesterObservedShiftCode ? { requesterObservedShiftCode } : {}),
      ...(requestedShiftCode ? { requestedShiftCode } : {}), ...(counterpartSub ? { counterpartSub } : {}),
      ...(counterpartCalendarId ? { counterpartCalendarId } : {}), ...(counterpartDate ? { counterpartDate } : {}),
      ...(counterpartObservedVersion !== null ? { counterpartObservedVersion } : {}),
      ...(counterpartObservedShiftCode ? { counterpartObservedShiftCode } : {}),
      status: kind === 'swap' ? 'pending_counterpart' : 'pending_manager', reason: canonical.reason,
      version: 1, createdAt: now, updatedAt: now };
    try {
      await this.db.batch([
        this.memberGuard(teamId),
        this.guard(`EXISTS(SELECT 1 FROM memberships WHERE team_id=? AND user_sub=? AND role IN ('member','viewer'))`, [teamId, this.sub]),
        this.guard(`NOT EXISTS(SELECT 1 FROM team_change_requests r WHERE r.team_id=?
          AND r.status IN ('pending_counterpart','pending_manager') AND (
            (r.requester_calendar_id=? AND r.requester_date=?) OR (r.counterpart_calendar_id=? AND r.counterpart_date=?)
            ${kind === 'swap' ? `OR (r.requester_calendar_id=? AND r.requester_date=?)
              OR (r.counterpart_calendar_id=? AND r.counterpart_date=?)` : ''}
          ))`, kind === 'swap'
          ? [teamId, requesterCalendarId, requesterDate, requesterCalendarId, requesterDate,
              counterpartCalendarId!, counterpartDate!, counterpartCalendarId!, counterpartDate!]
          : [teamId, requesterCalendarId, requesterDate, requesterCalendarId, requesterDate]),
        this.guard(`EXISTS(SELECT 1 FROM calendars c JOIN calendar_days d ON d.calendar_id=c.id AND d.date=?
          WHERE c.id=? AND c.team_id=? AND c.assigned_sub=? AND c.deleted=0 AND d.deleted=0 AND d.version=? AND d.shift_code=?)`,
        [requesterDate, requesterCalendarId, teamId, this.sub, requesterObservedVersion, requesterObservedShiftCode]),
        ...(kind === 'swap' ? [this.memberGuard(teamId, counterpartSub!),
          this.guard(`EXISTS(SELECT 1 FROM calendars c JOIN calendar_days d ON d.calendar_id=c.id AND d.date=?
            WHERE c.id=? AND c.team_id=? AND c.assigned_sub=? AND c.deleted=0 AND d.deleted=0 AND d.version=? AND d.shift_code=?)`,
          [counterpartDate!, counterpartCalendarId!, teamId, counterpartSub!, counterpartObservedVersion!, counterpartObservedShiftCode!])] : []),
        this.db.prepare(`INSERT INTO team_change_requests(id,team_id,kind,requester_sub,requester_calendar_id,requester_date,
          requester_observed_version,requester_observed_shift_code,requested_shift_code,counterpart_sub,counterpart_calendar_id,
          counterpart_date,counterpart_observed_version,counterpart_observed_shift_code,status,reason,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, teamId, kind, this.sub, requesterCalendarId, requesterDate,
          requesterObservedVersion, requesterObservedShiftCode, requestedShiftCode, counterpartSub, counterpartCalendarId,
          counterpartDate, counterpartObservedVersion, counterpartObservedShiftCode, result.status, canonical.reason, now, now),
        ...this.record(mutationId, operation, hash, result, now),
      ]);
    } catch {
      const retried = await this.prior<CloudChangeRequest>(mutationId, operation, hash);
      if (retried) return this.visible(retried.id);
      throw new ApiError(409, 'conflict', 'The request conflicted. Refresh before retrying.');
    }
    return this.visible(id);
  }

  async respond(requestId: string, input: unknown) {
    const row = await this.getRow(requestId);
    if (!row) throw new ApiError(404, 'not_found', 'Change request not found.');
    await this.role(row.team_id);
    if (row.counterpart_sub !== this.sub) throw new ApiError(403, 'forbidden', 'Only the selected counterpart can respond.');
    const body = object(input); const mutationId = identifier(body.mutationId, 96); const expectedVersion = revision(body.expectedVersion);
    if (Object.keys(body).some(key => !['mutationId', 'expectedVersion', 'decision'].includes(key)))
      throw new ApiError(400, 'invalid_request', 'Unknown response fields.');
    if (body.decision !== 'accept' && body.decision !== 'decline') throw new ApiError(400, 'invalid_request', 'Invalid response.');
    const hash = await fingerprint({ requestId, expectedVersion, decision: body.decision }); const operation = `change-request-respond:${requestId}`;
    const prior = await this.prior<CloudChangeRequest>(mutationId, operation, hash); if (prior) return this.visible(requestId);
    const status: CloudChangeRequestStatus = body.decision === 'accept' ? 'pending_manager' : 'declined';
    const now = new Date().toISOString();
    try { await this.db.batch([
      this.memberGuard(row.team_id),
      this.guard(`EXISTS(SELECT 1 FROM team_change_requests WHERE id=? AND counterpart_sub=? AND status='pending_counterpart' AND version=?)`,
        [requestId, this.sub, expectedVersion]),
      this.db.prepare(`UPDATE team_change_requests SET status=?,version=version+1,updated_at=?,resolved_at=?,resolved_by=? WHERE id=?`)
        .bind(status, now, status === 'declined' ? now : null, status === 'declined' ? this.sub : null, requestId),
      ...this.record(mutationId, operation, hash, { ...request(row), status, version: expectedVersion + 1, updatedAt: now,
        ...(status === 'declined' ? { resolvedAt: now, resolvedBy: this.sub } : {}) }, now),
    ]); } catch {
      const retried = await this.prior<CloudChangeRequest>(mutationId, operation, hash); if (retried) return this.visible(requestId);
      throw new ApiError(409, 'conflict', 'The request was already updated.');
    }
    return this.visible(requestId);
  }

  async cancel(requestId: string, input: unknown) {
    const row = await this.getRow(requestId); if (!row) throw new ApiError(404, 'not_found', 'Change request not found.');
    await this.role(row.team_id); if (row.requester_sub !== this.sub) throw new ApiError(403, 'forbidden', 'Only the requester can cancel.');
    return this.close(row, input, 'cancelled', false);
  }

  async resolve(teamId: string, requestId: string, input: unknown) {
    await this.role(teamId, ['owner', 'manager']);
    const row = await this.getRow(requestId); if (!row || row.team_id !== teamId) throw new ApiError(404, 'not_found', 'Change request not found.');
    const body = object(input);
    if (Object.keys(body).some(key => !['mutationId', 'expectedVersion', 'decision'].includes(key)))
      throw new ApiError(400, 'invalid_request', 'Unknown resolution fields.');
    if (body.decision === 'reject') return this.close(row, body, 'rejected', true);
    if (body.decision !== 'approve') throw new ApiError(400, 'invalid_request', 'Invalid decision.');
    const mutationId = identifier(body.mutationId, 96); const expectedVersion = revision(body.expectedVersion);
    const hash = await fingerprint({ requestId, expectedVersion, decision: 'approve' }); const operation = `change-request-resolve:${requestId}`;
    const prior = await this.prior<CloudChangeRequest>(mutationId, operation, hash); if (prior) return this.visible(requestId);
    if (row.status !== 'pending_manager' || row.version !== expectedVersion) throw new ApiError(409, 'conflict', 'The request was already updated.');
    const assignments = row.kind === 'direct' ? [{ memberSub: row.requester_sub, calendarId: row.requester_calendar_id,
      date: row.requester_date, mutationId: `${mutationId}_requester`, expectedVersion: row.requester_observed_version,
      shiftCode: row.requested_shift_code! }] : [
      { memberSub: row.requester_sub, calendarId: row.requester_calendar_id, date: row.requester_date,
        mutationId: `${mutationId}_requester`, expectedVersion: row.requester_observed_version,
        shiftCode: row.counterpart_observed_shift_code! },
      { memberSub: row.counterpart_sub!, calendarId: row.counterpart_calendar_id!, date: row.counterpart_date!,
        mutationId: `${mutationId}_counterpart`, expectedVersion: row.counterpart_observed_version!,
        shiftCode: row.requester_observed_shift_code! },
    ];
    const prepared = await Promise.all(assignments.map(item => this.calendars.prepareScheduledRosterDay(teamId, item)));
    const now = new Date().toISOString(); const result = { ...request(row), status: 'approved' as const,
      version: expectedVersion + 1, updatedAt: now, resolvedAt: now, resolvedBy: this.sub };
    try { await this.db.batch([
      this.managerGuard(teamId), this.memberGuard(teamId, row.requester_sub),
      ...(row.counterpart_sub ? [this.memberGuard(teamId, row.counterpart_sub)] : []),
      this.guard(`EXISTS(SELECT 1 FROM team_change_requests WHERE id=? AND team_id=? AND status='pending_manager' AND version=?)`,
        [requestId, teamId, expectedVersion]),
      ...prepared.flatMap(item => item.statements),
      this.db.prepare(`UPDATE team_change_requests SET status='approved',version=version+1,updated_at=?,resolved_at=?,resolved_by=? WHERE id=?`)
        .bind(now, now, this.sub, requestId),
      ...this.record(mutationId, operation, hash, result, now),
    ]); } catch {
      const retried = await this.prior<CloudChangeRequest>(mutationId, operation, hash); if (retried) return this.visible(requestId);
      throw new ApiError(409, 'conflict', 'The roster or request changed. Refresh before approving.');
    }
    return this.visible(requestId);
  }

  private async close(row: RequestRow, input: unknown, status: 'cancelled' | 'rejected', manager: boolean) {
    const body = object(input); const mutationId = identifier(body.mutationId, 96); const expectedVersion = revision(body.expectedVersion);
    if (Object.keys(body).some(key => !['mutationId', 'expectedVersion', 'decision'].includes(key)))
      throw new ApiError(400, 'invalid_request', 'Unknown resolution fields.');
    const hash = await fingerprint({ requestId: row.id, expectedVersion, decision: status });
    const operation = `change-request-${status}:${row.id}`;
    const prior = await this.prior<CloudChangeRequest>(mutationId, operation, hash); if (prior) return this.visible(row.id);
    const now = new Date().toISOString(); const result = { ...request(row), status, version: expectedVersion + 1,
      updatedAt: now, resolvedAt: now, resolvedBy: this.sub };
    try { await this.db.batch([
      manager ? this.managerGuard(row.team_id) : this.memberGuard(row.team_id),
      this.guard(`EXISTS(SELECT 1 FROM team_change_requests WHERE id=? AND version=? AND status IN ('pending_counterpart','pending_manager')
        AND ${manager ? "team_id=?" : "requester_sub=?"})`, [row.id, expectedVersion, manager ? row.team_id : this.sub]),
      this.db.prepare('UPDATE team_change_requests SET status=?,version=version+1,updated_at=?,resolved_at=?,resolved_by=? WHERE id=?')
        .bind(status, now, now, this.sub, row.id),
      ...this.record(mutationId, operation, hash, result, now),
    ]); } catch {
      const retried = await this.prior<CloudChangeRequest>(mutationId, operation, hash); if (retried) return this.visible(row.id);
      throw new ApiError(409, 'conflict', 'The request was already updated.');
    }
    return this.visible(row.id);
  }
}
