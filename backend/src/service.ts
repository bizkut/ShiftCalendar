import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type {
  BulkDayRequest,
  CloudCalendar,
  CloudCalendarDay,
  CloudCalendarDayTombstone,
  CloudMember,
  CloudPrivateDetails,
  CloudProfile,
  CloudShiftType,
  CloudTeam,
  InvitationCreated,
  Page,
  TeamRole,
  TeamRosterDay,
} from '../../shared/cloudTypes.js';
import { badRequest, conflict, forbidden, notFound } from './errors.js';
import { encodeStorageCursor, type Condition, type Item, type Key, type Storage, type Transaction } from './storage.js';

const MAX_PAGE = 100;
const MAX_DAYS = 62;
const MAX_BULK = 8;
const MAX_PRIVATE_DAYS = 3660;
const MAX_PRIVATE_BYTES = 300_000;
const MAX_PRIVATE_DAY_BYTES = 2_000;
const MAX_PRIVATE_CHANGED_DAYS = 4;
const DEFAULT_TZ = 'Asia/Kuala_Lumpur';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const EDIT_ROLES: TeamRole[] = ['owner', 'manager', 'member'];
const MANAGE_ROLES: TeamRole[] = ['owner', 'manager'];

type MembershipItem = Item & { entity: 'membership'; teamId: string; sub: string; displayName: string; role: TeamRole; joinedAt: string };
type CalendarItem = Item & CloudCalendar & { entity: 'calendar'; ownerSub?: string; status: 'active' | 'deleted' };
type TeamItem = Item & Omit<CloudTeam, 'role'> & { entity: 'team'; status: 'active' | 'deleted' };
type InviteItem = Item & { entity: 'invite'; id: string; teamId: string; role: Exclude<TeamRole, 'owner'>; expiresAt: number; expiresAtIso: string; status: 'open' | 'redeemed' | 'revoked'; version: number; createdBy: string };

const key = (PK: string, SK: string): Key => ({ PK, SK });
const now = () => new Date().toISOString();
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const clean = <T extends Item>(item: T): Omit<T, keyof Key | 'entity' | 'status'> => {
  const { PK: _pk, SK: _sk, entity: _entity, status: _status, ...value } = item;
  return value;
};

function limit(value?: number): number {
  if (value === undefined) return 50;
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE) throw badRequest(`limit must be between 1 and ${MAX_PAGE}`);
  return value;
}

function requireId(value: string, name: string): void {
  if (!ID.test(value)) throw badRequest(`${name} is invalid`);
}

function requireDateRange(from: string, to: string): void {
  if (!isLocalDate(from) || !isLocalDate(to) || from > to) throw badRequest('Invalid date range');
  const span = Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  if (span > MAX_DAYS) throw badRequest(`Date range cannot exceed ${MAX_DAYS} days`);
}

function isLocalDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function requireMutation(value: unknown): asserts value is { mutationId: string; expectedVersion: number; value: unknown } {
  if (!isRecord(value) || typeof value.mutationId !== 'string' || !ID.test(value.mutationId)) throw badRequest('mutationId is invalid');
  if (!Number.isInteger(value.expectedVersion) || (value.expectedVersion as number) < 0) throw badRequest('expectedVersion must be a non-negative integer');
  if (!Object.hasOwn(value, 'value')) throw badRequest('value is required');
}

function requireDayValue(value: unknown): asserts value is { shiftCode?: string; availability?: string } | null {
  if (value === null) return;
  if (!isRecord(value)) throw badRequest('day value must be an object or null');
  const keys = Object.keys(value);
  if (!keys.length || keys.some(field => field !== 'shiftCode' && field !== 'availability')) throw badRequest('day value contains unsupported fields');
  if (value.shiftCode !== undefined && (typeof value.shiftCode !== 'string' || value.shiftCode.length > 40)) throw badRequest('shiftCode is invalid');
  if (value.availability !== undefined && (typeof value.availability !== 'string' || value.availability.length > 200)) throw badRequest('availability is invalid');
}

function requirePrivateValue(value: unknown): asserts value is Omit<CloudPrivateDetails, 'calendarId' | 'version' | 'updatedAt'> {
  if (!isRecord(value) || !isRecord(value.leaveBalances) || !Array.isArray(value.days)) throw badRequest('private details are malformed');
  if (value.payRate !== undefined && (typeof value.payRate !== 'number' || !Number.isFinite(value.payRate) || value.payRate < 0)) throw badRequest('payRate is invalid');
  if (Object.keys(value.leaveBalances).length > 100 || Object.values(value.leaveBalances).some(days => typeof days !== 'number' || !Number.isFinite(days) || days < 0)) throw badRequest('leaveBalances are invalid');
  if (value.days.length > MAX_PRIVATE_DAYS) throw badRequest(`days cannot exceed ${MAX_PRIVATE_DAYS}`);
  const dates = new Set<string>();
  for (const day of value.days) {
    if (!isRecord(day) || typeof day.date !== 'string' || !isLocalDate(day.date) || dates.has(day.date)) throw badRequest('private detail dates must be valid and unique');
    dates.add(day.date);
    const allowed = new Set(['date', 'note', 'overtimeHours', 'leaveTypeId', 'leaveReason', 'version', 'updatedAt']);
    if (Object.keys(day).some(field => !allowed.has(field))) throw badRequest('private day contains unsupported fields');
    if (day.note !== undefined && (typeof day.note !== 'string' || day.note.length > 1500)) throw badRequest('note is invalid');
    if (day.leaveReason !== undefined && (typeof day.leaveReason !== 'string' || day.leaveReason.length > 500)) throw badRequest('leaveReason is invalid');
    if (day.leaveTypeId !== undefined && (typeof day.leaveTypeId !== 'string' || day.leaveTypeId.length > 80)) throw badRequest('leaveTypeId is invalid');
    if (day.overtimeHours !== undefined && (typeof day.overtimeHours !== 'number' || !Number.isFinite(day.overtimeHours) || day.overtimeHours < 0 || day.overtimeHours > 24)) throw badRequest('overtimeHours is invalid');
    if (Buffer.byteLength(JSON.stringify(day), 'utf8') > MAX_PRIVATE_DAY_BYTES) throw badRequest(`private day cannot exceed ${MAX_PRIVATE_DAY_BYTES} UTF-8 bytes`);
  }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_PRIVATE_BYTES) throw badRequest(`private details cannot exceed ${MAX_PRIVATE_BYTES} UTF-8 bytes`);
}

export class CalendarService {
  constructor(private readonly storage: Storage) {}

  private async membership(sub: string, teamId: string): Promise<MembershipItem> {
    const member = await this.storage.get(key(`TEAM#${teamId}`, `MEMBER#${sub}`), true) as MembershipItem | undefined;
    if (!member) throw forbidden('Current team membership is required');
    return member;
  }

  private async team(sub: string, teamId: string, ownerOnly = false): Promise<{ team: TeamItem; member: MembershipItem }> {
    requireId(teamId, 'teamId');
    const [team, member] = await Promise.all([
      this.storage.get(key(`TEAM#${teamId}`, 'META'), true) as Promise<TeamItem | undefined>,
      this.membership(sub, teamId),
    ]);
    if (!team || team.status !== 'active') throw notFound('Team not found');
    if (ownerOnly && member.role !== 'owner') throw forbidden('Team owner role is required');
    return { team, member };
  }

  private async calendar(sub: string, calendarId: string, edit = false): Promise<{ calendar: CalendarItem; member?: MembershipItem; team?: TeamItem }> {
    requireId(calendarId, 'calendarId');
    const calendar = await this.storage.get(key(`CAL#${calendarId}`, 'META'), true) as CalendarItem | undefined;
    if (!calendar || calendar.status !== 'active') throw notFound('Calendar not found');
    if (calendar.scope === 'private') {
      if (calendar.ownerSub !== sub) throw forbidden();
      return { calendar };
    }
    if (!calendar.teamId) throw new Error('Team calendar is missing teamId');
    const [member, team] = await Promise.all([
      this.membership(sub, calendar.teamId),
      this.storage.get(key(`TEAM#${calendar.teamId}`, 'META'), true) as Promise<TeamItem | undefined>,
    ]);
    if (!team || team.status !== 'active') throw notFound('Team not found');
    if (edit && (!EDIT_ROLES.includes(member.role) || (member.role === 'member' && calendar.assignedMemberSub !== sub))) throw forbidden('Role cannot edit this schedule');
    return { calendar, member, team };
  }

  private membershipCheck(member: MembershipItem): Condition {
    return { kind: 'equals', key: key(member.PK, member.SK), field: 'role', value: member.role };
  }

  private async previousMutation(sub: string, mutationId: string): Promise<unknown | undefined> {
    requireId(mutationId, 'mutationId');
    const item = await this.storage.get(key(`USER#${sub}`, `MUTATION#${mutationId}`), true);
    return item?.result;
  }

  private mutationItem(sub: string, mutationId: string, result: unknown): { item: Item; condition: Condition } {
    const mutationKey = key(`USER#${sub}`, `MUTATION#${mutationId}`);
    return { item: { ...mutationKey, entity: 'mutation', result, createdAt: now(), expiresAt: Math.floor(Date.now() / 1000) + 30 * 86400 }, condition: { kind: 'notExists', key: mutationKey } };
  }

  async bootstrap(sub: string) {
    const [profile, privateCalendars, teams] = await Promise.all([
      this.getProfile(sub),
      this.listCalendars(sub, 100),
      this.listTeams(sub, 100),
    ]);
    const calendars = [...privateCalendars.items];
    for (const team of teams.items.slice(0, 25)) {
      if (calendars.length >= 100) break;
      const teamCalendars = await this.listCalendars(sub, 100 - calendars.length, undefined, team.id);
      calendars.push(...teamCalendars.items);
    }
    return { profile, calendars, teams: teams.items };
  }

  async getProfile(sub: string): Promise<CloudProfile> {
    const item = await this.storage.get(key(`USER#${sub}`, 'PROFILE'), true);
    return item ? clean(item) as unknown as CloudProfile : { sub, displayName: '', timezone: DEFAULT_TZ, version: 0, updatedAt: now() };
  }

  async updateProfile(sub: string, request: { mutationId: string; expectedVersion: number; value: Pick<CloudProfile, 'displayName' | 'timezone'> }): Promise<CloudProfile> {
    const previous = await this.previousMutation(sub, request.mutationId);
    if (previous) return previous as CloudProfile;
    const profile: CloudProfile = { sub, displayName: request.value.displayName.slice(0, 100), timezone: request.value.timezone, version: request.expectedVersion + 1, updatedAt: now() };
    const profileKey = key(`USER#${sub}`, 'PROFILE');
    const condition: Condition = request.expectedVersion === 0 ? { kind: 'notExists', key: profileKey } : { kind: 'version', key: profileKey, version: request.expectedVersion };
    await this.write({ puts: [{ item: { ...profileKey, entity: 'profile', ...profile }, condition }, this.mutationItem(sub, request.mutationId, profile)] });
    return profile;
  }

  async listCalendars(sub: string, pageLimit?: number, cursor?: string, teamId?: string): Promise<Page<CloudCalendar>> {
    const member = teamId ? await this.membership(sub, teamId) : undefined;
    const result = await this.storage.query(teamId ? `TEAM#${teamId}` : `USER#${sub}`, { prefix: 'CAL#', limit: limit(pageLimit), cursor });
    return { items: result.items.map(item => ({ ...(clean(item) as unknown as CloudCalendar), role: member?.role })), nextCursor: result.cursor };
  }

  async createCalendar(sub: string, input: { mutationId: string; name: string; color: string; timezone?: string; teamId?: string; assignedMemberSub?: string }): Promise<CloudCalendar> {
    const previous = await this.previousMutation(sub, input.mutationId);
    if (previous) return previous as CloudCalendar;
    let member: MembershipItem | undefined;
    if (input.teamId) {
      ({ member } = await this.team(sub, input.teamId));
      if (!MANAGE_ROLES.includes(member.role)) throw forbidden('Owner or manager role is required');
      if (!input.assignedMemberSub) throw badRequest('assignedMemberSub is required for team calendars');
      await this.membership(sub === input.assignedMemberSub ? sub : input.assignedMemberSub, input.teamId);
    }
    const id = randomUUID();
    const calendar: CloudCalendar = { id, name: input.name.slice(0, 100), color: input.color, timezone: input.timezone ?? DEFAULT_TZ, scope: input.teamId ? 'team' : 'private', teamId: input.teamId, assignedMemberSub: input.assignedMemberSub, role: member?.role, version: 1, updatedAt: now() };
    const meta: CalendarItem = { ...key(`CAL#${id}`, 'META'), entity: 'calendar', status: 'active', ownerSub: input.teamId ? undefined : sub, ...calendar };
    const listPk = input.teamId ? `TEAM#${input.teamId}` : `USER#${sub}`;
    const checks = member ? [this.membershipCheck(member)] : undefined;
    await this.write({ checks, puts: [
      { item: meta, condition: { kind: 'notExists', key: key(meta.PK, meta.SK) } },
      { item: { ...key(listPk, `CAL#${id}`), entity: 'calendar-list', ...calendar } },
      this.mutationItem(sub, input.mutationId, calendar),
    ] });
    return calendar;
  }

  async getCalendar(sub: string, calendarId: string): Promise<CloudCalendar> {
    const { calendar, member } = await this.calendar(sub, calendarId);
    return { ...(clean(calendar) as unknown as CloudCalendar), role: member?.role };
  }

  async updateCalendar(sub: string, calendarId: string, request: { mutationId: string; expectedVersion: number; value: { name: string; color: string; timezone: string } }): Promise<CloudCalendar> {
    const previous = await this.previousMutation(sub, request.mutationId);
    if (previous) return previous as CloudCalendar;
    const { calendar, member, team } = await this.calendar(sub, calendarId, true);
    if (calendar.scope === 'team' && !MANAGE_ROLES.includes(member!.role)) throw forbidden('Owner or manager role is required');
    const result: CloudCalendar = { ...(clean(calendar) as unknown as CloudCalendar), ...request.value, role: member?.role, version: request.expectedVersion + 1, updatedAt: now() };
    const listPk = calendar.teamId ? `TEAM#${calendar.teamId}` : `USER#${sub}`;
    await this.write({ checks: [...(member ? [this.membershipCheck(member)] : []), ...(team ? [{ kind: 'equals' as const, key: key(team.PK, team.SK), field: 'status', value: 'active' as const }] : [])], puts: [
      { item: { ...calendar, ...result, ownerSub: calendar.ownerSub }, condition: { kind: 'version', key: key(calendar.PK, calendar.SK), version: request.expectedVersion } },
      { item: { ...key(listPk, `CAL#${calendarId}`), entity: 'calendar-list', ...result } },
      this.mutationItem(sub, request.mutationId, result),
    ] });
    return result;
  }

  async deleteCalendar(sub: string, calendarId: string, request: { mutationId: string; expectedVersion: number }): Promise<{ id: string; deleted: true }> {
    const previous = await this.previousMutation(sub, request.mutationId);
    if (previous) return previous as { id: string; deleted: true };
    const { calendar, member, team } = await this.calendar(sub, calendarId, true);
    if (calendar.scope === 'team' && !MANAGE_ROLES.includes(member!.role)) throw forbidden('Owner or manager role is required');
    const result = { id: calendarId, deleted: true as const };
    const listPk = calendar.teamId ? `TEAM#${calendar.teamId}` : `USER#${sub}`;
    await this.write({ checks: [...(member ? [this.membershipCheck(member)] : []), ...(team ? [{ kind: 'equals' as const, key: key(team.PK, team.SK), field: 'status', value: 'active' as const }] : [])], puts: [
      { item: { ...calendar, status: 'deleted', version: request.expectedVersion + 1, updatedAt: now() }, condition: { kind: 'version', key: key(calendar.PK, calendar.SK), version: request.expectedVersion } },
      this.mutationItem(sub, request.mutationId, result),
    ], deletes: [{ key: key(listPk, `CAL#${calendarId}`) }] });
    return result;
  }

  async listDays(sub: string, calendarId: string, from: string, to: string, pageLimit?: number, cursor?: string): Promise<Page<CloudCalendarDay | CloudCalendarDayTombstone>> {
    requireDateRange(from, to);
    await this.calendar(sub, calendarId);
    const result = await this.storage.query(`CAL#${calendarId}`, { from: `DAY#${from}`, to: `DAY#${to}`, limit: limit(pageLimit), cursor });
    return { items: result.items.map(item => clean(item) as unknown as CloudCalendarDay), nextCursor: result.cursor };
  }

  async writeDay(sub: string, calendarId: string, date: string, request: unknown): Promise<CloudCalendarDay | CloudCalendarDayTombstone> {
    if (!isLocalDate(date)) throw badRequest('date is invalid');
    requireMutation(request);
    requireDayValue(request.value);
    const { calendar, member, team } = await this.calendar(sub, calendarId, true);
    const previous = await this.previousMutation(sub, request.mutationId);
    if (previous) return previous as CloudCalendarDay | CloudCalendarDayTombstone;
    const dayKey = key(`CAL#${calendarId}`, `DAY#${date}`);
    const versionCondition: Condition = request.expectedVersion === 0 ? { kind: 'notExists', key: dayKey } : { kind: 'version', key: dayKey, version: request.expectedVersion };
    const audit = { version: request.expectedVersion + 1, updatedAt: now(), updatedBy: sub };
    const result = request.value === null ? { date, deleted: true as const, ...audit } : { date, ...request.value, ...audit };
    const transaction: Transaction = { checks: [{ kind: 'version', key: key(calendar.PK, calendar.SK), version: calendar.version }, ...(member ? [this.membershipCheck(member)] : []), ...(team ? [{ kind: 'equals' as const, key: key(team.PK, team.SK), field: 'status', value: 'active' as const }] : [])], puts: [this.mutationItem(sub, request.mutationId, result)] };
    transaction.puts!.unshift({ item: { ...dayKey, entity: 'day', ...result }, condition: versionCondition });
    await this.write(transaction);
    return result;
  }

  async writeDaysBulk(sub: string, calendarId: string, input: unknown): Promise<Array<CloudCalendarDay | CloudCalendarDayTombstone>> {
    if (!isRecord(input) || typeof input.mutationId !== 'string' || !ID.test(input.mutationId) || !Array.isArray(input.edits)) throw badRequest('bulk mutation is malformed');
    const request = input as unknown as BulkDayRequest;
    if (!request.edits.length || request.edits.length > MAX_BULK) throw badRequest(`edits must contain 1-${MAX_BULK} items`);
    request.edits.forEach(edit => {
      if (!isRecord(edit) || typeof edit.date !== 'string' || !isLocalDate(edit.date) || !Number.isInteger(edit.expectedVersion) || edit.expectedVersion < 0 || !Object.hasOwn(edit, 'value')) throw badRequest('bulk edit is malformed');
      requireDayValue(edit.value);
    });
    if (new Set(request.edits.map(edit => edit.date)).size !== request.edits.length) throw badRequest('Duplicate dates are not allowed');
    const { calendar, member, team } = await this.calendar(sub, calendarId, true);
    const previous = await this.previousMutation(sub, request.mutationId);
    if (previous) return previous as Array<CloudCalendarDay | CloudCalendarDayTombstone>;
    const result = request.edits.map(edit => {
      const audit = { version: edit.expectedVersion + 1, updatedAt: now(), updatedBy: sub };
      return edit.value === null ? { date: edit.date, deleted: true as const, ...audit } : { date: edit.date, ...edit.value, ...audit };
    });
    const transaction: Transaction = { checks: [{ kind: 'version', key: key(calendar.PK, calendar.SK), version: calendar.version }, ...(member ? [this.membershipCheck(member)] : []), ...(team ? [{ kind: 'equals' as const, key: key(team.PK, team.SK), field: 'status', value: 'active' as const }] : [])], puts: [this.mutationItem(sub, request.mutationId, result)] };
    request.edits.forEach((edit, index) => {
      if (!DATE.test(edit.date)) throw badRequest('date is invalid');
      const dayKey = key(`CAL#${calendarId}`, `DAY#${edit.date}`);
      const condition: Condition = edit.expectedVersion === 0 ? { kind: 'notExists', key: dayKey } : { kind: 'version', key: dayKey, version: edit.expectedVersion };
      transaction.puts!.unshift({ item: { ...dayKey, entity: 'day', ...result[index] }, condition });
    });
    await this.write(transaction);
    return result;
  }

  async getPrivateDetails(sub: string, calendarId: string): Promise<CloudPrivateDetails> {
    const { calendar } = await this.calendar(sub, calendarId);
    if (calendar.scope !== 'private') throw forbidden('Private details are unavailable for team calendars');
    return this.readPrivateDetails(sub, calendarId);
  }

  async updatePrivateDetails(sub: string, calendarId: string, input: unknown): Promise<CloudPrivateDetails> {
    requireMutation(input);
    requirePrivateValue(input.value);
    const request = input;
    const { calendar } = await this.calendar(sub, calendarId);
    if (calendar.scope !== 'private') throw forbidden('Private details are unavailable for team calendars');
    const previous = await this.previousMutation(sub, request.mutationId);
    if (previous) return this.readPrivateDetails(sub, calendarId);
    const value = request.value as Omit<CloudPrivateDetails, 'calendarId' | 'version' | 'updatedAt'>;
    const current = await this.readPrivateDetails(sub, calendarId);
    const currentDays = new Map(current.days.map(day => [day.date, day]));
    const submittedDays = new Map(value.days.map(day => [day.date, day]));
    const comparable = (day: CloudPrivateDetails['days'][number]) => JSON.stringify({ note: day.note, overtimeHours: day.overtimeHours, leaveTypeId: day.leaveTypeId, leaveReason: day.leaveReason });
    const changedDates = new Set<string>();
    for (const [date, day] of submittedDays) if (!currentDays.has(date) || comparable(day) !== comparable(currentDays.get(date)!)) changedDates.add(date);
    for (const date of currentDays.keys()) if (!submittedDays.has(date)) changedDates.add(date);
    if (changedDates.size > MAX_PRIVATE_CHANGED_DAYS) throw badRequest(`private details can change at most ${MAX_PRIVATE_CHANGED_DAYS} dates per request`);
    const updatedAt = now();
    const resultDays = value.days.map(day => changedDates.has(day.date)
      ? { date: day.date, note: day.note, overtimeHours: day.overtimeHours, leaveTypeId: day.leaveTypeId, leaveReason: day.leaveReason, version: (currentDays.get(day.date)?.version ?? 0) + 1, updatedAt }
      : currentDays.get(day.date)!);
    const details: CloudPrivateDetails = { calendarId, payRate: value.payRate, leaveBalances: value.leaveBalances, days: resultDays, version: request.expectedVersion + 1, updatedAt };
    const detailsKey = key(`USER#${sub}`, `PRIVATE#${calendarId}#DETAILS`);
    const condition: Condition = request.expectedVersion === 0 ? { kind: 'notExists', key: detailsKey } : { kind: 'version', key: detailsKey, version: request.expectedVersion };
    const transaction: Transaction = { checks: [{ kind: 'version', key: key(calendar.PK, calendar.SK), version: calendar.version }], puts: [
      { item: { ...detailsKey, entity: 'private-details', calendarId, payRate: details.payRate, leaveBalances: details.leaveBalances, version: details.version, updatedAt }, condition },
      this.mutationItem(sub, request.mutationId, { kind: 'private-details' }),
    ], deletes: [] };
    for (const date of changedDates) {
      const rowKey = key(`USER#${sub}`, `PRIVATE#${calendarId}#DAY#${date}`);
      const old = currentDays.get(date);
      const next = resultDays.find(day => day.date === date);
      const rowCondition: Condition = old ? { kind: 'version', key: rowKey, version: old.version } : { kind: 'notExists', key: rowKey };
      if (next) transaction.puts!.push({ item: { ...rowKey, entity: 'private-day', ...next }, condition: rowCondition });
      else transaction.deletes!.push({ key: rowKey, condition: rowCondition });
    }
    await this.write(transaction);
    return details;
  }

  private async readPrivateDetails(sub: string, calendarId: string): Promise<CloudPrivateDetails> {
    const metadata = await this.storage.get(key(`USER#${sub}`, `PRIVATE#${calendarId}#DETAILS`), true);
    const days: CloudPrivateDetails['days'] = [];
    let cursor: string | undefined;
    do {
      const page = await this.storage.query(`USER#${sub}`, { prefix: `PRIVATE#${calendarId}#DAY#`, limit: 100, cursor });
      days.push(...page.items.map(item => clean(item) as unknown as CloudPrivateDetails['days'][number]));
      cursor = page.cursor;
      if (days.length > MAX_PRIVATE_DAYS) throw new Error('Stored private history exceeds its configured bound');
    } while (cursor);
    return metadata ? {
      calendarId,
      payRate: metadata.payRate as number | undefined,
      leaveBalances: metadata.leaveBalances as Record<string, number>,
      days,
      version: metadata.version as number,
      updatedAt: metadata.updatedAt as string,
    } : { calendarId, leaveBalances: {}, days, version: 0, updatedAt: now() };
  }

  async listShiftTypes(sub: string, calendarId: string, pageLimit?: number, cursor?: string): Promise<Page<CloudShiftType>> {
    await this.calendar(sub, calendarId);
    const result = await this.storage.query(`CAL#${calendarId}`, { prefix: 'TYPE#', limit: limit(pageLimit), cursor });
    return { items: result.items.map(item => clean(item) as unknown as CloudShiftType), nextCursor: result.cursor };
  }

  async putShiftType(sub: string, calendarId: string, code: string, request: { mutationId: string; expectedVersion: number; value: Omit<CloudShiftType, 'code' | 'version' | 'updatedAt'> }): Promise<CloudShiftType> {
    requireId(code, 'code');
    const previous = await this.previousMutation(sub, request.mutationId);
    if (previous) return previous as CloudShiftType;
    const { calendar, member, team } = await this.calendar(sub, calendarId, true);
    const result: CloudShiftType = { code, ...request.value, version: request.expectedVersion + 1, updatedAt: now() };
    const typeKey = key(`CAL#${calendarId}`, `TYPE#${code}`);
    const condition: Condition = request.expectedVersion === 0 ? { kind: 'notExists', key: typeKey } : { kind: 'version', key: typeKey, version: request.expectedVersion };
    await this.write({ checks: [{ kind: 'version', key: key(calendar.PK, calendar.SK), version: calendar.version }, ...(member ? [this.membershipCheck(member)] : []), ...(team ? [{ kind: 'equals' as const, key: key(team.PK, team.SK), field: 'status', value: 'active' as const }] : [])], puts: [{ item: { ...typeKey, entity: 'shift-type', ...result }, condition }, this.mutationItem(sub, request.mutationId, result)] });
    return result;
  }

  async deleteShiftType(sub: string, calendarId: string, code: string, request: { mutationId: string; expectedVersion: number }): Promise<{ code: string; deleted: true }> {
    const previous = await this.previousMutation(sub, request.mutationId);
    if (previous) return previous as { code: string; deleted: true };
    const { calendar, member, team } = await this.calendar(sub, calendarId, true);
    const result = { code, deleted: true as const };
    const typeKey = key(`CAL#${calendarId}`, `TYPE#${code}`);
    await this.write({ checks: [{ kind: 'version', key: key(calendar.PK, calendar.SK), version: calendar.version }, ...(member ? [this.membershipCheck(member)] : []), ...(team ? [{ kind: 'equals' as const, key: key(team.PK, team.SK), field: 'status', value: 'active' as const }] : [])], puts: [this.mutationItem(sub, request.mutationId, result)], deletes: [{ key: typeKey, condition: { kind: 'version', key: typeKey, version: request.expectedVersion } }] });
    return result;
  }

  async listTeams(sub: string, pageLimit?: number, cursor?: string): Promise<Page<CloudTeam>> {
    const result = await this.storage.query(`USER#${sub}`, { prefix: 'TEAM#', limit: limit(pageLimit), cursor });
    const items: CloudTeam[] = [];
    for (let offset = 0; offset < result.items.length; offset += 10) {
      const batch = result.items.slice(offset, offset + 10);
      const resolved = await Promise.all(batch.map(async listing => {
        const team = await this.storage.get(key(`TEAM#${listing.id}`, 'META'), true) as TeamItem | undefined;
        return team?.status === 'active' ? { ...(clean(team) as unknown as CloudTeam), role: listing.role as TeamRole } : undefined;
      }));
      items.push(...resolved.filter((team): team is CloudTeam => Boolean(team)));
    }
    return { items, nextCursor: result.cursor };
  }

  async createTeam(sub: string, input: { mutationId: string; name: string; timezone?: string; displayName?: string }): Promise<CloudTeam> {
    const previous = await this.previousMutation(sub, input.mutationId);
    if (previous) return previous as CloudTeam;
    const id = randomUUID();
    const created = now();
    const team: CloudTeam = { id, name: input.name.slice(0, 100), timezone: input.timezone ?? DEFAULT_TZ, ownerSub: sub, role: 'owner', version: 1, updatedAt: created };
    const member: MembershipItem = { ...key(`TEAM#${id}`, `MEMBER#${sub}`), entity: 'membership', teamId: id, sub, displayName: input.displayName ?? '', role: 'owner', joinedAt: created };
    await this.write({ puts: [
      { item: { ...key(`TEAM#${id}`, 'META'), entity: 'team', status: 'active', ...team } as TeamItem, condition: { kind: 'notExists', key: key(`TEAM#${id}`, 'META') } },
      { item: member },
      { item: { ...key(`USER#${sub}`, `TEAM#${id}`), entity: 'team-list', ...team } },
      this.mutationItem(sub, input.mutationId, team),
    ] });
    return team;
  }

  async getTeam(sub: string, teamId: string): Promise<CloudTeam> {
    const { team, member } = await this.team(sub, teamId);
    return { ...(clean(team) as unknown as CloudTeam), role: member.role };
  }

  async updateTeam(sub: string, teamId: string, request: { mutationId: string; expectedVersion: number; value: { name: string; timezone: string } }): Promise<CloudTeam> {
    const previous = await this.previousMutation(sub, request.mutationId);
    if (previous) return previous as CloudTeam;
    const { team, member } = await this.team(sub, teamId, true);
    const result: CloudTeam = { ...(clean(team) as unknown as CloudTeam), ...request.value, role: 'owner', version: request.expectedVersion + 1, updatedAt: now() };
    await this.write({ checks: [this.membershipCheck(member)], puts: [
      { item: { ...team, ...result, status: 'active' }, condition: { kind: 'version', key: key(team.PK, team.SK), version: request.expectedVersion } },
      { item: { ...key(`USER#${sub}`, `TEAM#${teamId}`), entity: 'team-list', ...result } },
      this.mutationItem(sub, request.mutationId, result),
    ] });
    return result;
  }

  async deleteTeam(sub: string, teamId: string, request: { mutationId: string; expectedVersion: number }): Promise<{ id: string; deleted: true }> {
    const previous = await this.previousMutation(sub, request.mutationId);
    if (previous) return previous as { id: string; deleted: true };
    const { team, member } = await this.team(sub, teamId, true);
    const result = { id: teamId, deleted: true as const };
    await this.write({ checks: [this.membershipCheck(member)], puts: [
      { item: { ...team, status: 'deleted', version: request.expectedVersion + 1, updatedAt: now() }, condition: { kind: 'version', key: key(team.PK, team.SK), version: request.expectedVersion } },
      this.mutationItem(sub, request.mutationId, result),
    ] });
    return result;
  }

  async listMembers(sub: string, teamId: string, pageLimit?: number, cursor?: string): Promise<Page<CloudMember>> {
    await this.team(sub, teamId);
    const result = await this.storage.query(`TEAM#${teamId}`, { prefix: 'MEMBER#', limit: limit(pageLimit), cursor });
    return { items: result.items.map(item => clean(item) as unknown as CloudMember), nextCursor: result.cursor };
  }

  async changeMemberRole(sub: string, teamId: string, targetSub: string, mutationId: string, role: Exclude<TeamRole, 'owner'>): Promise<CloudMember> {
    if (!['manager', 'member', 'viewer'].includes(role)) throw badRequest('role is invalid');
    const previous = await this.previousMutation(sub, mutationId);
    if (previous) return previous as CloudMember;
    const { team, member: owner } = await this.team(sub, teamId, true);
    const target = await this.membership(targetSub, teamId);
    if (target.role === 'owner') throw forbidden('Transfer ownership instead');
    const result = { sub: targetSub, displayName: target.displayName, role, joinedAt: target.joinedAt };
    await this.write({ checks: [this.membershipCheck(owner)], puts: [
      { item: { ...target, role }, condition: { kind: 'equals', key: key(target.PK, target.SK), field: 'role', value: target.role } },
      { item: { ...key(`USER#${targetSub}`, `TEAM#${teamId}`), entity: 'team-list', ...(clean(team) as object), role } },
      this.mutationItem(sub, mutationId, result),
    ] });
    return result;
  }

  async removeMember(sub: string, teamId: string, targetSub: string, mutationId: string): Promise<{ sub: string; removed: true }> {
    const previous = await this.previousMutation(sub, mutationId);
    if (previous) return previous as { sub: string; removed: true };
    const { member: actor } = await this.team(sub, teamId);
    const target = await this.membership(targetSub, teamId);
    if (target.role === 'owner') throw forbidden('Transfer ownership before leaving or removal');
    if (sub !== targetSub && actor.role !== 'owner') throw forbidden('Team owner role is required');
    const result = { sub: targetSub, removed: true as const };
    await this.write({ checks: sub === targetSub ? undefined : [this.membershipCheck(actor)], puts: [this.mutationItem(sub, mutationId, result)], deletes: [
      { key: key(`TEAM#${teamId}`, `MEMBER#${targetSub}`), condition: { kind: 'equals', key: key(`TEAM#${teamId}`, `MEMBER#${targetSub}`), field: 'role', value: target.role } },
      { key: key(`USER#${targetSub}`, `TEAM#${teamId}`) },
    ] });
    return result;
  }

  async transferOwnership(sub: string, teamId: string, mutationId: string, expectedVersion: number, targetSub: string): Promise<CloudTeam> {
    const previous = await this.previousMutation(sub, mutationId);
    if (previous) return previous as CloudTeam;
    const { team, member: owner } = await this.team(sub, teamId, true);
    const target = await this.membership(targetSub, teamId);
    if (targetSub === sub) throw badRequest('Target already owns the team');
    const updatedAt = now();
    const result = { ...(clean(team) as unknown as CloudTeam), ownerSub: targetSub, role: 'manager' as TeamRole, version: expectedVersion + 1, updatedAt };
    await this.write({ puts: [
      { item: { ...team, ownerSub: targetSub, version: expectedVersion + 1, updatedAt }, condition: { kind: 'version', key: key(team.PK, team.SK), version: expectedVersion } },
      { item: { ...owner, role: 'manager' }, condition: { kind: 'equals', key: key(owner.PK, owner.SK), field: 'role', value: 'owner' } },
      { item: { ...target, role: 'owner' }, condition: { kind: 'equals', key: key(target.PK, target.SK), field: 'role', value: target.role } },
      { item: { ...key(`USER#${sub}`, `TEAM#${teamId}`), entity: 'team-list', ...result, role: 'manager' } },
      { item: { ...key(`USER#${targetSub}`, `TEAM#${teamId}`), entity: 'team-list', ...result, role: 'owner' } },
      this.mutationItem(sub, mutationId, result),
    ] });
    return result;
  }

  async createInvite(sub: string, teamId: string, input: { mutationId: string; role?: Exclude<TeamRole, 'owner'>; expiresAt?: string }): Promise<InvitationCreated> {
    const previous = await this.previousMutation(sub, input.mutationId);
    if (previous) throw conflict('Invitation was already created; its token is only returned once');
    const { member: owner } = await this.team(sub, teamId, true);
    const expiresAtIso = input.expiresAt ?? new Date(Date.now() + 7 * 86400000).toISOString();
    if (Date.parse(expiresAtIso) <= Date.now()) throw badRequest('expiresAt must be in the future');
    const secret = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(secret);
    const id = randomUUID();
    const role = input.role ?? 'member';
    if (!['manager', 'member', 'viewer'].includes(role)) throw badRequest('role is invalid');
    const expiresAt = Math.floor(Date.parse(expiresAtIso) / 1000);
    const invite: InviteItem = { ...key(`TEAM#${teamId}`, `INVITE#${tokenHash}`), entity: 'invite', id, teamId, role, expiresAt, expiresAtIso, status: 'open', version: 1, createdBy: sub };
    const result = { id, teamId, role, expiresAt: expiresAtIso, token: `${teamId}.${secret}` };
    await this.write({ checks: [this.membershipCheck(owner)], puts: [
      { item: invite, condition: { kind: 'notExists', key: key(invite.PK, invite.SK) } },
      { item: { ...key(`TEAM#${teamId}`, `INVITE_ID#${id}`), entity: 'invite-lookup', tokenHash }, condition: { kind: 'notExists', key: key(`TEAM#${teamId}`, `INVITE_ID#${id}`) } },
      this.mutationItem(sub, input.mutationId, { id, teamId, role, expiresAt: expiresAtIso }),
    ] });
    return result;
  }

  async revokeInvite(sub: string, teamId: string, inviteId: string, mutationId: string): Promise<{ id: string; revoked: true }> {
    const previous = await this.previousMutation(sub, mutationId);
    if (previous) return previous as { id: string; revoked: true };
    const { member: owner } = await this.team(sub, teamId, true);
    const lookup = await this.storage.get(key(`TEAM#${teamId}`, `INVITE_ID#${inviteId}`), true);
    const invite = lookup?.tokenHash ? await this.storage.get(key(`TEAM#${teamId}`, `INVITE#${lookup.tokenHash}`), true) as InviteItem | undefined : undefined;
    if (!invite) throw notFound('Invitation not found');
    const result = { id: inviteId, revoked: true as const };
    await this.write({ checks: [this.membershipCheck(owner)], puts: [{ item: { ...invite, status: 'revoked', version: invite.version + 1 }, condition: { kind: 'version', key: key(invite.PK, invite.SK), version: invite.version } }, this.mutationItem(sub, mutationId, result)] });
    return result;
  }

  async redeemInvite(sub: string, mutationId: string, token: string, displayName = ''): Promise<CloudTeam> {
    const previous = await this.previousMutation(sub, mutationId);
    if (previous) return previous as CloudTeam;
    const [teamId, secret, extra] = token.split('.');
    if (!teamId || !secret || extra) throw badRequest('Invitation token is invalid');
    requireId(teamId, 'teamId');
    const inviteKey = key(`TEAM#${teamId}`, `INVITE#${hashToken(secret)}`);
    const invite = await this.storage.get(inviteKey, true) as InviteItem | undefined;
    if (!invite || invite.status !== 'open' || invite.expiresAt <= Math.floor(Date.now() / 1000)) throw conflict('Invitation is expired, revoked, or already used');
    const team = await this.storage.get(key(`TEAM#${teamId}`, 'META'), true) as TeamItem | undefined;
    if (!team || team.status !== 'active') throw notFound('Team not found');
    const joinedAt = now();
    const result: CloudTeam = { ...(clean(team) as unknown as CloudTeam), role: invite.role };
    await this.write({ checks: [{ kind: 'equals', key: key(team.PK, team.SK), field: 'status', value: 'active' }], puts: [
      { item: { ...invite, status: 'redeemed', version: invite.version + 1, redeemedBy: sub, redeemedAt: joinedAt }, condition: { kind: 'version', key: inviteKey, version: invite.version } },
      { item: { ...key(`TEAM#${teamId}`, `MEMBER#${sub}`), entity: 'membership', teamId, sub, displayName, role: invite.role, joinedAt }, condition: { kind: 'notExists', key: key(`TEAM#${teamId}`, `MEMBER#${sub}`) } },
      { item: { ...key(`USER#${sub}`, `TEAM#${teamId}`), entity: 'team-list', ...result }, condition: { kind: 'notExists', key: key(`USER#${sub}`, `TEAM#${teamId}`) } },
      this.mutationItem(sub, mutationId, result),
    ] });
    return result;
  }

  async roster(sub: string, teamId: string, from: string, to: string, pageLimit?: number, cursor?: string): Promise<Page<TeamRosterDay>> {
    requireDateRange(from, to);
    await this.team(sub, teamId);
    const requested = limit(pageLimit);
    let state: { calendarId?: string; dayCursor?: string } = {};
    if (cursor) {
      try { state = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); }
      catch { throw badRequest('cursor is invalid'); }
    }
    const rows: TeamRosterDay[] = [];
    let calendarId = state.calendarId;
    let dayCursor = state.dayCursor;
    let steps = 0;
    while (rows.length < requested && steps++ < 25) {
      if (!calendarId) {
        const listing = await this.storage.query(`TEAM#${teamId}`, { prefix: 'CAL#', limit: 1 });
        calendarId = listing.items[0]?.id as string | undefined;
        if (!calendarId) break;
      }
      const calendar = await this.storage.get(key(`CAL#${calendarId}`, 'META'), true) as CalendarItem | undefined;
      if (!calendar || calendar.status !== 'active' || calendar.teamId !== teamId) throw conflict('Roster calendar changed; refresh the roster');
      const memberItem = calendar.assignedMemberSub ? await this.storage.get(key(`TEAM#${teamId}`, `MEMBER#${calendar.assignedMemberSub}`), true) as MembershipItem | undefined : undefined;
      const days = await this.storage.query(`CAL#${calendarId}`, { from: `DAY#${from}`, to: `DAY#${to}`, limit: requested - rows.length, cursor: dayCursor });
      rows.push(...days.items.filter(day => day.deleted !== true).map(day => ({ ...(clean(day) as unknown as CloudCalendarDay), calendarId: calendar!.id, memberSub: calendar!.assignedMemberSub ?? '', memberDisplayName: memberItem?.displayName ?? '' })));
      if (days.cursor) return { items: rows, nextCursor: Buffer.from(JSON.stringify({ calendarId, dayCursor: days.cursor })).toString('base64url') };
      const nextListing = await this.storage.query(`TEAM#${teamId}`, { prefix: 'CAL#', limit: 1, cursor: encodeStorageCursor({ PK: `TEAM#${teamId}`, SK: `CAL#${calendarId}` }) });
      calendarId = nextListing.items[0]?.id as string | undefined;
      dayCursor = undefined;
      if (!calendarId) break;
    }
    return { items: rows, nextCursor: calendarId ? Buffer.from(JSON.stringify({ calendarId })).toString('base64url') : undefined };
  }

  private async write(transaction: Transaction): Promise<void> {
    try {
      await this.storage.transact(transaction);
    } catch (error) {
      if (error && typeof error === 'object' && ('name' in error) && (error.name === 'TransactionCanceledException' || error.name === 'ConditionalCheckFailedException')) throw conflict();
      throw error;
    }
  }
}
