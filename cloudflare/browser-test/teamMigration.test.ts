import { describe, expect, it } from 'vitest';
import { parseTeamImport, safeExportFilename, serializeCsv } from '../../utils/teamMigration';

describe('team migration files', () => {
  it('parses bounded CSV and versioned JSON', () => {
    expect(parseTeamImport('memberSub,calendarId,date,shiftCode\nmember-1,calendar-1,2026-09-17,m')).toEqual([
      { memberSub: 'member-1', calendarId: 'calendar-1', date: '2026-09-17', shiftCode: 'M' },
    ]);
    expect(parseTeamImport(JSON.stringify({ schema: 'shiftcalendar.team-import.v1', rows: [
      { memberSub: 'member-1', calendarId: 'calendar-1', date: '2026-09-17', shiftCode: 'A' },
    ] }))).toHaveLength(1);
  });

  it('rejects unknown fields and oversized batches', () => {
    expect(() => parseTeamImport('[{"memberSub":"m","calendarId":"c","date":"2026-09-17","shiftCode":"M","admin":true}]')).toThrow('unknown field');
    expect(() => parseTeamImport('memberSub,calendarId,date,shiftCode\nm,c,2026-09-17,M\nm,c,2026-09-18,A\nm,c,2026-09-19,N')).toThrow('at most 2');
    expect(() => parseTeamImport('memberSub,calendarId,date,shiftCode\nm,c,2026-09-17,M,ignored')).toThrow('exactly 4');
  });

  it('neutralizes spreadsheet formulas and creates safe filenames', () => {
    const csv = serializeCsv([{ member: '=2+2', note: 'a,"b"' }], ['member', 'note']);
    expect(csv).toContain("\"'=2+2\"");
    expect(csv).toContain('"a,""b"""');
    expect(safeExportFilename('roster', 'csv', new Date('2026-09-14T00:00:00Z'))).toBe('shiftcalendar-roster-2026-09-14.csv');
  });
});
