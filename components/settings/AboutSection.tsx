import React from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Alert } from '../../utils/platformAlert';
import { resetLocalData } from '../../utils/exportImport';
import * as Haptics from 'expo-haptics';

type Props = {
  cloudMode?: boolean;
  colors: any;
  showPrivacy: boolean;
  setShowPrivacy: (v: boolean) => void;
};

export function AboutSection({ colors, showPrivacy, setShowPrivacy, cloudMode = false }: Props) {
  return (
    <>
      {/* Data Management */}
      {!cloudMode && <>
      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>DATA</Text>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <TouchableOpacity
          style={styles.dangerRow}
          onPress={() => {
            Alert.alert(
              'Reset All Data',
              'This will permanently delete all shifts, notes, overtime, and custom calendars. This cannot be undone.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Reset Everything',
                  style: 'destructive',
                  onPress: async () => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                    await resetLocalData();
                    Alert.alert('Done', 'All data has been reset. Please restart the app.');
                  },
                },
              ]
            );
          }}
          activeOpacity={0.6}
        >
          <MaterialCommunityIcons name="delete-sweep-outline" size={20} color="#EF4444" />
          <Text style={styles.dangerRowText}>Reset All Data</Text>
          <MaterialCommunityIcons name="chevron-right" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      </>}

      {/* About */}
      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>ABOUT</Text>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.aboutRow}>
          <Text style={[styles.aboutLabel, { color: colors.text }]}>App Name</Text>
          <Text style={[styles.aboutValue, { color: colors.textSecondary }]}>ShiftCalendar</Text>
        </View>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <View style={styles.aboutRow}>
          <Text style={[styles.aboutLabel, { color: colors.text }]}>Version</Text>
          <Text style={[styles.aboutValue, { color: colors.textSecondary }]}>2.5.1</Text>
        </View>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <View style={styles.aboutRow}>
          <Text style={[styles.aboutLabel, { color: colors.text }]}>Developer</Text>
          <Text style={[styles.aboutValue, { color: colors.primary }]}>Troy</Text>
        </View>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <TouchableOpacity
          style={styles.aboutRow}
          onPress={() => setShowPrivacy(true)}
          activeOpacity={0.6}
        >
          <Text style={[styles.aboutLabel, { color: colors.text }]}>Privacy Policy</Text>
          <MaterialCommunityIcons name="chevron-right" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <View style={styles.madeBy}>
          <MaterialCommunityIcons name="heart" size={16} color={colors.primary} />
          <Text style={[styles.madeByText, { color: colors.textSecondary }]}>Made by Troy</Text>
        </View>
      </View>

      {/* Privacy Policy Modal */}
      <Modal visible={showPrivacy} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
          <View style={[styles.privacyHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.privacyTitle, { color: colors.text }]}>Privacy Policy</Text>
            <TouchableOpacity onPress={() => setShowPrivacy(false)} style={styles.privacyClose}>
              <MaterialCommunityIcons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.privacyContent} showsVerticalScrollIndicator={false}>
            <Text style={[styles.privacyUpdated, { color: colors.textSecondary }]}>
              Last updated: September 2026
            </Text>

            <Text style={[styles.privacyBody, { color: colors.text }]}>
              ShiftCalendar is committed to protecting your privacy. This policy explains how the app handles your information.
            </Text>

            <Text style={[styles.privacySectionTitle, { color: colors.text }]}>Data Storage</Text>
            <Text style={[styles.privacyBody, { color: colors.text }]}>
              Local-only calendars and preferences stay in application storage on your device. In cloud mode, login information is handled by Amazon Cognito and calendars, private details, and team memberships are stored in AWS in Malaysia. Cognito verification email may be processed through other AWS Regions.
            </Text>

            <Text style={[styles.privacySectionTitle, { color: colors.text }]}>Login and Sharing</Text>
            <Text style={[styles.privacyBody, { color: colors.text }]}>
              Local mode does not need a login. Cloud calendars require sign-in. Personal calendars stay private; a team schedule is visible to its current team members. Personal notes, overtime details, and leave balances are excluded from team rosters.
            </Text>

            <Text style={[styles.privacySectionTitle, { color: colors.text }]}>Operational Data</Text>
            <Text style={[styles.privacyBody, { color: colors.text }]}>
              Cloud operations record identifiers and update times needed to save changes and enforce permissions. Short-lived operational logs help diagnose errors. The app does not include advertising or analytics tracking.
            </Text>

            <Text style={[styles.privacySectionTitle, { color: colors.text }]}>Notifications</Text>
            <Text style={[styles.privacyBody, { color: colors.text }]}>
              If you enable shift reminders, notifications are scheduled locally on your device. No notification data is sent to any server.
            </Text>

            <Text style={[styles.privacySectionTitle, { color: colors.text }]}>Export & Backup</Text>
            <Text style={[styles.privacyBody, { color: colors.text }]}>
              When you export data (CSV, PDF) or create backups, files are saved directly to your device. These files are not uploaded to any external service unless you choose to share them yourself.
            </Text>

            <Text style={[styles.privacySectionTitle, { color: colors.text }]}>Third-Party Services</Text>
            <Text style={[styles.privacyBody, { color: colors.text }]}>
              Cloud mode uses AWS for authentication, hosting, and storage. Files you export or invitation links you share are under your control. Removing a team member prevents future server access but cannot erase copies they previously downloaded.
            </Text>

            <Text style={[styles.privacySectionTitle, { color: colors.text }]}>Children's Privacy</Text>
            <Text style={[styles.privacyBody, { color: colors.text }]}>
              ShiftCalendar does not knowingly collect information from children under 13.
            </Text>

            <Text style={[styles.privacySectionTitle, { color: colors.text }]}>Changes to This Policy</Text>
            <Text style={[styles.privacyBody, { color: colors.text }]}>
              We may update this privacy policy from time to time. Any changes will be reflected within the app.
            </Text>

            <Text style={[styles.privacySectionTitle, { color: colors.text }]}>Contact</Text>
            <Text style={[styles.privacyBody, { color: colors.text }]}>
              If you have questions about this policy, you can reach the developer through the app's support channels.
            </Text>

            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  sectionTitle: { fontSize: 13, fontWeight: '700', letterSpacing: 0.8, marginBottom: 8, marginTop: 16, marginLeft: 4 },
  card: { borderRadius: 16, borderWidth: 1, padding: 16 },
  divider: { height: 1 },
  dangerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 10 },
  dangerRowText: { flex: 1, fontSize: 15, fontWeight: '600', color: '#EF4444' },
  aboutRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  aboutLabel: { fontSize: 15, fontWeight: '600' },
  aboutValue: { fontSize: 15 },
  madeBy: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingTop: 12, gap: 6 },
  madeByText: { fontSize: 14, fontWeight: '600' },
  privacyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1 },
  privacyTitle: { fontSize: 20, fontWeight: '800' },
  privacyClose: { padding: 4 },
  privacyContent: { padding: 20 },
  privacyUpdated: { fontSize: 13, fontWeight: '600', marginBottom: 16 },
  privacySectionTitle: { fontSize: 16, fontWeight: '700', marginTop: 20, marginBottom: 6 },
  privacyBody: { fontSize: 14, lineHeight: 22 },
});
