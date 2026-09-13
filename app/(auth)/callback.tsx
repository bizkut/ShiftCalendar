import { Redirect, useLocalSearchParams } from 'expo-router';
import React, { useEffect } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../hooks/AuthContext';
import { useAppSettings } from '../../hooks/ThemeContext';

export default function AuthCallbackScreen() {
  const { user, error, loading, retrySession } = useAuth();
  const { code, state } = useLocalSearchParams<{ code?: string; state?: string }>();
  const { colors } = useAppSettings();
  useEffect(() => { void retrySession(); }, [retrySession]);
  if (user) return <Redirect href="/" />;
  if (error || (Platform.OS === 'web' && !loading && (!code || !state))) {
    return <Redirect href="/login" />;
  }
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ActivityIndicator color={colors.primary} />
      <Text style={{ color: colors.text }}>Completing secure sign-in…</Text>
    </View>
  );
}

const styles = StyleSheet.create({ container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 } });
