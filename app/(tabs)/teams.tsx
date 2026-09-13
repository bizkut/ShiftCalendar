import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Redirect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../hooks/AuthContext';
import { useAppSettings } from '../../hooks/ThemeContext';
import { useShifts } from '../../hooks/ShiftContext';
import type { CloudCalendar, CloudInvitation, CloudMember, CloudTeam, CloudUser, Page, TeamRole } from '../../shared/cloudTypes';
import { cloudErrorMessage, cloudRequest, createMutationId } from '../../utils/cloudClient';

const editableRoles: Exclude<TeamRole, 'owner'>[] = ['manager', 'member', 'viewer'];
const pageItems = <T,>(value: Page<T> | T[]) => Array.isArray(value) ? value : value.items;

function capabilityText(role: TeamRole) {
  if (role === 'owner') return 'Team leader: manage members and edit every team calendar.';
  if (role === 'manager') return 'Manager: create and edit team calendars.';
  if (role === 'member') return 'Member: view team calendars, including your assigned calendar.';
  return 'Viewer: view team calendars without editing.';
}

const roleLabel = (role: TeamRole) => role === 'owner' ? 'team leader' : role;

export default function TeamsScreen() {
  const { user } = useAuth();
  const { cloud } = useShifts();
  const { colors } = useAppSettings();
  const [teams, setTeams] = useState<CloudTeam[]>([]);
  const [loadedForSub, setLoadedForSub] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [members, setMembers] = useState<CloudMember[]>([]);
  const [invitations, setInvitations] = useState<CloudInvitation[]>([]);
  const [users, setUsers] = useState<CloudUser[]>([]);
  const [teamName, setTeamName] = useState('');
  const [inviteeEmail, setInviteeEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Exclude<TeamRole, 'owner'>>('member');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const userSubRef = useRef(user?.sub); userSubRef.current = user?.sub;
  const selectedIdRef = useRef(selectedId); selectedIdRef.current = selectedId;

  const selected = teams.find(team => team.id === selectedId) ?? teams[0];
  const isLeader = selected?.role === 'owner';
  const canManageSchedules = selected?.role === 'owner' || selected?.role === 'manager';

  const loadTeams = useCallback(async () => {
    if (!user) return;
    const requestedSub = user.sub; setLoadedForSub(null);
    try {
      const result = await cloudRequest<Page<CloudTeam> | CloudTeam[]>('/teams?limit=100');
      if (userSubRef.current !== requestedSub) return;
      const items = pageItems(result); setTeams(items);
      setSelectedId(current => items.some(team => team.id === current) ? current : items[0]?.id ?? '');
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

  const loadAdministration = useCallback(async () => {
    if (!user) return;
    try {
      const incoming = await cloudRequest<Page<CloudInvitation> | CloudInvitation[]>('/invitations?limit=100');
      setInvitations(pageItems(incoming).filter(invitation => invitation.status === 'pending'));
      if (user.applicationAdmin) {
        const result = await cloudRequest<Page<CloudUser> | CloudUser[]>('/admin/users?limit=100');
        setUsers(pageItems(result));
      } else setUsers([]);
    } catch (error) { setMessage(cloudErrorMessage(error)); }
  }, [user]);

  useEffect(() => { void loadTeams(); void loadAdministration(); }, [loadTeams, loadAdministration]);
  useEffect(() => { if (!user) { setLoadedForSub(null); setTeams([]); setMembers([]); setInvitations([]); setUsers([]); setSelectedId(''); } }, [user]);
  useEffect(() => { void loadMembers(); }, [loadMembers]);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setMessage(null);
    try { await operation(); } catch (error) { setMessage(cloudErrorMessage(error)); } finally { setBusy(false); }
  };

  const createTeam = () => run(async () => {
    const name = teamName.trim(); if (!name) throw new Error('Enter a team name.');
    const created = await cloudRequest<CloudTeam>('/teams', { method:'POST', body:JSON.stringify({ mutationId:createMutationId(), value:{ name, timezone:'Asia/Kuala_Lumpur' } }) });
    setTeams(previous => [...previous,created]); setSelectedId(created.id); setTeamName(''); setMessage('Team created.');
  });

  const createInvite = () => run(async () => {
    if (!selected) return;
    const email = inviteeEmail.trim().toLowerCase(); if (!email) throw new Error('Enter an admitted user email.');
    await cloudRequest<CloudInvitation>(`/teams/${encodeURIComponent(selected.id)}/invitations`, {
      method:'POST', body:JSON.stringify({ mutationId:createMutationId(), value:{ inviteeUsername:email, role:inviteRole, expiresAt:new Date(Date.now()+7*86_400_000).toISOString() } }),
    });
    setInviteeEmail(''); setMessage('Invitation created. The user can accept it on this page.');
  });

  const respondInvite = (invite: CloudInvitation, status: 'accepted'|'declined') => run(async () => {
    await cloudRequest<CloudInvitation>(`/invitations/${encodeURIComponent(invite.id)}`, { method:'PATCH', body:JSON.stringify({ mutationId:createMutationId(), value:{ status } }) });
    await loadAdministration(); if (status === 'accepted') await loadTeams();
    setMessage(status === 'accepted' ? 'Invitation accepted.' : 'Invitation declined.');
  });

  const changeRole = (member: CloudMember, nextRole: Exclude<TeamRole,'owner'>) => run(async () => {
    await cloudRequest<CloudMember>(`/teams/${encodeURIComponent(selected!.id)}/members/${encodeURIComponent(member.sub)}`, { method:'PATCH', body:JSON.stringify({ mutationId:createMutationId(), value:{ role:nextRole } }) });
    await loadMembers(); await cloud?.refresh(); setMessage(`${member.displayName} is now ${nextRole}.`);
  });

  const removeMember = (member: CloudMember) => run(async () => {
    await cloudRequest<CloudMember>(`/teams/${encodeURIComponent(selected!.id)}/members/${encodeURIComponent(member.sub)}`, { method:'DELETE', body:JSON.stringify({ mutationId:createMutationId() }) });
    if (member.sub === user?.sub) await loadTeams(); else await loadMembers();
    await cloud?.refresh(); setMessage(member.sub === user?.sub ? 'You left the team.' : `${member.displayName} was removed.`);
  });

  const transferLeadership = (member: CloudMember) => run(async () => {
    await cloudRequest<CloudTeam>(`/teams/${encodeURIComponent(selected!.id)}/transfer-ownership`, { method:'POST', body:JSON.stringify({ mutationId:createMutationId(), expectedVersion:selected!.version, value:{ newOwnerSub:member.sub } }) });
    await loadTeams(); await loadMembers(); await cloud?.refresh(); setMessage(`${member.displayName} is now the team leader.`);
  });

  const createMemberCalendar = (member: CloudMember) => run(async () => {
    await cloudRequest<CloudCalendar>('/calendars', { method:'POST', body:JSON.stringify({ mutationId:createMutationId(), value:{ name:`${member.displayName || 'Member'} shifts`, color:'#3B82F6', timezone:selected!.timezone, teamId:selected!.id, assignedMemberSub:member.sub } }) });
    await cloud?.refresh(); setMessage(`Team calendar created for ${member.displayName || member.sub}.`);
  });

  const updateUser = (target: CloudUser, value: Pick<CloudUser,'disabled'|'applicationAdmin'>) => run(async () => {
    await cloudRequest<CloudUser>(`/admin/users/${encodeURIComponent(target.sub)}`, { method:'PATCH', body:JSON.stringify({ mutationId:createMutationId(), expectedVersion:target.version, value }) });
    await loadAdministration(); setMessage('User status updated.');
  });

  const palette = useMemo(() => ({ input:{ color:colors.text,borderColor:colors.border,backgroundColor:colors.surface } }), [colors]);
  if (!cloud?.enabled) return <Redirect href="/" />;
  if (!user || loadedForSub !== user.sub) return <View style={[styles.loading,{backgroundColor:colors.background}]}><ActivityIndicator color={colors.primary}/></View>;

  return <ScrollView style={{flex:1,backgroundColor:colors.background}} contentContainerStyle={styles.container}>
    <Text style={[styles.title,{color:colors.text}]}>Teams</Text>
    <Text style={[styles.subtitle,{color:colors.textSecondary}]}>Private calendars remain private when you join a team. Team leaders and managers edit team calendars; members and viewers have read-only access.</Text>
    {!!message && <Text accessibilityRole="alert" style={[styles.message,{color:colors.textSecondary}]}>{message}</Text>}

    {invitations.length > 0 && <View style={[styles.card,{backgroundColor:colors.surface,borderColor:colors.border}]}>
      <Text style={[styles.cardTitle,{color:colors.text}]}>Your invitations</Text>
      {invitations.map(invite => <View key={invite.id} style={styles.row}><Text style={[styles.flex,{color:colors.text}]}>{invite.teamName} · {roleLabel(invite.role)}</Text><TouchableOpacity disabled={busy} onPress={()=>respondInvite(invite,'accepted')}><Text style={{color:colors.primary}}>Accept</Text></TouchableOpacity><TouchableOpacity disabled={busy} onPress={()=>respondInvite(invite,'declined')}><Text style={{color:'#EF4444'}}>Decline</Text></TouchableOpacity></View>)}
    </View>}

    {user.applicationAdmin && <View style={styles.row}><TextInput value={teamName} onChangeText={setTeamName} placeholder="New team name" placeholderTextColor={colors.textSecondary} style={[styles.input,palette.input,styles.flex]}/><TouchableOpacity disabled={busy} onPress={createTeam} style={[styles.button,{backgroundColor:colors.primary}]}><Text style={styles.buttonText}>Create team</Text></TouchableOpacity></View>}

    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.teamList}>
      {teams.map(team => <TouchableOpacity key={team.id} onPress={()=>setSelectedId(team.id)} style={[styles.teamChip,{borderColor:team.id===selected?.id?colors.primary:colors.border,backgroundColor:colors.surface}]}><Text style={{color:colors.text,fontWeight:'700'}}>{team.name}</Text><Text style={{color:colors.textSecondary,fontSize:11}}>{roleLabel(team.role)}</Text></TouchableOpacity>)}
    </ScrollView>

    {selected ? <>
      <View style={[styles.card,{backgroundColor:colors.surface,borderColor:colors.border}]}>
        <Text style={[styles.cardTitle,{color:colors.text}]}>{selected.name}</Text><Text style={{color:colors.textSecondary,lineHeight:20}}>{capabilityText(selected.role)}</Text>
        {isLeader && <><Text style={[styles.label,{color:colors.text}]}>Invite an existing admitted user</Text><Text style={{color:colors.textSecondary,fontSize:12}}>This does not add anyone to Cloudflare Access or send email.</Text>
          <TextInput value={inviteeEmail} onChangeText={setInviteeEmail} autoCapitalize="none" keyboardType="email-address" placeholder="user@example.com" placeholderTextColor={colors.textSecondary} style={[styles.input,palette.input]}/>
          <View style={styles.roleRow}>{editableRoles.map(item=><TouchableOpacity key={item} onPress={()=>setInviteRole(item)} style={[styles.role,{borderColor:inviteRole===item?colors.primary:colors.border}]}><Text style={{color:colors.text}}>{item}</Text></TouchableOpacity>)}</View>
          <TouchableOpacity disabled={busy} onPress={createInvite} style={[styles.wideButton,{backgroundColor:colors.primary}]}><MaterialCommunityIcons name="account-plus" color="#FFF" size={18}/><Text style={styles.buttonText}>Create invitation</Text></TouchableOpacity>
        </>}
      </View>
      <Text style={[styles.sectionTitle,{color:colors.text}]}>Members</Text>
      {members.map(member=><View key={member.sub} style={[styles.member,{backgroundColor:colors.surface,borderColor:colors.border}]}>
        <View style={styles.flex}><Text style={{color:colors.text,fontWeight:'700'}}>{member.displayName}{member.sub===user.sub?' (you)':''}</Text><Text style={{color:colors.textSecondary,fontSize:12}}>{capabilityText(member.role)}</Text></View>
        {isLeader && member.role!=='owner' && <View style={styles.actions}>{editableRoles.map(item=><TouchableOpacity key={item} disabled={member.role===item||busy} onPress={()=>changeRole(member,item)}><Text style={{color:member.role===item?colors.textSecondary:colors.primary,fontSize:12}}>{item}</Text></TouchableOpacity>)}<TouchableOpacity disabled={busy} onPress={()=>transferLeadership(member)}><Text style={{color:colors.primary,fontSize:12}}>make leader</Text></TouchableOpacity><TouchableOpacity disabled={busy} onPress={()=>Alert.alert('Remove member?',member.displayName,[{text:'Cancel'},{text:'Remove',style:'destructive',onPress:()=>void removeMember(member)}])}><Text style={{color:'#EF4444',fontSize:12}}>remove</Text></TouchableOpacity></View>}
        {!isLeader && member.sub===user.sub && member.role!=='owner' && <TouchableOpacity disabled={busy} onPress={()=>removeMember(member)}><Text style={{color:'#EF4444'}}>Leave</Text></TouchableOpacity>}
        {canManageSchedules && <TouchableOpacity disabled={busy} onPress={()=>createMemberCalendar(member)}><Text style={{color:colors.primary,fontSize:12}}>Add calendar</Text></TouchableOpacity>}
      </View>)}
    </> : <Text style={{color:colors.textSecondary}}>No team membership yet.</Text>}

    {user.applicationAdmin && <><Text style={[styles.sectionTitle,{color:colors.text}]}>Application users</Text><Text style={{color:colors.textSecondary,fontSize:12}}>Access admission is managed separately in Cloudflare. These controls change application access only.</Text>
      {users.map(item=><View key={item.sub} style={[styles.member,{backgroundColor:colors.surface,borderColor:colors.border}]}><View style={styles.flex}><Text style={{color:colors.text,fontWeight:'700'}}>{item.displayName}{item.sub===user.sub?' (you)':''}</Text><Text style={{color:colors.textSecondary,fontSize:12}}>{item.disabled?'Deactivated':'Active'} · {item.applicationAdmin?'administrator':'standard user'} · Access: external</Text></View>{item.sub!==user.sub&&<View style={styles.actions}><TouchableOpacity disabled={busy} onPress={()=>updateUser(item,{disabled:!item.disabled,applicationAdmin:item.applicationAdmin})}><Text style={{color:item.disabled?colors.primary:'#EF4444',fontSize:12}}>{item.disabled?'activate':'deactivate'}</Text></TouchableOpacity><TouchableOpacity disabled={busy} onPress={()=>updateUser(item,{disabled:item.disabled,applicationAdmin:!item.applicationAdmin})}><Text style={{color:colors.primary,fontSize:12}}>{item.applicationAdmin?'remove admin':'make admin'}</Text></TouchableOpacity></View>}</View>)}
    </>}
  </ScrollView>;
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
