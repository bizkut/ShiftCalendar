import React, { useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { CloudImportApplyResult, CloudImportPreview, CloudTeamAuditEvent, CloudTeamRequestExport, Page } from '../shared/cloudTypes';
import { cloudRequest, createMutationId } from '../utils/cloudClient';
import { parseTeamImport, safeExportFilename, serializeCsv } from '../utils/teamMigration';

type Props = { teamId: string; colors: any; onApplied: () => void };
type RosterRow = { memberSub: string; memberName: string; calendarId: string; date: string; shiftCode: string | null; version: number };
type RosterExport = { schema: string; teamId: string; timezone: string; generatedAt: string; items: RosterRow[]; nextCursor?: string };
type ExportKind = 'roster' | 'requests' | 'audit';
const date = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
const sample = 'memberSub,calendarId,date,shiftCode\nmember-id,calendar-id,2026-09-17,M';

function download(name: string, content: string, type: string) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') throw new Error('Downloads are available in the hosted web app.');
  const link = document.createElement('a'); const url = URL.createObjectURL(new Blob([content], { type }));
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function TeamMigrationPanel({ teamId, colors, onApplied }: Props) {
  const [source, setSource] = useState(sample); const [preview, setPreview] = useState<CloudImportPreview | null>(null);
  const [mutationId, setMutationId] = useState(''); const [result, setResult] = useState<CloudImportApplyResult | null>(null);
  const [from, setFrom] = useState(date); const [to, setTo] = useState(date); const [format, setFormat] = useState<'csv'|'json'>('csv');
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');

  const loadFile = () => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.csv,.json,text/csv,application/json';
    input.onchange = () => { const file = input.files?.[0]; if (!file) return; if (file.size > 64 * 1024) { setMessage('File exceeds 64 KiB.'); return; }
      const reader = new FileReader(); reader.onload = () => { setSource(String(reader.result ?? '')); setPreview(null); setResult(null); setMessage('File loaded. Preview it before applying.'); }; reader.readAsText(file); };
    input.click();
  };
  const previewImport = async () => {
    setBusy(true); setMessage(''); setResult(null);
    try { const rows = parseTeamImport(source); const value = await cloudRequest<CloudImportPreview>(`/teams/${encodeURIComponent(teamId)}/import-preview`, {
      method: 'POST', body: JSON.stringify({ rows }),
    }); setPreview(value); setMutationId(createMutationId()); }
    catch (error) { setPreview(null); setMessage(error instanceof Error ? error.message : 'Import preview failed.'); }
    finally { setBusy(false); }
  };
  const applyImport = async () => {
    if (!preview || !mutationId) return; setBusy(true); setMessage('');
    try { const value = await cloudRequest<CloudImportApplyResult>(`/teams/${encodeURIComponent(teamId)}/import-apply`, {
      method: 'POST', body: JSON.stringify({ mutationId, previewToken: preview.previewToken, rows: preview.rows }),
    }); setResult(value); setMessage(`${value.applied} applied · ${value.conflicts} conflicts.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Import apply failed.'); }
    finally { setBusy(false); }
  };
  const exportData = async (kind: ExportKind) => {
    setBusy(true); setMessage('');
    try {
      const base = `/teams/${encodeURIComponent(teamId)}/exports/${kind}`; let cursor = ''; const exported: Record<string, unknown>[] = [];
      do {
        const query = new URLSearchParams({ limit: '100', ...(cursor ? { cursor } : {}), ...(kind === 'roster' ? { from, to } : {}) });
        if (kind === 'roster') { const page = await cloudRequest<RosterExport>(`${base}?${query}`); exported.push(...page.items.map(item => ({ ...item }))); cursor = page.nextCursor ?? ''; }
        else { const page = await cloudRequest<Page<CloudTeamRequestExport | CloudTeamAuditEvent>>(`${base}?${query}`); exported.push(...page.items.map(item => ({ ...item }))); cursor = page.nextCursor ?? ''; }
      } while (cursor);
      const columns = kind === 'roster' ? ['memberSub','memberName','calendarId','date','shiftCode','version']
        : kind === 'requests' ? ['id','kind','requesterSub','requesterCalendarId','requesterDate','requesterObservedShiftCode','requestedShiftCode','counterpartSub','counterpartCalendarId','counterpartDate','counterpartObservedShiftCode','status','version','createdAt','updatedAt','resolvedAt','resolvedBy']
        : ['id','actorSub','operation','createdAt'];
      const content = format === 'json' ? JSON.stringify({ schema: `shiftcalendar.team-${kind}.v1`, teamId, generatedAt: new Date().toISOString(), items: exported }, null, 2)
        : serializeCsv(exported, columns);
      download(safeExportFilename(kind, format), content, format === 'json' ? 'application/json' : 'text/csv;charset=utf-8');
      setMessage(`${kind[0].toUpperCase()}${kind.slice(1)} export downloaded. Private request reasons are excluded.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Export failed.'); }
    finally { setBusy(false); }
  };

  return <View style={[styles.panel, { borderColor: colors.border }]}>
    <Text style={[styles.heading, { color: colors.text }]}>Import and export</Text>
    <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Manager-only. Import up to 2 mapped assignments per preview. Use roster export to find member and calendar IDs.</Text>
    {Platform.OS === 'web' && <TouchableOpacity accessibilityLabel="Load roster import file" onPress={loadFile} disabled={busy} style={[styles.outline, { borderColor: colors.border }]}><Text style={{ color: colors.text }}>Load CSV or JSON file</Text></TouchableOpacity>}
    <TextInput accessibilityLabel="Roster import CSV or JSON" value={source} onChangeText={value => { setSource(value); setPreview(null); setResult(null); }} multiline autoCapitalize="none"
      style={[styles.input, { color: colors.text, borderColor: colors.border }]} />
    <TouchableOpacity accessibilityLabel="Preview roster import" onPress={previewImport} disabled={busy} style={[styles.button, { backgroundColor: colors.primary }]}><Text style={styles.buttonText}>Preview import</Text></TouchableOpacity>
    {preview && <View style={{ gap: 6 }}>{preview.rows.map(row => <Text key={`${row.calendarId}-${row.date}`} style={{ color: colors.text }}>
      {row.memberName} · {row.date} · {row.currentShiftCode ?? 'Empty'} → {row.shiftCode}
    </Text>)}{!result ? <TouchableOpacity accessibilityLabel="Apply roster import" onPress={applyImport} disabled={busy} style={[styles.button, { backgroundColor: colors.primary }]}><Text style={styles.buttonText}>Apply previewed import</Text></TouchableOpacity> : <View style={styles.row}>
      <TouchableOpacity accessibilityLabel="Check saved import result" onPress={applyImport} disabled={busy} style={[styles.outline, { borderColor: colors.border }]}><Text style={{ color: colors.text }}>Check saved import result</Text></TouchableOpacity>
      <TouchableOpacity accessibilityLabel="Finish roster import" onPress={onApplied} disabled={busy} style={[styles.button, { backgroundColor: colors.primary }]}><Text style={styles.buttonText}>Done</Text></TouchableOpacity>
    </View>}</View>}
    {!!message && <Text accessibilityRole="alert" style={{ color: colors.textSecondary }}>{message}</Text>}
    <Text style={[styles.heading, { color: colors.text }]}>Recovery exports</Text>
    <View style={styles.row}><TextInput accessibilityLabel="Export start date" value={from} onChangeText={setFrom} style={[styles.date, { color: colors.text, borderColor: colors.border }]} />
      <TextInput accessibilityLabel="Export end date" value={to} onChangeText={setTo} style={[styles.date, { color: colors.text, borderColor: colors.border }]} /></View>
    <View style={styles.row}>{(['csv','json'] as const).map(value => <TouchableOpacity key={value} onPress={() => setFormat(value)} style={[styles.outline, { borderColor: format === value ? colors.primary : colors.border }]}><Text style={{ color: colors.text }}>{value.toUpperCase()}</Text></TouchableOpacity>)}</View>
    <View style={styles.row}>{(['roster','requests','audit'] as const).map(kind => <TouchableOpacity key={kind} accessibilityLabel={`Export team ${kind}`} onPress={() => exportData(kind)} disabled={busy} style={[styles.outline, { borderColor: colors.border }]}><Text style={{ color: colors.text }}>Export {kind}</Text></TouchableOpacity>)}</View>
  </View>;
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 10, marginTop: 8 }, heading: { fontSize: 16, fontWeight: '700' },
  input: { minHeight: 92, borderWidth: 1, borderRadius: 10, padding: 10, textAlignVertical: 'top', fontFamily: Platform.OS === 'web' ? 'monospace' : undefined },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, date: { flex: 1, minWidth: 130, borderWidth: 1, borderRadius: 10, padding: 10 },
  button: { borderRadius: 10, padding: 11, alignItems: 'center' }, buttonText: { color: '#FFF', fontWeight: '700' },
  outline: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, alignItems: 'center' },
});
