import { useCallback, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  Alert,
  ActivityIndicator,
} from 'react-native';
import MotionPressable from '@/components/MotionPressable';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect, useRef } from 'react';

import AppButton from '@/components/AppButton';
import AppTextInput from '@/components/AppTextInput';
import SurfaceCard from '@/components/SurfaceCard';
import { COLORS } from '@/constants/colors';
import { FONTS } from '@/constants/fonts';
import { useAuth, signOut } from '@/lib/auth';
import { getProfileWithError, updateProfile, type Profile } from '@/lib/profiles';
import { formatCourseLabel, getAcademicGroupNames } from '@/lib/academic';

export default function ProfileScreen() {
  const { user, session } = useAuth();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [draftName, setDraftName] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [academic, setAcademic] = useState<{ academicLevel: { code: string; name: string } | null; course: { code: string; name: string } | null; yearLevel: { name: string } | null; section: { section_code: string; section_name: string; academic_year: string } | null }>({ academicLevel: null, course: null, yearLevel: null, section: null });
  const router = useRouter();
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      if (!user) {
        setProfile(null);
        setProfileLoading(false);
        return () => {
          active = false;
        };
      }

      setProfileLoading(true);
      setProfileError(null);
      getProfileWithError(user.id, session?.access_token)
        .then(({ profile: p, error }) => {
          if (!active || !mountedRef.current) return;
          setProfile(p);
          setProfileError(error ?? (!p ? 'No Acadence profile was found for this account.' : null));
          setDraftName(p?.full_name ?? '');
          if (p) getAcademicGroupNames(p).then(setAcademic);
        })
        .catch((error: unknown) => {
          if (!active || !mountedRef.current) return;
          console.error('Unable to load the account profile.', error);
          setProfileError(error instanceof Error ? error.message : 'Unable to load the account profile.');
        })
        .finally(() => {
          if (active && mountedRef.current) setProfileLoading(false);
        });

      return () => {
        active = false;
      };
    }, [session?.access_token, user])
  );

  const roleLabel = profile?.role === 'admin'
    ? 'Administrator'
    : profile?.role === 'teacher'
      ? 'Teacher'
      : profile?.role === 'student'
        ? 'Student'
        : 'Unavailable';

  const handleSaveName = async () => {
    if (!user || savingRef.current) return;

    savingRef.current = true;
    setSaving(true);
    try {
      const { error } = await updateProfile(user.id, {
        full_name: draftName.trim(),
      });
      if (!mountedRef.current) return;

      if (error) {
        Alert.alert('Error', error);
        return;
      }

      setProfile((prev: Profile | null) => {
        if (!prev) return prev;
        return {
          ...prev,
          full_name: draftName.trim(),
        };
      });
      setEditing(false);
      Alert.alert('Profile updated', 'Your display name was saved successfully.');
    } catch (error) {
      if (mountedRef.current) {
        Alert.alert('Error', error instanceof Error ? error.message : 'Failed to update your profile.');
      }
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  const handleSignOut = async () => {
    setLoading(true);
    try {
      await signOut();
      router.replace('/login');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to sign out.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.container, { paddingTop: 18 + insets.top, paddingBottom: 32 + insets.bottom }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>My Profile</Text>
        </View>
      </View>

      {user && profileLoading ? (
        <View style={styles.loadingCard}>
          <ActivityIndicator color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading profile...</Text>
        </View>
      ) : user ? (
        <>
        {profileError && <Text style={styles.profileError} accessibilityRole="alert">{profileError}</Text>}
        <SurfaceCard style={styles.infoCard}>
          <View style={styles.profileCardHeader}>
            <View style={styles.avatar}>
              <Ionicons name="person-outline" size={25} color={COLORS.primary} />
            </View>
            <View style={styles.profileIdentity}>
              <Text style={styles.identityName} numberOfLines={2}>
                {profile?.full_name || user.user_metadata?.full_name || 'Add your name'}
              </Text>
              <Text style={styles.identityEmail} numberOfLines={1}>{user.email}</Text>
            </View>
            {profile && !editing && <MotionPressable
              onPress={() => setEditing(true)}
              style={styles.editButton}
              accessibilityRole="button"
              accessibilityLabel="Edit profile name"
            >
              <Ionicons name="create-outline" size={15} color={COLORS.primary} />
              <Text style={styles.editHint}>Edit</Text>
            </MotionPressable>}
          </View>

          {editing && <View style={styles.nameEditRow}>
            <AppTextInput
              value={draftName}
              onChangeText={setDraftName}
              placeholder="Your name"
              placeholderTextColor={COLORS.textSecondary}
              containerStyle={styles.nameInputContainer}
              inputStyle={styles.nameInput}
              accessibilityLabel="Your name"
              returnKeyType="done"
            />
            <MotionPressable
              onPress={handleSaveName}
              style={({ pressed }) => [styles.saveButton, pressed && !saving && styles.saveButtonPressed, saving && styles.nameActionDisabled]}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Save profile name"
              accessibilityState={{ disabled: saving, busy: saving }}
            >
              {saving ? <ActivityIndicator size="small" color={COLORS.textOnPrimary} /> : <Text style={styles.saveButtonText}>Save</Text>}
            </MotionPressable>
            <MotionPressable
              onPress={() => { setEditing(false); setDraftName(profile?.full_name ?? ''); }}
              style={({ pressed }) => [styles.cancelButton, pressed && !saving && styles.cancelButtonPressed, saving && styles.nameActionDisabled]}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Cancel editing profile name"
              accessibilityState={{ disabled: saving }}
            >
              <Ionicons name="close" size={18} color={COLORS.textSecondary} />
            </MotionPressable>
          </View>}

          <View style={styles.roleRow}>
            <View style={styles.detailIcon}><Ionicons name="shield-checkmark-outline" size={16} color={COLORS.primary} /></View>
            <View style={styles.detailContent}>
              <Text style={styles.label}>ROLE</Text>
              <Text style={styles.roleBadgeText}>{roleLabel}</Text>
            </View>
          </View>
          <View style={styles.profileDivider} />
          <ProfileDetail icon="mail-outline" label="EMAIL" value={user.email ?? 'Not available'} />
          {profile?.role === 'student' && (
            <>
              <View style={styles.profileDivider} />
              <ProfileDetail icon="book-outline" label="COURSE" value={academic.course ? formatCourseLabel(academic.course) : 'Not assigned'} />
              <ProfileDetail icon="school-outline" label="ACADEMIC LEVEL" value={academic.academicLevel?.name ?? 'Not assigned'} />
              <ProfileDetail icon="layers-outline" label="YEAR LEVEL" value={academic.yearLevel?.name ?? 'Not assigned'} />
              <ProfileDetail icon="people-outline" label="SECTION / BLOCK" value={academic.section ? `${academic.section.section_name} (${academic.section.academic_year})` : 'Not assigned'} />
            </>
          )}
          <View style={styles.profileDivider} />
          <ProfileDetail icon="card-outline" label="MY ID" value={profile ? profile.display_id ?? 'Not assigned' : 'Unavailable'} />
        </SurfaceCard>
        </>
      ) : null}

      <SurfaceCard style={styles.signOutCard}>
        <View style={styles.signOutCopy}>
          <Text style={styles.signOutTitle}>Sign out</Text>
          <Text style={styles.signOutHint}>You can sign back in anytime.</Text>
        </View>
        <MotionPressable
          onPress={handleSignOut}
          disabled={loading}
          style={({ pressed }) => [styles.signOutButton, pressed && styles.signOutPressed, loading && styles.signOutDisabled]}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          {loading ? <ActivityIndicator color={COLORS.danger} size="small" /> : <Ionicons name="log-out-outline" size={19} color={COLORS.danger} />}
        </MotionPressable>
      </SurfaceCard>
    </ScrollView>
  );
}

function ProfileDetail({ icon, label, value }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailIcon}><Ionicons name={icon} size={16} color={COLORS.primary} /></View>
      <View style={styles.detailContent}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  container: {
    paddingHorizontal: 20,
  },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  eyebrow: { color: COLORS.primary, fontSize: 10, fontWeight: '800', letterSpacing: 1.1, marginBottom: 5 },
  title: {
    fontSize: 26,
    fontWeight: '800',
    fontFamily: FONTS.extraBold,
    color: COLORS.textPrimary,
    letterSpacing: -0.4,
  },
  infoCard: { padding: 16, marginBottom: 14 },
  profileCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  avatar: { width: 50, height: 50, borderRadius: 17, backgroundColor: `${COLORS.primary}1C`, borderWidth: 1, borderColor: `${COLORS.primary}33`, alignItems: 'center', justifyContent: 'center' },
  profileIdentity: { flex: 1 },
  identityName: { color: COLORS.textPrimary, fontSize: 17, fontWeight: '700', fontFamily: FONTS.bold, letterSpacing: -0.2 },
  identityEmail: { color: COLORS.textSecondary, fontSize: 12, fontFamily: FONTS.regular, marginTop: 4 },
  editButton: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: `${COLORS.primary}55`, backgroundColor: `${COLORS.primary}12`, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8 },
  loadingCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 14,
    fontFamily: FONTS.regular,
    color: COLORS.textSecondary,
    marginTop: 10,
  },
  profileError: {
    color: COLORS.danger,
    fontSize: 13,
    fontFamily: FONTS.medium,
    marginBottom: 12,
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: FONTS.bold,
    color: COLORS.textSecondary,
    letterSpacing: 0.7,
    marginBottom: 4,
  },
  value: {
    fontSize: 14,
    color: COLORS.textPrimary,
    fontWeight: '600',
    fontFamily: FONTS.semiBold,
    lineHeight: 20,
  },
  editHint: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '700',
    fontFamily: FONTS.bold,
  },
  nameEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 15,
  },
  nameInputContainer: { flex: 1 },
  nameInput: {
    flex: 1,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    minHeight: 44,
    paddingVertical: 9,
    color: COLORS.textPrimary,
    fontSize: 14,
    fontFamily: FONTS.regular,
  },
  saveButton: {
    backgroundColor: COLORS.primaryButtonStart,
    paddingHorizontal: 14,
    minWidth: 60,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  saveButtonPressed: { opacity: 0.86 },
  saveButtonText: {
    color: COLORS.textOnPrimary,
    fontWeight: '700',
    fontFamily: FONTS.bold,
  },
  cancelButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.background, borderRadius: 8 },
  cancelButtonPressed: { backgroundColor: COLORS.surface, borderColor: COLORS.primary },
  nameActionDisabled: { opacity: 0.55 },
  roleRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 11, marginVertical: 10 },
  detailIcon: { width: 34, height: 34, borderRadius: 8, backgroundColor: `${COLORS.primary}16`, alignItems: 'center', justifyContent: 'center' },
  detailContent: { flex: 1 },
  profileDivider: { height: 1, backgroundColor: COLORS.border, marginVertical: 6 },
  signOutCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, marginTop: 2 },
  signOutCopy: { flex: 1 },
  signOutTitle: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '700', fontFamily: FONTS.bold },
  signOutHint: { color: COLORS.textSecondary, fontSize: 12, fontFamily: FONTS.regular, marginTop: 4 },
  signOutButton: { width: 44, height: 44, borderRadius: 10, backgroundColor: `${COLORS.danger}14`, borderWidth: 1, borderColor: `${COLORS.danger}44`, alignItems: 'center', justifyContent: 'center', marginLeft: 12 },
  signOutPressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },
  signOutDisabled: { opacity: 0.55 },
  roleBadgeText: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: '700',
    fontFamily: FONTS.bold,
  },
});
