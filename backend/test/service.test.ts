import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpError } from '../src/errors.js';
import { CalendarService } from '../src/service.js';
import { MemoryStorage } from './memoryStorage.js';

const team = (id: string, owner = 'owner') => ({ PK: `TEAM#${id}`, SK: 'META', entity: 'team', status: 'active', id, name: id, timezone: 'Asia/Kuala_Lumpur', ownerSub: owner, version: 1, updatedAt: '2026-01-01T00:00:00.000Z' });
const member = (teamId: string, sub: string, role: string) => ({ PK: `TEAM#${teamId}`, SK: `MEMBER#${sub}`, entity: 'membership', teamId, sub, displayName: sub, role, joinedAt: '2026-01-01T00:00:00.000Z' });
const calendar = (id: string, fields: Record<string, unknown>) => ({ PK: `CAL#${id}`, SK: 'META', entity: 'calendar', status: 'active', id, name: id, color: '#000000', timezone: 'Asia/Kuala_Lumpur', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', ...fields });

async function rejectsCode(action: () => Promise<unknown>, status: number) {
  await assert.rejects(action, (error: unknown) => error instanceof HttpError && error.status === status);
}

test('private details and calendars cannot be read across users or via a team role', async () => {
  const storage = new MemoryStorage();
  storage.seed(
    calendar('private-a', { scope: 'private', ownerSub: 'alice' }),
    { PK: 'USER#alice', SK: 'PRIVATE#private-a#DETAILS', entity: 'private-details', calendarId: 'private-a', payRate: 50, leaveBalances: { annual: 10 }, days: [{ date: '2026-01-02', note: 'private' }], version: 1, updatedAt: '2026-01-01T00:00:00.000Z' },
    team('team-a'), member('team-a', 'bob', 'manager'),
  );
  const service = new CalendarService(storage);
  await rejectsCode(() => service.getCalendar('bob', 'private-a'), 403);
  await rejectsCode(() => service.getPrivateDetails('bob', 'private-a'), 403);
  assert.equal((await service.getPrivateDetails('alice', 'private-a')).payRate, 50);
});

test('team roles constrain schedule writes to the current authoritative membership', async () => {
  const storage = new MemoryStorage();
  storage.seed(
    team('team-a'),
    member('team-a', 'member-a', 'member'),
    member('team-a', 'member-b', 'member'),
    member('team-a', 'viewer', 'viewer'),
    member('team-a', 'manager', 'manager'),
    calendar('schedule-b', { scope: 'team', teamId: 'team-a', assignedMemberSub: 'member-b' }),
  );
  const service = new CalendarService(storage);
  await rejectsCode(() => service.writeDay('member-a', 'schedule-b', '2026-02-01', { mutationId: 'm1', expectedVersion: 0, value: { shiftCode: 'D' } }), 403);
  await rejectsCode(() => service.writeDay('viewer', 'schedule-b', '2026-02-01', { mutationId: 'm2', expectedVersion: 0, value: { shiftCode: 'D' } }), 403);
  const written = await service.writeDay('manager', 'schedule-b', '2026-02-01', { mutationId: 'm3', expectedVersion: 0, value: { shiftCode: 'D' } });
  assert.equal('shiftCode' in written && written.shiftCode, 'D');

  storage.items.delete('TEAM#team-a\nMEMBER#manager');
  await rejectsCode(() => service.writeDay('manager', 'schedule-b', '2026-02-02', { mutationId: 'm4', expectedVersion: 0, value: { shiftCode: 'N' } }), 403);
});

test('stale writes conflict while an identical mutation retry is idempotent', async () => {
  const storage = new MemoryStorage();
  storage.seed(calendar('private-a', { scope: 'private', ownerSub: 'alice' }));
  const service = new CalendarService(storage);
  const request = { mutationId: 'same-request', expectedVersion: 0, value: { shiftCode: 'D' } };
  const first = await service.writeDay('alice', 'private-a', '2026-03-01', request);
  const retry = await service.writeDay('alice', 'private-a', '2026-03-01', request);
  assert.deepEqual(retry, first);
  await rejectsCode(() => service.writeDay('alice', 'private-a', '2026-03-01', { mutationId: 'stale-request', expectedVersion: 0, value: { shiftCode: 'N' } }), 409);
});

test('day deletion preserves a tombstone version and prevents ABA recreation', async () => {
  const storage = new MemoryStorage();
  storage.seed(calendar('private-a', { scope: 'private', ownerSub: 'alice' }));
  const service = new CalendarService(storage);
  await service.writeDay('alice', 'private-a', '2026-03-02', { mutationId: 'create-day', expectedVersion: 0, value: { shiftCode: 'D' } });
  const deleted = await service.writeDay('alice', 'private-a', '2026-03-02', { mutationId: 'delete-day', expectedVersion: 1, value: null });
  assert.equal('deleted' in deleted && deleted.deleted, true);
  assert.equal(deleted.version, 2);
  const page = await service.listDays('alice', 'private-a', '2026-03-01', '2026-03-31');
  assert.equal('deleted' in page.items[0] && page.items[0].deleted, true);
  await rejectsCode(() => service.writeDay('alice', 'private-a', '2026-03-02', { mutationId: 'aba-day', expectedVersion: 0, value: { shiftCode: 'N' } }), 409);
  const recreated = await service.writeDay('alice', 'private-a', '2026-03-02', { mutationId: 'recreate-day', expectedVersion: 2, value: { shiftCode: 'N' } });
  assert.equal(recreated.version, 3);
});

test('idempotent retries reauthorize current calendar access', async () => {
  const storage = new MemoryStorage();
  storage.seed(team('team-a'), member('team-a', 'manager', 'manager'), calendar('schedule-a', { scope: 'team', teamId: 'team-a', assignedMemberSub: 'worker' }));
  const service = new CalendarService(storage);
  const request = { mutationId: 'bulk-retry', edits: [{ date: '2026-04-01', expectedVersion: 0, value: { shiftCode: 'D' } }] };
  await service.writeDaysBulk('manager', 'schedule-a', request);
  storage.items.delete('TEAM#team-a\nMEMBER#manager');
  await rejectsCode(() => service.writeDaysBulk('manager', 'schedule-a', request), 403);

  storage.seed(calendar('private-a', { scope: 'private', ownerSub: 'alice' }));
  const privateRequest = { mutationId: 'private-retry', expectedVersion: 0, value: { leaveBalances: {}, days: [] } };
  await service.updatePrivateDetails('alice', 'private-a', privateRequest);
  storage.seed(calendar('private-a', { scope: 'private', ownerSub: 'alice', status: 'deleted' }));
  await rejectsCode(() => service.updatePrivateDetails('alice', 'private-a', privateRequest), 404);
});

test('day and private-detail payloads reject malformed or oversized input', async () => {
  const storage = new MemoryStorage();
  storage.seed(calendar('private-a', { scope: 'private', ownerSub: 'alice' }));
  const service = new CalendarService(storage);
  await rejectsCode(() => service.writeDay('alice', 'private-a', '2026-05-01', { mutationId: 'bad-day', expectedVersion: 0, value: { shiftCode: 'D', note: 'leak' } }), 400);
  await rejectsCode(() => service.writeDaysBulk('alice', 'private-a', { mutationId: 'bad-bulk', edits: 'not-an-array' }), 400);
  const oversized = Array.from({ length: 200 }, (_, index) => ({ date: new Date(Date.UTC(2020, 0, index + 1)).toISOString().slice(0, 10), note: 'x'.repeat(1600) }));
  await rejectsCode(() => service.updatePrivateDetails('alice', 'private-a', { mutationId: 'too-large', expectedVersion: 0, value: { leaveBalances: {}, days: oversized } }), 400);
});

test('private history uses per-day rows and a one-note edit writes only that row', async () => {
  const storage = new MemoryStorage();
  const history = Array.from({ length: 365 }, (_, index) => ({ date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10), note: 'original', version: 1, updatedAt: '2026-01-01T00:00:00.000Z' }));
  storage.seed(
    calendar('private-a', { scope: 'private', ownerSub: 'alice' }),
    { PK: 'USER#alice', SK: 'PRIVATE#private-a#DETAILS', entity: 'private-details', calendarId: 'private-a', leaveBalances: {}, version: 1, updatedAt: '2026-01-01T00:00:00.000Z' },
    ...history.map(day => ({ PK: 'USER#alice', SK: `PRIVATE#private-a#DAY#${day.date}`, entity: 'private-day', ...day })),
  );
  const service = new CalendarService(storage);
  assert.equal((await service.getPrivateDetails('alice', 'private-a')).days.length, 365);
  const submitted = history.map((day, index) => index === 100 ? { ...day, note: 'changed' } : day);
  const saved = await service.updatePrivateDetails('alice', 'private-a', { mutationId: 'one-note', expectedVersion: 1, value: { leaveBalances: {}, days: submitted } });
  assert.equal(saved.days.length, 365);
  assert.equal(saved.days[100].note, 'changed');
  const transaction = storage.transactions.at(-1)!;
  const privateDayWrites = transaction.puts?.filter(write => write.item.entity === 'private-day') ?? [];
  assert.equal(privateDayWrites.length, 1);
  const mutation = transaction.puts?.find(write => write.item.entity === 'mutation')?.item;
  assert.deepEqual(mutation?.result, { kind: 'private-details' });
  assert.equal(JSON.stringify(mutation).includes('original'), false);
});

test('bulk calendar edits are bounded to eight days', async () => {
  const storage = new MemoryStorage();
  storage.seed(calendar('private-a', { scope: 'private', ownerSub: 'alice' }));
  const service = new CalendarService(storage);
  const edits = Array.from({ length: 9 }, (_, index) => ({ date: `2026-06-${String(index + 1).padStart(2, '0')}`, expectedVersion: 0, value: { shiftCode: 'D' } }));
  await rejectsCode(() => service.writeDaysBulk('alice', 'private-a', { mutationId: 'nine-days', edits }), 400);
  const saved = await service.writeDaysBulk('alice', 'private-a', { mutationId: 'eight-days', edits: edits.slice(0, 8) });
  assert.equal(saved.length, 8);
});

test('private detail transactions are bounded to four changed dates', async () => {
  const storage = new MemoryStorage();
  storage.seed(calendar('private-a', { scope: 'private', ownerSub: 'alice' }));
  const service = new CalendarService(storage);
  const days = Array.from({ length: 5 }, (_, index) => ({ date: `2026-07-${String(index + 1).padStart(2, '0')}`, note: 'note' }));
  await rejectsCode(() => service.updatePrivateDetails('alice', 'private-a', { mutationId: 'five-private', expectedVersion: 0, value: { leaveBalances: {}, days } }), 400);
  const saved = await service.updatePrivateDetails('alice', 'private-a', { mutationId: 'four-private', expectedVersion: 0, value: { leaveBalances: {}, days: days.slice(0, 4) } });
  assert.equal(saved.days.length, 4);
  assert.equal(storage.transactions.at(-1)?.puts?.filter(write => write.item.entity === 'private-day').length, 4);
});

test('invitation redemption is single-use and creates mirrored membership atomically', async () => {
  const storage = new MemoryStorage();
  storage.seed(team('team-a'), member('team-a', 'owner', 'owner'));
  const service = new CalendarService(storage);
  const invite = await service.createInvite('owner', 'team-a', { mutationId: 'invite-create', role: 'member', expiresAt: '2099-01-01T00:00:00.000Z' });
  const joined = await service.redeemInvite('alice', 'invite-redeem-a', invite.token, 'Alice');
  assert.equal(joined.role, 'member');
  assert.equal((await storage.get({ PK: 'TEAM#team-a', SK: 'MEMBER#alice' }))?.role, 'member');
  assert.equal((await storage.get({ PK: 'USER#alice', SK: 'TEAM#team-a' }))?.role, 'member');
  await rejectsCode(() => service.redeemInvite('bob', 'invite-redeem-b', invite.token, 'Bob'), 409);
  assert.equal(await storage.get({ PK: 'TEAM#team-a', SK: 'MEMBER#bob' }), undefined);
});

test('owner cannot leave until ownership is atomically transferred', async () => {
  const storage = new MemoryStorage();
  storage.seed(team('team-a'), member('team-a', 'owner', 'owner'), member('team-a', 'alice', 'member'));
  const service = new CalendarService(storage);
  await rejectsCode(() => service.removeMember('owner', 'team-a', 'owner', 'remove-owner'), 403);
  await service.transferOwnership('owner', 'team-a', 'transfer-owner', 1, 'alice');
  assert.equal((await storage.get({ PK: 'TEAM#team-a', SK: 'MEMBER#alice' }))?.role, 'owner');
  assert.equal((await storage.get({ PK: 'TEAM#team-a', SK: 'MEMBER#owner' }))?.role, 'manager');
});
