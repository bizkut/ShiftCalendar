import { MaterialCommunityIcons } from '@expo/vector-icons';
import { addDays, format } from 'date-fns';
import { Redirect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../hooks/AuthContext';
import { useAppSettings } from '../../hooks/ThemeContext';
import { useShifts } from '../../hooks/ShiftContext';
import type { CloudCalendar, CloudMember, CloudTeam, InvitationCreated, Page, TeamRole, TeamRosterDay } from '../../shared/cloudTypes';
import { cloudErrorMessage, cloudRequest, createMutationId } from '../../utils/cloudClient';

const editableRoles: Exclude<TeamRole, 'owner'>[] = ['manager', 'member', 'viewer'];
const pageItems = <T,>(value: Page<T> | T[]) => Array.isArray(value) ? value : value.items;

function capabilityText(role: TeamRole) {
  if (role === 'owner') return 'Owner: manage the team, members, invitations, and every team calendar.';
  if (role === 'manager') return 'Manager: edit team schedules and calendars. Membership is owner-controlled.';
  if (role === 'member') return 'Member: edit your assigned schedule and view the team roster.';
  return 'Viewer: view team calendars and rosters without editing.';
}

export default function TeamsScreen() {
  const { user } = useAuth();
  const { cloud } = useShifts();
  const { colors } = useAppSettings();
  const params = useLocalSearchParams<{ invite?: string }>();
  const [teams, setTeams] = useState<CloudTeam[]>([]);
  const [loadedForSub, setLoadedForSub] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [members, setMembers] = useState<CloudMember[]>([]);
  const [roster, setRoster] = useState<TeamRosterDay[]>([]);
  const [teamName, setTeamName] = useState('');
  const [inviteToken, setInviteToken] = useState(params.invite ?? '');
  const [inviteRole, setInviteRole] = useState<Exclude<TeamRole, 'owner'>>('member');
  const [createdInviteLink, setCreatedInviteLink] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const userSubRef = useRef(user?.sub);
  userSubRef.current = user?.sub;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const selected = teams.find((team) => team.id === selectedId) ?? teams[0];
  const isOwner = selected?.role === 'owner';
  const canManageSchedules = selected?.role === 'owner' || selected?.role === 'manager';

  const loadTeams = useCallback(async () => {
    if (!user) return;
    const requestedSub = user.sub;
    setLoadedForSub(null);
    try {
      const result = await cloudRequest<Page<CloudTeam> | CloudTeam[]>('/teams?limit=100');
      if (userSubRef.current !== requestedSub) return;
      const items = pageItems(result);
      setTeams(items);
      setSelectedId((current) => items.some((team) => team.id === current) ? current : items[0]?.id ?? '');
    } catch (error) { if (userSubRef.current === requestedSub) setMessage(cloudErrorMessage(error)); }
    finally { if (userSubRef.current === requestedSub) setLoadedForSub(requestedSub); }
  }, [user]);

  const loadMembers = useCallback(async () => {
    if (!selectedId) { setMembers([]); return; }
    const requestedTeam = selectedId;
    try {
      const result = await cloudRequest<Page<CloudMember> | CloudMember[]>(`/teams/${encodeURIComponent(selectedId)}/members?limit=100`);
      if (selectedIdRef.current === requestedTeam) setMembers(pageItems(result));
    } catch (error) { setMessage(cloudErrorMessage(error)); }
  }, [selectedId]);

  const loadRoster = useCallback(async () => {
    if (!selectedId) { setRoster([]); return; }
    const requestedTeam = selectedId;
    const from = format(new Date(), 'yyyy-MM-dd');
    const to = format(addDays(new Date(), 30), 'yyyy-MM-dd');
    try {
      const result = await cloudRequest<Page<TeamRosterDay> | TeamRosterDay[]>(`/teams/${encodeURIComponent(selectedId)}/roster?from=${from}&to=${to}&limit=100`);
      if (selectedIdRef.current === requestedTeam) setRoster(pageItems(result));
    } catch (error) { setMessage(cloudErrorMessage(error)); }
  }, [selectedId]);

  useEffect(() => { void loadTeams(); }, [loadTeams]);
  useEffect(() => { if (!user) { setLoadedForSub(null); setTeams([]); setMembers([]); setRoster([]); setSelectedId(''); } }, [user]);
  useEffect(() => { void loadMembers(); }, [loadMembers]);
  useEffect(() => { void loadRoster(); }, [loadRoster]);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setMessage(null);
    try { await operation(); } catch (error) { setMessage(cloudErrorMessage(error)); } finally { setBusy(false); }
  };

  const createTeam = () => run(async () => {
    const name = teamName.trim(); if (!name) throw new Error('Enter a team name.');
    const created = await cloudRequest<CloudTeam>('/teams', { method: 'POST', body: JSON.stringify({ mutationId: createMutationId(), value: { name, timezone: 'Asia/Kuala_Lumpur' } }) });
    setTeams((previous) => [...previous, created]); setSelectedId(created.id); setTeamName(''); setMessage('Team created.');
  });

  const redeemInvite = () => run(async () => {
    const token = inviteToken.trim(); if (!token) throw new Error('Paste an invitation token or link.');
    const parsedToken = token.includes('invite=') ? decodeURIComponent(token.split('invite=')[1].split('&')[0]) : token;
    await cloudRequest<CloudTeam>('/invites/redeem', { method: 'POST', body: JSON.stringify({ mutationId: createMutationId(), value: { token: parsedToken, displayName: user?.username } }) });
    setInviteToken(''); await loadTeams(); setMessage('Invitation accepted.');
  });

  const createInvite = () => run(async () => {
    if (!selected) return;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const invite = await cloudRequest<InvitationCreated>(`/teams/${encodeURIComponent(selected.id)}/invites`, { method: 'POST', body: JSON.stringify({ mutationId: createMutationId(), value: { role: inviteRole, expiresAt } }) });
    const base = process.env.EXPO_PUBLIC_WEB_URL?.replace(/\/$/, '');
    const link = base ? `${base}/teams?invite=${encodeURIComponent(invite.token)}` : invite.token;
    setCreatedInviteLink(link);
    try { await Share.share({ title: `Join ${selected.name}`, message: `Join ${selected.name} as ${invite.role}: ${link}`, url: link }); } catch { /* The link remains visible for manual sharing. */ }
    setMessage(`Invitation created. It expires ${new Date(invite.expiresAt).toLocaleString()}.`);
  });

  const changeRole = (member: CloudMember, role: Exclude<TeamRole, 'owner'>) => run(async () => {
    await cloudRequest<CloudMember>(`/teams/${encodeURIComponent(selected!.id)}/members/${encodeURIComponent(member.sub)}`, { method: 'PATCH', body: JSON.stringify({ mutationId: createMutationId(), value: { role } }) });
    await loadMembers(); setMessage(`${member.displayName} is now ${role}.`);
  });

  const removeMember = (member: CloudMember) => run(async () => {
    await cloudRequest<CloudMember>(`/teams/${encodeURIComponent(selected!.id)}/members/${encodeURIComponent(member.sub)}`, { method: 'DELETE', body: JSON.stringify({ mutationId: createMutationId() }) });
    if (member.sub === user?.sub) await loadTeams(); else await loadMembers();
    setMessage(member.sub === user?.sub ? 'You left the team.' : `${member.displayName} was removed.`);
  });

  const transferOwnership = (member: CloudMember) => run(async () => {
    await cloudRequest<CloudTeam>(`/teams/${encodeURIComponent(selected!.id)}/transfer-ownership`, { method: 'POST', body: JSON.stringify({ mutationId: createMutationId(), expectedVersion: selected!.version, value: { newOwnerSub: member.sub } }) });
    await loadTeams(); await loadMembers(); setMessage(`Ownership transferred to ${member.displayName}.`);
  });

  const createMemberCalendar = (member: CloudMember) => run(async () => {
    await cloudRequest<CloudCalendar>('/calendars', {
      method: 'POST',
      body: JSON.stringify({ mutationId: createMutationId(), value: { name: `${member.displayName || 'Member'} shifts`, color: '#3B82F6', timezone: selected!.timezone, teamId: selected!.id, assignedMemberSub: member.sub } }),
    });
    await cloud?.refresh();
    setMessage(`Team calendar created for ${member.displayName || member.sub}.`);
  });

  const palette = useMemo(() => ({ input: { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface } }), [colors]);

  if (!cloud?.enabled) return <Redirect href="/" />;
  if (!user || loadedForSub !== user.sub) return <View style={[styles.loading, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /></View>;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.container}>
      <Text style={[styles.title, { color: colors.text }]}>Teams</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>You can join multiple teams. Each team keeps its members and calendars isolated.</Text>
      {!!message && <Text accessibilityRole="alert" style={[styles.message, { color: message.includes('created') || message.includes('accepted') ? '#10B981' : colors.textSecondary }]}>{message}</Text>}

      <View style={styles.row}>
        <TextInput value={teamName} onChangeText={setTeamName} placeholder="New team name" placeholderTextColor={colors.textSecondary} style={[styles.input, palette.input, styles.flex]} />
        <TouchableOpacity disabled={busy} onPress={createTeam} style={[styles.button, { backgroundColor: colors.primary }]}><Text style={styles.buttonText}>Create</Text></TouchableOpacity>
      </View>
      <View style={styles.row}>
        <TextInput value={inviteToken} onChangeText={setInviteToken} autoCapitalize="none" placeholder="Invitation link or token" placeholderTextColor={colors.textSecondary} style={[styles.input, palette.input, styles.flex]} />
        <TouchableOpacity disabled={busy} onPress={redeemInvite} style={[styles.button, { backgroundColor: colors.primary }]}><Text style={styles.buttonText}>Join</Text></TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.teamList}>
        {teams.map((team) => <TouchableOpacity key={team.id} onPress={() => setSelectedId(team.id)} style={[styles.teamChip, { borderColor: team.id === selected?.id ? colors.primary : colors.border, backgroundColor: colors.surface }]}><Text style={{ color: colors.text, fontWeight: '700' }}>{team.name}</Text><Text style={{ color: colors.textSecondary, fontSize: 11 }}>{team.role}</Text></TouchableOpacity>)}
      </ScrollView>

      {selected ? <>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>{selected.name}</Text>
          <Text style={{ color: colors.textSecondary, lineHeight: 20 }}>{capabilityText(selected.role)}</Text>
          {isOwner && <>
            <Text style={[styles.label, { color: colors.text }]}>New invitation role</Text>
            <View style={styles.roleRow}>{editableRoles.map((role) => <TouchableOpacity key={role} onPress={() => setInviteRole(role)} style={[styles.role, { borderColor: inviteRole === role ? colors.primary : colors.border }]}><Text style={{ color: colors.text }}>{role}</Text></TouchableOpacity>)}</View>
            <TouchableOpacity disabled={busy} onPress={createInvite} style={[styles.wideButton, { backgroundColor: colors.primary }]}><MaterialCommunityIcons name="link-variant" color="#FFF" size={18} /><Text style={styles.buttonText}>Create invitation link</Text></TouchableOpacity>
            {!!createdInviteLink && <Text selectable style={[styles.inviteLink, { color: colors.primary, borderColor: colors.border }]}>{createdInviteLink}</Text>}
          </>}
        </View>

        <Text style={[styles.sectionTitle, { color: colors.text }]}>Members</Text>
        {members.map((member) => <View key={member.sub} style={[styles.member, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.flex}><Text style={{ color: colors.text, fontWeight: '700' }}>{member.displayName || member.sub}{member.sub === user?.sub ? ' (you)' : ''}</Text><Text style={{ color: colors.textSecondary, fontSize: 12 }}>{capabilityText(member.role)}</Text></View>
          {isOwner && member.role !== 'owner' && <View style={styles.actions}>
            {editableRoles.map((role) => <TouchableOpacity key={role} disabled={member.role === role || busy} onPress={() => changeRole(member, role)}><Text style={{ color: member.role === role ? colors.textSecondary : colors.primary, fontSize: 12 }}>{role}</Text></TouchableOpacity>)}
            <TouchableOpacity disabled={busy} onPress={() => transferOwnership(member)}><Text style={{ color: colors.primary, fontSize: 12 }}>make owner</Text></TouchableOpacity>
            <TouchableOpacity disabled={busy} onPress={() => Alert.alert('Remove member?', member.displayName, [{ text: 'Cancel' }, { text: 'Remove', style: 'destructive', onPress: () => void removeMember(member) }])}><Text style={{ color: '#EF4444', fontSize: 12 }}>remove</Text></TouchableOpacity>
          </View>}
          {!isOwner && member.sub === user?.sub && member.role !== 'owner' && <TouchableOpacity disabled={busy} onPress={() => removeMember(member)}><Text style={{ color: '#EF4444' }}>Leave</Text></TouchableOpacity>}
          {canManageSchedules && <TouchableOpacity disabled={busy} onPress={() => createMemberCalendar(member)} accessibilityRole="button"><Text style={{ color: colors.primary, fontSize: 12 }}>Add calendar</Text></TouchableOpacity>}
        </View>)}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Next 31 days (first 100 entries)</Text>
        {roster.length ? roster.map((day) => <View key={`${day.calendarId}-${day.date}`} style={[styles.rosterDay, { borderBottomColor: colors.border }]}><Text style={[styles.rosterDate, { color: colors.text }]}>{day.date}</Text><Text style={[styles.flex, { color: colors.textSecondary }]}>{day.memberDisplayName}</Text><Text style={{ color: colors.text, fontWeight: '800' }}>{day.shiftCode ?? day.availability ?? '—'}</Text></View>) : <Text style={{ color: colors.textSecondary }}>No scheduled shifts in this range.</Text>}
      </> : <Text style={{ color: colors.textSecondary }}>Create a team or accept an invitation to get started.</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 18, paddingBottom: 48, gap: 14 }, title: { fontSize: 28, fontWeight: '800' }, subtitle: { fontSize: 14, lineHeight: 20 }, message: { fontSize: 13 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: 8 }, flex: { flex: 1 }, input: { minHeight: 46, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12 }, button: { minHeight: 46, borderRadius: 10, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' }, buttonText: { color: '#FFF', fontWeight: '700' },
  teamList: { gap: 8 }, teamChip: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, minWidth: 100 }, card: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 12 }, cardTitle: { fontSize: 20, fontWeight: '800' }, label: { fontSize: 13, fontWeight: '700' }, roleRow: { flexDirection: 'row', gap: 7 }, role: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 }, wideButton: { minHeight: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  inviteLink: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '800', marginTop: 4 }, member: { borderWidth: 1, borderRadius: 12, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10 }, actions: { alignItems: 'flex-end', gap: 5 },
  rosterDay: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth }, rosterDate: { width: 88, fontWeight: '700' },
});
