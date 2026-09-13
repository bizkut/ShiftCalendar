import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Redirect } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../hooks/AuthContext';
import { useAppSettings } from '../../hooks/ThemeContext';

export default function LoginScreen() {
  const { configured, cloudMode, user, error, signIn, useLocalOnly } = useAuth();
  const { colors } = useAppSettings();
  const [starting, setStarting] = useState(false);
  if (user || !cloudMode) return <Redirect href="/" />;

  const begin = async () => {
    setStarting(true);
    try { await signIn(); } finally { setStarting(false); }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={[styles.icon, { backgroundColor: colors.primary + '18' }]}>
          <MaterialCommunityIcons name="calendar-account" size={42} color={colors.primary} />
        </View>
        <Text style={[styles.title, { color: colors.text }]}>ShiftCalendar Cloud</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>{Platform.OS === 'web' ? 'Sign in with your approved email address and a one-time PIN to use your private calendar.' : 'Sign in to use private cloud calendars and team rosters across your devices.'}</Text>
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        <TouchableOpacity disabled={!configured || starting} onPress={() => void begin()} style={[styles.primary, { backgroundColor: colors.primary, opacity: configured && !starting ? 1 : 0.5 }]} accessibilityRole="button">
          {starting ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryText}>{configured ? (Platform.OS === 'web' ? 'Sign in with email' : 'Sign in or create account') : 'Cloud login unavailable'}</Text>}
        </TouchableOpacity>
        {Platform.OS !== 'web' && (
          <TouchableOpacity onPress={() => void useLocalOnly()} style={[styles.secondary, { borderColor: colors.border }]} accessibilityRole="button">
            <Text style={[styles.secondaryText, { color: colors.text }]}>Continue with local-only calendars</Text>
          </TouchableOpacity>
        )}
        <Text style={[styles.caption, { color: colors.textSecondary }]}>Cloud mode requires a connection. Failed changes remain unsaved and are shown as errors.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 440, alignSelf: 'center', padding: 28, borderRadius: 18, borderWidth: 1, gap: 16 },
  icon: { width: 72, height: 72, borderRadius: 18, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  title: { fontSize: 25, fontWeight: '800', textAlign: 'center' },
  body: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  error: { color: '#EF4444', textAlign: 'center', fontSize: 13 },
  primary: { minHeight: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  primaryText: { color: '#FFF', fontWeight: '700', fontSize: 15 },
  secondary: { minHeight: 48, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  secondaryText: { fontWeight: '700', fontSize: 14 },
  caption: { fontSize: 12, lineHeight: 17, textAlign: 'center' },
});
