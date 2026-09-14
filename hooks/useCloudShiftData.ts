import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { endOfMonth, format, startOfMonth } from 'date-fns';
import { DEFAULT_LEAVE_TYPES } from '../constants/leaveTypes';
import { DEFAULT_SHIFTS, type ShiftType } from '../constants/shifts';
import type {
  BulkDayRequest,
  CloudCalendar,
  CloudCalendarDay,
  CloudCalendarDayTombstone,
  CloudPrivateDetails,
  CloudShiftType,
  CloudTeam,
  Page,
  TeamRosterDay,
} from '../shared/cloudTypes';
import { CloudApiError, cloudErrorMessage, cloudRequest, createMutationId } from '../utils/cloudClient';
import { useAuth } from './AuthContext';
import type { CalendarInfo, LeaveBalances, LeaveData, NotesData, OvertimeData, ShiftData, SwapRequest, SwapsData } from './useShiftData';

export type CloudSyncStatus = 'loading' | 'refreshing' | 'saved' | 'saving' | 'failed' | 'conflict';
export type CloudCalendarInfo = CalendarInfo & CloudCalendar;

interface BootstrapResponse {
  profile: { sub: string };
  calendars: CloudCalendar[];
  teams: CloudTeam[];
}

function pageItems<T>(value: Page<T> | T[]): T[] {
  return Array.isArray(value) ? value : value.items;
}

function toShiftType(value: CloudShiftType): ShiftType {
  return {
    code: value.code,
    label: value.label,
    color: value.color,
    startTime: value.startTime,
    endTime: value.endTime,
    icon: value.icon,
    isDefault: value.isDefault,
    archived: value.archived,
    position: value.position,
  };
}

const emptyPrivateDetails = (calendarId: string): CloudPrivateDetails => ({
  calendarId,
  leaveBalances: Object.fromEntries(DEFAULT_LEAVE_TYPES.map((type) => [type.id, type.defaultDays])),
  days: [],
  version: 0,
  updatedAt: '',
});

function monthRange(month: Date | string) {
  const value = typeof month === 'string' ? new Date(`${month.slice(0, 7)}-01T12:00:00`) : month;
  return { from: format(startOfMonth(value), 'yyyy-MM-dd'), to: format(endOfMonth(value), 'yyyy-MM-dd') };
}

function utf8Bytes(value: string) {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function changedPrivateDayCount(saved: CloudPrivateDetails, next: CloudPrivateDetails) {
  const savedDays = new Map(saved.days.map((day) => [day.date, day]));
  const nextDays = new Map(next.days.map((day) => [day.date, day]));
  return new Set([...savedDays.keys(), ...nextDays.keys()]).size === 0 ? 0 :
    [...new Set([...savedDays.keys(), ...nextDays.keys()])].filter((date) => JSON.stringify(savedDays.get(date)) !== JSON.stringify(nextDays.get(date))).length;
}

export function useCloudShiftData() {
  const { user } = useAuth();
  const [calendars, setCalendars] = useState<CloudCalendarInfo[]>([]);
  const [teams, setTeams] = useState<CloudTeam[]>([]);
  const [activeCalendarId, setActiveCalendarId] = useState('');
  const [shiftData, setShiftData] = useState<ShiftData>({});
  const [notesData, setNotesData] = useState<NotesData>({});
  const [overtimeData, setOvertimeData] = useState<OvertimeData>({});
  const [leaveData, setLeaveData] = useState<LeaveData>({});
  const [leaveBalances, setLeaveBalances] = useState<LeaveBalances>({});
  const [swapsData] = useState<SwapsData>({});
  const [allShifts, setAllShifts] = useState<ShiftType[]>(DEFAULT_SHIFTS);
  const [lastUsedShift, setLastUsedShift] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedSub, setLoadedSub] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<CloudSyncStatus>('loading');
  const [syncError, setSyncError] = useState<string | null>(null);
  const dayVersions = useRef<Record<string, number>>({});
  const shiftTypeVersions = useRef<Record<string, number>>({});
  const privateDetails = useRef<CloudPrivateDetails>(emptyPrivateDetails(''));
  const savedPrivateDetails = useRef<CloudPrivateDetails>(emptyPrivateDetails(''));
  const activeIdRef = useRef('');
  const visibleRangeRef = useRef(monthRange(new Date()));
  const userSubRef = useRef(user?.sub);
  userSubRef.current = user?.sub;

  const activeCalendar = calendars.find((calendar) => calendar.id === activeCalendarId) ?? calendars[0] ?? ({
    id: '', name: 'Cloud calendar', color: '#6366F1', timezone: 'Asia/Kuala_Lumpur', scope: 'private', version: 0, updatedAt: '',
  } as CloudCalendarInfo);

  const canEdit = activeCalendar.scope === 'private' || activeCalendar.role === 'owner' || activeCalendar.role === 'manager';

  const fail = useCallback((error: unknown) => {
    setSyncError(cloudErrorMessage(error));
    setSyncStatus(error instanceof CloudApiError && error.code === 'conflict' ? 'conflict' : 'failed');
  }, []);

  const requireEdit = useCallback(() => {
    if (syncStatus === 'loading' || syncStatus === 'refreshing') {
      fail(new Error('Wait for the visible calendar range to finish loading before editing.'));
      return false;
    }
    if (canEdit) return true;
    fail(new Error('Your team role can view this calendar but cannot edit it.'));
    return false;
  }, [canEdit, fail, syncStatus]);

  const loadCalendar = useCallback(async (calendar: CloudCalendarInfo, refreshing = false, expectedSub = userSubRef.current) => {
    setSyncStatus(refreshing ? 'refreshing' : 'loading');
    setSyncError(null);
    const { from, to } = visibleRangeRef.current;
    const requestedRange = `${from}:${to}`;
    try {
      const dayPath = calendar.scope === 'team'
        ? `/teams/${encodeURIComponent(calendar.teamId!)}/roster?from=${from}&to=${to}&memberSub=${encodeURIComponent(calendar.assignedMemberSub!)}&limit=100`
        : `/calendars/${encodeURIComponent(calendar.id)}/days?from=${from}&to=${to}&limit=100`;
      const [dayPage, typePage, details] = await Promise.all([
        cloudRequest<Page<CloudCalendarDay | CloudCalendarDayTombstone | TeamRosterDay> | Array<CloudCalendarDay | CloudCalendarDayTombstone | TeamRosterDay>>(dayPath),
        cloudRequest<Page<CloudShiftType> | CloudShiftType[]>(`/calendars/${encodeURIComponent(calendar.id)}/shift-types?limit=100`),
        calendar.scope === 'private'
          ? cloudRequest<CloudPrivateDetails>(`/calendars/${encodeURIComponent(calendar.id)}/private-details`)
          : Promise.resolve(emptyPrivateDetails(calendar.id)),
      ]);
      const currentRange = visibleRangeRef.current;
      if (activeIdRef.current !== calendar.id || userSubRef.current !== expectedSub || `${currentRange.from}:${currentRange.to}` !== requestedRange) return;
      const days = pageItems(dayPage);
      const shiftTypes = pageItems(typePage);
      Object.keys(dayVersions.current).forEach((date) => { if (date >= from && date <= to) delete dayVersions.current[date]; });
      days.forEach((day) => { dayVersions.current[day.date] = day.version; });
      shiftTypeVersions.current = Object.fromEntries(shiftTypes.map((shift) => [shift.code, shift.version]));
      setAllShifts([
        ...DEFAULT_SHIFTS.filter((builtIn) => !shiftTypes.some((shift) => shift.code === builtIn.code)),
        ...shiftTypes.map(toShiftType),
      ]);
      setShiftData((previous) => ({
        ...Object.fromEntries(Object.entries(previous).filter(([date]) => date < from || date > to)),
        ...Object.fromEntries(days.filter((day): day is CloudCalendarDay => !('deleted' in day) && Boolean(day.shiftCode)).map((day) => [day.date, day.shiftCode!])),
      }));
      privateDetails.current = details;
      savedPrivateDetails.current = details;
      setNotesData(Object.fromEntries(details.days.filter((day) => day.note).map((day) => [day.date, day.note!] )));
      setOvertimeData(Object.fromEntries(details.days.filter((day) => day.overtimeHours).map((day) => [day.date, day.overtimeHours!] )));
      setLeaveData(Object.fromEntries(details.days.filter((day) => day.leaveTypeId).map((day) => [day.date, day.leaveTypeId!] )));
      setLeaveBalances(details.leaveBalances);
      setSyncStatus('saved');
    } catch (error) { fail(error); }
  }, [fail]);

  const bootstrap = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    const requestedSub = user.sub;
    setLoadedSub(null);
    setCalendars([]);
    setTeams([]);
    setShiftData({});
    setNotesData({});
    setOvertimeData({});
    setLeaveData({});
    setLeaveBalances({});
    dayVersions.current = {};
    shiftTypeVersions.current = {};
    privateDetails.current = emptyPrivateDetails('');
    savedPrivateDetails.current = emptyPrivateDetails('');
    setLoading(true);
    try {
      const data = await cloudRequest<BootstrapResponse>('/bootstrap');
      if (userSubRef.current !== requestedSub) return;
      let cloudCalendars = data.calendars;
      if (!cloudCalendars.length) {
        const created = await cloudRequest<CloudCalendar>('/calendars', {
          method: 'POST',
          body: JSON.stringify({ mutationId: createMutationId(), value: { name: 'My Shifts', color: '#6366F1', timezone: 'Asia/Kuala_Lumpur', scope: 'private' } }),
        });
        if (userSubRef.current !== requestedSub) return;
        cloudCalendars = [created];
      }
      setCalendars(cloudCalendars as CloudCalendarInfo[]);
      setTeams(data.teams);
      const selected = cloudCalendars.find((calendar) => calendar.id === activeIdRef.current) ?? cloudCalendars[0];
      setActiveCalendarId(selected.id);
      activeIdRef.current = selected.id;
      await loadCalendar(selected as CloudCalendarInfo, false, requestedSub);
    } catch (error) { if (userSubRef.current === requestedSub) fail(error); } finally {
      if (userSubRef.current === requestedSub) { setLoadedSub(requestedSub); setLoading(false); }
    }
  }, [fail, loadCalendar, user]);

  useEffect(() => { bootstrap(); }, [bootstrap]);
  useEffect(() => {
    if (user) return;
    setLoadedSub(null); setCalendars([]); setTeams([]); setShiftData({}); setNotesData({}); setOvertimeData({}); setLeaveData({}); setLeaveBalances({});
    dayVersions.current = {}; shiftTypeVersions.current = {}; privateDetails.current = emptyPrivateDetails(''); savedPrivateDetails.current = emptyPrivateDetails(''); activeIdRef.current = '';
  }, [user]);
  useEffect(() => {
    const refresh = () => {
      const calendar = calendars.find((item) => item.id === activeIdRef.current);
      if (calendar) loadCalendar(calendar, true);
    };
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.addEventListener('focus', refresh);
    return () => {
      subscription.remove();
      if (Platform.OS === 'web' && typeof window !== 'undefined') window.removeEventListener('focus', refresh);
    };
  }, [calendars, loadCalendar]);

  const switchCalendar = useCallback((calendarId: string) => {
    const calendar = calendars.find((item) => item.id === calendarId);
    if (!calendar) return;
    setActiveCalendarId(calendarId);
    activeIdRef.current = calendarId;
    setShiftData({}); setNotesData({}); setOvertimeData({}); setLeaveData({});
    setLeaveBalances({}); setAllShifts(DEFAULT_SHIFTS);
    dayVersions.current = {}; shiftTypeVersions.current = {}; privateDetails.current = emptyPrivateDetails(calendarId); savedPrivateDetails.current = emptyPrivateDetails(calendarId);
    void loadCalendar(calendar);
  }, [calendars, loadCalendar]);

  const setVisibleMonth = useCallback((month: Date | string) => {
    const next = monthRange(month);
    const current = visibleRangeRef.current;
    if (current.from === next.from && current.to === next.to) return;
    visibleRangeRef.current = next;
    const calendar = calendars.find((item) => item.id === activeIdRef.current);
    if (calendar) void loadCalendar(calendar, true);
  }, [calendars, loadCalendar]);

  const saveDay = useCallback(async (date: string, shiftCode?: string) => {
    if (!requireEdit()) return;
    setSyncStatus('saving'); setSyncError(null);
    setShiftData((previous) => {
      const next = { ...previous };
      if (shiftCode) next[date] = shiftCode; else delete next[date];
      return next;
    });
    if (shiftCode) setLastUsedShift(shiftCode);
    const calendarId = activeIdRef.current;
    const calendar = calendars.find((item) => item.id === calendarId);
    try {
      const dayPath = calendar?.scope === 'team'
        ? `/teams/${encodeURIComponent(calendar.teamId!)}/roster/${encodeURIComponent(calendar.assignedMemberSub!)}/days/${date}`
        : `/calendars/${encodeURIComponent(calendarId)}/days/${date}`;
      const saved = await cloudRequest<CloudCalendarDay | CloudCalendarDayTombstone>(dayPath, {
        method: 'PATCH',
        body: JSON.stringify({ mutationId: createMutationId(), expectedVersion: dayVersions.current[date] ?? 0, value: shiftCode ? { shiftCode } : null }),
      });
      if (activeIdRef.current !== calendarId) return;
      dayVersions.current[date] = saved.version;
      setShiftData((previous) => {
        const next = { ...previous };
        if (!('deleted' in saved) && saved.shiftCode) next[date] = saved.shiftCode; else delete next[date];
        return next;
      });
      setSyncStatus('saved');
    } catch (error) { if (activeIdRef.current === calendarId) fail(error); }
  }, [calendars, fail, requireEdit]);

  const setShift = useCallback((date: string, code: string) => { void saveDay(date, code); }, [saveDay]);
  const clearShift = useCallback((date: string) => { void saveDay(date); }, [saveDay]);
  const setShiftsBulk = useCallback(async (entries: Record<string, string>) => {
    if (!requireEdit()) return;
    const calendar = calendars.find((item) => item.id === activeIdRef.current);
    if (calendar?.scope === 'team') {
      fail(new Error('Team roster bulk scheduling is planned for the next milestone. Edit one date at a time.'));
      return;
    }
    const edits = Object.entries(entries);
    if (!edits.length) return;
    setSyncStatus('saving'); setSyncError(null);
    setShiftData((previous) => ({ ...previous, ...entries }));
    let savedCount = 0;
    const calendarId = activeIdRef.current;
    try {
      for (let offset = 0; offset < edits.length; offset += 8) {
        if (activeIdRef.current !== calendarId) throw new Error('Calendar changed before all bulk edits finished. Return to the original calendar and refresh it.');
        const chunk = edits.slice(offset, offset + 8);
        const request: BulkDayRequest = {
          mutationId: createMutationId(),
          edits: chunk.map(([date, shiftCode]) => ({ date, expectedVersion: dayVersions.current[date] ?? 0, value: { shiftCode } })),
        };
        const saved = await cloudRequest<Array<CloudCalendarDay | CloudCalendarDayTombstone>>(`/calendars/${encodeURIComponent(calendarId)}/days/bulk`, { method: 'POST', body: JSON.stringify(request) });
        savedCount += chunk.length;
        if (activeIdRef.current !== calendarId) throw new Error('Calendar changed while bulk edits were saving. Return to the original calendar and refresh it.');
        saved.forEach((day) => { dayVersions.current[day.date] = day.version; });
        setShiftData((previous) => ({ ...previous, ...Object.fromEntries(saved.filter((day): day is CloudCalendarDay => !('deleted' in day) && Boolean(day.shiftCode)).map((day) => [day.date, day.shiftCode!])) }));
      }
      setSyncStatus('saved');
    } catch (error) {
      const detail = cloudErrorMessage(error);
      fail(new Error(savedCount ? `${savedCount} of ${edits.length} days were saved. The remaining changes are unsaved: ${detail}` : detail));
    }
  }, [calendars, fail, requireEdit]);

  const updatePrivate = useCallback(async (update: (current: CloudPrivateDetails) => CloudPrivateDetails) => {
    if (activeCalendar.scope !== 'private') { fail(new Error('Notes, overtime, pay, and leave details are private and unavailable on team calendars.')); return; }
    setSyncStatus('saving'); setSyncError(null);
    const next = update(privateDetails.current);
    if (changedPrivateDayCount(savedPrivateDetails.current, next) > 4) {
      fail(new Error('At most four private calendar dates can be retried together. Refresh this calendar, then save the remaining notes or leave details again.'));
      return;
    }
    privateDetails.current = next;
    setNotesData(Object.fromEntries(next.days.filter((day) => day.note).map((day) => [day.date, day.note!] )));
    setOvertimeData(Object.fromEntries(next.days.filter((day) => day.overtimeHours).map((day) => [day.date, day.overtimeHours!] )));
    setLeaveData(Object.fromEntries(next.days.filter((day) => day.leaveTypeId).map((day) => [day.date, day.leaveTypeId!] )));
    setLeaveBalances(next.leaveBalances);
    const calendarId = activeIdRef.current;
    try {
      const saved = await cloudRequest<CloudPrivateDetails>(`/calendars/${encodeURIComponent(calendarId)}/private-details`, {
        method: 'PATCH', body: JSON.stringify({ mutationId: createMutationId(), expectedVersion: next.version, value: { payRate: next.payRate, leaveBalances: next.leaveBalances, days: next.days } }),
      });
      if (activeIdRef.current !== calendarId) return;
      privateDetails.current = saved;
      savedPrivateDetails.current = saved;
      setNotesData(Object.fromEntries(saved.days.filter((day) => day.note).map((day) => [day.date, day.note!] )));
      setOvertimeData(Object.fromEntries(saved.days.filter((day) => day.overtimeHours).map((day) => [day.date, day.overtimeHours!] )));
      setLeaveData(Object.fromEntries(saved.days.filter((day) => day.leaveTypeId).map((day) => [day.date, day.leaveTypeId!] )));
      setLeaveBalances(saved.leaveBalances);
      setSyncStatus('saved');
    } catch (error) { if (activeIdRef.current === calendarId) fail(error); }
  }, [activeCalendar.scope, fail]);

  const updatePrivateDay = useCallback((date: string, fields: { note?: string; overtimeHours?: number; leaveTypeId?: string }) => {
    void updatePrivate((current) => {
      const existing = current.days.find((day) => day.date === date) ?? { date, version: 0, updatedAt: '' };
      const day = { ...existing, ...fields };
      Object.keys(day).forEach((key) => { if (day[key as keyof typeof day] === undefined) delete day[key as keyof typeof day]; });
      const days = Object.keys(day).length <= 3 ? current.days.filter((item) => item.date !== date) : [...current.days.filter((item) => item.date !== date), day];
      return { ...current, days };
    });
  }, [updatePrivate]);

  const setNote = useCallback((date: string, note: string) => {
    const normalized = note.trim();
    if (utf8Bytes(normalized) > 2048) { fail(new Error('Cloud notes must be 2 KB or smaller. Shorten this note before saving.')); return; }
    updatePrivateDay(date, { note: normalized || undefined });
  }, [fail, updatePrivateDay]);
  const clearNote = useCallback((date: string) => updatePrivateDay(date, { note: undefined }), [updatePrivateDay]);
  const setOvertime = useCallback((date: string, hours: number) => updatePrivateDay(date, { overtimeHours: hours > 0 ? hours : undefined }), [updatePrivateDay]);
  const setLeave = useCallback((date: string, leaveTypeId: string) => updatePrivateDay(date, { leaveTypeId }), [updatePrivateDay]);
  const clearLeave = useCallback((date: string) => updatePrivateDay(date, { leaveTypeId: undefined }), [updatePrivateDay]);
  const setLeaveBalance = useCallback((leaveTypeId: string, days: number) => { void updatePrivate((current) => ({ ...current, leaveBalances: { ...current.leaveBalances, [leaveTypeId]: days } })); }, [updatePrivate]);

  const saveShiftType = useCallback(async (shift: ShiftType, expectedVersion = 0) => {
    if (!requireEdit()) return;
    setSyncStatus('saving');
    try {
      const saved = await cloudRequest<CloudShiftType>(`/calendars/${encodeURIComponent(activeIdRef.current)}/shift-types/${encodeURIComponent(shift.code)}`, {
        method: 'PUT', body: JSON.stringify({ mutationId: createMutationId(), expectedVersion, value: {
          label: shift.label, color: shift.color, icon: shift.icon, startTime: shift.startTime,
          endTime: shift.endTime, position: shift.position ?? Math.max(4, allShifts.findIndex((item) => item.code === shift.code)),
        } }),
      });
      shiftTypeVersions.current[saved.code] = saved.version;
      setAllShifts((previous) => [...previous.filter((item) => item.code !== saved.code), toShiftType(saved)]);
      setSyncStatus('saved');
    } catch (error) { fail(error); }
  }, [allShifts, fail, requireEdit]);
  const addCustomShift = useCallback((shift: ShiftType) => { void saveShiftType(shift); }, [saveShiftType]);
  const updateCustomShift = useCallback((code: string, shift: ShiftType) => {
    if (code !== shift.code) { fail(new Error('Cloud shift codes cannot be renamed. Create a new shift type instead.')); return; }
    void saveShiftType(shift, shiftTypeVersions.current[code] ?? 0);
  }, [fail, saveShiftType]);
  const deleteCustomShift = useCallback(async (code: string) => {
    if (!requireEdit()) return;
    setSyncStatus('saving');
    try {
      await cloudRequest<{ code: string; deleted: true }>(`/calendars/${encodeURIComponent(activeIdRef.current)}/shift-types/${encodeURIComponent(code)}`, { method: 'DELETE', body: JSON.stringify({ mutationId: createMutationId(), expectedVersion: shiftTypeVersions.current[code] ?? 0 }) });
      setAllShifts((previous) => previous.map((shift) => shift.code === code ? { ...shift, archived: true } : shift)); setSyncStatus('saved');
    } catch (error) { fail(error); }
  }, [fail, requireEdit]);

  const addCalendar = useCallback(async (calendar: CalendarInfo) => {
    try {
      const created = await cloudRequest<CloudCalendar>('/calendars', { method: 'POST', body: JSON.stringify({ mutationId: createMutationId(), value: { name: calendar.name, color: calendar.color, timezone: 'Asia/Kuala_Lumpur', scope: 'private' } }) });
      setCalendars((previous) => [...previous, created as CloudCalendarInfo]);
    } catch (error) { fail(error); }
  }, [fail]);
  const renameCalendar = useCallback(async (calendarId: string, name: string, color: string) => {
    const calendar = calendars.find((item) => item.id === calendarId); if (!calendar) return;
    try {
      const saved = await cloudRequest<CloudCalendar>(`/calendars/${encodeURIComponent(calendarId)}`, { method: 'PATCH', body: JSON.stringify({ mutationId: createMutationId(), expectedVersion: calendar.version, value: { name, color, timezone: calendar.timezone } }) });
      setCalendars((previous) => previous.map((item) => item.id === calendarId ? saved as CloudCalendarInfo : item));
    } catch (error) { fail(error); }
  }, [calendars, fail]);
  const deleteCalendar = useCallback(async (calendarId: string) => {
    const calendar = calendars.find((item) => item.id === calendarId); if (!calendar) return;
    try {
      await cloudRequest<CloudCalendar>(`/calendars/${encodeURIComponent(calendarId)}`, { method: 'DELETE', body: JSON.stringify({ mutationId: createMutationId(), expectedVersion: calendar.version }) });
      const next = calendars.filter((item) => item.id !== calendarId); setCalendars(next);
      if (activeIdRef.current === calendarId && next[0]) switchCalendar(next[0].id);
    } catch (error) { fail(error); }
  }, [calendars, fail, switchCalendar]);

  const unsupportedSwap = useCallback((_value?: SwapRequest | string) => fail(new Error('Cloud shift swaps are planned for a later release.')), [fail]);
  const moveShift = useCallback((_code: string, _direction: 'up' | 'down') => fail(new Error('Cloud shift ordering is not supported by the current API.')), [fail]);
  const getShiftByCode = useCallback((code: string) => allShifts.find((shift) => shift.code === code), [allShifts]);
  const refresh = useCallback(() => bootstrap(), [bootstrap]);
  const currentUserLoaded = Boolean(user && loadedSub === user.sub);

  return useMemo(() => ({
    shiftData: currentUserLoaded ? shiftData : {}, notesData: currentUserLoaded ? notesData : {}, overtimeData: currentUserLoaded ? overtimeData : {}, swapsData: currentUserLoaded ? swapsData : {}, loading: loading || !currentUserLoaded, writeError: syncStatus === 'failed' || syncStatus === 'conflict',
    setShift, clearShift, setShiftsBulk, setNote, clearNote, setOvertime, allShifts, addCustomShift, updateCustomShift,
    deleteCustomShift, moveShift, getShiftByCode, lastUsedShift, leaveData, leaveBalances, leaveTypes: DEFAULT_LEAVE_TYPES,
    setLeave, clearLeave, setLeaveBalance, offerSwap: unsupportedSwap, cancelSwap: unsupportedSwap, acceptSwap: unsupportedSwap,
    calendars: currentUserLoaded ? calendars : [],
    activeCalendar: currentUserLoaded ? activeCalendar : ({ id: '', name: 'Cloud calendar', color: '#6366F1', timezone: 'Asia/Kuala_Lumpur', scope: 'private', version: 0, updatedAt: '' } as CloudCalendarInfo),
    activeCalendarId: currentUserLoaded ? activeCalendarId : '', switchCalendar, addCalendar, deleteCalendar, renameCalendar,
    cloud: { enabled: true as const, status: syncStatus, error: syncError, canEdit: currentUserLoaded && canEdit && syncStatus !== 'loading' && syncStatus !== 'refreshing', teams: currentUserLoaded ? teams : [], refresh, setVisibleMonth },
  }), [shiftData, notesData, overtimeData, swapsData, loading, syncStatus, setShift, clearShift, setShiftsBulk, setNote, clearNote,
    setOvertime, allShifts, addCustomShift, updateCustomShift, deleteCustomShift, moveShift, getShiftByCode, lastUsedShift,
    leaveData, leaveBalances, setLeave, clearLeave, setLeaveBalance, unsupportedSwap, calendars, activeCalendar,
    activeCalendarId, switchCalendar, addCalendar, deleteCalendar, renameCalendar, syncError, canEdit, teams, refresh, setVisibleMonth, currentUserLoaded]);
}
