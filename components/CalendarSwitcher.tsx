import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { CalendarInfo } from '../hooks/useShiftData';
import type { CloudCalendar } from '../shared/cloudTypes';
import { useShifts } from '../hooks/ShiftContext';

interface Props {
  calendars: CalendarInfo[];
  activeCalendarId: string;
  onSwitch: (calId: string) => void;
  colors: {
    text: string;
    textSecondary: string;
    border: string;
  };
}

export const CalendarSwitcher = React.memo(function CalendarSwitcher({ calendars, activeCalendarId, onSwitch, colors }: Props) {
  const { cloud } = useShifts();
  if (calendars.length <= 1) return null;

  const cloudCalendars = calendars as Array<CalendarInfo & Partial<CloudCalendar>>;
  const groups = cloud?.enabled
    ? [
        { id: 'personal', label: 'My shifts', items: cloudCalendars.filter((calendar) => calendar.scope !== 'team') },
        ...cloud.teams.map((team) => ({ id: team.id, label: `Team roster · ${team.name}`, items: cloudCalendars.filter((calendar) => calendar.teamId === team.id) })),
      ].filter((group) => group.items.length)
    : [{ id: 'local', label: '', items: cloudCalendars }];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scrollView}
      contentContainerStyle={styles.container}
    >
      {groups.map((group) => <View key={group.id} style={styles.group}>
        {!!group.label && <Text style={[styles.groupLabel, { color: colors.textSecondary }]}>{group.label}</Text>}
        <View style={styles.groupRow}>{group.items.map((cal) => {
        const isActive = cal.id === activeCalendarId;
        const label = cal.scope === 'team' ? cal.assignedMemberDisplayName || cal.name : cal.name;
        return (
          <TouchableOpacity
            key={cal.id}
            style={[
              styles.chip,
              {
                backgroundColor: isActive ? cal.color : 'transparent',
                borderColor: isActive ? cal.color : colors.border,
              },
            ]}
            onPress={() => onSwitch(cal.id)}
            accessibilityLabel={`${cal.scope === 'team' ? `${label} in ${group.label}` : `${label} calendar`}${isActive ? ', active' : ''}`}
            accessibilityRole="button"
          >
            <View style={[styles.dot, { backgroundColor: isActive ? '#FFF' : cal.color }]} />
            <Text style={[styles.text, { color: isActive ? '#FFF' : colors.textSecondary }]}>
              {label}
            </Text>
          </TouchableOpacity>
        );
        })}</View>
      </View>)}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  scrollView: {
    flexGrow: 0,
    flexShrink: 0,
  },
  container: {
    paddingHorizontal: 16,
    paddingTop: 2,
    paddingBottom: 4,
    gap: 6,
    alignItems: 'center',
  },
  group: { gap: 3 },
  groupRow: { flexDirection: 'row', gap: 6 },
  groupLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', paddingLeft: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    gap: 5,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 12, fontWeight: '600' },
});
