import type { CloudImportRow } from '../shared/cloudTypes';

export const MAX_IMPORT_SOURCE_BYTES = 64 * 1024;
export const MAX_IMPORT_ROWS = 2;
const headers = ['memberSub', 'calendarId', 'date', 'shiftCode'] as const;

function parseCsvRecords(source: string): string[][] {
  const records: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell); records.push(row); row = []; cell = ''; }
    else if (char !== '\r') cell += char;
  }
  if (quoted) throw new Error('CSV contains an unfinished quoted value.');
  if (cell || row.length) { row.push(cell); records.push(row); }
  return records.filter(record => record.some(value => value.trim()));
}

function validateRows(value: unknown): CloudImportRow[] {
  if (!Array.isArray(value) || value.length < 1) throw new Error('Add at least one import row.');
  if (value.length > MAX_IMPORT_ROWS) throw new Error(`Import at most ${MAX_IMPORT_ROWS} rows at a time.`);
  return value.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error(`Row ${index + 1} must be an object.`);
    const record = candidate as Record<string, unknown>;
    if (Object.keys(record).some(key => !headers.includes(key as typeof headers[number]))) throw new Error(`Row ${index + 1} has an unknown field.`);
    const row = Object.fromEntries(headers.map(key => [key, typeof record[key] === 'string' ? record[key].trim() : ''])) as unknown as CloudImportRow;
    if (headers.some(key => !row[key])) throw new Error(`Row ${index + 1} is missing a required field.`);
    return { ...row, shiftCode: row.shiftCode.toUpperCase() };
  });
}

export function parseTeamImport(source: string): CloudImportRow[] {
  if (new TextEncoder().encode(source).byteLength > MAX_IMPORT_SOURCE_BYTES) throw new Error('Import source exceeds 64 KiB.');
  const trimmed = source.trim(); if (!trimmed) throw new Error('Paste CSV or JSON first.');
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed: unknown; try { parsed = JSON.parse(trimmed); } catch { throw new Error('JSON is not valid.'); }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const document = parsed as Record<string, unknown>;
      if (document.schema !== 'shiftcalendar.team-import.v1' || Object.keys(document).some(key => !['schema', 'rows'].includes(key)))
        throw new Error('JSON must use the shiftcalendar.team-import.v1 schema.');
      parsed = document.rows;
    }
    return validateRows(parsed);
  }
  const records = parseCsvRecords(trimmed);
  if (!records.length || records[0].map(value => value.trim()).join(',') !== headers.join(','))
    throw new Error(`CSV headers must be ${headers.join(',')}.`);
  if (records.slice(1).some(record => record.length !== headers.length)) throw new Error('Every CSV row must contain exactly 4 fields.');
  return validateRows(records.slice(1).map(record => Object.fromEntries(headers.map((key, index) => [key, record[index] ?? '']))));
}

function safeCsvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function serializeCsv<T extends object>(items: T[], columns: readonly (keyof T)[]): string {
  return [columns.map(safeCsvCell).join(','), ...items.map(item => columns.map(column => safeCsvCell(item[column])).join(','))].join('\r\n');
}

export function safeExportFilename(kind: 'roster' | 'requests' | 'audit', extension: 'csv' | 'json', day = new Date()): string {
  return `shiftcalendar-${kind}-${day.toISOString().slice(0, 10)}.${extension}`;
}
