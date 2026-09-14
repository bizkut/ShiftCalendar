import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { CloudMember, CloudRotationTemplate, CloudSchedulePreview, Page } from '../shared/cloudTypes';
import { cloudRequest, createMutationId } from '../utils/cloudClient';

type ApplyResult = { results: Array<CloudSchedulePreview['assignments'][number] & { status: 'applied' | 'conflict' | 'forbidden'; error?: string }>;
  applied: number; conflicts: number };
type Props = { visible: boolean; teamId: string; defaultMemberSub?: string; colors: any; onClose: () => void; onApplied: () => void };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
const items = <T,>(value: Page<T> | T[]) => Array.isArray(value) ? value : value.items;

export function TeamScheduleModal({ visible, teamId, defaultMemberSub, colors, onClose, onApplied }: Props) {
  const [templates, setTemplates] = useState<CloudRotationTemplate[]>([]); const [members, setMembers] = useState<CloudMember[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState(''); const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [editingTemplateId, setEditingTemplateId] = useState('');
  const [from, setFrom] = useState(today); const [to, setTo] = useState(today); const [name, setName] = useState('');
  const [pattern, setPattern] = useState('M,A,N,O'); const [preview, setPreview] = useState<CloudSchedulePreview | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const activeTemplates = useMemo(() => templates.filter(item => !item.archived), [templates]);
  const selectedTemplate = templates.find(item => item.id === selectedTemplateId);

  const load = async () => {
    setBusy(true); setError(''); setPreview(null); setResult(null);
    try {
      const [templatePage, memberPage] = await Promise.all([
        cloudRequest<Page<CloudRotationTemplate> | CloudRotationTemplate[]>(`/teams/${encodeURIComponent(teamId)}/rotation-templates?limit=100`),
        cloudRequest<Page<CloudMember> | CloudMember[]>(`/teams/${encodeURIComponent(teamId)}/members?limit=100`),
      ]);
      const loadedTemplates = items(templatePage); const loadedMembers = items(memberPage);
      setTemplates(loadedTemplates); setMembers(loadedMembers);
      setSelectedTemplateId(loadedTemplates.find(item => !item.archived)?.id ?? '');
      setSelectedMembers(defaultMemberSub && loadedMembers.some(item => item.sub === defaultMemberSub) ? [defaultMemberSub] : loadedMembers[0] ? [loadedMembers[0].sub] : []);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load scheduling tools.'); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (visible && teamId) void load(); }, [visible, teamId]);

  const saveTemplate = async () => {
    const codes = pattern.split(',').map(value => value.trim().toUpperCase()).filter(Boolean);
    if (!name.trim() || !codes.length) { setError('Enter a template name and comma-separated shift codes.'); return; }
    setBusy(true); setError(''); setPreview(null); setResult(null);
    try {
      const editingTemplate = templates.find(item => item.id === editingTemplateId);
      const id = editingTemplate?.id ?? createMutationId();
      const saved = await cloudRequest<CloudRotationTemplate>(`/teams/${encodeURIComponent(teamId)}/rotation-templates/${encodeURIComponent(id)}`, {
        method: 'PUT', body: JSON.stringify({ mutationId: createMutationId(), expectedVersion: editingTemplate?.version ?? 0,
          value: { name: name.trim(), description: '', pattern: codes } }),
      });
      setTemplates(previous => [...previous.filter(item => item.id !== saved.id), saved]); setSelectedTemplateId(saved.id);
      setName(''); setPattern('M,A,N,O'); setEditingTemplateId('');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The template was not saved.'); }
    finally { setBusy(false); }
  };
  const editTemplate = (item: CloudRotationTemplate) => { setSelectedTemplateId(item.id); setEditingTemplateId(item.id); setName(item.name); setPattern(item.pattern.join(',')); setPreview(null); setResult(null); };
  const archiveTemplate = async () => {
    if (!selectedTemplate) return; setBusy(true); setError('');
    try {
      await cloudRequest(`/teams/${encodeURIComponent(teamId)}/rotation-templates/${encodeURIComponent(selectedTemplate.id)}`, {
        method: 'DELETE', body: JSON.stringify({ mutationId: createMutationId(), expectedVersion: selectedTemplate.version }),
      });
      setTemplates(previous => previous.map(item => item.id === selectedTemplate.id ? { ...item, archived: true } : item));
      setSelectedTemplateId(activeTemplates.find(item => item.id !== selectedTemplate.id)?.id ?? ''); setPreview(null); setResult(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The template was not archived.'); }
    finally { setBusy(false); }
  };
  const toggleMember = (sub: string) => { setSelectedMembers(previous => previous.includes(sub) ? previous.filter(item => item !== sub) : [...previous, sub]); setPreview(null); setResult(null); };
  const requestPreview = async () => {
    if (!selectedTemplate || !selectedMembers.length) { setError('Select a rotation and at least one member.'); return; }
    setBusy(true); setError(''); setResult(null);
    try {
      setPreview(await cloudRequest<CloudSchedulePreview>(`/teams/${encodeURIComponent(teamId)}/schedule-preview`, {
        method: 'POST', body: JSON.stringify({ templateId: selectedTemplate.id, expectedTemplateVersion: selectedTemplate.version,
          memberSubs: selectedMembers, from, to }),
      }));
    } catch (caught) { setPreview(null); setError(caught instanceof Error ? caught.message : 'Preview failed.'); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (!preview) return; setBusy(true); setError('');
    try {
      const applied = await cloudRequest<ApplyResult>(`/teams/${encodeURIComponent(teamId)}/schedule-apply`, {
        method: 'POST', body: JSON.stringify({ mutationId: createMutationId(), ...preview }),
      });
      setResult(applied); if (applied.applied) onApplied();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The schedule was not applied.'); }
    finally { setBusy(false); }
  };

  return <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
    <View style={styles.backdrop}><View style={[styles.panel, { backgroundColor: colors.background }]}>
      <View style={styles.header}><View><Text style={[styles.title, { color: colors.text }]}>Team scheduling</Text>
        <Text style={[styles.caption, { color: colors.textSecondary }]}>Up to 14 assignments per preview</Text></View>
        <TouchableOpacity accessibilityLabel="Close team scheduling" onPress={onClose}><MaterialCommunityIcons name="close" size={26} color={colors.text} /></TouchableOpacity></View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {busy && <ActivityIndicator color={colors.primary} />}
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        <Text style={[styles.heading, { color: colors.text }]}>Rotation templates</Text>
        <View style={styles.chips}>{activeTemplates.map(item => <TouchableOpacity key={item.id} accessibilityLabel={`Select ${item.name} rotation`}
          onPress={() => { setSelectedTemplateId(item.id); setPreview(null); setResult(null); }}
          style={[styles.chip, { borderColor: selectedTemplateId === item.id ? colors.primary : colors.border, backgroundColor: colors.surface }]}>
          <Text style={{ color: colors.text }}>{item.name}: {item.pattern.join(' · ')}</Text></TouchableOpacity>)}</View>
        <View style={styles.row}><TextInput accessibilityLabel="Rotation name" value={name} onChangeText={setName} placeholder="Rotation name"
          placeholderTextColor={colors.textSecondary} style={[styles.input, styles.flex, { color: colors.text, borderColor: colors.border }]} />
          <TextInput accessibilityLabel="Rotation shift codes" value={pattern} onChangeText={setPattern} autoCapitalize="characters" placeholder="M,A,N,O"
            placeholderTextColor={colors.textSecondary} style={[styles.input, styles.flex, { color: colors.text, borderColor: colors.border }]} /></View>
        <View style={styles.row}><TouchableOpacity accessibilityLabel="Save rotation template" onPress={saveTemplate} disabled={busy}
          style={[styles.button, { backgroundColor: colors.primary }]}><Text style={styles.buttonText}>{editingTemplateId ? 'Update rotation' : 'Save new rotation'}</Text></TouchableOpacity>
          {selectedTemplate && <><TouchableOpacity onPress={() => editTemplate(selectedTemplate)} style={[styles.outlineButton, { borderColor: colors.border }]}><Text style={{ color: colors.text }}>Edit</Text></TouchableOpacity>
          <TouchableOpacity accessibilityLabel="Archive selected rotation" onPress={archiveTemplate} style={[styles.outlineButton, { borderColor: '#DC2626' }]}><Text style={{ color: '#DC2626' }}>Archive</Text></TouchableOpacity></>}</View>

        <Text style={[styles.heading, { color: colors.text }]}>Members and dates</Text>
        <View style={styles.chips}>{members.map(item => <TouchableOpacity key={item.sub} accessibilityLabel={`Schedule ${item.displayName}`}
          onPress={() => toggleMember(item.sub)} style={[styles.chip, { borderColor: selectedMembers.includes(item.sub) ? colors.primary : colors.border,
            backgroundColor: selectedMembers.includes(item.sub) ? colors.primary + '18' : colors.surface }]}><Text style={{ color: colors.text }}>{item.displayName}</Text></TouchableOpacity>)}</View>
        <View style={styles.row}><TextInput accessibilityLabel="Schedule start date" value={from} onChangeText={value => { setFrom(value); setPreview(null); }}
          placeholder="YYYY-MM-DD" style={[styles.input, styles.flex, { color: colors.text, borderColor: colors.border }]} />
          <TextInput accessibilityLabel="Schedule end date" value={to} onChangeText={value => { setTo(value); setPreview(null); }}
            placeholder="YYYY-MM-DD" style={[styles.input, styles.flex, { color: colors.text, borderColor: colors.border }]} /></View>
        <TouchableOpacity accessibilityLabel="Preview team schedule" onPress={requestPreview} disabled={busy}
          style={[styles.button, { backgroundColor: colors.primary }]}><Text style={styles.buttonText}>Preview assignments</Text></TouchableOpacity>

        {preview && <View style={[styles.preview, { borderColor: colors.border }]}><Text style={[styles.heading, { color: colors.text }]}>{preview.templateName} preview</Text>
          {preview.assignments.map(item => {
            const outcome = result?.results.find(row => row.memberSub === item.memberSub && row.date === item.date);
            return <View key={`${item.memberSub}-${item.date}`} style={styles.assignment}><View style={styles.assignmentMain}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>{item.memberName} · {item.date}</Text>
              {outcome && <Text style={{ color: outcome.status === 'applied' ? '#15803D' : '#B45309', fontSize: 12 }}>
                {outcome.status === 'applied' ? 'Applied' : `${outcome.status}: ${outcome.error ?? 'Refresh and preview again.'}`}
              </Text>}</View>
              <Text style={{ color: colors.textSecondary }}>{item.currentShiftCode ?? 'Empty'} → {item.shiftCode}</Text></View>;
          })}
          {!result && <TouchableOpacity accessibilityLabel="Apply previewed team schedule" onPress={apply} disabled={busy}
            style={[styles.button, { backgroundColor: colors.primary }]}><Text style={styles.buttonText}>Apply {preview.assignments.length} assignments</Text></TouchableOpacity>}
        </View>}
        {result && <Text accessibilityRole="summary" style={{ color: result.conflicts ? '#B45309' : '#15803D' }}>
          {result.applied} applied · {result.conflicts} conflicts. Successful entries remain saved; refresh and preview conflicts again.
        </Text>}
      </ScrollView>
    </View></View>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' }, panel: { maxHeight: '92%', borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20 }, title: { fontSize: 24, fontWeight: '800' },
  caption: { fontSize: 12, marginTop: 2 }, content: { paddingHorizontal: 20, paddingBottom: 40, gap: 12 }, heading: { fontSize: 16, fontWeight: '700', marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, flex: { flex: 1, minWidth: 130 }, input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  button: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, alignItems: 'center' }, buttonText: { color: '#FFF', fontWeight: '700' },
  outlineButton: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 }, error: { color: '#DC2626', fontWeight: '600' },
  preview: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 }, assignment: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 }, assignmentMain: { flex: 1 },
});
