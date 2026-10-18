import Ionicons from '@expo/vector-icons/Ionicons';
import * as Linking from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AppTextInput from '@/components/AppTextInput';
import Header from '@/components/Header';
import MotionPressable from '@/components/MotionPressable';
import { COLORS, SPACING } from '@/constants/colors';
import { FONTS } from '@/constants/fonts';
import { signOut, updatePassword } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

type RecoveryParams = {
  accessToken?: string;
  refreshToken?: string;
  code?: string;
};

function readRecoveryParams(url: string): RecoveryParams {
  const hash = url.includes('#') ? url.slice(url.indexOf('#') + 1) : '';
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1).split('#')[0] : '';
  const params = new URLSearchParams([query, hash].filter(Boolean).join('&'));
  return {
    accessToken: params.get('access_token') ?? undefined,
    refreshToken: params.get('refresh_token') ?? undefined,
    code: params.get('code') ?? undefined,
  };
}

function getRecoveryErrorMessage(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes('expired') || normalized.includes('invalid')) {
    return 'This reset link has expired or is no longer valid. Request a new one.';
  }
  if (normalized.includes('network') || normalized.includes('fetch')) {
    return 'Unable to connect. Check your internet connection and try again.';
  }
  return 'We could not verify this reset link. Request a new one and try again.';
}

export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const compact = height - insets.top - insets.bottom < 700 || width < 360;
  const router = useRouter();
  const passwordRef = useRef<TextInput>(null);
  const processedUrl = useRef<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<'password' | 'confirmPassword' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let active = true;

    const handleUrl = async (url: string) => {
      if (!active || processedUrl.current === url) return;
      processedUrl.current = url;
      const { accessToken, refreshToken, code } = readRecoveryParams(url);
      if (!accessToken || !refreshToken) {
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (!active) return;
          if (exchangeError) {
            setError(getRecoveryErrorMessage(exchangeError.message));
            setStatus('missing');
          } else {
            setStatus('ready');
          }
          return;
        }
        if (active) setStatus('missing');
        return;
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (!active) return;
      if (sessionError) {
        setError(getRecoveryErrorMessage(sessionError.message));
        setStatus('missing');
      } else {
        setStatus('ready');
      }
    };

    const subscription = Linking.addEventListener('url', ({ url }) => { void handleUrl(url); });
    Linking.getInitialURL().then((url) => {
      const browserUrl = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.href : null;
      if (url || browserUrl) void handleUrl(url ?? browserUrl!);
      else if (active) setStatus('missing');
    }).catch(() => { if (active) setStatus('missing'); });

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  const handleSubmit = async () => {
    setError(null);
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      passwordRef.current?.focus();
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await updatePassword(password);
      if (updateError) {
        setError(getRecoveryErrorMessage(updateError.message));
        return;
      }
      try { await signOut(); } catch { /* The password was updated; sign-in remains available. */ }
      setSuccess(true);
    } catch (updateRequestError: unknown) {
      setError(updateRequestError instanceof Error
        ? getRecoveryErrorMessage(updateRequestError.message)
        : 'Unable to update your password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingHorizontal: width < 360 ? SPACING.md : SPACING.lg, paddingBottom: insets.bottom + SPACING.lg }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Header title="Acadence" topSpacing={0} logoWidth={compact ? 145 : 170} />
          <View style={[styles.intro, compact && styles.introCompact]}>
            <Text style={styles.eyebrow}>SECURE ACCOUNT</Text>
            <Text style={styles.title}>Create a new password</Text>
            <Text style={styles.subtitle}>Choose a new password for your Acadence account.</Text>
          </View>

          <View style={[styles.card, compact && styles.cardCompact]}>
            {status === 'loading' ? (
              <View style={styles.state}><ActivityIndicator color={COLORS.primary} /><Text style={styles.stateText}>Verifying reset link...</Text></View>
            ) : success ? (
              <View style={styles.state}>
                <View style={styles.successIcon}><Ionicons name="checkmark" size={28} color={COLORS.success} /></View>
                <Text style={styles.successTitle}>Password updated</Text>
                <Text style={styles.stateText}>Your password has been changed successfully.</Text>
                <MotionPressable style={styles.submitButton} onPress={() => router.replace('/login')} accessibilityRole="button">
                  <Ionicons name="arrow-forward" size={18} color={COLORS.textOnPrimary} />
                  <Text style={styles.submitText}>Back to Sign In</Text>
                </MotionPressable>
              </View>
            ) : status === 'missing' ? (
              <View style={styles.state}>
                <View style={styles.errorIcon}><Ionicons name="link-outline" size={27} color={COLORS.danger} /></View>
                <Text style={styles.successTitle}>Reset link unavailable</Text>
                <Text style={styles.stateText}>{error ?? 'Open this screen from the password reset email.'}</Text>
                <MotionPressable style={styles.backButton} onPress={() => router.replace('/forgot-password')} accessibilityRole="button">
                  <Text style={styles.backText}>Request a new link</Text>
                </MotionPressable>
              </View>
            ) : (
              <>
                <Text style={styles.label}>New password</Text>
                <View style={[styles.inputShell, compact && styles.inputShellCompact, focusedField === 'password' && styles.inputShellFocused]}>
                  <Ionicons name="lock-closed-outline" size={18} color={focusedField === 'password' ? COLORS.primary : COLORS.textMuted} />
                  <AppTextInput
                    ref={passwordRef}
                    containerStyle={styles.inputContainer}
                    inputStyle={[styles.input, compact && styles.inputCompact]}
                    value={password}
                    onChangeText={(value) => { setPassword(value); setError(null); }}
                    onFocus={() => setFocusedField('password')}
                    onBlur={() => setFocusedField(null)}
                    placeholder="At least 6 characters"
                    secureTextEntry={!showPassword}
                    textContentType="newPassword"
                    autoComplete="new-password"
                    returnKeyType="next"
                    editable={!loading}
                    accessibilityLabel="New password"
                  />
                  <MotionPressable style={styles.visibilityButton} onPress={() => setShowPassword((value) => !value)} accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide password' : 'Show password'} hitSlop={8}>
                    <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={19} color={COLORS.textSecondary} />
                  </MotionPressable>
                </View>

                <Text style={styles.confirmLabel}>Confirm password</Text>
                <View style={[styles.inputShell, compact && styles.inputShellCompact, focusedField === 'confirmPassword' && styles.inputShellFocused]}>
                  <Ionicons name="lock-closed-outline" size={18} color={focusedField === 'confirmPassword' ? COLORS.primary : COLORS.textMuted} />
                  <AppTextInput
                    containerStyle={styles.inputContainer}
                    inputStyle={[styles.input, compact && styles.inputCompact]}
                    value={confirmPassword}
                    onChangeText={(value) => { setConfirmPassword(value); setError(null); }}
                    onFocus={() => setFocusedField('confirmPassword')}
                    onBlur={() => setFocusedField(null)}
                    placeholder="Re-enter your password"
                    secureTextEntry={!showConfirmPassword}
                    textContentType="newPassword"
                    autoComplete="new-password"
                    returnKeyType="go"
                    onSubmitEditing={handleSubmit}
                    editable={!loading}
                    accessibilityLabel="Confirm password"
                  />
                  <MotionPressable style={styles.visibilityButton} onPress={() => setShowConfirmPassword((value) => !value)} accessibilityRole="button" accessibilityLabel={showConfirmPassword ? 'Hide confirmed password' : 'Show confirmed password'} hitSlop={8}>
                    <Ionicons name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'} size={19} color={COLORS.textSecondary} />
                  </MotionPressable>
                </View>
                {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
                <MotionPressable style={({ pressed }) => [styles.submitButton, pressed && styles.pressed, loading && styles.disabled]} onPress={handleSubmit} disabled={loading} accessibilityRole="button" accessibilityState={{ busy: loading, disabled: loading }}>
                  {loading ? <ActivityIndicator color={COLORS.textOnPrimary} /> : <Ionicons name="lock-open-outline" size={18} color={COLORS.textOnPrimary} />}
                  <Text style={styles.submitText}>{loading ? 'Updating...' : 'Update password'}</Text>
                </MotionPressable>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  keyboardView: { flex: 1 },
  scrollContent: { flexGrow: 1, width: '100%', maxWidth: 480, alignSelf: 'center', justifyContent: 'center', paddingHorizontal: SPACING.lg },
  intro: { alignItems: 'center', marginTop: 12, marginBottom: 18 },
  introCompact: { marginTop: 6, marginBottom: 12 },
  eyebrow: { color: COLORS.primaryLight, backgroundColor: `${COLORS.primaryDark}55`, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, fontSize: 11, letterSpacing: 1.1, fontFamily: FONTS.bold },
  title: { color: COLORS.textPrimary, fontSize: 25, lineHeight: 31, textAlign: 'center', fontFamily: FONTS.bold, marginTop: 10 },
  subtitle: { maxWidth: 330, color: COLORS.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center', fontFamily: FONTS.regular, marginTop: 4 },
  card: { padding: 17, borderRadius: 17, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.card, shadowColor: COLORS.primaryDark, shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 5 }, elevation: 5 },
  cardCompact: { padding: 14 },
  state: { alignItems: 'center', paddingVertical: 12 },
  stateText: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 10, fontFamily: FONTS.regular },
  successIcon: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: `${COLORS.success}18`, borderWidth: 1, borderColor: `${COLORS.success}45` },
  errorIcon: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: `${COLORS.danger}18`, borderWidth: 1, borderColor: `${COLORS.danger}45` },
  successTitle: { color: COLORS.textPrimary, fontSize: 18, textAlign: 'center', fontFamily: FONTS.bold, marginTop: 12 },
  label: { color: COLORS.textPrimary, fontSize: 13, fontFamily: FONTS.semiBold, marginBottom: 6 },
  confirmLabel: { color: COLORS.textPrimary, fontSize: 13, fontFamily: FONTS.semiBold, marginTop: 15, marginBottom: 6 },
  inputShell: { minHeight: 51, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, backgroundColor: COLORS.surfaceRaised },
  inputShellCompact: { minHeight: 46 },
  inputShellFocused: { borderColor: COLORS.primary },
  inputContainer: { flex: 1 },
  input: { minHeight: 50, paddingHorizontal: 0, paddingVertical: 10, borderWidth: 0, backgroundColor: 'transparent', color: COLORS.textPrimary, fontSize: 14, fontFamily: FONTS.regular },
  inputCompact: { minHeight: 44, paddingVertical: 7 },
  visibilityButton: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  error: { color: COLORS.danger, fontSize: 12, lineHeight: 17, marginTop: 9, fontFamily: FONTS.medium },
  submitButton: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 15, borderRadius: 14, backgroundColor: COLORS.primaryButtonStart },
  submitText: { color: COLORS.textOnPrimary, fontSize: 14, fontFamily: FONTS.semiBold },
  backButton: { minHeight: 42, justifyContent: 'center', alignItems: 'center', marginTop: 12 },
  backText: { color: COLORS.primary, fontSize: 13, fontFamily: FONTS.semiBold },
  pressed: { opacity: 0.86 },
  disabled: { opacity: 0.7 },
});
