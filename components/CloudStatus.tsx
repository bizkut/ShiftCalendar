import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../hooks/AuthContext';
import { useShifts } from '../hooks/ShiftContext';
import { useAppSettings } from '../hooks/ThemeContext';

export function CloudStatus() {
  const { cloud } = useShifts();
  const { user, signOutUser } = useAuth();
  const { colors } = useAppSettings();
  if (!cloud?.enabled) return null;

  const busy = cloud.status === 'loading' || cloud.status === 'refreshing' || cloud.status === 'saving';
  const label = cloud.status === 'conflict'
    ? 'Conflict — refresh before retrying'
    : cloud.status === 'failed'
      ? cloud.error ?? 'Cloud save failed'
      : cloud.status === 'saving'
        ? 'Saving…'
        : cloud.status === 'refreshing'
          ? 'Refreshing…'
          : 'Saved to cloud';

  return (
    <View style={[styles.container, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      {busy ? <ActivityIndicator size="small" color={colors.primary} /> : (
        <MaterialCommunityIcons
          name={cloud.status === 'saved' ? 'cloud-check-outline' : 'cloud-alert-outline'}
          size={17}
          color={cloud.status === 'saved' ? '#10B981' : '#EF4444'}
        />
      )}
      <Text numberOfLines={1} style={[styles.label, { color: cloud.status === 'failed' || cloud.status === 'conflict' ? '#EF4444' : colors.textSecondary }]}>{label}</Text>
      <TouchableOpacity onPress={() => void cloud.refresh()} accessibilityRole="button" accessibilityLabel="Refresh cloud calendar">
        <MaterialCommunityIcons name="refresh" size={19} color={colors.textSecondary} />
      </TouchableOpacity>
      <TouchableOpacity onPress={() => void signOutUser()} accessibilityRole="button" accessibilityLabel={`Sign out ${user?.username ?? ''}`}>
        <MaterialCommunityIcons name="logout" size={19} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { height: 34, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { flex: 1, fontSize: 12, fontWeight: '600' },
});
