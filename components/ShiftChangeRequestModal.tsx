import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { ShiftType } from '../constants/shifts';
import type { CloudCalendar, Page, TeamRosterDay } from '../shared/cloudTypes';
import { cloudErrorMessage, cloudRequest, createMutationId } from '../utils/cloudClient';

type Props = {
  visible: boolean; onClose: () => void; onCreated: () => void; teamId: string; userSub: string;
  calendar: CloudCalendar; date: string; observedVersion: number; observedShiftCode?: string;
  calendars: CloudCalendar[]; shifts: ShiftType[];
  colors: { surface: string; background: string; text: string; textSecondary: string; border: string; primary: string };
};

export function ShiftChangeRequestModal(props: Props) {
  const [kind, setKind] = useState<'direct' | 'swap'>('direct');
  const [desired, setDesired] = useState(''); const [reason, setReason] = useState('');
  const counterparts = useMemo(() => props.calendars.filter(item => item.scope === 'team' && item.teamId === props.teamId
    && item.assignedMemberSub && item.assignedMemberSub !== props.userSub), [props.calendars, props.teamId, props.userSub]);
  const [counterpartId, setCounterpartId] = useState(''); const [counterpartDate, setCounterpartDate] = useState(props.date);
  const [mutationId, setMutationId] = useState(createMutationId()); const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { if (!props.visible) return; setKind('direct'); setDesired(''); setReason('');
    setCounterpartId(counterparts[0]?.id ?? ''); setCounterpartDate(props.date); setMutationId(createMutationId()); setMessage('');
  }, [props.visible, props.date, counterparts.length]);

  const submit = async () => {
    if (!reason.trim()) { setMessage('Enter a private reason.'); return; }
    if (kind === 'direct' && !desired) { setMessage('Choose the shift you want.'); return; }
    setBusy(true); setMessage('');
    try {
      let swapValue: Record<string, unknown> = {};
      if (kind === 'swap') {
        const counterpart = counterparts.find(item => item.id === counterpartId);
        if (!counterpart || !/^\d{4}-\d{2}-\d{2}$/.test(counterpartDate)) throw new Error('Choose a counterpart and enter a date as YYYY-MM-DD.');
        const page = await cloudRequest<Page<TeamRosterDay>>(`/teams/${encodeURIComponent(props.teamId)}/roster?from=${counterpartDate}&to=${counterpartDate}&memberSub=${encodeURIComponent(counterpart.assignedMemberSub!)}&limit=2`);
        const target = page.items.find(item => item.calendarId === counterpart.id && item.date === counterpartDate);
        if (!target?.shiftCode) throw new Error('That member has no assigned shift on the selected date.');
        swapValue = { counterpartSub: counterpart.assignedMemberSub, counterpartCalendarId: counterpart.id,
          counterpartDate, counterpartObservedVersion: target.version, counterpartObservedShiftCode: target.shiftCode };
      }
      await cloudRequest(`/teams/${encodeURIComponent(props.teamId)}/change-requests`, { method: 'POST', body: JSON.stringify({
        mutationId, value: { kind, requesterCalendarId: props.calendar.id, requesterDate: props.date,
          requesterObservedVersion: props.observedVersion, requesterObservedShiftCode: props.observedShiftCode,
          ...(kind === 'direct' ? { requestedShiftCode: desired } : swapValue), reason: reason.trim() },
      }) });
      props.onCreated(); props.onClose();
    } catch (error) { setMessage(cloudErrorMessage(error)); } finally { setBusy(false); }
  };

  return <Modal visible={props.visible} animationType="slide" transparent onRequestClose={props.onClose}>
    <View style={styles.backdrop}><View style={[styles.sheet, { backgroundColor: props.colors.surface }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: props.colors.text }]}>Request shift change</Text>
        <Text style={{ color: props.colors.textSecondary }}>{props.date} · {props.observedShiftCode ?? 'No shift assigned'}</Text>
        <View style={styles.row}>{(['direct', 'swap'] as const).map(value => <TouchableOpacity key={value}
          accessibilityLabel={`Choose ${value} request`} onPress={() => setKind(value)}
          style={[styles.choice, { borderColor: kind === value ? props.colors.primary : props.colors.border,
            backgroundColor: kind === value ? props.colors.primary + '18' : props.colors.background }]}>
          <Text style={{ color: kind === value ? props.colors.primary : props.colors.text }}>{value === 'direct' ? 'Different shift' : 'Swap with member'}</Text>
        </TouchableOpacity>)}</View>
        {kind === 'direct' ? <>
          <Text style={[styles.label, { color: props.colors.text }]}>Requested shift</Text>
          <View style={styles.wrap}>{props.shifts.filter(item => !item.archived && item.code !== props.observedShiftCode).map(item =>
            <TouchableOpacity key={item.code} accessibilityLabel={`Request ${item.label}`} onPress={() => setDesired(item.code)}
              style={[styles.shift, { borderColor: desired === item.code ? props.colors.primary : props.colors.border }]}>
              <Text style={{ color: desired === item.code ? props.colors.primary : props.colors.text }}>{item.code} · {item.label}</Text>
            </TouchableOpacity>)}</View>
        </> : <>
          <Text style={[styles.label, { color: props.colors.text }]}>Counterpart</Text>
          <View style={styles.wrap}>{counterparts.map(item => <TouchableOpacity key={item.id}
            accessibilityLabel={`Swap with ${item.assignedMemberDisplayName ?? item.name}`} onPress={() => setCounterpartId(item.id)}
            style={[styles.shift, { borderColor: counterpartId === item.id ? props.colors.primary : props.colors.border }]}>
            <Text style={{ color: counterpartId === item.id ? props.colors.primary : props.colors.text }}>{item.assignedMemberDisplayName ?? item.name}</Text>
          </TouchableOpacity>)}</View>
          <Text style={[styles.label, { color: props.colors.text }]}>Their shift date</Text>
          <TextInput accessibilityLabel="Counterpart shift date" value={counterpartDate} onChangeText={setCounterpartDate}
            placeholder="YYYY-MM-DD" placeholderTextColor={props.colors.textSecondary}
            style={[styles.input, { color: props.colors.text, borderColor: props.colors.border, backgroundColor: props.colors.background }]} />
        </>}
        <Text style={[styles.label, { color: props.colors.text }]}>Private reason</Text>
        <TextInput accessibilityLabel="Private request reason" value={reason} onChangeText={setReason} multiline maxLength={500}
          placeholder="Visible only to you, the counterpart, and current team managers" placeholderTextColor={props.colors.textSecondary}
          style={[styles.reason, { color: props.colors.text, borderColor: props.colors.border, backgroundColor: props.colors.background }]} />
        {!!message && <Text accessibilityRole="alert" style={{ color: '#DC2626' }}>{message}</Text>}
        <View style={styles.row}><TouchableOpacity onPress={props.onClose} style={[styles.button, { borderColor: props.colors.border }]}><Text style={{ color: props.colors.text }}>Cancel</Text></TouchableOpacity>
          <TouchableOpacity disabled={busy} accessibilityLabel="Submit shift change request" onPress={() => void submit()}
            style={[styles.button, { backgroundColor: props.colors.primary, borderColor: props.colors.primary }]}>
            {busy ? <ActivityIndicator color="#FFF" /> : <Text style={{ color: '#FFF', fontWeight: '700' }}>Submit request</Text>}
          </TouchableOpacity></View>
      </ScrollView>
    </View></View>
  </Modal>;
}

const styles = StyleSheet.create({ backdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' },
  sheet: { maxHeight: '90%', borderTopLeftRadius: 22, borderTopRightRadius: 22 }, content: { padding: 20, gap: 12 },
  title: { fontSize: 22, fontWeight: '800' }, row: { flexDirection: 'row', gap: 10 }, wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { flex: 1, borderWidth: 1, borderRadius: 10, padding: 12, alignItems: 'center' }, label: { fontWeight: '700', marginTop: 4 },
  shift: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 11, paddingVertical: 8 }, input: { borderWidth: 1, borderRadius: 10, minHeight: 44, paddingHorizontal: 12 },
  reason: { borderWidth: 1, borderRadius: 10, minHeight: 90, padding: 12, textAlignVertical: 'top' },
  button: { flex: 1, borderWidth: 1, borderRadius: 10, minHeight: 46, alignItems: 'center', justifyContent: 'center' } });
